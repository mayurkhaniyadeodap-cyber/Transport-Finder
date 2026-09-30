"""Merges known spelling/typing variations of the same transporter into one display name.

Source: a read-only, India-wide audit of the live RDS `orders` table (all states, no filter),
comparing every pair of the (then) 635 distinct display names with a conservative, transposition-
aware edit-distance check — same word count, every differing word a close typo, any word with a
digit must match exactly (so e.g. weight tiers like "1Kg"/"10Kg" are never touched). 47 candidate
groups came out of that; this file is their approved result: `data/transporter_synonyms.csv`, one
row per (variant_name, canonical_name) pair. The canonical name is whichever spelling had the most
orders in the audit — not necessarily the "correct" spelling (e.g. "Ishani Tranport" outnumbers the
correctly-spelled "Ishani Transport") — kept for determinism; edit the CSV to override a pick.

This is a display-only merge, exactly like the existing allowlist/overrides layers: nothing here
reads from or writes to the RDS, transporters.xlsx, or the local overrides SQLite file. It only
decides which already-normalised name two rows are considered "the same transporter" under, in
`excel_search.dedupe_transport_rows()` (the one shared place every search type already goes
through), same as before -- so it applies to pincode/city/state/city+state and /api/transport/list.

Matching is via `excel_source.key()` (case/spacing/punctuation-insensitive), consistent with the
rest of the dedupe pipeline, so a variant with different case or spacing than its CSV row still
matches. Names never present in this file pass through unchanged -- this never invents a merge.

To add or refine a merge later, edit `data/transporter_synonyms.csv` directly (or replace it with a
fresh audit run) -- no code change needed.
"""
import csv
from pathlib import Path

from .excel_source import key

SYNONYMS_CSV_PATH = Path(__file__).resolve().parents[3] / "data" / "transporter_synonyms.csv"


def _load_synonyms(path: Path = SYNONYMS_CSV_PATH) -> dict[str, str]:
    if not path.is_file():
        return {}
    out: dict[str, str] = {}
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            variant, canonical = row.get("variant_name"), row.get("canonical_name")
            if variant and canonical:
                out[key(variant)] = canonical
    return out


_SYNONYMS = _load_synonyms()


def canonical_name(name: str) -> str:
    """The display name to show for `name`, merging it with its known spelling variants. Returns
    `name` unchanged if it isn't a known variant (including if it's already the canonical form)."""
    return _SYNONYMS.get(key(name), name)
