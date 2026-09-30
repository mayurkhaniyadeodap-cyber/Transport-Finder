"""Import VRL Logistics branch data (and optional serviceability) from CSV/Excel into the common schema.

Usage:
    python vrl_import.py --branches vrl_branches.csv [--pincodes vrl_pincodes.csv]

Branch file columns (case-insensitive):
    branch, branch_type, godown, contact, alternate_contact, address, city, district, state, pincode, latitude, longitude
Pincode file columns:
    pincode, branch, city, state, pincode_type, documents_required, surface_delivery, air_delivery, rail_delivery

Any column missing from the source is stored as NULL, never guessed. VRL branch data does not
imply pincode serviceability; only rows in --pincodes set that.
"""
import argparse

import normalize as n
from common import pick, read_table, run, upsert_branches, upsert_pincodes

TRANSPORT = "VRL Logistics"
SOURCE_URL = "https://www.vrlgroup.in"  # update to the exact page/file the data came from


def _float(v):
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def map_branch_row(row: dict) -> dict | None:
    branch = n.normalize_branch_name(pick(row, "branch", "branch_name", "office"))
    if not branch:
        return None
    return {
        "transport_name": TRANSPORT,
        "branch_name": branch,
        "pincode": n.normalize_pincode(pick(row, "pincode", "pin_code")) or "",
        "branch_type": n.clean_text(pick(row, "branch_type", "type")),
        "godown_name": n.clean_text(pick(row, "godown", "godown_name")),
        "contact_number": n.clean_text(pick(row, "contact", "contact_number", "phone", "mobile")),
        "alternate_contact": n.clean_text(pick(row, "alternate_contact")),
        "address": n.clean_text(pick(row, "address")),
        "city": n.normalize_city(pick(row, "city")),
        "district": n.normalize_district(pick(row, "district")),
        "state": n.normalize_state(pick(row, "state")),
        "latitude": _float(pick(row, "latitude", "lat")),
        "longitude": _float(pick(row, "longitude", "lng", "lon")),
        "source_url": SOURCE_URL,
    }


def map_pincode_row(row: dict) -> dict | None:
    pincode = n.normalize_pincode(pick(row, "pincode", "pin_code"))
    if not pincode:
        return None
    return {
        "transport_name": TRANSPORT,
        "pincode": pincode,
        "branch_name": n.normalize_branch_name(pick(row, "branch", "branch_name")),
        "city": n.normalize_city(pick(row, "city")),
        "location": n.normalize_city(pick(row, "location")),
        "district": n.normalize_district(pick(row, "district")),
        "state": n.normalize_state(pick(row, "state")),
        "pincode_type": n.clean_text(pick(row, "pincode_type", "pin_code_type", "serviceability")),
        "documents_required": n.clean_text(pick(row, "documents_required")),
        "surface_delivery": n.normalize_bool(pick(row, "surface_delivery")),
        "air_delivery": n.normalize_bool(pick(row, "air_delivery")),
        "rail_delivery": n.normalize_bool(pick(row, "rail_delivery")),
        "source_url": SOURCE_URL,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--branches", help="CSV/Excel with VRL branch data")
    ap.add_argument("--pincodes", help="CSV/Excel with VRL pincode serviceability data")
    args = ap.parse_args()
    if not (args.pincodes or args.branches):
        ap.error("give --branches and/or --pincodes")
    if args.branches:
        run(read_table(args.branches), map_branch_row, upsert_branches, "VRL branches",
            key_fields=("transport_name", "branch_name", "pincode"))
    if args.pincodes:
        run(read_table(args.pincodes), map_pincode_row, upsert_pincodes, "VRL pincodes")


if __name__ == "__main__":
    main()
