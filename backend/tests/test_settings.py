"""Settings page backend: sign-in against hashed accounts in the local SQLite file, changing the
signed-in role's own ID/password, and Admin-only app-wide preferences."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import accounts

client = TestClient(app)

ADMIN = ("Admin_deodap@123", "Admin@123")
USER = ("User_deodap@123", "User@123")


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch):
    monkeypatch.setattr(accounts, "PBKDF2_ITERATIONS", 1_000)  # the real 600k is deliberately slow
    monkeypatch.setattr(accounts, "_failures", {})


def login(role="admin", login_id=None, password=None):
    login_id = login_id if login_id is not None else (ADMIN if role == "admin" else USER)[0]
    password = password if password is not None else (ADMIN if role == "admin" else USER)[1]
    return client.post("/api/auth/login", json={"role": role, "login_id": login_id, "password": password})


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def token_for(role="admin"):
    r = login(role)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def db_rows(sql):
    conn = sqlite3.connect(settings.overrides_db_path)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


# --- login ---

def test_the_existing_demo_credentials_still_log_in_as_each_role():
    a, u = login("admin").json(), login("user").json()
    assert (a["role"], a["login_id"]) == ("admin", ADMIN[0]) and a["token"]
    assert (u["role"], u["login_id"]) == ("user", USER[0])


@pytest.mark.parametrize("role, login_id, password", [
    ("admin", ADMIN[0], "wrong"), ("admin", USER[0], USER[1]),  # the User's credentials on the Admin tab
    ("user", ADMIN[0], ADMIN[1]), ("admin", "", ""),
])
def test_wrong_credentials_are_rejected(role, login_id, password):
    r = login(role, login_id, password)
    assert r.status_code == 401 and r.json()["detail"] == "Invalid ID or password"


def test_passwords_are_stored_only_as_salted_hashes():
    login("admin"), login("user")
    rows = db_rows("SELECT 'admin', password_hash FROM app_accounts UNION ALL SELECT login_id, password_hash FROM app_users")
    assert [r[0] for r in rows] == ["admin", USER[0]]
    for _, stored in rows:
        assert stored.startswith("pbkdf2_sha256$") and "Admin@123" not in stored and "User@123" not in stored
    assert rows[0][1].split("$")[2] != rows[1][1].split("$")[2]  # a different salt each


def test_session_tokens_are_stored_only_as_hashes():
    token = token_for()
    stored = [r[0] for r in db_rows("SELECT token_hash FROM app_sessions")]
    assert token not in stored and len(stored) == 1 and len(stored[0]) == 64


def test_repeated_wrong_passwords_lock_that_role_for_a_while():
    for _ in range(accounts.MAX_FAILURES):
        assert login("admin", password="nope").status_code == 401
    assert login("admin").status_code == 429  # even the right password, until the window passes
    assert login("user").status_code == 200  # the other role isn't affected


def test_verify_password_rejects_garbage():
    assert not accounts.verify_password("x", "not-a-hash")
    assert accounts.verify_password("Secret123", accounts.hash_password("Secret123"))


# --- sessions ---

def test_settings_need_a_valid_session():
    assert client.get("/api/settings/account").status_code == 401
    assert client.get("/api/settings/account", headers=auth("made-up")).status_code == 401
    token = token_for()
    assert client.get("/api/settings/account", headers=auth(token)).json() == {"role": "admin", "login_id": ADMIN[0]}
    client.post("/api/auth/logout", headers=auth(token))
    assert client.get("/api/settings/account", headers=auth(token)).status_code == 401


def test_expired_sessions_are_refused(monkeypatch):
    token = token_for()
    conn = sqlite3.connect(settings.overrides_db_path)
    conn.execute("UPDATE app_sessions SET expires_at = '2000-01-01T00:00:00+00:00'")
    conn.commit()
    conn.close()
    assert client.get("/api/settings/account", headers=auth(token)).status_code == 401


# --- account changes ---

def test_admin_changes_own_id_and_password_and_the_old_ones_stop_working():
    token = token_for()
    r = client.patch("/api/settings/account", headers=auth(token),
                     json={"current_password": ADMIN[1], "new_login_id": "ops_admin", "new_password": "NewPass2026"})
    assert r.status_code == 200 and r.json() == {"role": "admin", "login_id": "ops_admin"}
    assert login("admin").status_code == 401
    assert login("admin", "ops_admin", "NewPass2026").status_code == 200
    assert login("user").status_code == 200  # the User account is untouched


def test_changing_needs_the_current_password():
    token = token_for("user")
    r = client.patch("/api/settings/account", headers=auth(token), json={"current_password": "wrong", "new_password": "Another123"})
    assert r.status_code == 422 and r.json()["detail"] == "Current password is incorrect."
    assert login("user").status_code == 200


def test_a_user_session_can_only_change_the_user_account():
    token = token_for("user")
    r = client.patch("/api/settings/account", headers=auth(token), json={"current_password": USER[1], "new_login_id": "desk_user"})
    assert r.json() == {"role": "user", "login_id": "desk_user"}
    assert login("admin").status_code == 200  # Admin untouched


@pytest.mark.parametrize("body, message", [
    ({"new_password": "short1"}, "8"),
    ({"new_password": "onlyletters"}, "letter and one number"),
    ({"new_password": ADMIN[1]}, "different"),
    ({"new_login_id": "   "}, "cannot be empty"),
    ({"new_login_id": "has space"}, "no spaces"),
    ({"new_login_id": USER[0]}, "already in use"),
    ({"new_login_id": USER[0].upper()}, "already in use"),  # regardless of letter case
    ({}, "Nothing to change"),
])
def test_invalid_new_values_are_rejected(body, message):
    token = token_for()
    r = client.patch("/api/settings/account", headers=auth(token), json={"current_password": ADMIN[1], **body})
    assert r.status_code == 422 and message in r.json()["detail"]
    assert login("admin").status_code == 200


def test_a_password_change_signs_out_that_roles_other_sessions_only():
    other_admin, user = token_for(), token_for("user")
    this = token_for()
    client.patch("/api/settings/account", headers=auth(this), json={"current_password": ADMIN[1], "new_password": "Changed2026"})
    assert client.get("/api/settings/account", headers=auth(this)).status_code == 200
    assert client.get("/api/settings/account", headers=auth(other_admin)).status_code == 401
    assert client.get("/api/settings/account", headers=auth(user)).status_code == 200


# --- preferences ---

def test_preferences_default_to_the_current_behaviour():
    assert client.get("/api/settings/preferences", headers=auth(token_for("user"))).json() == {
        "default_pincode": "", "default_search_type": "auto", "results_per_page": 50}


def test_admin_saves_preferences_and_they_persist_in_sqlite():
    token = token_for()
    r = client.put("/api/settings/preferences", headers=auth(token),
                   json={"default_pincode": "360003", "default_search_type": "city", "results_per_page": 25})
    assert r.status_code == 200
    expected = {"default_pincode": "360003", "default_search_type": "city", "results_per_page": 25}
    assert r.json() == expected
    with TestClient(app) as restarted:  # a server restart reads them back from the file
        assert restarted.get("/api/settings/preferences", headers=auth(token_for("user"))).json() == expected


def test_user_cannot_change_preferences():
    token = token_for("user")
    r = client.put("/api/settings/preferences", headers=auth(token), json={"results_per_page": 10})
    assert r.status_code == 403
    assert client.get("/api/settings/preferences", headers=auth(token)).json()["results_per_page"] == 50
    assert client.put("/api/settings/preferences", json={"results_per_page": 10}).status_code == 401


@pytest.mark.parametrize("body", [{"default_pincode": "12345"}, {"default_search_type": "everything"}, {"results_per_page": 7}])
def test_invalid_preferences_are_rejected(body):
    assert client.put("/api/settings/preferences", headers=auth(token_for()), json=body).status_code == 422


def test_empty_default_pincode_clears_it():
    token = token_for()
    client.put("/api/settings/preferences", headers=auth(token), json={"default_pincode": "360003"})
    assert client.put("/api/settings/preferences", headers=auth(token), json={"default_pincode": ""}).json()["default_pincode"] == ""


def test_settings_are_stored_in_the_local_sqlite_file_only():
    client.put("/api/settings/preferences", headers=auth(token_for()), json={"results_per_page": 100})
    rows = dict(db_rows("SELECT key, value FROM app_settings WHERE key != '_users_initialized'"))
    assert rows == {"results_per_page": "100"}
