"""Import TCI Express pincode serviceability (and optional branch data) from CSV/Excel.

Usage:
    python tci_import.py --pincodes tci_pincodes.csv [--branches tci_branches.csv]

Pincode file columns (case-insensitive; spaces or underscores):
    pincode, branch, city, location, state, pincode_type, documents_required,
    mbg_surface_delivery, mbg_air_delivery, mbg_rail_delivery

Branch file columns:
    branch, godown, contact, alternate_contact, address, city, district, state, pincode

Run again with the same file: existing rows are updated, not duplicated.
"""
import argparse

import normalize as n
from common import pick, read_table, run, upsert_branches, upsert_pincodes

TRANSPORT = "TCI Express"
SOURCE_URL = "https://www.tciexpress.in/pincode-enquiry.aspx"


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
        "pincode_type": n.clean_text(pick(row, "pincode_type", "pin_code_type")),
        "documents_required": n.clean_text(pick(row, "documents_required")),
        "surface_delivery": n.normalize_bool(pick(row, "mbg_surface_delivery", "surface_delivery")),
        "air_delivery": n.normalize_bool(pick(row, "mbg_air_delivery", "air_delivery")),
        "rail_delivery": n.normalize_bool(pick(row, "mbg_rail_delivery", "rail_delivery")),
        "source_url": SOURCE_URL,
    }


def map_branch_row(row: dict) -> dict | None:
    branch = n.normalize_branch_name(pick(row, "branch", "branch_name"))
    if not branch:
        return None
    return {
        "transport_name": TRANSPORT,
        "branch_name": branch,
        "pincode": n.normalize_pincode(pick(row, "pincode", "pin_code")) or "",
        "branch_type": n.clean_text(pick(row, "branch_type")),
        "godown_name": n.clean_text(pick(row, "godown", "godown_name")),
        "contact_number": n.clean_text(pick(row, "contact", "contact_number", "phone")),
        "alternate_contact": n.clean_text(pick(row, "alternate_contact")),
        "address": n.clean_text(pick(row, "address")),
        "city": n.normalize_city(pick(row, "city")),
        "district": n.normalize_district(pick(row, "district")),
        "state": n.normalize_state(pick(row, "state")),
        "source_url": SOURCE_URL,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pincodes", help="CSV/Excel with TCI pincode enquiry data")
    ap.add_argument("--branches", help="CSV/Excel with TCI branch/godown/contact data")
    args = ap.parse_args()
    if not (args.pincodes or args.branches):
        ap.error("give --pincodes and/or --branches")
    if args.pincodes:
        run(read_table(args.pincodes), map_pincode_row, upsert_pincodes, "TCI pincodes")
    if args.branches:
        run(read_table(args.branches), map_branch_row, upsert_branches, "TCI branches",
            key_fields=("transport_name", "branch_name", "pincode"))


if __name__ == "__main__":
    main()
