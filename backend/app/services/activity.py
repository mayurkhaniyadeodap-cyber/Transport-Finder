"""Activity Log: who did what, and when -- sign-ins, panel opens, searches, profile views and every
Admin change. Stored in the same local SQLite file as the rest of the Admin data (table
`activity_log`, created by overrides_store), never in the RDS.

Each row keeps the actor's role, User id and login ID *as it was at the time* (so renaming a User
later doesn't rewrite history), plus the client IP. Recording never breaks the action being
recorded: a failure to write the log is logged server-side and otherwise ignored."""
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..config import settings
from . import overrides_store

log = logging.getLogger(__name__)

KINDS = ("session", "search", "profile", "admin", "settings")
MAX_DETAIL = 300
IST = timezone(timedelta(hours=5, minutes=30))  # "today" for the summary counts is the India day

# What the app itself may report (POST /api/activity). Everything else is recorded by the server
# where the action happens, so a client can't invent Admin changes.
CLIENT_EVENTS = {
    "panel_open": ("session", "Panel opened"),
    "search": ("search", "Search performed"),
    "profile_view": ("profile", "Transporter profile viewed"),
}


def _path() -> Path:
    return Path(settings.overrides_db_path)


def _stamp(dt: datetime | None = None) -> str:
    return (dt or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds")


def record(who, kind: str, event: str, detail: str | None = None, *, ip: str | None = None,
           login_id: str | None = None) -> None:
    """Adds one entry. `who` is an accounts.Identity (or None when nobody is signed in, e.g. a failed
    sign-in -- then `login_id` names the ID that was tried)."""
    from . import accounts  # here, not at import time: accounts imports overrides_store too

    try:
        role = getattr(who, "role", None)
        user_id = getattr(who, "user_id", None)
        if who is not None and login_id is None:
            login_id = accounts.account_info(who)["login_id"]
        conn = overrides_store._connect(_path())
        try:
            conn.execute(
                "INSERT INTO activity_log (created_at, role, user_id, login_id, kind, event, detail, ip) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (_stamp(), role, user_id, login_id, kind if kind in KINDS else "session", event[:120],
                 (detail or "")[:MAX_DETAIL] or None, (ip or "")[:64] or None),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        log.exception("Could not write to the activity log")


def _scope(who) -> tuple[str, list]:
    """The Admin sees everyone's activity; a User sees only their own."""
    if who.role == "admin":
        return "1 = 1", []
    return "role = 'user' AND user_id = ?", [who.user_id]


def list_activity(who, *, limit: int = 50, offset: int = 0, kind: str | None = None, q: str | None = None) -> dict:
    where, params = _scope(who)
    if kind in KINDS:
        where += " AND kind = ?"
        params.append(kind)
    if q and q.strip():
        like = f"%{q.strip()}%"
        where += " AND (event LIKE ? OR detail LIKE ? OR login_id LIKE ?)"
        params += [like, like, like]

    scope_where, scope_params = _scope(who)
    today_start = _stamp(datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0))
    conn = overrides_store._connect(_path())
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM activity_log WHERE {where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT id, created_at, role, login_id, kind, event, detail, ip FROM activity_log WHERE {where} "
            "ORDER BY id DESC LIMIT ? OFFSET ?", [*params, limit, offset],
        ).fetchall()
        today = conn.execute(
            f"SELECT COUNT(*) AS events, "
            f"COALESCE(SUM(event = 'Panel opened'), 0) AS panel_opens, "
            f"COALESCE(SUM(kind = 'search'), 0) AS searches "
            f"FROM activity_log WHERE {scope_where} AND created_at >= ?", [*scope_params, today_start],
        ).fetchone()
    finally:
        conn.close()
    return {
        "results": [dict(r) for r in rows],
        "total": total,
        "today": {"events": today["events"], "panel_opens": today["panel_opens"], "searches": today["searches"]},
    }
