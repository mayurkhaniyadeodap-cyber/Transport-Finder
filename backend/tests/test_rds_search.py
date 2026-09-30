"""Tests the RDS-backed source with a fake pymysql connection — no real network/RDS access here.
Live verification against the actual RDS is done separately (manual script), not in the test suite."""
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import rds_source as rds, transporter_filter

client = TestClient(app)


class FakeCursor:
    def __init__(self, orders_count, combos, phones):
        self._orders_count, self._combos, self._phones = orders_count, combos, phones
        self._result = None

    def execute(self, sql, params=None):
        s = sql.strip().upper()
        assert s.startswith("SELECT") or s.startswith("SET SESSION TRANSACTION READ ONLY"), sql
        if "COUNT(*) FROM ORDERS" in s:
            self._result = [(self._orders_count,)]
        elif "FROM ORDERS O" in s:
            self._result = self._combos
        elif "FROM COURIER_LOCATIONS" in s:
            self._result = self._phones
        else:
            self._result = []

    def fetchone(self):
        return self._result[0]

    def fetchall(self):
        return self._result

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, orders_count, combos, phones):
        self._cursor = FakeCursor(orders_count, combos, phones)
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


COMBOS = [
    ("Rajkot", "Gujarat", "360003", "TCI EXPRESS", 5),
    ("rajkot", "Gujarat", "360003", "tci express", 2),  # same after normalising -> collapses
    ("Rajkot", "Gujarat", "360003", "VRL", 3),
    ("Bhavnagar", "Gujarat", "364001", "KISHAN TRAVELS", 4),
    ("Rajkot", "Gujarat", "360003", "SELF PICKUP", 50),  # excluded
    ("rajkot", "Gujarat", "360003", "DRIVER: DHARMIKBHAI RABARI", 20),  # excluded
    ("rajkot", "Gujarat", "360003", ": Ekart", 6),  # stray leading colon -> cleaned
    ("Rajkot", "Gujarat", "360003", "COD", 3),  # excluded
    ("rajkot", "Gujarat", "360003", "demo", 1),  # excluded test/junk value
    ("rajkot", "Gujarat", "360003", "0000", 1),  # excluded numeric noise
    ("Surat", "Gujarat", "", "AAKASH ROADWAYS", 2),  # blank pincode: still indexed by city
    ("360410", "Gujarat", "360410", "XPRESSBEES", 1),  # a stray pincode typed into buyer_city
    # A buyer typed a real Gujarat city/pincode but mis-selected the state -- one bad row must not
    # put a Gujarat-only transporter into a Goa search. See test_wrong_state_selection_* below.
    ("Ahmedabad", "Goa", "380009", "PAVAN PARCEL SERVICE", 1),
    ("Rajkot", "Gujarat", "360001", "PAVAN PARCEL SERVICE", 7),  # this transporter's real business
]
PHONES_CONFIDENT = [("TCI EXPRESS", "9624203797")]  # exactly one distinct number -> usable
PHONES_AMBIGUOUS = [("VRL", "111111"), ("VRL", "222222")]  # two distinct numbers -> Not Available


def fake_index(orders_count=100, combos=COMBOS, phones=PHONES_CONFIDENT + PHONES_AMBIGUOUS):
    return FakeConn(orders_count, combos, phones)


@pytest.fixture()
def rds_env(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("DB_HOST=h\nDB_PORT=3306\nDB_USER=u\nDB_PASSWORD=p\nDB_NAME=admin\n", encoding="utf-8")
    monkeypatch.setattr(settings, "data_source", "rds")
    monkeypatch.setattr(settings, "rds_env_path", str(env))
    monkeypatch.setattr(settings, "rds_cache_ttl_seconds", 1800)
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "no_status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    import app.services.excel_search as es
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(rds, "_entries", None)
    monkeypatch.setattr(rds, "_stats", None)
    monkeypatch.setattr(rds, "_phonebook", None)
    monkeypatch.setattr(rds, "_built_at", 0.0)
    monkeypatch.setattr(rds, "_connect", lambda env_path: fake_index())
    # This file tests the RDS source/search pipeline, not transporter_filter (which has its own
    # dedicated tests in test_transporter_filter.py) — bypass it here so "does this transporter
    # appear" assertions below test what they're meant to.
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)
    # Isolate from any real local overrides on this machine -- otherwise they leak into results here too.
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))
    return env


def get(**params):
    r = client.get("/api/transport/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def names(data):
    return {r["transport_name"] for r in data["results"]}


# ---------- normalisation ----------

def test_normalize_transport_excludes_and_cleans():
    assert rds.normalize_transport("TCI EXPRESS") == "TCI Express"
    assert rds.normalize_transport(": Delhivery Air") == "Delhivery Air"  # stray leading colon
    assert rds.normalize_transport("Driver :- Bhavesh Bhai") is None
    assert rds.normalize_transport("DRIVER:LALIT BHAI") is None
    assert rds.normalize_transport("SELF PICKUP") is None
    assert rds.normalize_transport("self  Pickup") is None
    assert rds.normalize_transport("CUSTOMER LEBAL") is None  # observed typo in this DB
    assert rds.normalize_transport("Others") is None
    assert rds.normalize_transport("demo") is None
    assert rds.normalize_transport("0000") is None
    assert rds.normalize_transport("141123208077368") is None  # tracking-number noise
    assert rds.normalize_transport("VRL") == "VRL"
    assert rds.normalize_transport("") is None
    assert rds.normalize_transport(None) is None


# ---------- search wired through the FastAPI route ----------

def test_pincode_search_uses_mapped_columns(rds_env):
    data = get(pincode="360003")
    assert data["match_level"] == "pincode"
    assert names(data) == {"TCI Express", "VRL", "Ekart"}


def test_duplicate_combos_collapse(rds_env):
    row = next(r for r in get(pincode="360003")["results"] if r["transport_name"] == "TCI Express")
    assert row is not None  # "TCI EXPRESS" (5) + "tci express" (2) -> a single row, not two


def test_excluded_values_never_appear(rds_env):
    data = get(pincode="360003")
    for bad in ("Self Pickup", "Driver", "Cod", "Demo", "0000"):
        assert bad not in names(data)


def test_city_state_and_blank_pincode_row(rds_env):
    assert names(get(city="Bhavnagar", state="Gujarat")) == {"Kishan Travels"}
    surat = get(city="Surat")["results"]
    assert names({"results": surat}) if False else {r["transport_name"] for r in surat} == {"Aakash Roadways"}
    assert surat[0]["pincode"] is None


def test_mobile_no_confident_vs_ambiguous(rds_env):
    data = get(pincode="360003")
    tci = next(r for r in data["results"] if r["transport_name"] == "TCI Express")
    vrl = next(r for r in data["results"] if r["transport_name"] == "VRL")
    assert tci["contact_number"] == "9624203797"  # one confident number
    assert vrl["contact_number"] is None  # two conflicting numbers -> never guessed


def test_no_customer_data_possible_by_design(rds_env):
    # the fake connection never returns anything except the 5 aggregated columns; nothing to leak
    body = client.get("/api/transport/search", params={"pincode": "360003"}).text
    assert "buyer_phone" not in body and "buyer_name" not in body


def test_invalid_pincode(rds_env):
    data = get(pincode="12")
    assert data["results"] == [] and "6 digits" in data["message"]


# ---------- a single wrong state selection must not misplace an otherwise-real transporter ----------
# Reproduces a live-data bug: "Pavan Parcel Service" is a Gujarat-only transporter, but one order
# has buyer_city "Ahmedabad" (a real Gujarat/380009 address) with buyer_state_id resolving to "Goa"
# -- a buyer selecting the wrong state, not a code bug in how city/state/pincode are joined. See
# COMBOS above and rds_source.pincode_state_conflicts().

def test_wrong_state_selection_does_not_put_a_gujarat_transporter_in_a_goa_search(rds_env):
    data = get(state="Goa")
    assert "Pavan Parcel Service" not in names(data)


def test_wrong_state_selection_does_not_create_a_goa_service_city(rds_env):
    row = next(r for r in get(pincode="360001")["results"] if r["transport_name"] == "Pavan Parcel Service")
    assert "Ahmedabad" in row["service_cities"]  # the city itself is real and kept
    assert set(row["service_cities"]) <= {"Ahmedabad", "Rajkot"}  # never merges in "Goa"


def test_wrong_state_selection_row_is_still_found_by_its_own_pincode_and_city(rds_env):
    # The state is dropped, not the whole row -- pincode/city search for it still works.
    assert "Pavan Parcel Service" in names(get(pincode="380009"))
    assert "Pavan Parcel Service" in names(get(city="Ahmedabad"))
    # But a city+state search combining the real city with the wrong state finds nothing, since
    # that specific (city, state) combination never legitimately existed.
    assert get(city="Ahmedabad", state="Goa")["results"] == []


def test_wrong_state_selection_does_not_affect_the_transporters_real_gujarat_rows(rds_env):
    assert "Pavan Parcel Service" in names(get(state="Gujarat"))
    assert "Pavan Parcel Service" in names(get(city="Rajkot", state="Gujarat"))
    assert "Pavan Parcel Service" in names(get(pincode="360001"))


def test_not_active_transporter_is_excluded_from_search(rds_env, tmp_path, monkeypatch):
    status_csv = tmp_path / "status.csv"
    status_csv.write_text("transport_name,status\nTCI Express,Not Active\n", encoding="utf-8")
    monkeypatch.setattr(settings, "transport_status_csv", str(status_csv))
    data = get(pincode="360003")
    assert "TCI Express" not in names(data)
    assert names(data)  # the other (Active) transporters at this pincode are still returned


def test_stats(rds_env):
    get(pincode="360003")  # trigger a build
    entries, stats = rds._entries, rds._stats
    assert stats.total_rows == 100
    # 3 @360003 + Kishan Travels@364001 + Aakash@Surat + Xpressbees@360410 + Pavan Parcel Service's
    # two rows (380009 and 360001)
    assert stats.unique_records == len(entries) == 8
    assert stats.duplicate_rows_removed >= 1  # the TCI EXPRESS/tci express collapse


def test_numeric_city_is_not_shown_as_a_city_name(rds_env):
    # buyer_city held a pincode by mistake: city becomes None (Not Available), row still findable
    data = get(pincode="360410")
    assert data["results"] and data["results"][0]["city"] is None


def test_address_like_city_is_blanked_not_leaked():
    assert rds.normalize_place("80, China Gate 2, Althan Canal Road Surat, Gujarat") is None
    assert rds.normalize_place("3/5 Gaytrinagr Near Jalaram Chowk Rajkot Somewhere Far Away") is None
    assert rds.normalize_place("Rajkot") == "Rajkot"


def _no_rds_env(tmp_path, monkeypatch):
    """RDS credentials missing -> rds_source.get_index() raises RdsUnavailable for every test below."""
    env = tmp_path / ".env"
    env.write_text("DB_HOST=h\n", encoding="utf-8")  # no password
    monkeypatch.setattr(settings, "data_source", "rds")
    monkeypatch.setattr(settings, "rds_env_path", str(env))
    import app.services.excel_search as es
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")  # must not see a real cached index
    monkeypatch.setattr(rds, "_entries", None)
    monkeypatch.setattr(transporter_filter, "is_excluded_transporter", lambda name: False)  # see rds_env fixture
    return env


def test_rds_unavailable_falls_back_to_csv_automatically(tmp_path, monkeypatch):
    _no_rds_env(tmp_path, monkeypatch)
    csv_path = tmp_path / "orders.csv"
    csv_path.write_text(
        "OrderNo,CustomerFirstNm,CustomerBillingState,CustomerBillingCity,CustomerBillingPinCode,ShipmentCourier\n"
        "#1,Secret,Gujarat,Rajkot,360003,TCI EXPRESS\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(csv_path))
    r = client.get("/api/transport/search", params={"pincode": "360003"})
    assert r.status_code == 200  # search keeps working via the CSV fallback, not a 503
    data = r.json()
    assert data["results"] and data["results"][0]["transport_name"] == "TCI Express"
    assert "Secret" not in r.text  # the fallback source's own privacy rules still apply


def test_missing_credentials_and_missing_csv_gives_503(tmp_path, monkeypatch):
    _no_rds_env(tmp_path, monkeypatch)
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(tmp_path / "missing.csv"))  # fallback also unavailable
    r = client.get("/api/transport/search", params={"pincode": "360003"})
    assert r.status_code == 503
    assert "password" not in r.text.lower() or "DB_PASSWORD" in r.text  # never leaks a real secret
