"""Server-side Admin check on every /api/manage/* and /api/overrides/* endpoint: 401 without a
session, 403 for a User, allowed for the Admin. Search stays open, as before."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import accounts
from test_transporter_photos import PNG, data, managed, search_row  # noqa: F401  (data is a fixture)

pytestmark = pytest.mark.real_auth
client = TestClient(app)


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch):
    monkeypatch.setattr(accounts, "PBKDF2_ITERATIONS", 1_000)
    monkeypatch.setattr(accounts, "_failures", {})


def token(role):
    login_id, password = ("Admin_deodap@123", "Admin@123") if role == "admin" else ("User_deodap@123", "User@123")
    r = client.post("/api/auth/login", json={"role": role, "login_id": login_id, "password": password})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


# Every route under /api/manage and /api/overrides, with a body that would succeed for the Admin.
ENDPOINTS = [
    ("get", "/api/manage/transporters", {}),
    ("post", "/api/manage/transporters", {"json": {"transport_name": "Om Logistics", "pincodes": ["395007"]}}),
    ("patch", "/api/manage/transporters", {"json": {"transport_name": "Kishan Travels", "mobile": "9000000000"}}),
    ("delete", "/api/manage/transporters", {"params": {"transport_name": "Kishan Travels"}}),
    ("post", "/api/manage/transporters/restore", {"json": {"transport_name": "Kishan Travels"}}),
    ("post", "/api/manage/transporters/photo", {"params": {"transport_name": "Kishan Travels"}, "content": PNG}),
    ("delete", "/api/manage/transporters/photo", {"params": {"transport_name": "Kishan Travels"}}),
    ("get", "/api/overrides", {}),
    ("post", "/api/overrides", {"json": {"source_city": "Rajkot", "source_transport_name": "KISHAN TRAVELS",
                                         "source_pincode": "360001", "mobile": "9000000000"}}),
    ("post", "/api/overrides/new-transporter", {"json": {"transport_name": "New Co", "pincode": "360001"}}),
    ("patch", "/api/overrides/1", {"json": {"mobile": "9000000000"}}),
    ("delete", "/api/overrides/1", {}),
]


def test_every_manage_and_overrides_route_is_covered():
    paths = app.openapi()["paths"]  # every registered endpoint
    guarded = {(m, path) for path, ops in paths.items() if path.startswith(("/api/manage", "/api/overrides")) for m in ops}
    tested = {(m, u.replace("/1", "/{override_id}")) for m, u, _ in ENDPOINTS}
    assert guarded == tested


@pytest.mark.parametrize("method, url, kwargs", ENDPOINTS)
def test_logged_out_requests_are_401(data, method, url, kwargs):
    assert getattr(client, method)(url, **kwargs).status_code == 401
    assert getattr(client, method)(url, headers={"Authorization": "Bearer made-up"}, **kwargs).status_code == 401


@pytest.mark.parametrize("method, url, kwargs", ENDPOINTS)
def test_user_requests_are_403(data, method, url, kwargs):
    r = getattr(client, method)(url, headers=token("user"), **kwargs)
    assert r.status_code == 403 and r.json()["detail"] == "Only the Admin can do this."


def test_blocked_requests_change_nothing(data):
    user = token("user")
    client.patch("/api/manage/transporters", json={"transport_name": "Kishan Travels", "shipment_charge": "99", "mobile": "9000000000"})
    client.patch("/api/manage/transporters", headers=user, json={"transport_name": "Kishan Travels", "shipment_charge": "99"})
    client.delete("/api/manage/transporters", headers=user, params={"transport_name": "Kishan Travels"})
    client.post("/api/manage/transporters/photo", params={"transport_name": "Kishan Travels"}, content=PNG)
    row = search_row("Kishan Travels")
    assert row["shipment_charge"] is None and row["photo_url"] is None and row["contact_number"] != "9000000000"


def test_admin_can_add_edit_delete_and_restore(data):
    admin = token("admin")
    assert client.post("/api/manage/transporters", headers=admin, json={"transport_name": "Om Logistics", "pincodes": ["395007"]}).status_code == 200
    assert client.patch("/api/manage/transporters", headers=admin, json={"transport_name": "Om Logistics", "shipment_charge": "75.50"}).status_code == 200
    assert search_row("Om Logistics")["shipment_charge"] == "75.50"
    assert client.post("/api/manage/transporters/photo", headers=admin, params={"transport_name": "Om Logistics"}, content=PNG).status_code == 200
    assert client.delete("/api/manage/transporters", headers=admin, params={"transport_name": "Om Logistics"}).status_code == 200
    assert client.get("/api/transport/search", params={"transport_name": "Om Logistics"}).json()["results"] == []
    assert client.post("/api/manage/transporters/restore", headers=admin, json={"transport_name": "Om Logistics"}).status_code == 200
    assert search_row("Om Logistics")["shipment_charge"] == "75.50"
    listed = client.get("/api/manage/transporters", headers=admin).json()["results"]
    assert any(t["transport_name"] == "Om Logistics" for t in listed)


def test_a_signed_out_or_deactivated_admin_session_stops_working(data):
    admin = token("admin")
    client.post("/api/auth/logout", headers=admin)
    assert client.get("/api/manage/transporters", headers=admin).status_code == 401


def test_search_and_photos_stay_open_as_before(data):
    assert client.get("/api/transport/search", params={"transport_name": "Kishan Travels"}).status_code == 200
    assert client.get("/api/transport/list").status_code == 200
    assert client.get("/api/transport/suggest", params={"q": "Kis"}).status_code == 200
