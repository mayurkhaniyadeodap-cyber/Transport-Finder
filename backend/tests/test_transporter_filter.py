"""Tests the transporter allowlist: only names present in the `courier_name` column of
data/transporters.xlsx are shown, applied consistently across pincode/city/state search and
/list, without touching the source data, using the vacalvers_csv fixture (fast, file-based, no
network)."""
import csv

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import transporter_filter as tf

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


def write_allowlist_xlsx(path, *names, other_columns=True):
    """A minimal stand-in for transporters.xlsx: a `courier_name` column, plus (by default) the
    other real columns present in the actual file, to check they're ignored for filtering."""
    wb = openpyxl.Workbook()
    ws = wb.active
    if other_columns:
        ws.append(["courier_name", "order_count", "normalized_key", "variation_group_size", "variation_group_total_orders"])
        for n in names:
            ws.append([n, 1, n.lower(), 1, 1])
    else:
        ws.append(["courier_name"])
        for n in names:
            ws.append([n])
    wb.save(path)


@pytest.fixture()
def csv_file(tmp_path, monkeypatch):
    path = tmp_path / "orders.csv"
    write_csv(path, [
        _row("TCI EXPRESS", order="#1"),        # in the (fake) allowlist
        _row("VRL LOGISTICS", order="#2"),       # in the (fake) allowlist
        _row("KISHAN TRAVELS", order="#3"),      # in the (fake) allowlist
        _row("BLUEDART", order="#4"),            # NOT in the (fake) allowlist -> hidden
        _row("DTDC COURIER", order="#5"),        # NOT in the (fake) allowlist -> hidden
        _row("SOME UNLISTED COURIER", order="#6"),  # a real-looking name that isn't in the Excel -> hidden
    ])
    allowlist = tmp_path / "allowlist.xlsx"
    write_allowlist_xlsx(allowlist, "TCI EXPRESS", "VRL LOGISTICS", "KISHAN TRAVELS")
    monkeypatch.setattr(tf, "ALLOWLIST_XLSX_PATH", allowlist)
    monkeypatch.setattr(tf, "ALLOWED_TRANSPORTERS", tf._load_allowed_names(allowlist))
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    # Isolate from any real local overrides on this machine (e.g. a "new transporter" override
    # added through the real app) -- otherwise it leaks into /list and /search here too.
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))
    import app.services.excel_search as es
    import app.services.vacalvers_source as vc
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    return path


def get(**params):
    r = client.get("/api/transport/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def names(data):
    return {r["transport_name"] for r in data["results"]}


# ---------- unit: the real, current allowlist file (data/transporters.xlsx) ----------

def test_real_allowlist_file_is_used_by_default():
    assert tf.ALLOWLIST_XLSX_PATH == tf.ALLOWLIST_XLSX_PATH.__class__(
        r"C:\wherehous_tool\Transport Finder\data\transporters.xlsx"
    )


def test_allowlist_has_388_names_from_the_excel():
    allowed = tf._load_allowed_names(tf.ALLOWLIST_XLSX_PATH)
    assert len(allowed) > 0
    assert len(allowed) <= 388  # at most one entry per raw name; some may collapse by display form


@pytest.mark.parametrize("name", ["TCI Express", "Kishan Travels", "Aakash Roadways", "VRL Logistics", "Lalji Mulji"])
def test_real_allowlist_contains_known_transporters(name):
    allowed = tf._load_allowed_names(tf.ALLOWLIST_XLSX_PATH)
    assert name in allowed, name


def test_only_the_courier_name_column_is_read(tmp_path):
    # order_count/normalized_key/etc. are never treated as transporter names, even though they're
    # present in the real file's other columns.
    path = tmp_path / "allowlist.xlsx"
    write_allowlist_xlsx(path, "TCI EXPRESS", "VRL LOGISTICS")
    allowed = tf._load_allowed_names(path)
    assert allowed == {"TCI Express", "VRL Logistics"}
    assert "1" not in allowed and "tciexpress" not in allowed


def test_display_form_matches_what_each_source_already_shows():
    # raw allowlist text -> the exact string Transport Finder displays (title-case, acronym fix,
    # stray-punctuation stripped) -- not a rename, just reproducing the existing convention
    assert tf._display_form("TCI EXPRESS") == "TCI Express"
    assert tf._display_form("aakash roadways") == "Aakash Roadways"
    assert tf._display_form(": Delhivery Air") == "Delhivery Air"
    assert tf._display_form("PATEL TRANSPORT CO.") == "Patel Transport Co"
    assert tf._display_form("") == ""
    assert tf._display_form(None) == ""


def test_is_excluded_transporter_true_for_names_not_in_the_allowlist(tmp_path, monkeypatch):
    allowlist = tmp_path / "small_allowlist.xlsx"
    write_allowlist_xlsx(allowlist, "TCI EXPRESS")
    monkeypatch.setattr(tf, "ALLOWED_TRANSPORTERS", tf._load_allowed_names(allowlist))
    assert tf.is_excluded_transporter("TCI Express") is False   # in the allowlist
    assert tf.is_excluded_transporter("Bluedart") is True        # a real transporter, just not in this Excel
    assert tf.is_excluded_transporter("A Brand New Courier") is True
    assert tf.is_excluded_transporter("") is True
    assert tf.is_excluded_transporter(None) is True


def test_missing_allowlist_file_hides_everything_rather_than_guessing(tmp_path):
    allowed = tf._load_allowed_names(tmp_path / "does_not_exist.xlsx")
    assert allowed == frozenset()


def test_allowlist_without_courier_name_column_hides_everything(tmp_path):
    path = tmp_path / "wrong_columns.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["name", "count"])
    ws.append(["TCI EXPRESS", 5])
    wb.save(path)
    assert tf._load_allowed_names(path) == frozenset()


# ---------- applied consistently across pincode / city / state / list ----------

def test_allowed_transporters_appear_in_pincode_search(csv_file):
    n = names(get(pincode="360003"))
    assert n == {"TCI Express", "VRL Logistics", "Kishan Travels"}


def test_pincode_search_is_not_empty(csv_file):
    data = get(pincode="360003")
    assert data["results"] != []
    assert data["total"] > 0


def test_names_not_in_excel_do_not_appear_in_pincode_search(csv_file):
    n = names(get(pincode="360003"))
    assert "Bluedart" not in n
    assert "DTDC Courier" not in n
    assert "Some Unlisted Courier" not in n


def test_allowed_transporters_appear_in_city_search(csv_file):
    assert "TCI Express" in names(get(city="Rajkot"))
    assert "Bluedart" not in names(get(city="Rajkot"))


def test_allowed_transporters_appear_in_state_search(csv_file):
    n = names(get(state="Gujarat"))
    assert {"TCI Express", "VRL Logistics", "Kishan Travels"} <= n
    assert "Bluedart" not in n and "DTDC Courier" not in n


def test_list_endpoint_only_shows_allowed_transporters(csv_file):
    listed = client.get("/api/transport/list").json()
    assert set(listed) == {"TCI Express", "VRL Logistics", "Kishan Travels"}


def test_result_columns_are_unchanged(csv_file):
    row = get(pincode="360003")["results"][0]
    assert {"city", "transport_name", "contact_number", "pincode", "status"} <= set(row)


def test_filtering_does_not_write_to_the_source_file(csv_file):
    before = csv_file.read_text(encoding="utf-8")
    get(pincode="360003")
    get(city="Rajkot")
    get(state="Gujarat")
    client.get("/api/transport/list")
    after = csv_file.read_text(encoding="utf-8")
    assert before == after  # the app never rewrites the source, only filters its own response


# ---------- name-variation matching (case, spacing, punctuation) ----------

def test_case_and_spacing_variations_still_match(tmp_path, monkeypatch):
    path = tmp_path / "orders.csv"
    write_csv(path, [
        _row("tci  express", order="#1"),   # lowercase, double space
        _row("TCI EXPRESS", order="#2"),    # uppercase
        _row("Tci Express", order="#3"),    # already title case
    ])
    allowlist = tmp_path / "allowlist.xlsx"
    write_allowlist_xlsx(allowlist, "TCI EXPRESS")
    monkeypatch.setattr(tf, "ALLOWLIST_XLSX_PATH", allowlist)
    monkeypatch.setattr(tf, "ALLOWED_TRANSPORTERS", tf._load_allowed_names(allowlist))
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
    # all three variants normalise to the same display name and to the same allowlist entry
    assert names(get(pincode="360003")) == {"TCI Express"}
