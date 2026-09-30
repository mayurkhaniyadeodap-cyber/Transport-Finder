"""Tests for:
- GET /api/transport/suggest -- autocomplete suggestions (pincode/city/state/transporter), built
  entirely from the same already-loaded, already-allowlisted data every search already uses.
- Searching by transporter name (SearchQuery.transport_name), the new 4th search type -- reuses
  the existing search/dedupe/synonym/allowlist pipeline unchanged, just a new way to reach it.
Uses the vacalvers_csv fixture (fast, file-based, no network), same convention as
test_vacalvers_search.py.
"""
import csv

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import excel_search as es
from app.services import transporter_filter as tf
from app.services import transporter_synonyms as ts
from app.services import vacalvers_source as vc

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
def data(tmp_path, monkeypatch):
    rows = [
        _row("TCI EXPRESS", city="Rajkot", state="Gujarat", pincode="360003", order="#1"),
        _row("PAVAN PARCEL SERVICE", city="Rajkot", state="Gujarat", pincode="360001", order="#2"),
        _row("PAVITRA TRANSPORT", city="Ahmedabad", state="Gujarat", pincode="380001", order="#3"),
        # A second pincode for Pavan Parcel Service, to prove name-search still combines pincodes.
        _row("PAVAN PARCEL SERVICE", city="Surat", state="Gujarat", pincode="395001", order="#4"),
        # A known spelling variant (see data/transporter_synonyms.csv): should surface as "Bluedart".
        _row("BLUEADART", city="Rajkot", state="Gujarat", pincode="360002", order="#5"),
        _row("BLUEDART", city="Vadodara", state="Gujarat", pincode="390001", order="#6"),
        # Excluded by the (fake) allowlist below -- must never appear as a suggestion or a result.
        _row("SHADOW COURIER", city="Rajkot", state="Gujarat", pincode="360005", order="#7"),
    ]
    path = tmp_path / "orders.csv"
    write_csv(path, rows)

    allowlist = tmp_path / "allowlist.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["courier_name"])
    for n in ("TCI EXPRESS", "PAVAN PARCEL SERVICE", "PAVITRA TRANSPORT", "BLUEADART", "BLUEDART"):
        ws.append([n])
    wb.save(allowlist)
    monkeypatch.setattr(tf, "ALLOWLIST_XLSX_PATH", allowlist)
    monkeypatch.setattr(tf, "ALLOWED_TRANSPORTERS", tf._load_allowed_names(allowlist))

    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    return path


def suggest(q, **params):
    r = client.get("/api/transport/suggest", params={"q": q, **params})
    assert r.status_code == 200, r.text
    return r.json()


def search(**params):
    r = client.get("/api/transport/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- /api/transport/suggest ----------

def test_pincode_prefix_suggests_matching_pincodes(data):
    out = suggest("360")
    pincodes = {s["value"] for s in out if s["type"] == "pincode"}
    assert pincodes == {"360001", "360002", "360003"}  # not 360005 -- that courier is excluded


def test_city_prefix_suggests_matching_cities(data):
    out = suggest("Raj")
    cities = {s["value"] for s in out if s["type"] == "city"}
    assert cities == {"Rajkot"}


def test_state_prefix_suggests_matching_states(data):
    out = suggest("Guj")
    states = {s["value"] for s in out if s["type"] == "state"}
    assert states == {"Gujarat"}


def test_transporter_prefix_suggests_matching_names(data):
    # Matches the request's example shape ("Pav" -> multiple "Pav..." transporters). Deliberately
    # not "Pavan Travels" as the second name -- that's a real confirmed variant of "Paavan Travels"
    # in the live data/transporter_synonyms.csv, so it would canonicalise away; see the dedicated
    # synonym tests in test_dedupe_transport_rows.py / test_transporter_synonyms.py for that.
    out = suggest("Pav")
    names = {s["value"] for s in out if s["type"] == "transporter"}
    assert names == {"Pavan Parcel Service", "Pavitra Transport"}


def test_suggestions_never_include_excluded_transporters(data):
    out = suggest("Shad")
    assert all(s["value"] != "Shadow Courier" for s in out)


def test_transporter_suggestions_use_the_canonical_synonym_name(data):
    # "Blueadart" is a known variant of "Bluedart" (data/transporter_synonyms.csv) -- the
    # suggestion list, like every other view, shows only the canonical spelling, once.
    out = suggest("Blue")
    names = [s["value"] for s in out if s["type"] == "transporter"]
    assert names == ["Bluedart"]


def test_empty_query_returns_no_suggestions(data):
    assert suggest("") == []


def test_suggestion_results_are_capped(data):
    out = suggest("Pav", limit=1)
    assert len(out) == 1


def test_suggestions_pick_up_a_newly_added_transporter_immediately(data):
    # The suggestion vocabulary is cached for speed; adding a transporter in Manage Transporters
    # must still show up on the very next keystroke, not after some expiry.
    assert all(s["value"] != "Pavlov Logistics" for s in suggest("Pavl"))
    r = client.post("/api/overrides/new-transporter", json={
        "transport_name": "Pavlov Logistics", "city": "Rajkot", "pincode": "360009",
    })
    assert r.status_code == 200, r.text
    assert {"type": "transporter", "value": "Pavlov Logistics"} in suggest("Pavl")


def test_suggestions_drop_a_hidden_transporter_immediately(data):
    assert {"type": "transporter", "value": "Pavitra Transport"} in suggest("Pavi")
    r = client.post("/api/overrides", json={
        "source_city": "Ahmedabad", "source_transport_name": "Pavitra Transport",
        "source_pincode": "380001", "hidden": True,
    })
    assert r.status_code == 200, r.text
    assert all(s["value"] != "Pavitra Transport" for s in suggest("Pavi"))


def test_suggestions_follow_a_renamed_transporter_immediately(data):
    created = client.post("/api/overrides/new-transporter", json={"transport_name": "Pavo Carriers", "pincode": "360010"})
    assert created.status_code == 200, created.text
    client.patch(f"/api/overrides/{created.json()['id']}", json={"transport_name": "Pavo Cargo Carriers"})
    names = {s["value"] for s in suggest("Pavo") if s["type"] == "transporter"}
    assert names == {"Pavo Cargo Carriers"}


# ---------- Search by Transporter Name ----------

def test_search_by_transporter_name_returns_that_transporters_rows(data):
    result = search(transport_name="Pavan Parcel Service")
    assert result["match_level"] == "transporter"
    names = {r["transport_name"] for r in result["results"]}
    assert names == {"Pavan Parcel Service"}


def test_search_by_transporter_name_combines_its_pincodes(data):
    # Pavan Parcel Service has two pincodes (Rajkot 360001, Surat 395001) -- name search combines
    # them into one row exactly like a city/state search would.
    result = search(transport_name="Pavan Parcel Service")
    row = result["results"][0]
    assert row["pincode"] == "360001, 395001"


def test_search_by_transporter_name_is_case_and_spacing_insensitive(data):
    result = search(transport_name="pavan   parcel service")
    assert {r["transport_name"] for r in result["results"]} == {"Pavan Parcel Service"}


def test_search_by_a_known_variant_name_finds_the_canonical_transporter(data):
    # Searching the misspelled variant itself still finds the (merged) canonical result.
    result = search(transport_name="Blueadart")
    assert result["match_level"] == "transporter"
    names = {r["transport_name"] for r in result["results"]}
    assert names == {"Bluedart"}
    row = result["results"][0]
    assert row["pincode"] == "360002, 390001"  # both the variant's and the canonical's own pincode


def test_search_by_excluded_transporter_name_finds_nothing(data):
    result = search(transport_name="Shadow Courier")
    assert result["results"] == []


def test_search_with_no_field_at_all_mentions_transporter_name_in_the_hint(data):
    result = search()
    assert "transporter name" in result["message"].lower()


def test_clicking_a_transporter_suggestion_and_searching_returns_that_transporter(data):
    # End-to-end: the suggestion's own value, fed straight back into search, must work.
    out = suggest("Pavitra Transport")
    suggestion = next(s["value"] for s in out if s["type"] == "transporter")
    result = search(transport_name=suggestion)
    assert {r["transport_name"] for r in result["results"]} == {"Pavitra Transport"}
