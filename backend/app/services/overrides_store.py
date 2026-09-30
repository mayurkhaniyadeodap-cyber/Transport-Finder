"""Local manual overrides for Transport Finder — Transporter Management.

Stores everything in a small local SQLite file (settings.overrides_db_path). This is entirely
separate from the RDS/CSV/Excel data: nothing here ever reads from or writes to the RDS or the
CSV/Excel files. Search results are built from the real source first, and this store is then
overlaid on top (see excel_search.py) — RDS real data -> local override -> combined result.

One row here is either:
  - an edit of an existing (RDS/CSV/Excel-sourced) row, identified by its original
    (source_city, source_transport_name, source_pincode) — `is_new = 0`; or
  - a brand-new transporter that has no source row at all — `is_new = 1`, and its
    override_transport_name/override_city/override_pincode/... fields ARE its full definition.

Any override_* field left NULL means "keep whatever the source shows" (mobile stays
"Not Available", name/city/pincode/status stay as the source has them). `hidden = 1` removes the
row from Transport Finder's results entirely, without touching the source.

A second table, `transporter_settings`, holds Admin actions on a whole transporter (all of its
merged rows at once), keyed by its match key (excel_source.key of its canonical name):
status/mobile overrides, a display-name rename, replacement Service Cities / Pincodes lists (NULL
= use the real data), hidden (kept in Manage Transporters, dropped from search) and deleted
(dropped from both; restorable). `is_new = 1` is a transporter an Admin added from scratch, whose
lists ARE its full definition. Also local-only.

A third table, `transporter_photos`, holds each transporter's profile photo (the image bytes, keyed
the same way as transporter_settings), uploaded from Manage Transporters. Local-only as well.

Initialisation/migration is safe to run on every connection: tables are created if missing, and
columns added in later versions are added in place. Before the first such in-place migration of an
existing file, a full copy is written next to it (`<name>.pre-migration-<UTC time>.db`), so an
upgrade can never lose Admin data. `init_db()` runs this once at server startup and reports where
the file is and what it holds.
"""
import hashlib
import json
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ("transport_name", "city", "pincode", "mobile", "status")  # override_* columns, short names


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    existed = path.is_file() and path.stat().st_size > 0
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    _ensure_schema(conn, path, existed)
    return conn


def _ensure_schema(conn: sqlite3.Connection, path: Path, existed: bool) -> list[str]:
    """Creates any missing table and adds any missing column; returns the columns added. Backs the
    file up first if it already held data and needs an in-place migration."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transporter_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            is_new INTEGER NOT NULL DEFAULT 0,
            source_city TEXT,
            source_transport_name TEXT,
            source_pincode TEXT,
            override_transport_name TEXT,
            override_city TEXT,
            override_pincode TEXT,
            override_mobile TEXT,
            override_status TEXT,
            hidden INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transporter_settings (
            name_key TEXT PRIMARY KEY,
            transport_name TEXT NOT NULL,
            status TEXT,
            mobile TEXT,
            hidden INTEGER NOT NULL DEFAULT 0,
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transporter_photos (
            name_key TEXT PRIMARY KEY,
            content_type TEXT NOT NULL,
            data BLOB NOT NULL,
            sha256 TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    # Settings page: the Admin sign-in account (password stored only as a salted PBKDF2 hash), the
    # signed-in sessions (only a SHA-256 of each token), and app-wide preferences (JSON values).
    # Users (any number, managed by the Admin) are in app_users below.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_accounts (
            role TEXT PRIMARY KEY,
            login_id TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_sessions (
            token_hash TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            user_id INTEGER,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            login_id TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    # User IDs are unique regardless of letter case ("Ravi" and "ravi" can't both exist).
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS app_users_login_id ON app_users (login_id COLLATE NOCASE)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.commit()
    missing = []
    for table, added in _ADDED_COLUMNS.items():
        have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        missing += [(table, col, ddl) for col, ddl in added if col not in have]
    if missing and existed:
        _backup(conn, path.with_name(f"{path.stem}.pre-migration-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}{path.suffix}"))
    for table, col, ddl in missing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
    conn.commit()
    return [col for _, col, _ in missing]


def _backup(conn: sqlite3.Connection, dest: Path) -> None:
    """A consistent copy via SQLite's own online-backup API (safe even while the server runs)."""
    target = sqlite3.connect(str(dest))
    try:
        conn.backup(target)
    finally:
        target.close()


def location_warning(path: Path) -> str | None:
    """Why `path` is a risky place for the only copy of Admin data, or None if it's fine: a cache,
    build or temp directory can be wiped by a cleanup, rebuild or reboot."""
    resolved = path.resolve()
    risky = {".cache", "cache", "dist", "build", "node_modules", "__pycache__", "tmp", "temp"}
    hit = next((p for p in resolved.parent.parts if p.lower() in risky), None)
    if hit:
        return f'it is inside a "{hit}" directory'
    try:
        resolved.relative_to(Path(tempfile.gettempdir()).resolve())
        return "it is inside the system temp directory"
    except ValueError:
        return None


def init_db(path: Path) -> dict:
    """Server-startup initialisation: creates the file and tables if missing, migrates an older
    schema in place (after a safety backup), and returns what it found, for logging."""
    created = not (path.is_file() and path.stat().st_size > 0)
    conn = _connect(path)
    try:
        count = lambda sql: conn.execute(sql).fetchone()[0]
        return {
            "path": str(path.resolve()),
            "created": created,
            "row_overrides": count("SELECT COUNT(*) FROM transporter_overrides"),
            "transporter_settings": count("SELECT COUNT(*) FROM transporter_settings"),
            "deleted": count("SELECT COUNT(*) FROM transporter_settings WHERE deleted = 1"),
            "photos": count("SELECT COUNT(*) FROM transporter_photos"),
            "integrity": count("PRAGMA quick_check"),
            "warning": location_warning(path),
        }
    finally:
        conn.close()


# Columns added after a table first shipped; migrated in place on connect.
_SETTINGS_ADDED_COLUMNS = (
    ("display_name", "TEXT"),
    ("service_cities", "TEXT"),  # JSON list, NULL = real data
    ("pincodes", "TEXT"),  # JSON list, NULL = real data
    ("is_new", "INTEGER NOT NULL DEFAULT 0"),
    ("shipment_charge", "TEXT"),  # Admin-entered approx. charge per box in rupees, e.g. "75.50"; NULL = not set
)
_ADDED_COLUMNS = {
    "transporter_settings": _SETTINGS_ADDED_COLUMNS,
    "app_sessions": (("user_id", "INTEGER"),),  # which User a "user" session belongs to (NULL for Admin)
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["is_new"] = bool(d["is_new"])
    d["hidden"] = bool(d["hidden"])
    return d


def list_overrides(path: Path) -> list[dict]:
    conn = _connect(path)
    try:
        rows = conn.execute("SELECT * FROM transporter_overrides ORDER BY updated_at DESC").fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_by_id(path: Path, override_id: int) -> dict | None:
    conn = _connect(path)
    try:
        row = conn.execute("SELECT * FROM transporter_overrides WHERE id = ?", (override_id,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def upsert_existing(path: Path, source_city: str | None, source_transport_name: str, source_pincode: str | None,
                     **fields) -> dict:
    """Create or update the override for an existing source row, identified by its original
    (source_city, source_transport_name, source_pincode). NULL-safe match, since city/pincode can
    legitimately be missing on a real row."""
    conn = _connect(path)
    try:
        existing = conn.execute(
            """SELECT id FROM transporter_overrides
               WHERE is_new = 0 AND source_transport_name = ?
                 AND source_city IS ? AND source_pincode IS ?""",
            (source_transport_name, source_city, source_pincode),
        ).fetchone()
        now = _now()
        if existing:
            _update(conn, existing["id"], fields, now)
            override_id = existing["id"]
        else:
            cols = ["is_new", "source_city", "source_transport_name", "source_pincode", "created_at", "updated_at"]
            vals = [0, source_city, source_transport_name, source_pincode, now, now]
            for key in FIELDS:
                if key in fields and fields[key] is not None:
                    cols.append(f"override_{key}")
                    vals.append(fields[key])
            if "hidden" in fields and fields["hidden"] is not None:
                cols.append("hidden")
                vals.append(1 if fields["hidden"] else 0)
            placeholders = ", ".join("?" for _ in vals)
            cur = conn.execute(f"INSERT INTO transporter_overrides ({', '.join(cols)}) VALUES ({placeholders})", vals)
            override_id = cur.lastrowid
        conn.commit()
        return get_by_id(path, override_id)
    finally:
        conn.close()


def create_new(path: Path, transport_name: str, city: str | None, pincode: str | None,
                mobile: str | None = None, status: str | None = None) -> dict:
    """A brand-new transporter with no source row — override_* fields ARE its full definition."""
    conn = _connect(path)
    try:
        now = _now()
        cur = conn.execute(
            """INSERT INTO transporter_overrides
               (is_new, override_transport_name, override_city, override_pincode, override_mobile,
                override_status, created_at, updated_at)
               VALUES (1, ?, ?, ?, ?, ?, ?, ?)""",
            (transport_name, city, pincode, mobile, status, now, now),
        )
        conn.commit()
        return get_by_id(path, cur.lastrowid)
    finally:
        conn.close()


def _update(conn: sqlite3.Connection, override_id: int, fields: dict, now: str) -> None:
    sets, vals = [], []
    for key in FIELDS:
        if key in fields and fields[key] is not None:
            sets.append(f"override_{key} = ?")
            vals.append(fields[key])
    if "hidden" in fields and fields["hidden"] is not None:
        sets.append("hidden = ?")
        vals.append(1 if fields["hidden"] else 0)
    if not sets:
        return
    sets.append("updated_at = ?")
    vals.append(now)
    vals.append(override_id)
    conn.execute(f"UPDATE transporter_overrides SET {', '.join(sets)} WHERE id = ?", vals)


def update_by_id(path: Path, override_id: int, **fields) -> dict | None:
    conn = _connect(path)
    try:
        if not conn.execute("SELECT 1 FROM transporter_overrides WHERE id = ?", (override_id,)).fetchone():
            return None
        _update(conn, override_id, fields, _now())
        conn.commit()
        return get_by_id(path, override_id)
    finally:
        conn.close()


def delete_by_id(path: Path, override_id: int) -> bool:
    conn = _connect(path)
    try:
        cur = conn.execute("DELETE FROM transporter_overrides WHERE id = ?", (override_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def set_photo(path: Path, name_key: str, content_type: str, data: bytes) -> str:
    """Stores (or replaces) one transporter's photo; returns its content hash (its version)."""
    sha = hashlib.sha256(data).hexdigest()
    conn = _connect(path)
    try:
        conn.execute(
            """INSERT INTO transporter_photos (name_key, content_type, data, sha256, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(name_key) DO UPDATE SET content_type = excluded.content_type,
                 data = excluded.data, sha256 = excluded.sha256, updated_at = excluded.updated_at""",
            (name_key, content_type, sqlite3.Binary(data), sha, _now()),
        )
        conn.commit()
        return sha
    finally:
        conn.close()


def get_photo(path: Path, name_key: str) -> tuple[str, bytes] | None:
    conn = _connect(path)
    try:
        row = conn.execute("SELECT content_type, data FROM transporter_photos WHERE name_key = ?", (name_key,)).fetchone()
        return (row["content_type"], bytes(row["data"])) if row else None
    finally:
        conn.close()


def delete_photo(path: Path, name_key: str) -> bool:
    conn = _connect(path)
    try:
        cur = conn.execute("DELETE FROM transporter_photos WHERE name_key = ?", (name_key,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def list_photo_versions(path: Path) -> dict[str, str]:
    """name_key -> content hash, for every transporter with a photo (the image data isn't read)."""
    conn = _connect(path)
    try:
        return {r["name_key"]: r["sha256"] for r in conn.execute("SELECT name_key, sha256 FROM transporter_photos")}
    finally:
        conn.close()


def _settings_row(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["hidden"] = bool(d["hidden"])
    d["deleted"] = bool(d["deleted"])
    d["is_new"] = bool(d["is_new"])
    for col in ("service_cities", "pincodes"):
        d[col] = json.loads(d[col]) if d[col] is not None else None
    return d


def list_transporter_settings(path: Path) -> dict[str, dict]:
    conn = _connect(path)
    try:
        rows = conn.execute("SELECT * FROM transporter_settings").fetchall()
        return {r["name_key"]: _settings_row(r) for r in rows}
    finally:
        conn.close()


def set_transporter_settings(path: Path, name_key: str, transport_name: str, *, status: str | None = None,
                             mobile: str | None = None, hidden: bool | None = None,
                             deleted: bool | None = None, display_name: str | None = None,
                             service_cities: list[str] | None = None, pincodes: list[str] | None = None,
                             is_new: bool | None = None, shipment_charge: str | None = None) -> dict:
    """Create or update one transporter's settings. A None argument leaves that field unchanged;
    display_name="" clears a rename and shipment_charge="" clears the charge. `transport_name` is the name the key was derived from and
    never changes once stored."""
    conn = _connect(path)
    try:
        now = _now()
        conn.execute(
            """INSERT INTO transporter_settings (name_key, transport_name, created_at, updated_at)
               VALUES (?, ?, ?, ?) ON CONFLICT(name_key) DO NOTHING""",
            (name_key, transport_name, now, now),
        )
        sets, vals = ["updated_at = ?"], [now]
        for col, v in (("status", status), ("mobile", mobile)):
            if v is not None:
                sets.append(f"{col} = ?")
                vals.append(v)
        if display_name is not None:
            sets.append("display_name = ?")
            vals.append(display_name or None)
        if shipment_charge is not None:
            sets.append("shipment_charge = ?")
            vals.append(shipment_charge or None)
        for col, v in (("service_cities", service_cities), ("pincodes", pincodes)):
            if v is not None:
                sets.append(f"{col} = ?")
                vals.append(json.dumps(v))
        if is_new is not None:
            sets.append("is_new = ?")
            vals.append(1 if is_new else 0)
        for col, v in (("hidden", hidden), ("deleted", deleted)):
            if v is not None:
                sets.append(f"{col} = ?")
                vals.append(1 if v else 0)
        conn.execute(f"UPDATE transporter_settings SET {', '.join(sets)} WHERE name_key = ?", [*vals, name_key])
        conn.commit()
        row = conn.execute("SELECT * FROM transporter_settings WHERE name_key = ?", (name_key,)).fetchone()
        return _settings_row(row)
    finally:
        conn.close()
