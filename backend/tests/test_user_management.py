"""User Management (Settings, Admin only): many Users, each with a hashed password in the local
SQLite file; add, edit ID, reset password, activate/deactivate, delete, and logging in as each."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import accounts, overrides_store

client = TestClient(app)

ADMIN = ("Admin_deodap@123", "Admin@123")
DEFAULT_USER = ("User_deodap@123", "User@123")


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch):
    monkeypatch.setattr(accounts, "PBKDF2_ITERATIONS", 1_000)  # the real 600k is deliberately slow
    monkeypatch.setattr(accounts, "_failures", {})


def login(role, login_id, password):
    return client.post("/api/auth/login", json={"role": role, "login_id": login_id, "password": password})


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def admin():
    r = login("admin", *ADMIN)
    assert r.status_code == 200
    return auth(r.json()["token"])


def add(admin, login_id, password="Password1", **extra):
    return client.post("/api/settings/users", headers=admin, json={"login_id": login_id, "password": password, **extra})


def users(admin):
    return {u["login_id"]: u for u in client.get("/api/settings/users", headers=admin).json()}


def db_rows(sql):
    conn = sqlite3.connect(settings.overrides_db_path)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


# --- adding and logging in with multiple Users ---

def test_the_existing_user_login_still_works_and_is_listed(admin):
    assert login("user", *DEFAULT_USER).status_code == 200
    listed = users(admin)
    assert list(listed) == [DEFAULT_USER[0]] and listed[DEFAULT_USER[0]]["active"] is True


def test_admin_adds_several_users_and_each_can_log_in_with_their_own_password(admin):
    for i, name in enumerate(("ravi", "priya", "karan")):
        r = add(admin, name, f"Secret{i}pass")
        assert r.status_code == 201 and r.json()["login_id"] == name and r.json()["active"] is True
    assert set(users(admin)) == {DEFAULT_USER[0], "ravi", "priya", "karan"}
    for i, name in enumerate(("ravi", "priya", "karan")):
        r = login("user", name, f"Secret{i}pass")
        assert r.status_code == 200 and r.json() == {**r.json(), "role": "user", "login_id": name}
    assert login("user", "ravi", "Secret1pass").status_code == 401  # someone else's password
    assert login("admin", "ravi", "Secret0pass").status_code == 401  # a User can't sign in as Admin


def test_each_user_session_is_its_own_account(admin):
    add(admin, "ravi", "Password1")
    add(admin, "priya", "Password2")
    ravi = auth(login("user", "ravi", "Password1").json()["token"])
    priya = auth(login("user", "priya", "Password2").json()["token"])
    assert client.get("/api/settings/account", headers=ravi).json() == {"role": "user", "login_id": "ravi"}
    assert client.get("/api/settings/account", headers=priya).json() == {"role": "user", "login_id": "priya"}


def test_passwords_are_hashed_never_plain_text(admin):
    add(admin, "ravi", "Password1")
    stored = dict(db_rows("SELECT login_id, password_hash FROM app_users"))
    assert stored["ravi"].startswith("pbkdf2_sha256$") and "Password1" not in stored["ravi"]
    assert "password" not in str(client.get("/api/settings/users", headers=admin).json()).lower()


# --- duplicates ---

@pytest.mark.parametrize("login_id", ["ravi", "RAVI", "Ravi", DEFAULT_USER[0], ADMIN[0], ADMIN[0].lower()])
def test_duplicate_ids_are_refused_regardless_of_case_or_the_admin_id(admin, login_id):
    add(admin, "ravi")
    r = add(admin, login_id)
    assert r.status_code == 422 and "already in use" in r.json()["detail"]


def test_renaming_to_an_existing_id_is_refused_but_to_its_own_id_in_new_case_is_fine(admin):
    ravi = add(admin, "ravi").json()["id"]
    add(admin, "priya")
    assert client.patch(f"/api/settings/users/{ravi}", headers=admin, json={"login_id": "Priya"}).status_code == 422
    r = client.patch(f"/api/settings/users/{ravi}", headers=admin, json={"login_id": "Ravi"})
    assert r.status_code == 200 and r.json()["login_id"] == "Ravi"


def test_the_admin_cannot_take_a_users_id_either(admin):
    add(admin, "ravi")
    r = client.patch("/api/settings/account", headers=admin, json={"current_password": ADMIN[1], "new_login_id": "ravi"})
    assert r.status_code == 422


@pytest.mark.parametrize("body", [{"login_id": "", "password": "Password1"}, {"login_id": "has space", "password": "Password1"},
                                  {"login_id": "ok", "password": "short1"}, {"login_id": "ok", "password": "noDigitsHere"}])
def test_invalid_new_users_are_refused(admin, body):
    assert client.post("/api/settings/users", headers=admin, json=body).status_code == 422


# --- editing ---

def test_admin_changes_a_users_id_and_the_new_id_signs_in(admin):
    ravi = add(admin, "ravi", "Password1").json()["id"]
    r = client.patch(f"/api/settings/users/{ravi}", headers=admin, json={"login_id": "ravi.k"})
    assert r.status_code == 200 and r.json()["login_id"] == "ravi.k"
    assert login("user", "ravi", "Password1").status_code == 401
    assert login("user", "ravi.k", "Password1").status_code == 200


def test_admin_resets_a_password_and_it_signs_that_user_out(admin):
    ravi = add(admin, "ravi", "Password1").json()["id"]
    priya_id = add(admin, "priya", "Password2").json()["id"]
    ravi_session = auth(login("user", "ravi", "Password1").json()["token"])
    priya_session = auth(login("user", "priya", "Password2").json()["token"])
    r = client.patch(f"/api/settings/users/{ravi}", headers=admin, json={"password": "BrandNew9"})
    assert r.status_code == 200
    assert login("user", "ravi", "Password1").status_code == 401
    assert login("user", "ravi", "BrandNew9").status_code == 200
    assert client.get("/api/settings/account", headers=ravi_session).status_code == 401
    assert client.get("/api/settings/account", headers=priya_session).status_code == 200  # others unaffected
    assert priya_id


def test_a_reset_password_must_still_be_strong(admin):
    ravi = add(admin, "ravi").json()["id"]
    assert client.patch(f"/api/settings/users/{ravi}", headers=admin, json={"password": "weak"}).status_code == 422


# --- activate / deactivate ---

def test_deactivated_users_cannot_log_in_and_are_signed_out_until_reactivated(admin):
    ravi = add(admin, "ravi", "Password1").json()["id"]
    session = auth(login("user", "ravi", "Password1").json()["token"])
    r = client.patch(f"/api/settings/users/{ravi}", headers=admin, json={"active": False})
    assert r.status_code == 200 and r.json()["active"] is False
    blocked = login("user", "ravi", "Password1")
    assert blocked.status_code == 403 and "deactivated" in blocked.json()["detail"]
    assert login("user", "ravi", "wrong").status_code == 401  # a wrong password doesn't reveal the status
    assert client.get("/api/settings/account", headers=session).status_code == 401
    client.patch(f"/api/settings/users/{ravi}", headers=admin, json={"active": True})
    assert login("user", "ravi", "Password1").status_code == 200


def test_a_user_can_be_added_inactive(admin):
    add(admin, "later", "Password1", active=False)
    assert users(admin)["later"]["active"] is False
    assert login("user", "later", "Password1").status_code == 403


# --- delete ---

def test_deleting_a_user_removes_them_and_ends_their_session(admin):
    ravi = add(admin, "ravi", "Password1").json()["id"]
    session = auth(login("user", "ravi", "Password1").json()["token"])
    assert client.delete(f"/api/settings/users/{ravi}", headers=admin).json() == {"deleted": True}
    assert "ravi" not in users(admin)
    assert login("user", "ravi", "Password1").status_code == 401
    assert client.get("/api/settings/account", headers=session).status_code == 401
    assert db_rows("SELECT COUNT(*) FROM app_sessions WHERE user_id = %d" % ravi) == [(0,)]
    assert add(admin, "ravi").status_code == 201  # the ID is free again


def test_unknown_user_is_404(admin):
    assert client.patch("/api/settings/users/9999", headers=admin, json={"active": False}).status_code == 404
    assert client.delete("/api/settings/users/9999", headers=admin).status_code == 404


def test_deleting_every_user_does_not_bring_the_demo_user_back(admin):
    for u in client.get("/api/settings/users", headers=admin).json():
        client.delete(f"/api/settings/users/{u['id']}", headers=admin)
    assert users(admin) == {}
    assert login("user", *DEFAULT_USER).status_code == 401


# --- access: Admin only ---

def test_user_management_is_admin_only():
    user = auth(login("user", *DEFAULT_USER).json()["token"])
    uid = db_rows("SELECT id FROM app_users")[0][0]
    for method, url, body in [("get", "/api/settings/users", None), ("post", "/api/settings/users", {"login_id": "x", "password": "Password1"}),
                              ("patch", f"/api/settings/users/{uid}", {"active": False}), ("delete", f"/api/settings/users/{uid}", None)]:
        kwargs = {"json": body} if body else {}
        assert getattr(client, method)(url, headers=user, **kwargs).status_code == 403
        assert getattr(client, method)(url, **kwargs).status_code == 401  # and nothing without a session
    assert login("user", *DEFAULT_USER).status_code == 200  # unchanged


def test_a_user_changes_only_their_own_id_and_password(admin):
    add(admin, "ravi", "Password1")
    add(admin, "priya", "Password2")
    ravi = auth(login("user", "ravi", "Password1").json()["token"])
    r = client.patch("/api/settings/account", headers=ravi, json={"current_password": "Password1", "new_login_id": "ravi2", "new_password": "Password9"})
    assert r.json() == {"role": "user", "login_id": "ravi2"}
    assert login("user", "ravi2", "Password9").status_code == 200
    assert login("user", "priya", "Password2").status_code == 200  # priya untouched
    assert login("admin", *ADMIN).status_code == 200  # Admin untouched
    assert client.patch("/api/settings/account", headers=ravi, json={"current_password": "Password9", "new_login_id": "priya"}).status_code == 422


# --- upgrade from the single-User version ---

def test_the_earlier_single_user_account_is_carried_over_unchanged():
    path = settings.overrides_db_path
    conn = overrides_store._connect(__import__("pathlib").Path(path))
    conn.execute("INSERT INTO app_accounts (role, login_id, password_hash, updated_at) VALUES ('user', 'desk_user', ?, 'x')",
                 (accounts.hash_password("Kept1234"),))
    conn.commit()
    conn.close()
    assert login("user", "desk_user", "Kept1234").status_code == 200
    assert login("user", *DEFAULT_USER).status_code == 401  # not re-seeded alongside it
    assert db_rows("SELECT COUNT(*) FROM app_accounts WHERE role = 'user'") == [(0,)]


def test_an_older_sessions_table_gets_the_user_id_column_after_a_backup(tmp_path):
    from pathlib import Path
    db = tmp_path / "old.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE app_sessions (token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)")
    conn.execute("INSERT INTO app_sessions VALUES ('h', 'admin', 'x', 'y')")
    conn.commit()
    conn.close()
    overrides_store._connect(Path(db)).close()
    conn = sqlite3.connect(db)
    assert "user_id" in [r[1] for r in conn.execute("PRAGMA table_info(app_sessions)")]
    assert conn.execute("SELECT token_hash FROM app_sessions").fetchall() == [("h",)]  # data kept
    conn.close()
    assert list(tmp_path.glob("old.pre-migration-*.db"))


# --- Reset Password: the old password can never be retrieved ---

def test_user_list_and_every_user_response_carry_the_id_but_never_a_password_or_hash(admin):
    created = add(admin, "ravi", "Password1").json()
    listed = client.get("/api/settings/users", headers=admin).json()
    updated = client.patch(f"/api/settings/users/{created['id']}", headers=admin, json={"password": "Another22"}).json()
    for item in [created, updated, *listed]:
        assert set(item) == {"id", "login_id", "active", "created_at", "updated_at"}
        assert "pbkdf2" not in str(item)


def test_there_is_no_way_to_read_back_a_single_users_password(admin):
    uid = add(admin, "ravi").json()["id"]
    assert client.get(f"/api/settings/users/{uid}", headers=admin).status_code in (404, 405)
    assert client.get(f"/api/settings/users/{uid}/password", headers=admin).status_code in (404, 405)


def test_a_reset_replaces_the_hash_with_a_new_salted_hash(admin):
    uid = add(admin, "ravi", "Password1").json()["id"]
    before = db_rows(f"SELECT password_hash FROM app_users WHERE id = {uid}")[0][0]
    client.patch(f"/api/settings/users/{uid}", headers=admin, json={"password": "Password1"})  # same text, new salt
    after = db_rows(f"SELECT password_hash FROM app_users WHERE id = {uid}")[0][0]
    assert after.startswith("pbkdf2_sha256$") and after != before and "Password1" not in after
    client.patch(f"/api/settings/users/{uid}", headers=admin, json={"password": "BrandNew9"})
    stored = db_rows(f"SELECT password_hash FROM app_users WHERE id = {uid}")[0][0]
    assert accounts.verify_password("BrandNew9", stored) and not accounts.verify_password("Password1", stored)
