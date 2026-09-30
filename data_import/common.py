"""Shared file reading + upsert logic. Importers only map source columns -> common fields."""
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import TransportBranch, TransportPincode  # noqa: E402


def read_table(path: str) -> pd.DataFrame:
    """Read CSV/Excel as strings (so pincodes keep leading zeros)."""
    p = Path(path)
    if p.suffix.lower() in {".xlsx", ".xls"}:
        df = pd.read_excel(p, dtype=str)
    else:
        df = pd.read_csv(p, dtype=str, keep_default_na=False)
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    return df


def pick(row: dict, *aliases: str):
    """First non-empty value among the given source column names."""
    for a in aliases:
        v = row.get(a)
        if v is not None and str(v).strip() not in {"", "nan"}:
            return v
    return None


def _upsert(db, model, key: dict, values: dict) -> str:
    obj = db.scalar(select(model).filter_by(**key))
    now = datetime.now()
    if obj is None:
        db.add(model(**key, **values, last_updated=now))
        return "inserted"
    for k, v in values.items():
        setattr(obj, k, v)
    obj.last_updated = now
    return "updated"


def upsert_pincodes(records: list[dict]) -> dict:
    stats = {"inserted": 0, "updated": 0}
    with SessionLocal() as db:
        for r in records:
            key = {k: r[k] for k in ("transport_name", "pincode", "branch_name")}
            values = {k: v for k, v in r.items() if k not in key}
            stats[_upsert(db, TransportPincode, key, values)] += 1
        db.commit()
    return stats


def upsert_branches(records: list[dict]) -> dict:
    stats = {"inserted": 0, "updated": 0}
    with SessionLocal() as db:
        for r in records:
            key = {k: r[k] for k in ("transport_name", "branch_name", "pincode")}
            values = {k: v for k, v in r.items() if k not in key}
            stats[_upsert(db, TransportBranch, key, values)] += 1
        db.commit()
    return stats


def run(df: pd.DataFrame, map_row, upsert, label: str, key_fields=("transport_name", "pincode", "branch_name")) -> None:
    unique: dict[tuple, dict] = {}
    skipped = 0
    for row in df.to_dict("records"):
        rec = map_row(row)
        if rec is None:
            skipped += 1
            continue
        unique[tuple(rec[k] for k in key_fields)] = rec  # de-duplicate within the file (last row wins)
    stats = upsert(list(unique.values()))
    print(f"{label}: {stats['inserted']} inserted, {stats['updated']} updated, {skipped} skipped (invalid pincode/name)")
