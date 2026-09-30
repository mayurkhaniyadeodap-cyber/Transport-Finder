"""Reads the VaCalvers order-export CSV ("L135 Orders ...csv") and builds the same kind of
(transport, pincode, city, state) index that excel_source.py builds from the dispatch workbook,
so excel_search.py's search/sort/status/mobile-lookup logic works unchanged on either source.

Only four columns are ever read from every row:
    CustomerBillingCity, CustomerBillingState, CustomerBillingPinCode, ShipmentCourier
The file also has customer name, address, phone/GSTIN, order number and price columns (40 in total).
None of those are read out, stored, cached or returned — only the four columns above ever reach an
Entry. ALL order rows are used regardless of OrderStatus (Dispatched/Packed/New/...) or order date;
nothing is filtered by status or recency.
"""
import csv
import json
import re
import threading
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .excel_source import ACRONYMS, Entry, ExcelIndex, pincode_state_conflicts

INDEX_VERSION = 1

# ShipmentCourier values seen in the export that are not transporter names: a payment mode, a
# hand/local delivery marker, a self-pickup marker, a driver's own name, or a too-vague placeholder.
EXCLUDED_COURIERS = {"COD", "LOCAL", "SELF PICKUP", "CUSTOMER LABEL", "OTHER", ""}
_DRIVER_RE = re.compile(r"^driver\s*:", re.I)


@dataclass(frozen=True)
class IndexStats:
    total_rows: int
    valid_rows: int
    invalid_rows: int
    unique_records: int
    duplicate_rows_removed: int


def _blank(v) -> bool:
    return v is None or not str(v).strip()


def _title(v: str) -> str:
    return re.sub(r"\s+", " ", v).strip().title()


def normalize_transport(raw) -> str | None:
    """None for blank/placeholder/driver-name values; otherwise Title Case with known acronyms fixed."""
    if _blank(raw):
        return None
    text = re.sub(r"\s+", " ", str(raw)).strip()
    if text.upper() in EXCLUDED_COURIERS or _DRIVER_RE.match(text):
        return None
    words = text.title().split(" ")
    return " ".join(ACRONYMS.get(w, w) for w in words)


def normalize_place(raw) -> str | None:
    return None if _blank(raw) else _title(str(raw))


def normalize_pincode(raw) -> str | None:
    if _blank(raw):
        return None
    text = str(raw).strip()
    return text if re.fullmatch(r"\d{6}", text) else None


def build_entries(path: str) -> tuple[list[Entry], IndexStats]:
    total = valid = invalid = 0
    counts: Counter = Counter()
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            total += 1
            transport = normalize_transport(row.get("ShipmentCourier"))
            city = normalize_place(row.get("CustomerBillingCity"))
            state = normalize_place(row.get("CustomerBillingState"))
            pincode = normalize_pincode(row.get("CustomerBillingPinCode"))
            if pincode_state_conflicts(pincode, state):
                state = None  # this row's own state disagrees with its own pincode; see rds_source.py
            if not transport or not (pincode or city or state):
                invalid += 1
                continue
            valid += 1
            counts[(transport, pincode, city, state)] += 1
    entries = [Entry(t, p, c, s, count=n, last_date=None) for (t, p, c, s), n in counts.items()]
    stats = IndexStats(total, valid, invalid, len(entries), valid - len(entries))
    return entries, stats


_lock = threading.Lock()
_index: ExcelIndex | None = None
_index_sig: tuple | None = None
_index_stats: IndexStats | None = None


def _signature(p: Path) -> list:
    st = p.stat()
    return [INDEX_VERSION, st.st_size, int(st.st_mtime)]


def get_index(path: str, cache_dir: Path | None = None) -> ExcelIndex:
    global _index, _index_sig, _index_stats
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"VaCalvers CSV data source not found: {p}")
    sig = _signature(p)
    with _lock:
        if _index is not None and _index_sig == sig:
            return _index
        cache_file = (cache_dir / "vacalvers_index.json") if cache_dir else None
        cached = None
        if cache_file and cache_file.is_file():
            try:
                blob = json.loads(cache_file.read_text(encoding="utf-8"))
                if blob.get("sig") == sig:
                    cached = [Entry(*row) for row in blob["entries"]], IndexStats(**blob["stats"])
            except (ValueError, TypeError, KeyError):
                cached = None
        if cached is None:
            entries, stats = build_entries(str(p))
            if cache_file:
                cache_dir.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(
                    json.dumps({"sig": sig, "entries": [list(vars(e).values()) for e in entries],
                                "stats": vars(stats)}),
                    encoding="utf-8",
                )
        else:
            entries, stats = cached
        _index, _index_sig, _index_stats = ExcelIndex(entries), sig, stats
        return _index


def get_last_stats() -> IndexStats | None:
    """Stats from the most recent build_entries()/get_index() call, for reporting/tests."""
    return _index_stats
