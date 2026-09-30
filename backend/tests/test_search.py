import os

os.environ["DATABASE_URL"] = "sqlite://"  # must be set before app imports

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings

settings.data_source = "db"  # these tests cover the database search; Excel has its own tests

from app.database import Base, get_db
from app.main import app
from app.models import TransportBranch, TransportPincode

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(bind=engine, expire_on_commit=False)


def override_db():
    with Session() as db:
        yield db


app.dependency_overrides[get_db] = override_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def seed():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session() as db:
        db.add_all([
            TransportPincode(transport_name="TCI Express", pincode="110001", branch_name="XPHJ-PAHARGANJ",
                             city="New Delhi", location="New Delhi", state="Delhi", pincode_type="SERVICEABLE",
                             documents_required="Copies of Invoice, E-Way Bill",
                             surface_delivery=True, air_delivery=True, rail_delivery=True),
            TransportPincode(transport_name="TCI Express", pincode="400001", branch_name="MUM", city="Mumbai",
                             state="Maharashtra", pincode_type="SERVICEABLE"),
            TransportBranch(transport_name="TCI Express", branch_name="XPHJ-PAHARGANJ", pincode="110001",
                            godown_name="Paharganj Godown", contact_number="123", address="Some address",
                            city="New Delhi", state="Delhi"),
            TransportBranch(transport_name="VRL Logistics", branch_name="New Delhi", pincode="110001",
                            city="New Delhi", state="Delhi"),  # branch only: no contact/address/serviceability
        ])
        db.commit()


def get(**params):
    r = client.get("/api/transport/search", params=params)
    assert r.status_code == 200
    return r.json()


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_valid_pincode_merges_branch_data():
    data = get(pincode="110001")
    assert data["match_level"] == "pincode"
    tci = next(r for r in data["results"] if r["transport_name"] == "TCI Express")
    assert tci["serviceability"] == "SERVICEABLE"
    assert tci["surface_delivery"] is True
    assert tci["godown_name"] == "Paharganj Godown"


def test_multiple_transporters_and_no_fabrication():
    data = get(pincode="110001")
    assert {r["transport_name"] for r in data["results"]} == {"TCI Express", "VRL Logistics"}
    vrl = next(r for r in data["results"] if r["transport_name"] == "VRL Logistics")
    # branch exists != serviceable: unknown stays None
    assert vrl["serviceability"] is None
    assert vrl["surface_delivery"] is None
    assert vrl["contact_number"] is None and vrl["address"] is None


def test_invalid_pincode():
    data = get(pincode="12ab")
    assert data["results"] == [] and "6 digits" in data["message"]
    

def test_no_result():
    data = get(pincode="999999")
    assert data["results"] == [] and data["message"]


def test_city_state_search_is_case_and_underscore_insensitive():
    data = get(city="NEW_DELHI", state="delhi")
    assert data["match_level"] == "city_state" and data["results"]


def test_state_fallback_when_city_unknown():
    data = get(city="Nowhere", state="Maharashtra")
    assert data["match_level"] == "state"
    assert data["results"][0]["city"] == "Mumbai"


def test_pincode_falls_back_to_city_state():
    data = get(pincode="999999", city="Mumbai", state="Maharashtra")
    assert data["match_level"] == "city_state"


def test_empty_search():
    assert get()["results"] == []


def test_list():
    assert client.get("/api/transport/list").json() == ["TCI Express", "VRL Logistics"]
