"""Mobile-number lookup from Branches_LIST_*.csv (a VRL Logistics branch list).

The CSV has no transporter column (it is entirely VRL), no pincode column (the pincode is inside
Address) and no city column (Branch Name is the closest thing). Matching is therefore deliberately
conservative: only dispatch rows for VRL, and only when the pincode (or city + state) agrees with
exactly one branch. Anything ambiguous returns None -> "Not Available". Phone numbers from the
dispatch workbook are never used.
"""
import csv
import re
import threading
from dataclasses import dataclass
from pathlib import Path

# Dispatch-sheet transporter names (exact, after case/space normalisation) that this file covers.
# Nothing fuzzy: misspellings such as "VRL Logistoc" are intentionally NOT included.
VRL_NAMES = {"vrl logistics", "vrl logistic", "vrl"}

_PIN_RE = re.compile(r"(?<!\d)(\d{6})(?!\d)")


def _key(v: str | None) -> str:
    return re.sub(r"[\s_\-.,]+", " ", v or "").strip().lower()


@dataclass(frozen=True)
class Branch:
    name: str
    address: str | None
    state: str | None
    phones: str | None  # numbers as written in the CSV, joined with ", "


def _clean_phones(raw: str) -> str | None:
    parts = [p.strip() for p in re.split(r"[,;/]|\s{2,}", raw or "") if p.strip()]
    return ", ".join(parts) or None


def _read_rows(path: Path) -> list[dict]:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            with path.open(newline="", encoding=enc) as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    return []


class BranchIndex:
    def __init__(self, rows: list[dict]):
        self.by_pincode: dict[str, list[Branch]] = {}
        self.by_name: dict[str, list[Branch]] = {}
        for r in rows:
            name = (r.get("Branch Name") or "").strip()
            if not name:
                continue
            address = re.sub(r"\s+", " ", r.get("Address") or "").strip() or None
            b = Branch(name, address, (r.get("State") or "").strip() or None, _clean_phones(r.get("Phone") or ""))
            self.by_name.setdefault(_key(name), []).append(b)
            m = _PIN_RE.search(address or "")
            if m:
                self.by_pincode.setdefault(m.group(1), []).append(b)

    def lookup(self, transport: str, pincode: str | None, city: str | None, state: str | None) -> Branch | None:
        if _key(transport) not in VRL_NAMES:
            return None
        if pincode and pincode in self.by_pincode:
            cands = self.by_pincode[pincode]
            if len(cands) > 1 and city:
                cands = [b for b in cands if _key(b.name) == _key(city)]
            return cands[0] if len(cands) == 1 else None  # ambiguous -> no guess
        if city and state:
            cands = [b for b in self.by_name.get(_key(city), []) if _key(b.state) == _key(state)]
            return cands[0] if len(cands) == 1 else None
        return None


_lock = threading.Lock()
_index: BranchIndex | None = None
_sig: tuple | None = None


def get_index(path: str) -> BranchIndex | None:
    """None if the CSV is not there: search keeps working, Mobile No is simply Not Available."""
    global _index, _sig
    p = Path(path)
    if not p.is_file():
        return None
    st = p.stat()
    sig = (st.st_size, int(st.st_mtime))
    with _lock:
        if _index is None or _sig != sig:
            _index, _sig = BranchIndex(_read_rows(p)), sig
        return _index
