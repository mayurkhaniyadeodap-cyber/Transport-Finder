"""Sign-in accounts, sessions, User Management and app-wide preferences for the Settings page.

Everything lives in the same local SQLite file as the rest of the Admin data (never the RDS):
  - app_accounts: the single Admin account (role "admin") with its login ID and a salted
    PBKDF2-SHA256 password hash. Passwords are never stored or logged in plain text. If the row is
    missing it's seeded with the original demo credentials (hashed) -- deleting it resets the Admin
    to those defaults (the recovery path if the Admin password is forgotten).
  - app_users: any number of User accounts, managed by the Admin (add, change ID, reset password,
    activate/deactivate, delete). Same hashing. IDs are unique regardless of letter case, and never
    equal the Admin's ID. The first time this runs, the earlier single User account (an
    app_accounts row with role "user") is moved here unchanged -- same ID, same password hash -- or,
    on a fresh install, the original demo User is created, so existing logins keep working.
  - app_sessions: signed-in sessions. The browser holds a random token; only its SHA-256 is stored,
    so the database never contains a usable token. Sessions expire after SESSION_HOURS; a User's
    sessions end at once when that User is deactivated, deleted or has their password reset.
  - app_settings: app-wide search preferences set by the Admin (default pincode, default search
    type, results per page).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..config import settings
from . import overrides_store

ROLES = ("admin", "user")
# The original demo sign-ins; used only to seed the Admin row and, on a fresh install, the first User.
_DEFAULT_ADMIN = ("Admin_deodap@123", "Admin@123")
_DEFAULT_USER = ("User_deodap@123", "User@123")
_USERS_READY_KEY = "_users_initialized"  # app_settings marker: the one-time User setup has run

PBKDF2_ITERATIONS = 600_000
SESSION_HOURS = 12
MIN_PASSWORD_LENGTH = 8
MAX_FIELD_LENGTH = 128

SEARCH_TYPES = ("auto", "pincode", "city", "state", "transporter")
PAGE_SIZES = (10, 25, 50, 100)
DEFAULT_PREFERENCES = {"default_pincode": "", "default_search_type": "auto", "results_per_page": 50}

# Simple brute-force brake: after MAX_FAILURES wrong passwords for one role + ID within
# LOCK_SECONDS, further attempts for it are refused until the window passes.
MAX_FAILURES = 5
LOCK_SECONDS = 300
_failures: dict[str, list[float]] = {}
_failures_lock = threading.Lock()


class AuthError(Exception):
    """Wrong credentials or a missing/expired session (answered 401)."""


class TooManyAttempts(Exception):
    """Login temporarily locked (answered 429)."""


class AccountDisabled(Exception):
    """Right password, but the Admin has deactivated this User (answered 403)."""


class SettingsError(ValueError):
    """Invalid new value (answered 422)."""


class NotFound(LookupError):
    """No such User (answered 404)."""


@dataclass(frozen=True)
class Identity:
    """Who a session belongs to: the Admin (user_id None) or one User."""
    role: str
    user_id: int | None = None


def _path() -> Path:
    return Path(settings.overrides_db_path)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp() -> str:
    return _now().isoformat(timespec="seconds")


# --- password hashing -------------------------------------------------------------------------

def hash_password(password: str, *, iterations: int | None = None) -> str:
    iterations = iterations or PBKDF2_ITERATIONS
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return f"pbkdf2_sha256${iterations}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.b64decode(salt), int(iterations))
        return hmac.compare_digest(check, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def _check_new_password(password: str | None) -> str:
    password = password or ""
    if len(password) < MIN_PASSWORD_LENGTH or len(password) > MAX_FIELD_LENGTH:
        raise SettingsError(f"The password must be {MIN_PASSWORD_LENGTH}–{MAX_FIELD_LENGTH} characters.")
    if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        raise SettingsError("The password must contain at least one letter and one number.")
    return password


def _check_new_login_id(login_id: str | None) -> str:
    login_id = (login_id or "").strip()
    if not login_id:
        raise SettingsError("The ID cannot be empty.")
    if len(login_id) > MAX_FIELD_LENGTH or re.search(r"\s", login_id):
        raise SettingsError(f"The ID must be at most {MAX_FIELD_LENGTH} characters, with no spaces.")
    return login_id


# --- storage helpers --------------------------------------------------------------------------

def _connect():
    conn = overrides_store._connect(_path())
    _ensure_accounts(conn)
    return conn


def _ensure_accounts(conn) -> None:
    """Seeds the Admin row if missing, and runs the one-time User setup (see module docstring)."""
    if conn.execute("SELECT 1 FROM app_accounts WHERE role = 'admin'").fetchone() is None:
        conn.execute("INSERT INTO app_accounts (role, login_id, password_hash, updated_at) VALUES ('admin', ?, ?, ?) "
                     "ON CONFLICT(role) DO NOTHING", (_DEFAULT_ADMIN[0], hash_password(_DEFAULT_ADMIN[1]), _stamp()))
        conn.commit()
    if conn.execute("SELECT 1 FROM app_settings WHERE key = ?", (_USERS_READY_KEY,)).fetchone():
        return
    legacy = conn.execute("SELECT login_id, password_hash FROM app_accounts WHERE role = 'user'").fetchone()
    if legacy:
        login_id, password_hash = legacy["login_id"], legacy["password_hash"]
    else:
        login_id, password_hash = _DEFAULT_USER[0], hash_password(_DEFAULT_USER[1])
    now = _stamp()
    if not conn.execute("SELECT 1 FROM app_users WHERE login_id = ? COLLATE NOCASE", (login_id,)).fetchone():
        conn.execute("INSERT INTO app_users (login_id, password_hash, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
                     (login_id, password_hash, now, now))
    conn.execute("DELETE FROM app_accounts WHERE role = 'user'")
    conn.execute("DELETE FROM app_sessions WHERE role = 'user' AND user_id IS NULL")  # pre-migration User sessions
    conn.execute("INSERT INTO app_settings (key, value, updated_at) VALUES (?, 'true', ?) ON CONFLICT(key) DO NOTHING",
                 (_USERS_READY_KEY, now))
    conn.commit()


def _admin_row(conn):
    return conn.execute("SELECT * FROM app_accounts WHERE role = 'admin'").fetchone()


def _user_row(conn, user_id: int):
    row = conn.execute("SELECT * FROM app_users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise NotFound("That user no longer exists.")
    return row


def _id_taken(conn, login_id: str, *, except_user: int | None = None, except_admin: bool = False) -> bool:
    """Is this ID already used -- by any User (ignoring letter case) or by the Admin?"""
    if not except_admin and _admin_row(conn)["login_id"].lower() == login_id.lower():
        return True
    row = conn.execute("SELECT id FROM app_users WHERE login_id = ? COLLATE NOCASE", (login_id,)).fetchone()
    return row is not None and row["id"] != except_user


def _user_out(row) -> dict:
    return {"id": row["id"], "login_id": row["login_id"], "active": bool(row["active"]),
            "created_at": row["created_at"], "updated_at": row["updated_at"]}


# --- sign-in ----------------------------------------------------------------------------------

def _rate_key(role: str, login_id: str) -> str:
    return f"{role}:{login_id.strip().lower()}"


def _check_rate(key: str) -> None:
    with _failures_lock:
        recent = [t for t in _failures.get(key, []) if time.monotonic() - t < LOCK_SECONDS]
        _failures[key] = recent
        if len(recent) >= MAX_FAILURES:
            raise TooManyAttempts("Too many failed attempts. Please wait a few minutes and try again.")


def _record_failure(key: str) -> None:
    with _failures_lock:
        _failures.setdefault(key, []).append(time.monotonic())


def login(role: str, login_id: str, password: str) -> dict:
    """Checks the ID and password for that role; returns a new session {token, role, login_id}."""
    if role not in ROLES:
        raise AuthError("Invalid ID or password")
    key = _rate_key(role, login_id)
    _check_rate(key)
    conn = _connect()
    try:
        if role == "admin":
            row, user_id = _admin_row(conn), None
            ok = login_id.strip() == row["login_id"] and verify_password(password, row["password_hash"])
        else:
            row = conn.execute("SELECT * FROM app_users WHERE login_id = ?", (login_id.strip(),)).fetchone()
            user_id = row["id"] if row else None
            ok = row is not None and verify_password(password, row["password_hash"])
        if not ok:
            _record_failure(key)
            raise AuthError("Invalid ID or password")
        with _failures_lock:
            _failures.pop(key, None)
        if role == "user" and not row["active"]:
            raise AccountDisabled("This account has been deactivated. Please contact the Admin.")
        token = secrets.token_urlsafe(32)
        now = _now()
        conn.execute("DELETE FROM app_sessions WHERE expires_at < ?", (now.isoformat(timespec="seconds"),))
        conn.execute(
            "INSERT INTO app_sessions (token_hash, role, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            (_token_hash(token), role, user_id, now.isoformat(timespec="seconds"),
             (now + timedelta(hours=SESSION_HOURS)).isoformat(timespec="seconds")),
        )
        conn.commit()
        return {"token": token, "role": role, "login_id": row["login_id"]}
    finally:
        conn.close()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_identity(token: str | None) -> Identity:
    """Who a valid, unexpired session belongs to; raises AuthError otherwise (including a User who
    has since been deactivated or deleted)."""
    if not token:
        raise AuthError("Please log in again.")
    conn = _connect()
    try:
        row = conn.execute("SELECT role, user_id, expires_at FROM app_sessions WHERE token_hash = ?", (_token_hash(token),)).fetchone()
        if row is None or row["expires_at"] < _stamp():
            raise AuthError("Your session has expired. Please log in again.")
        if row["role"] == "user":
            user = conn.execute("SELECT active FROM app_users WHERE id = ?", (row["user_id"],)).fetchone()
            if user is None or not user["active"]:
                raise AuthError("Your session has ended. Please log in again.")
        return Identity(row["role"], row["user_id"])
    finally:
        conn.close()


def session_role(token: str | None) -> str:
    return session_identity(token).role


def logout(token: str | None) -> None:
    if not token:
        return
    conn = _connect()
    try:
        conn.execute("DELETE FROM app_sessions WHERE token_hash = ?", (_token_hash(token),))
        conn.commit()
    finally:
        conn.close()


# --- your own account -------------------------------------------------------------------------

def account_info(who: Identity) -> dict:
    conn = _connect()
    try:
        row = _admin_row(conn) if who.role == "admin" else _user_row(conn, who.user_id)
        return {"role": who.role, "login_id": row["login_id"]}
    finally:
        conn.close()


def update_account(who: Identity, token: str, current_password: str, *, new_login_id: str | None = None,
                   new_password: str | None = None) -> dict:
    """The signed-in Admin or User changes their own login ID and/or password; the current password
    is always required. A password change signs out their other sessions (this one stays)."""
    if new_login_id is None and new_password is None:
        raise SettingsError("Nothing to change.")
    conn = _connect()
    try:
        is_admin = who.role == "admin"
        row = _admin_row(conn) if is_admin else _user_row(conn, who.user_id)
        if not verify_password(current_password or "", row["password_hash"]):
            raise SettingsError("Current password is incorrect.")
        sets, vals = [], []
        if new_login_id is not None:
            new_login_id = _check_new_login_id(new_login_id)
            if _id_taken(conn, new_login_id, except_user=None if is_admin else who.user_id, except_admin=is_admin):
                raise SettingsError("That ID is already in use.")
            sets.append("login_id = ?")
            vals.append(new_login_id)
        if new_password is not None:
            _check_new_password(new_password)
            if verify_password(new_password, row["password_hash"]):
                raise SettingsError("The new password must be different from the current one.")
            sets.append("password_hash = ?")
            vals.append(hash_password(new_password))
        sets.append("updated_at = ?")
        vals.append(_stamp())
        if is_admin:
            conn.execute(f"UPDATE app_accounts SET {', '.join(sets)} WHERE role = 'admin'", vals)
        else:
            conn.execute(f"UPDATE app_users SET {', '.join(sets)} WHERE id = ?", [*vals, who.user_id])
        if new_password is not None:
            if is_admin:
                conn.execute("DELETE FROM app_sessions WHERE role = 'admin' AND token_hash != ?", (_token_hash(token),))
            else:
                conn.execute("DELETE FROM app_sessions WHERE user_id = ? AND token_hash != ?", (who.user_id, _token_hash(token)))
        conn.commit()
        row = _admin_row(conn) if is_admin else _user_row(conn, who.user_id)
        return {"role": who.role, "login_id": row["login_id"]}
    finally:
        conn.close()


# --- User Management (Admin only; the route layer enforces that) ------------------------------

def list_users() -> list[dict]:
    conn = _connect()
    try:
        return [_user_out(r) for r in conn.execute("SELECT * FROM app_users ORDER BY login_id COLLATE NOCASE")]
    finally:
        conn.close()


def add_user(login_id: str, password: str, active: bool = True) -> dict:
    login_id = _check_new_login_id(login_id)
    _check_new_password(password)
    conn = _connect()
    try:
        if _id_taken(conn, login_id):
            raise SettingsError("That ID is already in use.")
        now = _stamp()
        cur = conn.execute("INSERT INTO app_users (login_id, password_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                           (login_id, hash_password(password), 1 if active else 0, now, now))
        conn.commit()
        return _user_out(_user_row(conn, cur.lastrowid))
    finally:
        conn.close()


def update_user(user_id: int, *, login_id: str | None = None, password: str | None = None, active: bool | None = None) -> dict:
    """Admin edit of a User: change the ID, reset the password (no old password needed), or
    activate/deactivate. A reset or a deactivation signs that User out everywhere."""
    if login_id is None and password is None and active is None:
        raise SettingsError("Nothing to change.")
    conn = _connect()
    try:
        _user_row(conn, user_id)
        sets, vals = [], []
        if login_id is not None:
            login_id = _check_new_login_id(login_id)
            if _id_taken(conn, login_id, except_user=user_id):
                raise SettingsError("That ID is already in use.")
            sets.append("login_id = ?")
            vals.append(login_id)
        if password is not None:
            sets.append("password_hash = ?")
            vals.append(hash_password(_check_new_password(password)))
        if active is not None:
            sets.append("active = ?")
            vals.append(1 if active else 0)
        sets.append("updated_at = ?")
        vals.append(_stamp())
        conn.execute(f"UPDATE app_users SET {', '.join(sets)} WHERE id = ?", [*vals, user_id])
        if password is not None or active is False:
            conn.execute("DELETE FROM app_sessions WHERE user_id = ?", (user_id,))
        conn.commit()
        return _user_out(_user_row(conn, user_id))
    finally:
        conn.close()


def delete_user(user_id: int) -> None:
    conn = _connect()
    try:
        _user_row(conn, user_id)
        conn.execute("DELETE FROM app_sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM app_users WHERE id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


# --- app-wide preferences ---------------------------------------------------------------------

def get_preferences() -> dict:
    conn = _connect()
    try:
        prefs = dict(DEFAULT_PREFERENCES)
        for row in conn.execute("SELECT key, value FROM app_settings"):
            if row["key"] in prefs:
                prefs[row["key"]] = json.loads(row["value"])
        return prefs
    finally:
        conn.close()


def set_preferences(*, default_pincode: str | None = None, default_search_type: str | None = None,
                    results_per_page: int | None = None) -> dict:
    changes: dict = {}
    if default_pincode is not None:
        pin = default_pincode.strip()
        if pin and not re.fullmatch(r"\d{6}", pin):
            raise SettingsError("Default pincode must be 6 digits (or empty for none).")
        changes["default_pincode"] = pin
    if default_search_type is not None:
        if default_search_type not in SEARCH_TYPES:
            raise SettingsError(f"Default search type must be one of: {', '.join(SEARCH_TYPES)}.")
        changes["default_search_type"] = default_search_type
    if results_per_page is not None:
        if results_per_page not in PAGE_SIZES:
            raise SettingsError(f"Results per page must be one of: {', '.join(map(str, PAGE_SIZES))}.")
        changes["results_per_page"] = results_per_page
    conn = _connect()
    try:
        now = _now().isoformat(timespec="seconds")
        for key, value in changes.items():
            conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (key, json.dumps(value), now),
            )
        conn.commit()
    finally:
        conn.close()
    return get_preferences()
