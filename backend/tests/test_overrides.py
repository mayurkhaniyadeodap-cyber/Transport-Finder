"""Tests Transporter Management: local manual overrides only, never the RDS/CSV/Excel data.
Priority: RDS real data -> local override -> combined result, using the vacalvers_csv fixture
(fast, file-based, no network) as the "real source" stand-in."""
import csv
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import overrides_store as store

client = TestClient(app)

COLUMNS = ["OrderNo", "CustomerBillingState", "CustomerBillingCity", "CustomerBillingPinCode", "ShipmentCourier"]


def _row(courier, city="Rajkot", pincode="360003", state="Gujarat", order="#1"):
    return {"OrderNo": order, "CustomerBillingState": state, "CustomerBillingCity": city,
            "CustomerBillingPinCode": pincode, "ShipmentCourier": courier}


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)


@pytest.fixture()
def csv_file(tmp_path, monkeypatch):
    path = tmp_path / "orders.csv"
    write_csv(path, [
        _row("TCI EXPRESS", order="#1"),
        _row("VRL LOGISTICS", order="#2"),
        _row("KISHAN TRAVELS", city="Bhavnagar", pincode="364001", order="#3"),
    ])
    allowlist = tmp_path / "allowlist.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["courier_name"])
    for n in ("TCI EXPRESS", "VRL LOGISTICS", "KISHAN TRAVELS"):
        ws.append([n])
    wb.save(allowlist)
    from app.services import transporter_filter as tf
    monkeypatch.setattr(tf, "ALLOWED_TRANSPORTERS", tf._load_allowed_names(allowlist))

    db_path = tmp_path / "overrides.db"
    monkeypatch.setattr(settings, "overrides_db_path", str(db_path))

    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    import app.services.excel_search as es
    import app.services.vacalvers_source as vc
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    return path, db_path


def get(**params):
    r = client.get("/api/transport/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def by_name(data, name):
    return next(r for r in data["results"] if r["transport_name"] == name)


# ---------- overrides_store.py: plain sqlite CRUD ----------

def test_store_upsert_creates_then_updates_same_record(tmp_path):
    db = tmp_path / "o.db"
    a = store.upsert_existing(db, "Rajkot", "TCI Express", "360003", mobile="9876543210")
    assert a["override_mobile"] == "9876543210"
    assert a["is_new"] is False
    b = store.upsert_existing(db, "Rajkot", "TCI Express", "360003", status="Not Active")
    assert b["id"] == a["id"]  # same underlying row, not a duplicate
    assert b["override_mobile"] == "9876543210"  # untouched field preserved
    assert b["override_status"] == "Not Active"
    assert len(store.list_overrides(db)) == 1


def test_store_null_safe_matching_on_missing_city_or_pincode(tmp_path):
    db = tmp_path / "o.db"
    a = store.upsert_existing(db, None, "Some Courier", None, mobile="111")
    b = store.upsert_existing(db, None, "Some Courier", None, mobile="222")
    assert a["id"] == b["id"]
    assert store.get_by_id(db, a["id"])["override_mobile"] == "222"


def test_store_create_new_and_delete(tmp_path):
    db = tmp_path / "o.db"
    row = store.create_new(db, "My Own Courier", "Rajkot", "360003", mobile="9998887776", status="Active")
    assert row["is_new"] is True
    assert row["override_transport_name"] == "My Own Courier"
    assert store.delete_by_id(db, row["id"]) is True
    assert store.get_by_id(db, row["id"]) is None
    assert store.delete_by_id(db, row["id"]) is False  # already gone


def test_store_update_by_id_partial(tmp_path):
    db = tmp_path / "o.db"
    row = store.create_new(db, "X Courier", "Rajkot", "360003")
    updated = store.update_by_id(db, row["id"], mobile="123")
    assert updated["override_mobile"] == "123"
    assert updated["override_transport_name"] == "X Courier"  # unchanged
    assert store.update_by_id(db, 999999, mobile="x") is None


# ---------- API: /api/overrides ----------

def test_api_create_update_delete_new_transporter(csv_file):
    r = client.post("/api/overrides/new-transporter",
                     json={"transport_name": "My Courier", "city": "Rajkot", "pincode": "360003",
                           "mobile": "9998887776", "status": "Active"})
    assert r.status_code == 200
    row = r.json()
    assert row["is_new"] is True and row["override_mobile"] == "9998887776"

    r2 = client.patch(f"/api/overrides/{row['id']}", json={"mobile": "1112223334"})
    assert r2.status_code == 200 and r2.json()["override_mobile"] == "1112223334"

    r3 = client.get("/api/overrides")
    assert any(o["id"] == row["id"] for o in r3.json())

    r4 = client.delete(f"/api/overrides/{row['id']}")
    assert r4.status_code == 200
    assert client.get(f"/api/overrides").json() == [] or all(o["id"] != row["id"] for o in client.get("/api/overrides").json())


def test_api_rejects_invalid_status(csv_file):
    r = client.post("/api/overrides/new-transporter",
                     json={"transport_name": "X", "city": "Rajkot", "status": "Maybe"})
    assert r.status_code == 422


def test_api_upsert_existing_row_requires_source_name(csv_file):
    r = client.post("/api/overrides", json={"source_transport_name": "", "mobile": "123"})
    assert r.status_code == 422


def test_api_delete_missing_override_is_404(csv_file):
    assert client.delete("/api/overrides/999999").status_code == 404


def test_api_patch_missing_override_is_404(csv_file):
    assert client.patch("/api/overrides/999999", json={"mobile": "1"}).status_code == 404


# ---------- priority: RDS real data -> local override -> combined result ----------

def test_manual_mobile_number_appears_over_not_available(csv_file):
    data = get(pincode="360003")
    tci = by_name(data, "TCI Express")
    assert tci["contact_number"] is None  # "Not Available" in the UI, RDS/CSV has no number

    client.post("/api/overrides", json={
        "source_city": tci["city"], "source_transport_name": tci["transport_name"],
        "source_pincode": tci["pincode"], "mobile": "9876543210",
    })
    data2 = get(pincode="360003")
    assert by_name(data2, "TCI Express")["contact_number"] == "9876543210"


def test_editing_the_same_row_twice_updates_one_override_not_two(csv_file):
    data = get(pincode="360003")
    tci = by_name(data, "TCI Express")
    client.post("/api/overrides", json={
        "source_city": tci["city"], "source_transport_name": tci["transport_name"],
        "source_pincode": tci["pincode"], "mobile": "1111111111",
    })
    row_after_first_edit = by_name(get(pincode="360003"), "TCI Express")
    override_id = row_after_first_edit["override_id"]
    assert override_id is not None

    # a second edit, using the (now overridden) row's own override_id, as the UI would
    client.patch(f"/api/overrides/{override_id}", json={"mobile": "2222222222"})
    final = by_name(get(pincode="360003"), "TCI Express")
    assert final["contact_number"] == "2222222222"
    assert final["override_id"] == override_id
    assert len(store.list_overrides(Path(csv_file[1]))) == 1


def test_manual_status_override_to_not_active_removes_the_row_from_search(csv_file):
    data = get(pincode="360003")
    vrl = by_name(data, "VRL Logistics")
    assert vrl["status"] == "Active"
    client.post("/api/overrides", json={
        "source_city": vrl["city"], "source_transport_name": vrl["transport_name"],
        "source_pincode": vrl["pincode"], "status": "Not Active",
    })
    assert "VRL Logistics" not in {r["transport_name"] for r in get(pincode="360003")["results"]}


def test_manual_name_city_pincode_overrides_apply(csv_file):
    data = get(pincode="364001")
    kt = by_name(data, "Kishan Travels")
    client.post("/api/overrides", json={
        "source_city": kt["city"], "source_transport_name": kt["transport_name"],
        "source_pincode": kt["pincode"], "transport_name": "Kishan Travels Pvt Ltd",
        "city": "New Bhavnagar", "pincode": "364099",
    })
    data2 = get(pincode="364001")  # still found via the ORIGINAL pincode (search matching is unaffected)
    row = by_name(data2, "Kishan Travels Pvt Ltd")
    assert row["city"] == "New Bhavnagar"
    assert row["pincode"] == "364099"


def test_override_rename_with_different_case_and_spacing_still_merges_with_the_real_name(csv_file):
    # A manual rename is stored exactly as typed (never run through normalize_transport()), so it
    # can differ in case/spacing from an existing real transporter's display name. The shared
    # dedupe function must still recognise them as the same transporter.
    tci = by_name(get(pincode="360003"), "TCI Express")
    client.post("/api/overrides", json={
        "source_city": tci["city"], "source_transport_name": tci["transport_name"],
        "source_pincode": tci["pincode"], "transport_name": "kishan   travels",  # loose case/spacing
    })
    data = get(state="Gujarat")
    rows = [r for r in data["results"] if r["transport_name"].strip().lower().split() == ["kishan", "travels"]]
    assert len(rows) == 1  # merged into one row, not two
    assert rows[0]["pincode"] == "360003, 364001"  # the renamed TCI row's pincode + the real Kishan Travels one
    assert "VRL Logistics" in {r["transport_name"] for r in data["results"]}  # untouched, still its own row


def test_hide_removes_row_from_every_search_type(csv_file):
    data = get(pincode="360003")
    tci = by_name(data, "TCI Express")
    client.post("/api/overrides", json={
        "source_city": tci["city"], "source_transport_name": tci["transport_name"],
        "source_pincode": tci["pincode"], "hidden": True,
    })
    assert "TCI Express" not in {r["transport_name"] for r in get(pincode="360003")["results"]}
    assert "TCI Express" not in {r["transport_name"] for r in get(city="Rajkot")["results"]}
    assert "TCI Express" not in {r["transport_name"] for r in get(state="Gujarat")["results"]}
    assert "TCI Express" not in client.get("/api/transport/list").json()
    # the other real transporter at the same pincode is unaffected
    assert "VRL Logistics" in {r["transport_name"] for r in get(pincode="360003")["results"]}


def test_new_transporter_appears_in_pincode_and_city_search(csv_file):
    client.post("/api/overrides/new-transporter", json={
        "transport_name": "Brand New Courier", "city": "Rajkot", "pincode": "360003",
        "mobile": "9000000000", "status": "Active",
    })
    p = by_name(get(pincode="360003"), "Brand New Courier")
    assert p["contact_number"] == "9000000000" and p["status"] == "Active"
    assert "Brand New Courier" in {r["transport_name"] for r in get(city="Rajkot")["results"]}
    assert "Brand New Courier" in client.get("/api/transport/list").json()


def test_new_transporter_bypasses_the_courier_allowlist(csv_file):
    # "Totally Unlisted Co" is NOT in the fake allowlist fixture — a real RDS-sourced row with that
    # name would be hidden by transporter_filter, but a manually-added one is shown regardless.
    client.post("/api/overrides/new-transporter", json={
        "transport_name": "Totally Unlisted Co", "city": "Rajkot", "pincode": "360003",
    })
    assert "Totally Unlisted Co" in {r["transport_name"] for r in get(pincode="360003")["results"]}


def test_deleting_a_new_transporter_removes_it_from_results(csv_file):
    r = client.post("/api/overrides/new-transporter", json={"transport_name": "Temp Co", "pincode": "360003"})
    override_id = r.json()["id"]
    assert "Temp Co" in {row["transport_name"] for row in get(pincode="360003")["results"]}
    client.delete(f"/api/overrides/{override_id}")
    assert "Temp Co" not in {row["transport_name"] for row in get(pincode="360003")["results"]}


def test_deleting_an_edit_override_reverts_to_the_real_source_value(csv_file):
    data = get(pincode="360003")
    tci = by_name(data, "TCI Express")
    client.post("/api/overrides", json={
        "source_city": tci["city"], "source_transport_name": tci["transport_name"],
        "source_pincode": tci["pincode"], "mobile": "5555555555",
    })
    override_id = by_name(get(pincode="360003"), "TCI Express")["override_id"]
    client.delete(f"/api/overrides/{override_id}")
    reverted = by_name(get(pincode="360003"), "TCI Express")
    assert reverted["contact_number"] is None  # back to "Not Available"
    assert reverted["override_id"] is None


def test_result_columns_are_unchanged(csv_file):
    row = get(pincode="360003")["results"][0]
    assert {"city", "transport_name", "contact_number", "pincode", "status"} <= set(row)


def test_overrides_never_write_to_the_source_csv(csv_file):
    csv_path, _db = csv_file
    before = csv_path.read_text(encoding="utf-8")
    data = get(pincode="360003")
    tci = by_name(data, "TCI Express")
    client.post("/api/overrides", json={
        "source_city": tci["city"], "source_transport_name": tci["transport_name"],
        "source_pincode": tci["pincode"], "mobile": "9876543210", "status": "Not Active",
    })
    client.post("/api/overrides/new-transporter", json={"transport_name": "New Co", "pincode": "360003"})
    get(pincode="360003")
    after = csv_path.read_text(encoding="utf-8")
    assert before == after  # the "real source" file is never rewritten — only the local sqlite db changes
