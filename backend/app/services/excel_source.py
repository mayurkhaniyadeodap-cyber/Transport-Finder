"""Reads the DAILY DISPATCH SHEET workbook and builds an in-memory index of
(transport, pincode, city, state) -> dispatch count / last dispatch date.

The workbook is a dispatch log, not a branch directory: it only tells us which transporter was
used for which destination. Nothing else (branch, godown, contact, address, serviceability...)
is present, so none of it is produced here. Customer names and order numbers are never read out.
"""
import json
import re
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import openpyxl

INDEX_VERSION = 1

# Values in the Transport column that are not transporters (payment mode / hand delivery).
EXCLUDED_TRANSPORTS = {"COD", "LOCAL"}

STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu And Kashmir", "Ladakh",
    "Chandigarh", "Puducherry", "Andaman And Nicobar Islands", "Dadra And Nagar Haveli", "Daman And Diu",
    "Lakshadweep",
]
_STATE_ALIASES = {
    "orissa": "Odisha", "pondicherry": "Puducherry", "uttaranchal": "Uttarakhand",
    "new delhi": "Delhi", "nct of delhi": "Delhi", "jammu & kashmir": "Jammu And Kashmir",
    "j&k": "Jammu And Kashmir", "chattisgarh": "Chhattisgarh", "chhatisgarh": "Chhattisgarh",
}
_STATE_LOOKUP = {s.lower(): s for s in STATES} | _STATE_ALIASES
# longest first so "Uttar Pradesh" wins over shorter overlaps, "Arunachal Pradesh" over "Pradesh"...
_STATE_RE = re.compile(
    r"(?<![a-z])(" + "|".join(re.escape(k) for k in sorted(_STATE_LOOKUP, key=len, reverse=True)) + r")(?![a-z])",
    re.I,
)
_PIN_RE = re.compile(r"(?<!\d)(\d{6})(?!\d)")
_DATE_TEXT_RE = re.compile(r"date\s*:\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", re.I)
ACRONYMS = {"Tci": "TCI", "Vrl": "VRL", "Dtdc": "DTDC", "Ats": "ATS", "Sri": "Sri"}


@dataclass(frozen=True)
class Entry:
    transport: str
    pincode: str | None
    city: str | None
    state: str | None
    count: int
    last_date: str | None  # ISO date, best effort


def key(value: str | None) -> str:
    return re.sub(r"[\s_\-.,]+", " ", value or "").strip().lower()


# India Post's 9 postal regions, keyed by a PIN code's first digit (region 9 is the Army Postal
# Service, which never appears as a "state"). Fixed, public geography -- not per-row guesswork --
# used only by pincode_state_conflicts() below to catch a single order row's own state field
# contradicting its own pincode (e.g. a buyer selected "Goa" from a state dropdown but their pincode
# is a Gujarat one). A state's pincodes never span more than one region, so this is a safe,
# deterministic check, not an approximation that could reject genuinely valid combinations.
_PINCODE_REGION_STATES: dict[int, set[str]] = {
    1: {"delhi", "haryana", "punjab", "himachal pradesh", "jammu and kashmir", "ladakh", "chandigarh"},
    2: {"uttar pradesh", "uttarakhand"},
    3: {"rajasthan", "gujarat", "daman and diu", "dadra and nagar haveli"},
    4: {"maharashtra", "madhya pradesh", "chhattisgarh", "goa"},
    5: {"andhra pradesh", "telangana", "karnataka"},
    6: {"tamil nadu", "kerala", "puducherry", "lakshadweep"},
    7: {"west bengal", "odisha", "assam", "arunachal pradesh", "nagaland", "manipur", "mizoram",
        "tripura", "meghalaya", "sikkim", "andaman and nicobar islands"},
    8: {"bihar", "jharkhand"},
}
_STATE_REGION: dict[str, int] = {s: r for r, states in _PINCODE_REGION_STATES.items() for s in states}


def pincode_state_conflicts(pincode: str | None, state: str | None) -> bool:
    """True only when a 6-digit pincode and a recognised state clearly disagree about which of
    India's postal regions the order is in (e.g. pincode 380009 -- Ahmedabad, Gujarat -- against
    state "Goa"). False whenever either value is missing, the pincode isn't 6 digits, or the state
    isn't one this maps (nothing to check against, so nothing is flagged) -- this never invents or
    corrects a value, it only identifies a same-row contradiction so the caller can decide to drop
    the untrustworthy field rather than act on it."""
    if not pincode or not state or not re.fullmatch(r"\d{6}", pincode):
        return False
    region = _STATE_REGION.get(re.sub(r"[\s_\-.,]+", " ", state).strip().lower())
    return region is not None and int(pincode[0]) != region


def normalize_transport(raw) -> str | None:
    if raw is None:
        return None
    text = re.sub(r"\s+", " ", str(raw)).strip()
    if len(text) < 2 or re.fullmatch(r"[\d.\s]+", text):
        return None
    if text.upper() in EXCLUDED_TRANSPORTS:
        return None
    words = text.title().split(" ")
    return " ".join(ACRONYMS.get(w, w) for w in words)


def parse_location(raw) -> tuple[str | None, str | None, str | None]:
    """'patiyala 147001 Punjab' -> ('Patiyala', '147001', 'Punjab'). Missing parts -> None."""
    if raw is None:
        return None, None, None
    text = re.sub(r"\s+", " ", str(raw)).strip()
    if not text:
        return None, None, None
    pin_m = _PIN_RE.search(text)
    pincode = pin_m.group(1) if pin_m else None
    state = None
    st_m = _STATE_RE.search(text)
    if st_m:
        state = _STATE_LOOKUP[st_m.group(1).lower()]
    rest = text
    if st_m:
        rest = rest[: st_m.start()] + " " + rest[st_m.end():]
    if pin_m:
        rest = _PIN_RE.sub(" ", rest)
    city = re.sub(r"[\s\-,.]+", " ", rest).strip().title() or None
    if pincode_state_conflicts(pincode, state):
        state = None  # e.g. a mistyped/misread state word next to a pincode from a different one
    return city, pincode, state


def _row_date(cells) -> date | None:
    for c in cells[:8]:
        if isinstance(c, datetime):
            return c.date()
        if isinstance(c, date):
            return c
        if isinstance(c, str):
            m = _DATE_TEXT_RE.search(c)
            if m:
                d, mo, y = map(int, m.groups())
                try:
                    return date(y, mo, d)
                except ValueError:
                    pass
    return None


def build_entries(path: str) -> list[Entry]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    counts: Counter = Counter()
    last: dict[tuple, str] = {}
    for ws in wb.worksheets:
        cols: dict[str, int] | None = None
        current: date | None = None
        for row in ws.iter_rows(values_only=True):
            cells = list(row[:10])
            low = [str(c).strip().lower() if c is not None else "" for c in cells]
            if "city" in low and "transport" in low:  # header row (repeats; column order varies by sheet)
                cols = {v: i for i, v in enumerate(low) if v}
                continue
            d = _row_date(cells)
            if d:
                current = d
            if not cols:
                continue
            ci, ti = cols["city"], cols["transport"]
            if ci >= len(cells) or ti >= len(cells):
                continue
            transport = normalize_transport(cells[ti])
            city, pincode, state = parse_location(cells[ci])
            if not transport or not (pincode or city or state):
                continue
            k = (transport, pincode, city, state)
            counts[k] += 1
            if current and (k not in last or current.isoformat() > last[k]):
                last[k] = current.isoformat()
    wb.close()
    return [Entry(*k, count=n, last_date=last.get(k)) for k, n in counts.items()]


class ExcelIndex:
    def __init__(self, entries: list[Entry]):
        self.entries = entries
        self.by_pincode: dict[str, list[Entry]] = defaultdict(list)
        for e in entries:
            if e.pincode:
                self.by_pincode[e.pincode].append(e)


_lock = threading.Lock()
_index: ExcelIndex | None = None
_index_sig: tuple | None = None


def _signature(path: Path) -> list:
    st = path.stat()
    return [INDEX_VERSION, st.st_size, int(st.st_mtime)]


def get_index(path: str, cache_dir: Path | None = None) -> ExcelIndex:
    """Load once per process; a JSON cache next to the backend makes restarts fast."""
    global _index, _index_sig
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"Excel data source not found: {p}")
    sig = _signature(p)
    with _lock:
        if _index is not None and _index_sig == sig:
            return _index
        cache_file = (cache_dir / "excel_index.json") if cache_dir else None
        entries = None
        if cache_file and cache_file.is_file():
            try:
                blob = json.loads(cache_file.read_text(encoding="utf-8"))
                if blob.get("sig") == sig:
                    entries = [Entry(*row) for row in blob["entries"]]
            except (ValueError, TypeError, KeyError):
                entries = None
        if entries is None:
            entries = build_entries(str(p))
            if cache_file:
                cache_dir.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(
                    json.dumps({"sig": sig, "entries": [list(vars(e).values()) for e in entries]}),
                    encoding="utf-8",
                )
        _index, _index_sig = ExcelIndex(entries), sig
        return _index
