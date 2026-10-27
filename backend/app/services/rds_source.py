"""Reads Transport Finder data from the read-only Vacalvers RDS (MySQL). Used when
`settings.data_source == "rds"`. The VaCalvers CSV (`vacalvers_source.py`) remains the default and
is unaffected by this module; switching to RDS is opt-in via `DATA_SOURCE=rds`.

READ-ONLY, always:
- The DB user is granted SELECT, SHOW VIEW only (no INSERT/UPDATE/DELETE/DDL grants exist for it).
- Every connection additionally runs `SET SESSION TRANSACTION READ ONLY` as a second guard.
- Only SELECT and information_schema-style read queries are issued anywhere in this file.
- Nothing here ever creates, drops or alters a table, or writes to the RDS in any way.

Credentials: read directly from the project-root `.env` (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD,
DB_NAME) at connection time only. They are never placed on the Settings object, never logged and
never sent to the frontend — only the resulting table rows are.

Schema used (found by read-only inspection of information_schema; nothing here was guessed):
    orders:  buyer_city, buyer_state_id, buyer_pincode, shipment_courier_id, shipment_courier
    states:  id, name                              (buyer_state_id -> states.id)
    couriers: id, name                              (shipment_courier_id -> couriers.id)
    courier_locations: courier_id, phone            (a transporter contact-phone directory)
No customer name/phone/email/address, order number, price or order-status column is ever read.
ALL orders are used regardless of order_status or order date — nothing is filtered by recency.

Courier naming: `couriers.name` (via shipment_courier_id) is preferred; `orders.shipment_courier`
free text is used only when no id is set (older orders). Values that are clearly not a transporter
name are excluded: self pickup, hand/local delivery, COD, a driver's own name ("DRIVER: ..."),
"customer label", "other(s)", numeric/tracking-number noise, and a short list of obvious
test/placeholder rows seen in this specific database (demo, abc, ...). See EXCLUDED_TRANSPORTS.

Mobile No: `courier_locations` is a phone directory keyed by courier, not by destination city (its
own `city` column is almost always the *pickup* location, e.g. Rajkot). A transporter's number is
used only when every courier_id sharing its (normalised) name in courier_locations agrees on a
single phone value; if there is more than one distinct number, or none, it stays "Not Available" —
never guessed.

City/state consistency: `buyer_city` and `buyer_state_id` are independent, free-entry fields on the
same order, and a small number of orders have a city typed correctly but the wrong state selected
(e.g. buyer_city "Ahmedabad" with the state recorded as "Goa"). When a row's own pincode clearly
disagrees with its own state (see `excel_source.pincode_state_conflicts`), only that row's state is
dropped — the order is still found by pincode/city search — so one bad state selection can't make an
unrelated transporter appear in a state (or city+state) search for somewhere it never actually served.
"""
import json
import logging
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import pymysql
from dotenv import dotenv_values

from .excel_source import ACRONYMS, Entry, ExcelIndex, key, pincode_state_conflicts

log = logging.getLogger(__name__)

# Values seen in shipment_courier / couriers.name that are not transporter names.
EXCLUDED_TRANSPORTS = {
    "COD", "LOCAL", "SELF PICKUP", "CUSTOMER LABEL", "CUSTOMER LEBAL", "OTHER", "OTHERS",
    "DISPATCH", "BAG NUMBER", "CUSTOMER BILL", "RAJKOT GODOWN",
    "ABC", "ABC ABC", "ABC XYZ", "DEMO", "DEODAP", "DOEDPA", "",
}
_DRIVER_RE = re.compile(r"^driv[ae]r\b", re.I)  # "driver" and the observed typo "drivar"
_STRIP_RE = re.compile(r"^[\s:\-.,]+|[\s:\-.,]+$")  # stray leading ":"/"-" seen on some entries


class RdsUnavailable(Exception):
    """Missing credentials or a connection/query failure. Never contains the password."""


@dataclass(frozen=True)
class IndexStats:
    total_rows: int
    valid_rows: int
    invalid_rows: int
    unique_records: int
    duplicate_rows_removed: int


def _blank(v) -> bool:
    return v is None or not str(v).strip()


def normalize_transport(raw) -> str | None:
    if _blank(raw):
        return None
    text = _STRIP_RE.sub("", re.sub(r"\s+", " ", str(raw))).strip()
    if len(text) < 2 or re.fullmatch(r"[\d.\s]+", text):
        return None
    if text.upper() in EXCLUDED_TRANSPORTS or _DRIVER_RE.match(text):
        return None
    words = text.title().split(" ")
    return " ".join(ACRONYMS.get(w, w) for w in words)


def normalize_place(raw) -> str | None:
    """None for blank, purely-numeric (a stray pincode typed into the city field), or address-like
    values. `buyer_city` is free text and sometimes holds a full shipping address rather than a
    city name (comma-separated parts, a house/flat number, an unusually long string); showing that
    verbatim as "City Name" would expose customer address information, so it is blanked instead."""
    if _blank(raw):
        return None
    text = re.sub(r"\s+", " ", str(raw)).strip()
    if re.fullmatch(r"[\d\s]+", text) or "," in text or len(text) > 35:
        return None
    return text.title()


def normalize_pincode(raw) -> str | None:
    if _blank(raw):
        return None
    text = str(raw).strip()
    return text if re.fullmatch(r"\d{6}", text) else None


def _credentials(env_path: str) -> dict:
    env = dotenv_values(env_path)
    missing = [k for k in ("DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME") if not env.get(k)]
    if missing:
        raise RdsUnavailable(f"RDS credentials missing from {env_path}: {', '.join(missing)}")
    return env


def _connect(env_path: str):
    env = _credentials(env_path)
    try:
        conn = pymysql.connect(
            host=env["DB_HOST"], port=int(env["DB_PORT"]), user=env["DB_USER"], password=env["DB_PASSWORD"],
            database=env["DB_NAME"], connect_timeout=10, read_timeout=60, autocommit=True,
        )
    except Exception as exc:  # never let the password reach an error message
        raise RdsUnavailable(f"Could not connect to the RDS ({type(exc).__name__})") from exc
    with conn.cursor() as cur:
        cur.execute("SET SESSION TRANSACTION READ ONLY")  # extra guard beyond the SELECT-only grant
    return conn


def _fetch_entries_and_stats(conn) -> tuple[list[Entry], IndexStats]:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM orders")  # SELECT only
        total_rows = cur.fetchone()[0]

        cur.execute("""
            SELECT o.buyer_city, s.name, o.buyer_pincode,
                   COALESCE(c.name, o.shipment_courier) AS transport_raw, COUNT(*) AS n
            FROM orders o
            LEFT JOIN states s ON s.id = o.buyer_state_id
            LEFT JOIN couriers c ON c.id = o.shipment_courier_id
            WHERE o.shipment_courier_id IS NOT NULL OR (o.shipment_courier IS NOT NULL AND o.shipment_courier <> '')
            GROUP BY o.buyer_city, s.name, o.buyer_pincode, transport_raw
        """)  # SELECT only; aggregation happens server-side so no order-level row ever leaves the DB
        combos = cur.fetchall()

    valid = invalid = 0
    counts: dict[tuple, int] = {}
    for raw_city, raw_state, raw_pincode, raw_transport, n in combos:
        transport = normalize_transport(raw_transport)
        city = normalize_place(raw_city)
        state = normalize_place(raw_state)
        pincode = normalize_pincode(raw_pincode)
        if pincode_state_conflicts(pincode, state):
            # A single order's own buyer_state disagrees with its own buyer_pincode (data-entry
            # error, e.g. state "Goa" selected against a Gujarat pincode) -- drop only the
            # untrustworthy state, not the whole row, so it's still found by pincode/city search.
            state = None
        if not transport or not (pincode or city or state):
            invalid += n
            continue
        valid += n
        k = (transport, pincode, city, state)
        counts[k] = counts.get(k, 0) + n
    invalid += total_rows - sum(n for *_, n in combos)  # rows with no courier value at all

    entries = [Entry(t, p, c, s, count=n, last_date=None) for (t, p, c, s), n in counts.items()]
    stats = IndexStats(total_rows, valid, invalid, len(entries), valid - len(entries))
    return entries, stats


def _fetch_phonebook(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT c.name, cl.phone
            FROM courier_locations cl
            JOIN couriers c ON c.id = cl.courier_id
            WHERE cl.phone IS NOT NULL AND cl.phone <> ''
        """)  # SELECT only
        rows = cur.fetchall()
    by_name: dict[str, set[str]] = {}
    for name, phone in rows:
        k = key(normalize_transport(name) or "")
        if not k:
            continue
        by_name.setdefault(k, set()).add(phone.strip())
    return {k: next(iter(phones)) for k, phones in by_name.items() if len(phones) == 1}


_lock = threading.Lock()
_entries: list[Entry] | None = None
_stats: IndexStats | None = None
_phonebook: dict[str, str] | None = None
_built_at: float = 0.0
_index: ExcelIndex | None = None  # built once per _entries list, not once per request

# Stale-while-revalidate: once there is data, an expired snapshot keeps being served while ONE
# background thread re-queries the RDS (the aggregate over ~2.4M orders takes seconds), so no
# search ever waits for it. Only the very first build in a process, with no data at all, blocks.
REFRESH_RETRY_SECONDS = 120  # after a failed background refresh, keep the old data this long
_refreshing = False
_next_attempt: float = 0.0
_refresh_listeners: list = []  # called (no args, background thread) after each background refresh


def add_refresh_listener(fn) -> None:
    """`fn()` runs after a background refresh swaps in new data, e.g. to pre-build caches that
    depend on it so the next search doesn't pay for that either."""
    _refresh_listeners.append(fn)


def _cache_file(cache_dir: Path | None) -> Path | None:
    return (cache_dir / "rds_index.json") if cache_dir else None


def _read_cache_file(cache_file: Path | None):
    """(entries, stats, phonebook, built_at) from the JSON snapshot, whatever its age; else None."""
    if not (cache_file and cache_file.is_file()):
        return None
    try:
        blob = json.loads(cache_file.read_text(encoding="utf-8"))
        return ([Entry(*row) for row in blob["entries"]], IndexStats(**blob["stats"]), blob["phonebook"],
                blob["built_at"])
    except (ValueError, TypeError, KeyError, OSError):
        return None


def _query_rds(cache_file: Path | None, env_path: str):
    """One read-only round trip: the aggregate + phonebook, also written to the JSON snapshot."""
    conn = _connect(env_path)
    try:
        entries, stats = _fetch_entries_and_stats(conn)
        phonebook = _fetch_phonebook(conn)
    finally:
        conn.close()
    built_at = time.time()
    if cache_file:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache_file.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({
                "built_at": built_at,
                "entries": [list(vars(e).values()) for e in entries],
                "stats": vars(stats),
                "phonebook": phonebook,
            }),
            encoding="utf-8",
        )
        tmp.replace(cache_file)  # atomic, so a restart mid-write never reads half a file
    return entries, stats, phonebook, built_at


def _background_refresh(cache_file: Path | None, env_path: str) -> None:
    global _entries, _stats, _phonebook, _built_at, _refreshing, _next_attempt
    try:
        built = _query_rds(cache_file, env_path)
    except Exception as exc:  # RdsUnavailable or a query error: keep serving the old snapshot
        log.warning("Background RDS refresh failed (%s); still serving the previous snapshot.", exc)
        with _lock:
            _refreshing, _next_attempt = False, time.time() + REFRESH_RETRY_SECONDS
        return
    with _lock:
        _entries, _stats, _phonebook, _built_at = built
        _refreshing = False
    for fn in list(_refresh_listeners):
        try:
            fn()
        except Exception:
            log.exception("RDS refresh listener failed")


def _ensure_built(cache_dir: Path | None, env_path: str, ttl_seconds: int) -> None:
    global _entries, _stats, _phonebook, _built_at, _refreshing
    with _lock:
        now = time.time()
        if _entries is not None and (now - _built_at) < ttl_seconds:
            return
        cache_file = _cache_file(cache_dir)
        if _entries is None:
            cached = _read_cache_file(cache_file)
            if cached is not None:
                _entries, _stats, _phonebook, _built_at = cached
                if (now - _built_at) < ttl_seconds:
                    return
        if _entries is not None:  # stale: serve it now, refresh behind the scenes
            if not _refreshing and now >= _next_attempt:
                _refreshing = True
                threading.Thread(target=_background_refresh, args=(cache_file, env_path),
                                 name="rds-refresh", daemon=True).start()
            return
        # Nothing to serve yet: this first build has to wait (RdsUnavailable -> CSV fallback upstream).
        _entries, _stats, _phonebook, _built_at = _query_rds(cache_file, env_path)


def get_index(cache_dir: Path | None, env_path: str, ttl_seconds: int) -> ExcelIndex:
    global _index
    _ensure_built(cache_dir, env_path, ttl_seconds)
    entries = _entries
    if _index is None or _index.entries is not entries:
        _index = ExcelIndex(entries)
    return _index


def get_phonebook(cache_dir: Path | None, env_path: str, ttl_seconds: int) -> dict[str, str]:
    _ensure_built(cache_dir, env_path, ttl_seconds)
    return _phonebook


def get_last_stats() -> IndexStats | None:
    return _stats
