"""Tests for:
- Service Cities on every search result row (every real city a transporter covers, India-wide).
- Manage Transporters (Admin): /api/manage/transporters lists every transporter, Active, Not Active
  and hidden alike; Edit (status/mobile), Hide/Unhide, Delete/Restore on a whole transporter.
- Inactive transporters never appear in search or suggestions, but stay manageable.
All Admin actions are local only: the source file is never written."""
import csv

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import excel_search as es
from app.services import transporter_filter as tf
from app.services import vacalvers_source as vc

client = TestClient(app)

COLUMNS = ["OrderNo", "CustomerBillingState", "CustomerBillingCity", "CustomerBillingPinCode", "ShipmentCourier"]


def _row(courier, city, pincode, state="Gujarat", order="#1"):
    return {"OrderNo": order, "CustomerBillingState": state, "CustomerBillingCity": city,
            "CustomerBillingPinCode": pincode, "ShipmentCourier": courier}


@pytest.fixture()
def data(tmp_path, monkeypatch):
    rows = [
        _row("ABHISEK TRAVELS", "Mumbai", "400001", state="Maharashtra", order="#1"),
        _row("ABHISEK TRAVELS", "Pune", "411001", state="Maharashtra", order="#2"),
        _row("ABHISEK TRAVELS", "Ahmedabad", "380001", order="#3"),
        _row("ABHISEK TRAVELS", "MUMBAI", "400002", state="Maharashtra", order="#4"),  # same city, other case
        _row("ABHISEK TRAVELS", "Thane", "400601", state="Maharashtra", order="#5"),
        _row("TCI EXPRESS", "Ahmedabad", "380001", order="#6"),
        _row("KISHAN TRAVELS", "Rajkot", "360001", order="#7"),
        _row("SHADOW COURIER", "Ahmedabad", "380001", order="#8"),  # not on the allowlist
    ]
    path = tmp_path / "orders.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)

    allowlist = tmp_path / "allowlist.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["courier_name"])
    for n in ("ABHISEK TRAVELS", "TCI EXPRESS", "KISHAN TRAVELS"):
        ws.append([n])
    wb.save(allowlist)
    monkeypatch.setattr(tf, "ALLOWLIST_XLSX_PATH", allowlist)
    monkeypatch.setattr(tf, "ALLOWED_TRANSPORTERS", tf._load_allowed_names(allowlist))

    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    return path


def search(**params):
    r = client.get("/api/transport/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def names(result):
    return {r["transport_name"] for r in result["results"]}


def manage():
    r = client.get("/api/manage/transporters")
    assert r.status_code == 200, r.text
    return r.json()


def managed(name):
    return next(t for t in manage()["results"] if t["transport_name"] == name)


def patch(**body):
    r = client.patch("/api/manage/transporters", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def suggested(q):
    return {s["value"] for s in client.get("/api/transport/suggest", params={"q": q}).json()}


# ---------- Service Cities ----------

def test_search_row_lists_every_real_service_city_of_the_transporter(data):
    # Searched in Ahmedabad, but Service Cities covers the transporter's cities India-wide.
    row = next(r for r in search(city="Ahmedabad")["results"] if r["transport_name"] == "Abhisek Travels")
    assert row["service_cities"] == ["Ahmedabad", "Mumbai", "Pune", "Thane"]  # "MUMBAI" not repeated


def test_service_cities_are_never_invented(data):
    row = search(transport_name="Kishan Travels")["results"][0]
    assert row["service_cities"] == ["Rajkot"]


def test_service_cities_in_manage_list_match_search(data):
    assert managed("Abhisek Travels")["service_cities"] == ["Ahmedabad", "Mumbai", "Pune", "Thane"]
    assert managed("Abhisek Travels")["pincodes"] == ["380001", "400001", "400002", "400601", "411001"]


def test_locally_added_transporter_service_city_comes_from_its_own_entry(data):
    client.post("/api/overrides/new-transporter", json={"transport_name": "Avadh Travels", "city": "Vansda", "pincode": "396580"})
    t = managed("Avadh Travels")
    assert t["service_cities"] == ["Vansda"] and t["added_locally"] is True


# ---------- Manage Transporters: list ----------

def test_manage_lists_every_allowed_transporter_once(data):
    body = manage()
    assert [t["transport_name"] for t in body["results"]] == ["Abhisek Travels", "Kishan Travels", "TCI Express"]
    assert body["total"] == 3
    assert body["deleted"] == []


def test_manage_includes_not_active_and_hidden_transporters(data):
    (data.parent / "status.csv").write_text("transport_name,status\nTCI Express,Not Active\n", encoding="utf-8")
    patch(transport_name="Kishan Travels", hidden=True)
    body = {t["transport_name"]: t for t in manage()["results"]}
    assert body["TCI Express"]["status"] == "Not Active"
    assert body["Kishan Travels"]["hidden"] is True


# ---------- Inactive transporters ----------

def test_not_active_transporter_is_not_in_search_or_suggestions(data):
    (data.parent / "status.csv").write_text("transport_name,status\nTCI Express,Not Active\n", encoding="utf-8")
    assert "TCI Express" not in names(search(city="Ahmedabad"))
    assert "TCI Express" not in names(search(pincode="380001"))
    assert search(transport_name="TCI Express")["results"] == []
    assert "TCI Express" not in suggested("TCI")


def test_admin_can_set_a_transporter_not_active_then_back_to_active(data):
    patch(transport_name="TCI Express", status="Not Active")
    assert "TCI Express" not in names(search(city="Ahmedabad"))
    assert managed("TCI Express")["status"] == "Not Active"

    patch(transport_name="TCI Express", status="Active")
    assert "TCI Express" in names(search(city="Ahmedabad"))
    assert "TCI Express" in suggested("TCI")


def test_admin_active_status_overrides_a_not_active_status_file(data):
    (data.parent / "status.csv").write_text("transport_name,status\nTCI Express,Not Active\n", encoding="utf-8")
    patch(transport_name="TCI Express", status="Active")
    row = next(r for r in search(city="Ahmedabad")["results"] if r["transport_name"] == "TCI Express")
    assert row["status"] == "Active"


def test_a_pincode_served_only_by_an_inactive_transporter_is_not_suggested(data):
    patch(transport_name="Kishan Travels", status="Not Active")
    assert "360001" not in suggested("3600")
    assert "Rajkot" not in suggested("Raj")


def test_invalid_status_is_rejected(data):
    r = client.patch("/api/manage/transporters", json={"transport_name": "TCI Express", "status": "Inactive"})
    assert r.status_code == 422


# ---------- Edit / Hide ----------

def test_transporter_level_mobile_applies_to_search(data):
    patch(transport_name="Abhisek Travels", mobile="9876500000")
    row = search(transport_name="Abhisek Travels")["results"][0]
    assert row["contact_number"] == "9876500000"
    assert managed("Abhisek Travels")["edited"] is True


def test_hide_removes_from_search_but_keeps_in_manage_and_unhide_restores(data):
    patch(transport_name="Abhisek Travels", hidden=True)
    assert "Abhisek Travels" not in names(search(city="Ahmedabad"))
    assert "Abhisek Travels" not in suggested("Abh")
    assert managed("Abhisek Travels")["hidden"] is True

    patch(transport_name="Abhisek Travels", hidden=False)
    assert "Abhisek Travels" in names(search(city="Ahmedabad"))


def test_actions_match_the_name_case_and_spacing_insensitively(data):
    patch(transport_name="  abhisek   TRAVELS ", status="Not Active")
    assert managed("Abhisek Travels")["status"] == "Not Active"


# ---------- Delete / Restore ----------

def test_delete_removes_from_manage_search_list_and_suggestions(data):
    r = client.delete("/api/manage/transporters", params={"transport_name": "Kishan Travels"})
    assert r.status_code == 200, r.text
    body = manage()
    assert "Kishan Travels" not in {t["transport_name"] for t in body["results"]}
    assert body["deleted"] == ["Kishan Travels"]
    assert search(transport_name="Kishan Travels")["results"] == []
    assert "Kishan Travels" not in names(search(city="Rajkot"))
    assert "Kishan Travels" not in client.get("/api/transport/list").json()
    assert "Kishan Travels" not in suggested("Kis")


def test_restore_brings_a_deleted_transporter_back(data):
    client.delete("/api/manage/transporters", params={"transport_name": "Kishan Travels"})
    r = client.post("/api/manage/transporters/restore", json={"transport_name": "Kishan Travels"})
    assert r.status_code == 200, r.text
    assert manage()["deleted"] == []
    assert "Kishan Travels" in names(search(city="Rajkot"))


def test_delete_unknown_or_excluded_transporter_is_404(data):
    assert client.delete("/api/manage/transporters", params={"transport_name": "Nobody Logistics"}).status_code == 404
    assert client.delete("/api/manage/transporters", params={"transport_name": "Shadow Courier"}).status_code == 404


def test_admin_actions_never_write_the_source_data(data):
    before = data.read_bytes()
    patch(transport_name="TCI Express", status="Not Active", mobile="9000000000", hidden=True)
    client.delete("/api/manage/transporters", params={"transport_name": "Kishan Travels"})
    manage()
    search(city="Ahmedabad")
    assert data.read_bytes() == before


# ---------- Edit: name, service cities, pincodes ----------

def test_rename_applies_to_search_manage_and_suggestions(data):
    patch(transport_name="Kishan Travels", name="Kishan Roadlines")
    assert names(search(city="Rajkot")) == {"Kishan Roadlines"}
    assert search(transport_name="Kishan Roadlines")["results"][0]["transport_name"] == "Kishan Roadlines"
    assert search(transport_name="Kishan Travels")["results"] == []
    assert "Kishan Roadlines" in suggested("Kishan R")
    t = managed("Kishan Roadlines")
    assert t["edited"] is True and t["service_cities"] == ["Rajkot"]
    # Further actions use the new displayed name.
    patch(transport_name="Kishan Roadlines", status="Not Active")
    assert search(city="Rajkot")["results"] == []


def test_renaming_back_to_the_original_name_clears_the_rename(data):
    patch(transport_name="Kishan Travels", name="Kishan Roadlines")
    patch(transport_name="Kishan Roadlines", name="Kishan Travels")
    assert managed("Kishan Travels")["edited"] is False


def test_rename_to_another_transporters_name_is_rejected(data):
    r = client.patch("/api/manage/transporters", json={"transport_name": "Kishan Travels", "name": "tci  express"})
    assert r.status_code == 409 and "TCI Express" in r.json()["detail"]
    r = client.patch("/api/manage/transporters", json={"transport_name": "Kishan Travels", "name": "   "})
    assert r.status_code == 422


def test_edited_service_cities_replace_the_real_list_and_are_searchable(data):
    patch(transport_name="Kishan Travels", service_cities=["Rajkot", "Surat", " surat "])
    assert managed("Kishan Travels")["service_cities"] == ["Rajkot", "Surat"]  # trimmed, de-duplicated
    assert "Kishan Travels" in names(search(city="Surat"))
    row = search(transport_name="Kishan Travels")["results"][0]
    assert row["service_cities"] == ["Rajkot", "Surat"]
    assert "Surat" in suggested("Sur")


def test_edited_pincodes_replace_the_real_list_and_are_searchable(data):
    patch(transport_name="Kishan Travels", pincodes=["395007", "360001"])
    assert managed("Kishan Travels")["pincodes"] == ["360001", "395007"]
    assert "Kishan Travels" in names(search(pincode="395007"))
    patch(transport_name="Kishan Travels", pincodes=["395007"])
    assert "Kishan Travels" not in names(search(pincode="360001"))
    assert "Kishan Travels" in names(search(city="Rajkot"))  # still a service city


def test_an_edited_pincode_keeps_its_real_location_for_state_search(data):
    patch(transport_name="Kishan Travels", pincodes=["400001"])  # a real Maharashtra pincode in the data
    assert "Kishan Travels" in names(search(state="Maharashtra"))


def test_invalid_pincodes_are_rejected(data):
    r = client.patch("/api/manage/transporters", json={"transport_name": "Kishan Travels", "pincodes": ["36000", "abc123"]})
    assert r.status_code == 422 and "36000" in r.json()["detail"]


def test_edit_all_fields_at_once(data):
    patch(transport_name="Abhisek Travels", name="Abhishek Travels", service_cities=["Mumbai", "Pune"],
          pincodes=["400001"], mobile="9000011111", status="Active", hidden=False)
    t = managed("Abhishek Travels")
    assert (t["service_cities"], t["pincodes"], t["mobile"], t["status"], t["hidden"]) == (
        ["Mumbai", "Pune"], ["400001"], "9000011111", "Active", False)
    row = search(pincode="400001")["results"][0]
    assert (row["transport_name"], row["contact_number"]) == ("Abhishek Travels", "9000011111")


# ---------- Add Transporter ----------

def add(**body):
    return client.post("/api/manage/transporters", json=body)


def test_added_transporter_appears_in_manage_and_every_search_type(data):
    r = add(transport_name="Shree Ganesh Roadways", service_cities=["Surat", "Vapi"], pincodes=["400001", "396191"],
            mobile="9812345678", status="Active")
    assert r.status_code == 200, r.text
    t = managed("Shree Ganesh Roadways")
    assert t["added_locally"] is True and t["edited"] is False
    assert (t["service_cities"], t["pincodes"], t["mobile"], t["status"]) == (
        ["Surat", "Vapi"], ["396191", "400001"], "9812345678", "Active")
    assert "Shree Ganesh Roadways" in names(search(pincode="396191"))
    assert "Shree Ganesh Roadways" in names(search(city="Vapi"))
    assert "Shree Ganesh Roadways" in names(search(state="Maharashtra"))  # via real pincode 400001
    row = search(transport_name="shree ganesh roadways")["results"][0]
    assert row["contact_number"] == "9812345678" and row["service_cities"] == ["Surat", "Vapi"]
    assert "Shree Ganesh Roadways" in suggested("Shree G")


def test_added_transporter_defaults_to_active_and_needs_only_a_name(data):
    assert add(transport_name="Om Logistics").status_code == 200
    assert managed("Om Logistics")["status"] == "Active"
    assert search(transport_name="Om Logistics")["results"][0]["transport_name"] == "Om Logistics"


def test_added_not_active_transporter_is_managed_but_not_searchable(data):
    add(transport_name="Om Logistics", service_cities=["Surat"], status="Not Active")
    assert managed("Om Logistics")["status"] == "Not Active"
    assert search(city="Surat")["results"] == []


def test_add_rejects_duplicates_missing_name_and_bad_pincodes(data):
    assert add(transport_name="tci express").status_code == 409
    assert add(transport_name="  ").status_code == 422
    assert add(transport_name="New One", pincodes=["12"]).status_code == 422
    add(transport_name="Om Logistics")
    assert add(transport_name="OM  LOGISTICS").status_code == 409


def test_added_transporter_can_be_edited_hidden_deleted_and_restored(data):
    add(transport_name="Om Logistics", pincodes=["380001"])
    patch(transport_name="Om Logistics", name="Om Logistics Pvt", pincodes=["380001", "390001"])
    assert "Om Logistics Pvt" in names(search(pincode="390001"))
    patch(transport_name="Om Logistics Pvt", hidden=True)
    assert "Om Logistics Pvt" not in names(search(pincode="390001"))
    patch(transport_name="Om Logistics Pvt", hidden=False)
    client.delete("/api/manage/transporters", params={"transport_name": "Om Logistics Pvt"})
    assert manage()["deleted"] == ["Om Logistics Pvt"]
    client.post("/api/manage/transporters/restore", json={"transport_name": "Om Logistics Pvt"})
    assert managed("Om Logistics Pvt")["pincodes"] == ["380001", "390001"]


def test_edits_and_added_transporters_survive_a_restart(data, monkeypatch):
    add(transport_name="Om Logistics", service_cities=["Surat"], pincodes=["395007"], mobile="9812345678")
    patch(transport_name="Kishan Travels", name="Kishan Roadlines", service_cities=["Rajkot", "Morbi"])
    # A restart = every in-memory cache gone; only the local SQLite file remains.
    for cache in ("_groups_cache", "_catalog_cache", "_suggest_cache", "_locations_cache"):
        monkeypatch.setattr(es, cache, {})
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    assert managed("Om Logistics")["mobile"] == "9812345678"
    assert managed("Kishan Roadlines")["service_cities"] == ["Morbi", "Rajkot"]
    assert "Kishan Roadlines" in names(search(city="Morbi"))
