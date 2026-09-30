from datetime import datetime

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import excel_source as src, transporter_filter, transporter_synonyms

client = TestClient(app)


def test_parse_location():
    assert src.parse_location("patiyala 147001 Punjab") == ("Patiyala", "147001", "Punjab")
    assert src.parse_location("BALOTARA - 344022, Rajasthan") == ("Balotara", "344022", "Rajasthan")
    assert src.parse_location("RAJKOT") == ("Rajkot", None, None)
    assert src.parse_location("364240") == (None, "364240", None)
    assert src.parse_location(None) == (None, None, None)


def test_parse_location_drops_a_state_word_that_contradicts_its_own_pincode():
    # 360003 is a real Gujarat (Rajkot) pincode; "Goa" next to it in the same free-text address is
    # a contradiction (Goa pincodes start with 4, not 3) -- the state is dropped, not the pincode.
    assert src.parse_location("Rajkot 360003 Goa") == ("Rajkot", "360003", None)
    # A genuinely consistent combination is untouched.
    assert src.parse_location("Rajkot 360003 Gujarat") == ("Rajkot", "360003", "Gujarat")


# ---------- pincode/state consistency (shared by rds_source.py and vacalvers_source.py too) ----------

def test_pincode_state_conflicts_flags_a_cross_region_mismatch():
    assert src.pincode_state_conflicts("380009", "Goa") is True  # Ahmedabad (Gujarat) pincode vs Goa
    assert src.pincode_state_conflicts("361005", "Goa") is True  # Jamnagar (Gujarat) pincode vs Goa
    assert src.pincode_state_conflicts("403001", "Goa") is False  # a real Goa pincode
    assert src.pincode_state_conflicts("360003", "Gujarat") is False
    assert src.pincode_state_conflicts("400001", "Maharashtra") is False
    assert src.pincode_state_conflicts("110001", "Delhi") is False


def test_pincode_state_conflicts_is_case_and_spacing_insensitive():
    assert src.pincode_state_conflicts("380009", "  goa  ") is True
    assert src.pincode_state_conflicts("380009", "GUJARAT") is False


def test_pincode_state_conflicts_never_flags_when_it_cannot_check():
    assert src.pincode_state_conflicts(None, "Goa") is False
    assert src.pincode_state_conflicts("380009", None) is False
    assert src.pincode_state_conflicts("38000", "Goa") is False  # not 6 digits
    assert src.pincode_state_conflicts("380009", "Narnia") is False  # not a recognised state
    assert src.pincode_state_conflicts("380009", "Other") is False  # RDS's own "unknown state" bucket


def test_normalize_transport():
    assert src.normalize_transport("KISHAN  TRAVELS") == "Kishan Travels"
    assert src.normalize_transport("tci express") == "TCI Express"
    assert src.normalize_transport("COD") is None  # not a transporter
    assert src.normalize_transport("12.0") is None


@pytest.fixture()
def workbook(tmp_path, monkeypatch):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "SEP 2021"
    ws.append([None, "ORDERN NO", "Company name", "City", "Transport", "Parcel", "Time"])
    ws.append([datetime(2021, 9, 1)])
    ws.append([None, 1, "Secret Customer", "Bhavnagar 364240 Gujarat", "Shree Khodiyar Transport", 2])
    ws.append([None, 2, "Another Customer", "Sihor 364240 Gujarat", "Shree Khodiyar Transport", 1])
    ws.append([datetime(2021, 9, 5)])
    ws.append([None, 3, "X", "Bhavnagar 364240 Gujarat", "TCI EXPRESS", 1])
    ws.append([None, 4, "Y", "Rajkot 360001 Gujarat", "COD", 1])  # excluded
    ws.append([None, 5, "Z", "Surat", "VRL LOGISTIC", 1])  # city only
    ws.append([None, 6, "Cust 9876543210", "Ambala 133001 Haryana", "VRL LOGISTIC", 1])  # matches branch by pincode
    ws.append([None, 7, "Q", "Ambala 133001 Haryana", "Kishan Travels", 1])  # same pincode, not VRL -> no phone
    ws.append([None, 8, "Q", "Ambala 133001 Haryana", "VRL LOGISTOC", 1])  # misspelling, not merged -> no phone
    ws.append([None, 9, "Q", "Panchkula 134003 Haryana", "VRL LOGISTICS", 1])  # 2 branches share pincode -> ambiguous
    ws.append([None, 10, "Q", "Rajkot Gujarat", "VRL LOGISTICS", 1])  # no pincode: city + state fallback
    ws.append([None, 11, "Q", "Rajkot 360009 Gujarat", "VRL LOGISTICS", 1])  # pincode not in CSV -> city fallback
    ws2 = wb.create_sheet("Other")
    ws2.append([None, "POS", "Company name", "Transport", "City", "Parcel"])  # swapped columns
    ws2.append([None, 1, "Q", "Kishan Travels", "Jaipur 302001 Rajasthan", 1])
    path = tmp_path / "dispatch.xlsx"
    wb.save(path)
    csv_path = tmp_path / "branches.csv"
    csv_lines = [
        "Branch Name,Branch Code,Branch ID,Address,State,Phone,Email,Booking,Delivery",
        'AMBALA,AMB,1,"PLOT 38, MOHRA, AMBALA-133001.",Haryana,"7743039625,7483405793",a@vrllogistics.com,Yes,Yes',
        'PKL ONE,P1,2,"SECTOR 1 PANCHKULA-134003",Haryana,9000000001,b@vrllogistics.com,Yes,Yes',
        'PKL TWO,P2,3,"SECTOR 2 PANCHKULA-134003",Haryana,9000000002,c@vrllogistics.com,Yes,Yes',
        'RAJKOT,RJT,4,"GIDC RAJKOT-360002",Gujarat,093777-11111   0281-2222222,d@vrllogistics.com,Yes,Yes',
    ]
    csv_path.write_text("\n".join(csv_lines) + "\n", encoding="utf-8")
    monkeypatch.setattr(settings, "branches_csv", str(csv_path))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "status.csv"))  # absent = nothing configured
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    monkeypatch.setattr(settings, "data_source", "excel")
    monkeypatch.setattr(settings, "excel_path", str(path))
    monkeypatch.setattr(src, "_index", None)
    monkeypatch.setattr(src, "_index_sig", None)
    monkeypatch.setattr("app.services.excel_search.CACHE_DIR", tmp_path / "cache")
    # This file tests the Excel source/search pipeline, not transporter_filter (which has its own
    # dedicated tests in test_transporter_filter.py) — bypass it here so "does this transporter
    # appear" assertions below test what they're meant to.
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)
    # Likewise, this fixture's "VRL Logistic" vs "VRL Logistics" rows deliberately test the plain
    # exact-key dedup, not the real-world synonym audit (which does merge that specific pair) —
    # bypass it here so those stay independent test fixtures, unaffected by real audit data.
    monkeypatch.setattr(transporter_synonyms, "canonical_name", lambda name: name)
    # Isolate from any real local overrides on this machine -- otherwise they leak into results here too.
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))
    return path


def get(**params):
    r = client.get("/api/transport/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_pincode_search_returns_table_rows_sorted(workbook):
    data = get(pincode="364240")
    assert data["match_level"] == "pincode"
    rows = [(r["city"], r["transport_name"], r["pincode"]) for r in data["results"]]
    assert rows == sorted(rows, key=lambda r: r[1].lower())  # sorted by transport name
    # "Shree Khodiyar Transport" appears for both Bhavnagar and Sihor (rows #2 and #3 in the
    # workbook, same pincode) -- one row per Transport Name globally, so these collapse into one.
    assert ("Bhavnagar", "Shree Khodiyar Transport", "364240") in rows
    assert ("Sihor", "Shree Khodiyar Transport", "364240") not in rows
    assert sum(1 for r in rows if r[1] == "Shree Khodiyar Transport") == 1
    assert ("Bhavnagar", "TCI Express", "364240") in rows
    assert all(r["contact_number"] is None for r in data["results"])  # none of these are VRL


def test_missing_data_is_null_not_invented(workbook):
    r = get(pincode="364240")["results"][0]
    for f in ("branch_name", "contact_number", "address", "godown_name", "serviceability",
              "documents_required", "surface_delivery", "air_delivery", "rail_delivery"):
        assert r[f] is None, f


def test_no_customer_data_leaks(workbook):
    body = client.get("/api/transport/search", params={"pincode": "364240"}).text
    assert "Secret Customer" not in body and "Another Customer" not in body
    assert "dispatch" not in body


def test_city_state_and_state_and_fallback(workbook):
    assert get(city="jaipur", state="Rajasthan")["match_level"] == "city_state"
    assert get(state="gujarat")["match_level"] == "state"
    assert get(pincode="999999", state="Rajasthan")["match_level"] == "state"
    assert get(city="Surat")["results"][0]["transport_name"] == "VRL Logistic"
    assert get(city="Surat")["results"][0]["pincode"] is None  # never invented


def test_swapped_columns_and_excluded_transport(workbook):
    assert get(pincode="302001")["results"][0]["transport_name"] == "Kishan Travels"
    assert get(pincode="360001")["results"] == []  # only row was COD


def test_no_result_and_invalid(workbook):
    assert get(pincode="999999")["results"] == []
    assert "6 digits" in get(pincode="12")["message"]


def test_missing_file_gives_503(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_source", "excel")
    monkeypatch.setattr(settings, "excel_path", str(tmp_path / "nope.xlsx"))
    monkeypatch.setattr(src, "_index", None)
    r = client.get("/api/transport/search", params={"pincode": "110001"})
    assert r.status_code == 503


def _row(data, transport):
    return next(r for r in data["results"] if r["transport_name"] == transport)


def test_mobile_matched_by_pincode_for_vrl_only(workbook):
    rows = get(pincode="133001")["results"]
    by = {r["transport_name"]: r for r in rows}
    assert by["VRL Logistic"]["contact_number"] == "7743039625, 7483405793"
    assert by["VRL Logistic"]["branch_name"] == "AMBALA"
    assert by["Kishan Travels"]["contact_number"] is None  # other transporter never gets VRL's number
    assert by["VRL Logistoc"]["contact_number"] is None  # similar name is not merged


def test_customer_phone_never_used(workbook):
    body = client.get("/api/transport/search", params={"pincode": "133001"}).text
    assert "9876543210" not in body


def test_ambiguous_pincode_is_not_guessed(workbook):
    assert get(pincode="134003")["results"][0]["contact_number"] is None


def test_city_state_fallback(workbook):
    # row #10 (no pincode) and row #11 (360009, not in the branches CSV) are the same
    # VRL Logistics/Rajkot combo -> one row, pincodes combined.
    rows = get(city="Rajkot", state="Gujarat")["results"]
    assert len(rows) == 1
    assert rows[0]["contact_number"] == "093777-11111, 0281-2222222"
    assert rows[0]["pincode"] == "360009"
    assert get(city="Rajkot")["results"][0]["contact_number"] == "093777-11111, 0281-2222222"


def test_missing_branch_csv_still_searches(workbook, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "missing.csv"))
    data = get(pincode="133001")
    assert data["results"] and all(r["contact_number"] is None for r in data["results"])


# ---------- Active / Not Active transporter status ----------
# Search returns Active transporters only: a Not Active one is dropped (Manage Transporters still lists it).

def write_status(workbook, *rows, header="transport_name,status"):
    (workbook.parent / "status.csv").write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")


def names(data):
    return {r["transport_name"] for r in data["results"]}


def statuses_by_name(data):
    return {r["transport_name"]: r["status"] for r in data["results"]}


def test_active_transporter_appears(workbook):
    write_status(workbook, "TCI Express,Active", "Shree Khodiyar Transport,Active")
    assert names(get(pincode="364240")) == {"TCI Express", "Shree Khodiyar Transport"}


def test_not_active_transporter_is_excluded_from_every_search_type(workbook):
    write_status(workbook, "TCI Express,Not Active")
    for q in ({"pincode": "364240"}, {"city": "Bhavnagar", "state": "Gujarat"}, {"state": "Gujarat"},
              {"transport_name": "TCI Express"}):
        data = get(**q)
        assert "TCI Express" not in names(data), q
    body = client.get("/api/transport/search", params={"pincode": "364240"}).text
    assert "TCI Express" not in body  # not in the raw response either


def test_mixed_search_returns_only_the_active_one(workbook):
    write_status(workbook, "TCI Express,Not Active", "Shree Khodiyar Transport,Active")
    data = get(pincode="364240")
    assert statuses_by_name(data) == {"Shree Khodiyar Transport": "Active"}
    assert data["total"] == 1  # counted after the filter, so pagination stays right
    assert {r["pincode"] for r in data["results"]} == {"364240"}


def test_status_matching_is_case_space_insensitive_but_exact(workbook):
    # Tested directly against transport_status.py (not via search) since the sample name here need
    # not be a real, searchable transporter — only status-matching behaviour is under test.
    write_status(workbook, "  kishan travels  ,not   active", "Kishan Travels Extra,Active")
    from app.services import transport_status as ts
    table = ts.get_table(str(workbook.parent / "status.csv"))
    assert table.status_of("Kishan Travels") == "Not Active"  # matches ignoring case/spacing
    assert table.status_of("Kishan Travels Extra") == "Active"  # a different transporter: unaffected


def test_similar_names_are_labelled_independently(workbook):
    write_status(workbook, "VRL Logistic,Not Active")  # a different transporter than the one at 133001
    from app.services import transport_status as ts
    table = ts.get_table(str(workbook.parent / "status.csv"))
    assert table.status_of("VRL Logistic") == "Not Active"
    assert table.status_of("VRL Logistoc") == "Active"  # misspelling: unaffected, documented default
    assert names(get(pincode="133001")) == {"Kishan Travels", "VRL Logistoc"}  # only the exact name is dropped


def test_unlisted_transporter_follows_documented_default(workbook, monkeypatch):
    write_status(workbook, "TCI Express,Not Active")  # Shree Khodiyar has no row
    assert statuses_by_name(get(pincode="364240"))["Shree Khodiyar Transport"] == "Active"  # default = Active
    monkeypatch.setattr(settings, "unlisted_transport_status", "Not Active")
    assert names(get(pincode="364240")) == set()  # both Not Active now: unlisted default, and listed


def test_no_status_file_means_everything_defaults_to_active(workbook):
    data = get(pincode="364240")
    assert names(data) == {"TCI Express", "Shree Khodiyar Transport"}
    assert set(statuses_by_name(data).values()) == {"Active"}


def test_pincode_with_only_not_active_transporters_finds_nothing_active(workbook):
    write_status(workbook, "TCI Express,Not Active", "Shree Khodiyar Transport,Not Active")
    data = get(pincode="364240", city="Sihor", state="Gujarat")
    # Same pincode -> city -> state fallback as always: only Gujarat still has an Active transporter.
    assert data["match_level"] == "state"
    assert names(data) == {"VRL Logistics"}


def test_list_endpoint_includes_not_active(workbook):
    write_status(workbook, "TCI Express,Not Active")
    listed = client.get("/api/transport/list").json()
    assert "TCI Express" in listed and "Shree Khodiyar Transport" in listed


def test_status_file_edits_apply_without_restart(workbook):
    write_status(workbook, "TCI Express,Active")
    assert statuses_by_name(get(pincode="364240"))["TCI Express"] == "Active"
    write_status(workbook, "TCI Express,Not Active")
    assert "TCI Express" not in names(get(pincode="364240"))  # dropped as soon as the file changes


@pytest.mark.parametrize("row", ["TCI Express,Inactive", "TCI Express,", "TCI Express,maybe"])
def test_invalid_status_fails_safe_with_503(workbook, row):
    write_status(workbook, row)
    r = client.get("/api/transport/search", params={"pincode": "364240"})
    assert r.status_code == 503 and "TCI Express" in r.text  # never silently guesses a status


def test_conflicting_duplicate_rows_and_bad_header_give_503(workbook):
    write_status(workbook, "TCI Express,Active", "tci  express,Not Active")
    assert client.get("/api/transport/search", params={"pincode": "364240"}).status_code == 503
    write_status(workbook, "TCI Express,Active", header="name,state")
    assert client.get("/api/transport/search", params={"pincode": "364240"}).status_code == 503


def test_comments_and_blank_lines_are_ignored(workbook):
    lines = ["# note", "", "transport_name,status", "# another", "TCI Express,Not Active"]
    (workbook.parent / "status.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert "TCI Express" not in names(get(pincode="364240"))


def test_shipped_status_file_is_valid_and_has_no_guessed_rows():
    from app.services import transport_status as ts
    table = ts.get_table(str(__import__("pathlib").Path(__file__).resolve().parents[2] / "data" / "transport_status.csv"))
    assert table.statuses == {}  # nothing pre-filled: statuses are never guessed


def test_every_result_row_carries_an_active_status(workbook):
    write_status(workbook, "TCI Express,Not Active", "Shree Khodiyar Transport,Active")
    rows = get(pincode="364240")["results"]
    assert rows and all(r["status"] == "Active" for r in rows)


def test_unlisted_transporter_status_is_the_documented_default(workbook):
    assert set(statuses_by_name(get(pincode="364240")).values()) == {"Active"}  # no rows configured
