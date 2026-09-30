"""Application-side transporter allowlist for Transport Finder.

    RDS -> real transport data -> transporter allowlist (this file, from transporters.xlsx)
    -> Transport Finder

Transport Finder shows ONLY the transporter names present in the `courier_name` column of
`data/transporters.xlsx` (a copy of the uploaded transporter list, 388 names). Anything not in
that column is hidden. Every other column in the sheet (order_count, normalized_key,
variation_group_size, variation_group_total_orders, ...) is ignored — only `courier_name` is read.

This is a display filter only: it never touches the RDS or its CSV/Excel fallbacks — no row in any
source is read differently, deleted, or updated. It only decides which already-fetched rows get
returned to the caller.

Matching: `transporters.xlsx`'s raw courier names (e.g. "TCI EXPRESS", "aakash roadways") are put
through the exact same title-case + acronym-fix + stray-punctuation-strip transformation every
source's own normalize_transport() already applies, to get the *display* form Transport Finder
would use for it (e.g. "TCI EXPRESS" -> "TCI Express") — and it is that display form that is
compared, not the raw name. This is not renaming or merging any transporter: it reproduces the
app's existing, unchanged display convention so the comparison lines up (case-insensitive, extra
spaces and hyphens/punctuation ignored).

To update the allowlist later, replace `data/transporters.xlsx` with a new workbook that has a
`courier_name` column — no code change needed.
"""
import re
from pathlib import Path

import openpyxl

from .excel_source import ACRONYMS

ALLOWLIST_XLSX_PATH = Path(__file__).resolve().parents[3] / "data" / "transporters.xlsx"
ALLOWLIST_COLUMN = "courier_name"

_STRIP_RE = re.compile(r"^[\s:\-.,]+|[\s:\-.,]+$")


def _display_form(raw: str) -> str:
    """The same title-case + acronym-fix + stray-punctuation-strip every source's own
    normalize_transport() already applies, so a raw allowlist name (e.g. "TCI EXPRESS", "aakash
    roadways") matches the exact string Transport Finder actually shows for it."""
    if not raw:
        return ""
    text = _STRIP_RE.sub("", re.sub(r"\s+", " ", str(raw))).strip()
    if not text:
        return ""
    words = text.title().split(" ")
    return " ".join(ACRONYMS.get(w, w) for w in words)


def _load_allowed_names(path: Path = ALLOWLIST_XLSX_PATH) -> frozenset:
    if not path.is_file():
        return frozenset()
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    try:
        ws = wb.active
        header = [str(c.value).strip() if c.value is not None else "" for c in next(ws.iter_rows(max_row=1))]
        if ALLOWLIST_COLUMN not in header:
            return frozenset()
        col = header.index(ALLOWLIST_COLUMN)
        names = set()
        for row in ws.iter_rows(min_row=2, values_only=True):
            if col < len(row):
                names.add(_display_form(row[col]))
        names.discard("")
        return frozenset(names)
    finally:
        wb.close()


ALLOWED_TRANSPORTERS = _load_allowed_names()


def is_excluded_transporter(name: str) -> bool:
    """True if this transporter should be hidden — i.e. its display name is NOT in the
    transporters.xlsx allowlist. `name` is already the display form Transport Finder computed for
    it (each source normalises before this is called), so no further transformation happens here —
    it's compared to the allowlist as-is."""
    return (name or "").strip() not in ALLOWED_TRANSPORTERS
