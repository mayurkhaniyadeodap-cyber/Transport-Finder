"""Activity Log: sign-ins, app-reported events (panel open, search, profile view) and Admin changes
are stored in the local SQLite file with who/what/when; the Admin sees everyone's entries, a User
only their own, and nobody can read it without a session."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import accounts
from test_transporter_photos import data  # noqa: F401  (a fixture: a small real data source)

pytestmark = pytest.mark.real_auth
client = TestClient(app)

ADMIN = ("Admin_deodap@123", "Admin@123")
USER = ("User_deodap@123", "User@123")


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch):
    monkeypatch.setattr(accounts, "PBKDF2_ITERATIONS", 1_000)
    monkeypatch.setattr(accounts, "_failures", {})


def sign_in(role):
    login_id, password = ADMIN if role == "admin" else USER
    r = client.post("/api/auth/login", json={"role": role, "login_id": login_id, "password": password})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def log(headers, **params):
    r = client.get("/api/activity", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def events(headers, **params):
    return [(e["login_id"], e["event"], e["detail"]) for e in log(headers, **params)["results"]]


def test_reading_the_log_needs_a_session():
    assert client.get("/api/activity").status_code == 401
    assert client.post("/api/activity", json={"type": "search", "detail": "360001"}).status_code == 401


def test_sign_in_and_reported_events_are_stored_with_who_and_when():
    admin = sign_in("admin")
    for body in ({"type": "panel_open"}, {"type": "search", "detail": "Searched for 360001 · 3 results"},
                 {"type": "profile_view", "detail": "TCI Express"}):
        assert client.post("/api/activity", headers=admin, json=body).status_code == 201

    data = log(admin)
    newest_first = [(e["event"], e["kind"]) for e in data["results"]]
    assert newest_first == [
        ("Transporter profile viewed", "profile"), ("Search performed", "search"),
        ("Panel opened", "session"), ("Signed in", "session"),
    ]
    first = data["results"][0]
    assert first["login_id"] == ADMIN[0] and first["role"] == "admin"
    assert first["detail"] == "TCI Express"
    assert first["created_at"].endswith("+00:00")  # stored in UTC, with its date and time
    assert data["total"] == 4
    assert data["today"] == {"events": 4, "panel_opens": 1, "searches": 1}


def test_the_app_cannot_report_admin_changes():
    admin = sign_in("admin")
    r = client.post("/api/activity", headers=admin, json={"type": "admin", "detail": "Transporter deleted"})
    assert r.status_code == 422


def test_a_user_sees_only_their_own_activity_and_the_admin_sees_everyone():
    admin, user = sign_in("admin"), sign_in("user")
    client.post("/api/activity", headers=user, json={"type": "search", "detail": "user search"})
    client.post("/api/activity", headers=admin, json={"type": "search", "detail": "admin search"})

    assert {who for who, *_ in events(user)} == {USER[0]}
    assert ("User_deodap@123", "Search performed", "user search") in events(user)
    assert {who for who, *_ in events(admin)} == {ADMIN[0], USER[0]}


def test_failed_sign_in_is_recorded_without_the_password():
    client.post("/api/auth/login", json={"role": "admin", "login_id": ADMIN[0], "password": "wrong-password"})
    admin = sign_in("admin")
    failed = [e for e in log(admin)["results"] if e["event"] == "Sign-in failed"]
    assert failed and failed[0]["login_id"] == ADMIN[0] and failed[0]["role"] is None
    assert "wrong-password" not in str(log(admin))


def test_admin_changes_are_recorded(data):  # noqa: F811
    admin = sign_in("admin")
    client.patch("/api/manage/transporters", headers=admin, json={"transport_name": "Kishan Travels", "mobile": "9000000000"})
    client.patch("/api/manage/transporters", headers=admin, json={"transport_name": "Kishan Travels", "hidden": True})
    client.delete("/api/manage/transporters", headers=admin, params={"transport_name": "Kishan Travels"})
    client.post("/api/manage/transporters/restore", headers=admin, json={"transport_name": "Kishan Travels"})
    client.post("/api/settings/users", headers=admin, json={"login_id": "ravi", "password": "Password1"})

    got = [(event, detail) for _, event, detail in events(admin, kind="admin")]
    assert got == [
        ("User added", "User 'ravi'"),
        ("Transporter restored", "Kishan Travels"),
        ("Transporter deleted", "Kishan Travels"),
        ("Transporter hidden", "Kishan Travels"),
        ("Transporter updated", "Kishan Travels: mobile"),
    ]


def test_search_filter_and_paging():
    admin = sign_in("admin")
    for i in range(5):
        client.post("/api/activity", headers=admin, json={"type": "search", "detail": f"query {i}"})
    page = log(admin, kind="search", limit=2, offset=0)
    assert page["total"] == 5 and [e["detail"] for e in page["results"]] == ["query 4", "query 3"]
    assert [e["detail"] for e in log(admin, q="query 1")["results"]] == ["query 1"]


def test_sign_out_is_recorded():
    admin = sign_in("admin")
    client.post("/api/auth/logout", headers=admin)
    again = sign_in("admin")
    assert "Signed out" in [event for _, event, _ in events(again)]
