import csv

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import branch_source, transport_status, transporter_filter
from app.services import vacalvers_source as vc

client = TestClient(app)

COLUMNS = [
    "OrderNo", "MarketplaceName", "OrderDate", "OrderStatus", "Total",
    "CustomerFirstNm", "CustomerLastNm", "CustomerBillingAddress",
    "CustomerBillingState", "CustomerBillingCity", "CustomerBillingPinCode",
    "ShipmentCourier",
]


def _row(**over):
    base = {
        "OrderNo": "#135-00000001", "MarketplaceName": "Shopify", "OrderDate": "2026-09-01 00:00:00",
        "OrderStatus": "Dispatched", "Total": "1234.56",
        "CustomerFirstNm": "Secret", "CustomerLastNm": "Customer",
        "CustomerBillingAddress": "12 Secret Street", "CustomerBillingState": "Gujarat",
        "CustomerBillingCity": "Rajkot", "CustomerBillingPinCode": "360003", "ShipmentCourier": "TCI EXPRESS",
    }
    base.update(over)
    return base


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)


@pytest.fixture()
def csv_file(tmp_path, monkeypatch):
    path = tmp_path / "orders.csv"
    write_csv(path, [
        _row(OrderNo="#1", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier="TCI EXPRESS"),
        _row(OrderNo="#2", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier="tci express"),  # dup after normalise
        _row(OrderNo="#3", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier="VRL LOGISTICS"),
        _row(OrderNo="#4", CustomerBillingCity="Bhavnagar", CustomerBillingPinCode="364001", CustomerBillingState="Gujarat", ShipmentCourier="KISHAN TRAVELS"),
        _row(OrderNo="#5", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier="SELF PICKUP"),  # excluded
        _row(OrderNo="#6", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier="DRIVER: DHARMIKBHAI RABARI"),  # excluded
        _row(OrderNo="#7", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier=""),  # blank -> excluded
        _row(OrderNo="#8", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier="COD"),  # excluded
        _row(OrderNo="#9", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier="CUSTOMER LABEL"),  # excluded
        _row(OrderNo="#10", CustomerBillingCity="Surat", CustomerBillingPinCode="", CustomerBillingState="Gujarat", ShipmentCourier="AAKASH ROADWAYS"),  # no pincode, still indexed
    ])
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    import app.services.excel_search as es
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    # This file tests the VaCalvers CSV source/search pipeline, not transporter_filter (which has
    # its own dedicated tests in test_transporter_filter.py) — bypass it here so "does this
    # transporter appear" assertions below test what they're meant to.
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))  # isolate from real local overrides
    return path


def get(**params):
    r = client.get("/api/transport/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def many_transporters_csv(tmp_path, monkeypatch):
    """120 distinct transporters at one pincode, with varying order counts, to test pagination."""
    rows = []
    for i in range(120):
        name = f"Transport {i:03d}"
        for _ in range(i % 3 + 1):  # 1, 2 or 3 orders per transporter
            rows.append(_row(
                OrderNo=f"#{i}", CustomerBillingCity="Mumbai", CustomerBillingState="Maharashtra",
                CustomerBillingPinCode="400001", ShipmentCourier=name,
            ))
    path = tmp_path / "many.csv"
    write_csv(path, rows)
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    import app.services.excel_search as es
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)  # see csv_file fixture
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))  # isolate from real local overrides
    return path


def test_pagination_default_page_size_is_50(many_transporters_csv):
    data = get(pincode="400001")
    assert data["total"] == 120
    assert data["page"] == 1
    assert data["page_size"] == 50
    assert data["total_pages"] == 3  # ceil(120/50)
    assert len(data["results"]) == 50


def test_pagination_second_and_last_page(many_transporters_csv):
    p2 = get(pincode="400001", page=2)
    assert p2["page"] == 2 and len(p2["results"]) == 50 and p2["total"] == 120
    p3 = get(pincode="400001", page=3)
    assert p3["page"] == 3 and len(p3["results"]) == 20  # 120 - 100

    # pages are contiguous, non-overlapping slices of the same sorted order
    names_all = [r["transport_name"] for r in (get(pincode="400001")["results"] + p2["results"] + p3["results"])]
    assert names_all == sorted(names_all)
    assert len(set(names_all)) == 120


def test_pagination_custom_page_size(many_transporters_csv):
    data = get(pincode="400001", page_size=10)
    assert data["page_size"] == 10 and len(data["results"]) == 10 and data["total_pages"] == 12


def test_pagination_page_size_is_capped(many_transporters_csv):
    r = client.get("/api/transport/search", params={"pincode": "400001", "page_size": 10000})
    assert r.status_code == 422  # rejected outright: page_size is capped at 200, never unbounded


def test_pagination_out_of_range_page_returns_empty_but_correct_total(many_transporters_csv):
    data = get(pincode="400001", page=99)
    assert data["results"] == [] and data["total"] == 120 and data["total_pages"] == 3


def test_no_result_and_validation_error_have_zero_pages(csv_file):
    data = get(pincode="999999")
    assert data["total"] == 0 and data["total_pages"] == 0 and data["results"] == []
    data = get(pincode="12")
    assert data["total"] == 0 and data["total_pages"] == 0


def names(data):
    return {r["transport_name"] for r in data["results"]}


# ---------- column mapping / normalisation ----------

def test_normalize_transport_excludes_non_transporter_values():
    assert vc.normalize_transport("TCI EXPRESS") == "TCI Express"
    assert vc.normalize_transport("VRL LOGISTICS") == "VRL Logistics"
    assert vc.normalize_transport("SELF PICKUP") is None
    assert vc.normalize_transport("DRIVER: DHARMIKBHAI RABARI") is None
    assert vc.normalize_transport("driver:bhavesh bhai") is None
    assert vc.normalize_transport("CUSTOMER LABEL") is None
    assert vc.normalize_transport("OTHER") is None
    assert vc.normalize_transport("COD") is None
    assert vc.normalize_transport("LOCAL") is None
    assert vc.normalize_transport("") is None
    assert vc.normalize_transport(None) is None
    assert vc.normalize_transport("AMAZON SHIPPING") == "Amazon Shipping"  # a real courier: kept


def test_normalize_pincode_requires_six_digits():
    assert vc.normalize_pincode("360003") == "360003"
    assert vc.normalize_pincode("3600") is None
    assert vc.normalize_pincode("") is None
    assert vc.normalize_pincode(None) is None


# ---------- search ----------

def test_pincode_search_uses_mapped_columns(csv_file):
    data = get(pincode="360003")
    assert data["match_level"] == "pincode"
    assert names(data) == {"TCI Express", "VRL Logistics"}
    row = next(r for r in data["results"] if r["transport_name"] == "TCI Express")
    assert row["city"] == "Rajkot" and row["pincode"] == "360003"


def test_duplicate_orders_collapse_into_one_row(csv_file):
    # order #1 (TCI EXPRESS) and #2 (tci express) are the same transporter/city/pincode
    data = get(pincode="360003")
    tci_rows = [r for r in data["results"] if r["transport_name"] == "TCI Express"]
    assert len(tci_rows) == 1


# ---------- one row per Transport Name (globally), pincodes combined ----------

@pytest.fixture()
def multi_pincode_csv(tmp_path, monkeypatch):
    """Same transporter serving three pincodes in Rajkot, plus a second, unrelated transporter
    in the same city -- to check pincodes combine but different transporters never merge."""
    rows = [
        _row(OrderNo="#1", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360001", ShipmentCourier="TCI EXPRESS"),
        _row(OrderNo="#2", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360002", ShipmentCourier="TCI EXPRESS"),
        _row(OrderNo="#3", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360003", ShipmentCourier="tci express"),  # dup-after-normalise, third pincode
        _row(OrderNo="#4", CustomerBillingCity="Rajkot", CustomerBillingPinCode="360001", ShipmentCourier="VRL LOGISTICS"),
    ]
    path = tmp_path / "multi.csv"
    write_csv(path, rows)
    status_csv = tmp_path / "status.csv"
    status_csv.write_text("transport_name,status\nTCI Express,Active\n", encoding="utf-8")
    branches = tmp_path / "branches.csv"
    branches.write_text(
        "Branch Name,Branch Code,Branch ID,Address,State,Phone,Email,Booking,Delivery\n"
        'RAJKOT,RJT,1,"GIDC RAJKOT-360001",Gujarat,9377011111,a@vrllogistics.com,Yes,Yes\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(branches))
    monkeypatch.setattr(settings, "transport_status_csv", str(status_csv))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    import app.services.excel_search as es
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))  # isolate from real local overrides
    return path


def test_same_transporter_multiple_pincodes_combine_into_one_row(multi_pincode_csv):
    data = get(city="Rajkot")
    tci_rows = [r for r in data["results"] if r["transport_name"] == "TCI Express"]
    assert len(tci_rows) == 1
    assert tci_rows[0]["pincode"] == "360001, 360002, 360003"


def test_dedup_keeps_mobile_and_status(multi_pincode_csv):
    data = get(city="Rajkot")
    tci = next(r for r in data["results"] if r["transport_name"] == "TCI Express")
    vrl = next(r for r in data["results"] if r["transport_name"] == "VRL Logistics")
    assert tci["status"] == "Active"  # from transport_status_csv, unaffected by dedup
    assert vrl["contact_number"] == "9377011111"  # from branches_csv, unaffected by dedup


def test_dedup_never_merges_different_transporters(multi_pincode_csv):
    data = get(city="Rajkot")
    assert {r["transport_name"] for r in data["results"]} == {"TCI Express", "VRL Logistics"}
    assert data["total"] == 2


def test_dedup_applies_to_pincode_search_too(multi_pincode_csv):
    data = get(pincode="360001")
    assert {r["transport_name"] for r in data["results"]} == {"TCI Express", "VRL Logistics"}
    tci = next(r for r in data["results"] if r["transport_name"] == "TCI Express")
    assert tci["pincode"] == "360001"  # only the matched pincode, not the transporter's other ones


def test_pagination_counts_grouped_rows_not_raw_entries(tmp_path, monkeypatch):
    """40 transporters, each at 2 pincodes in the same city -- total/pagination must be 40, not 80."""
    rows = []
    for i in range(40):
        name = f"Transport {i:03d}"
        rows.append(_row(OrderNo=f"#{i}a", CustomerBillingCity="Mumbai", CustomerBillingState="Maharashtra",
                          CustomerBillingPinCode="400001", ShipmentCourier=name))
        rows.append(_row(OrderNo=f"#{i}b", CustomerBillingCity="Mumbai", CustomerBillingState="Maharashtra",
                          CustomerBillingPinCode="400002", ShipmentCourier=name))
    path = tmp_path / "grouped.csv"
    write_csv(path, rows)
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    import app.services.excel_search as es
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))  # isolate from real local overrides

    data = get(city="Mumbai", state="Maharashtra", page_size=100)
    assert data["total"] == 40
    assert len(data["results"]) == 40
    row = next(r for r in data["results"] if r["transport_name"] == "Transport 000")
    assert row["pincode"] == "400001, 400002"


@pytest.fixture()
def cross_city_csv(tmp_path, monkeypatch):
    """The same transporter (by exact display name) serving different pincodes in DIFFERENT
    cities within one state -- plus lookalike names that must never merge with it or each other."""
    rows = [
        _row(OrderNo="#1", CustomerBillingCity="Rajkot", CustomerBillingState="Gujarat",
             CustomerBillingPinCode="394107", ShipmentCourier="AAKASH ROADWAYS"),
        _row(OrderNo="#2", CustomerBillingCity="Bhavnagar", CustomerBillingState="Gujarat",
             CustomerBillingPinCode="394210", ShipmentCourier="AAKASH ROADWAYS"),
        _row(OrderNo="#3", CustomerBillingCity="Surat", CustomerBillingState="Gujarat",
             CustomerBillingPinCode="395001", ShipmentCourier="aakash roadways"),  # same name, different case
        # "Kishan" vs "Kishan Travels" -- different word count, must stay distinct (never a synonym).
        _row(OrderNo="#4", CustomerBillingCity="Rajkot", CustomerBillingState="Gujarat",
             CustomerBillingPinCode="360001", ShipmentCourier="KISHAN"),
        _row(OrderNo="#5", CustomerBillingCity="Rajkot", CustomerBillingState="Gujarat",
             CustomerBillingPinCode="360002", ShipmentCourier="KISHAN TRAVELS"),
        # "Kishna" IS a known spelling variant of "Kishan" per the approved India-wide audit --
        # a third pincode for "Kishan" once merged (see test_known_synonym_variant_merges below).
        _row(OrderNo="#6", CustomerBillingCity="Rajkot", CustomerBillingState="Gujarat",
             CustomerBillingPinCode="360003", ShipmentCourier="KISHNA"),
    ]
    path = tmp_path / "cross_city.csv"
    write_csv(path, rows)
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    import app.services.excel_search as es
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))  # isolate from real local overrides
    return path


def test_state_search_merges_the_same_transporter_across_different_cities(cross_city_csv):
    # Aakash Roadways appears in Rajkot, Bhavnagar and Surat -- one row, all three pincodes combined.
    data = get(state="Gujarat")
    aakash_rows = [r for r in data["results"] if r["transport_name"] == "Aakash Roadways"]
    assert len(aakash_rows) == 1
    assert aakash_rows[0]["pincode"] == "394107, 394210, 395001"


def test_similar_but_distinct_names_are_never_merged(cross_city_csv):
    # "Kishan" vs "Kishan Travels": different word count -> never a synonym, always distinct.
    data = get(state="Gujarat")
    names = {r["transport_name"] for r in data["results"]}
    assert {"Kishan", "Kishan Travels"} <= names
    kishan_travels = [r for r in data["results"] if r["transport_name"] == "Kishan Travels"]
    assert len(kishan_travels) == 1
    assert kishan_travels[0]["pincode"] == "360002"  # its own pincode only, not merged with "Kishan"'s


def test_known_synonym_variant_merges_via_audit(cross_city_csv):
    # "Kishna" is a known spelling variant of "Kishan" per the approved India-wide audit -- they
    # merge into one "Kishan" row, combining both pincodes, same as any other known variant.
    data = get(state="Gujarat")
    kishan_rows = [r for r in data["results"] if r["transport_name"] == "Kishan"]
    assert len(kishan_rows) == 1
    assert kishan_rows[0]["pincode"] == "360001, 360003"
    assert "Kishna" not in {r["transport_name"] for r in data["results"]}


def test_list_endpoint_shows_each_transport_name_once(cross_city_csv):
    listed = client.get("/api/transport/list").json()
    assert listed.count("Aakash Roadways") == 1
    assert {"Kishan", "Kishan Travels"} <= set(listed)
    assert "Kishna" not in listed  # merged into "Kishan"


def test_city_search_still_only_returns_that_citys_pincodes(cross_city_csv):
    # A city-scoped search must not pull in the same transporter's pincodes from other cities.
    data = get(city="Rajkot", state="Gujarat")
    aakash = next(r for r in data["results"] if r["transport_name"] == "Aakash Roadways")
    assert aakash["pincode"] == "394107"


@pytest.fixture()
def wrong_state_csv(tmp_path, monkeypatch):
    """Reproduces a live-data bug: a Gujarat-only transporter has one order where the buyer typed a
    real Gujarat city/pincode (Ahmedabad, 380009) but the billing state field says "Goa" -- a
    data-entry mistake, not a code bug in how city/state/pincode are joined (they come from the
    same CSV row). One bad row must not put this transporter into a Goa search."""
    rows = [
        _row(OrderNo="#1", CustomerBillingCity="Ahmedabad", CustomerBillingState="Goa",
             CustomerBillingPinCode="380009", ShipmentCourier="PAVAN PARCEL SERVICE"),
        _row(OrderNo="#2", CustomerBillingCity="Rajkot", CustomerBillingState="Gujarat",
             CustomerBillingPinCode="360001", ShipmentCourier="PAVAN PARCEL SERVICE"),
    ]
    path = tmp_path / "wrong_state.csv"
    write_csv(path, rows)
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    import app.services.excel_search as es
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))
    return path


def test_wrong_state_selection_does_not_put_a_gujarat_transporter_in_a_goa_search(wrong_state_csv):
    data = get(state="Goa")
    assert data["results"] == []


def test_wrong_state_selection_row_is_still_found_by_pincode_and_city(wrong_state_csv):
    assert "Pavan Parcel Service" in {r["transport_name"] for r in get(pincode="380009")["results"]}
    assert "Pavan Parcel Service" in {r["transport_name"] for r in get(city="Ahmedabad")["results"]}
    assert get(city="Ahmedabad", state="Goa")["results"] == []


def test_wrong_state_selection_does_not_affect_the_transporters_real_gujarat_rows(wrong_state_csv):
    data = get(state="Gujarat")
    row = next(r for r in data["results"] if r["transport_name"] == "Pavan Parcel Service")
    assert row["pincode"] == "360001"
    assert set(row["service_cities"]) == {"Ahmedabad", "Rajkot"}  # the city itself is real, kept


def test_excluded_courier_values_never_appear(csv_file):
    data = get(pincode="360003")
    for bad in ("Self Pickup", "Driver", "Cod", "Customer Label", ""):
        assert bad not in names(data)
    assert "" not in names(get(city="Rajkot"))


def test_city_state_and_state_search(csv_file):
    assert names(get(city="Bhavnagar", state="Gujarat")) == {"Kishan Travels"}
    assert names(get(state="Gujarat")) == {"TCI Express", "VRL Logistics", "Kishan Travels", "Aakash Roadways"}


def test_row_with_blank_pincode_is_found_by_city(csv_file):
    data = get(city="Surat")
    assert names(data) == {"Aakash Roadways"}
    assert data["results"][0]["pincode"] is None


def test_invalid_pincode_query_rejected(csv_file):
    data = get(pincode="12")
    assert data["results"] == [] and "6 digits" in data["message"]


def test_no_result(csv_file):
    data = get(pincode="999999")
    assert data["results"] == [] and data["message"]


# ---------- privacy: only the 4 mapped columns are ever used ----------

def test_no_customer_or_order_data_in_response(csv_file):
    body = client.get("/api/transport/search", params={"pincode": "360003"}).text
    for leak in ("Secret", "Customer", "1234.56", "#135-00000001", "12 Secret Street", "Shopify", "Dispatched"):
        assert leak not in body


def test_response_row_shape(csv_file):
    row = get(pincode="360003")["results"][0]
    assert set(row) == {
        "transport_name", "branch_name", "location", "city", "state", "pincode", "serviceability",
        "documents_required", "surface_delivery", "air_delivery", "rail_delivery", "branch_type",
        "godown_name", "contact_number", "alternate_contact", "address", "source_url", "last_updated",
        "status", "override_id", "service_cities", "photo_url", "photo_source", "shipment_charge",
    }


# ---------- Active only in search + Mobile No still apply on this source ----------

def test_not_active_transporter_is_excluded_from_search_on_this_source(csv_file, tmp_path, monkeypatch):
    status_csv = tmp_path / "status2.csv"
    status_csv.write_text("transport_name,status\nTCI Express,Not Active\n", encoding="utf-8")
    monkeypatch.setattr(settings, "transport_status_csv", str(status_csv))
    data = get(pincode="360003")
    statuses = {r["transport_name"]: r["status"] for r in data["results"]}
    assert "TCI Express" not in statuses
    assert statuses["VRL Logistics"] == "Active"


def test_vrl_mobile_lookup_still_applies(csv_file, tmp_path, monkeypatch):
    branches = tmp_path / "branches2.csv"
    branches.write_text(
        "Branch Name,Branch Code,Branch ID,Address,State,Phone,Email,Booking,Delivery\n"
        'RAJKOT,RJT,1,"GIDC RAJKOT-360003",Gujarat,9377011111,a@vrllogistics.com,Yes,Yes\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "branches_csv", str(branches))
    row = next(r for r in get(pincode="360003")["results"] if r["transport_name"] == "VRL Logistics")
    assert row["contact_number"] == "9377011111"
    tci = next(r for r in get(pincode="360003")["results"] if r["transport_name"] == "TCI Express")
    assert tci["contact_number"] is None  # not VRL: never given a number


# ---------- reporting stats used for the manual report ----------

def test_build_entries_stats(csv_file):
    entries, stats = vc.build_entries(str(csv_file))
    assert stats.total_rows == 10
    assert stats.invalid_rows == 5  # #5 SELF PICKUP, #6 DRIVER:, #7 blank, #8 COD, #9 CUSTOMER LABEL
    assert stats.valid_rows == 5  # #1, #2, #3, #4, #10
    assert stats.unique_records == 4  # #1 and #2 collapse into one TCI Express/Rajkot/360003 record
    assert len(entries) == stats.unique_records
    assert stats.duplicate_rows_removed == 1


def test_missing_csv_gives_503(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(tmp_path / "missing.csv"))
    import app.services.vacalvers_source as vcmod
    monkeypatch.setattr(vcmod, "_index", None)
    r = client.get("/api/transport/search", params={"pincode": "360003"})
    assert r.status_code == 503
