"""Sign-in and the Settings page. Accounts, sessions and preferences are stored only in the local
SQLite file (see services/accounts.py) -- nothing here touches the RDS."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..services import accounts, activity
from .auth import bearer_token as _token, client_ip as _ip, current_identity as _who, require_admin as _admin

router = APIRouter()


class LoginIn(BaseModel):
    role: Literal["admin", "user"]
    login_id: str
    password: str


class AccountUpdateIn(BaseModel):
    current_password: str
    new_login_id: str | None = None
    new_password: str | None = None


class UserIn(BaseModel):
    login_id: str
    password: str
    active: bool = True


class UserUpdateIn(BaseModel):
    login_id: str | None = None
    password: str | None = None  # a reset: no old password needed (Admin only)
    active: bool | None = None


class PreferencesIn(BaseModel):
    default_pincode: str | None = None
    default_search_type: str | None = None
    results_per_page: int | None = None


def _handle(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except accounts.AuthError as exc:
        raise HTTPException(401, str(exc))
    except accounts.TooManyAttempts as exc:
        raise HTTPException(429, str(exc))
    except accounts.AccountDisabled as exc:
        raise HTTPException(403, str(exc))
    except accounts.NotFound as exc:
        raise HTTPException(404, str(exc))
    except accounts.SettingsError as exc:
        raise HTTPException(422, str(exc))


@router.post("/auth/login")
def login(body: LoginIn, ip: str | None = Depends(_ip)):
    try:
        out = _handle(accounts.login, body.role, body.login_id, body.password)
    except HTTPException as exc:
        if exc.status_code in (401, 403):  # wrong ID/password, or a deactivated User
            reason = "account deactivated" if exc.status_code == 403 else "wrong ID or password"
            activity.record(None, "session", "Sign-in failed", f"{body.role.title()} sign-in: {reason}",
                            ip=ip, login_id=body.login_id.strip()[:64])
        raise
    activity.record(accounts.session_identity(out["token"]), "session", "Signed in", f"{body.role.title()} sign-in",
                    ip=ip, login_id=out["login_id"])
    return out


@router.post("/auth/logout")
def logout(token: str | None = Depends(_token), ip: str | None = Depends(_ip)):
    try:
        who = accounts.session_identity(token)
    except accounts.AuthError:
        who = None  # already expired: nothing to record
    if who is not None:
        activity.record(who, "session", "Signed out", ip=ip)
    accounts.logout(token)
    return {"ok": True}


@router.get("/settings/account")
def get_account(who: accounts.Identity = Depends(_who)):
    return _handle(accounts.account_info, who)


@router.patch("/settings/account")
def update_account(body: AccountUpdateIn, who: accounts.Identity = Depends(_who), token: str | None = Depends(_token),
                   ip: str | None = Depends(_ip)):
    """The signed-in person's own ID/password only -- never another account's."""
    out = _handle(accounts.update_account, who, token, body.current_password,
                  new_login_id=body.new_login_id, new_password=body.new_password)
    changed = [what for what, v in (("Login ID", body.new_login_id), ("password", body.new_password)) if v]
    activity.record(who, "settings", "Account updated", " and ".join(changed).capitalize() + " changed", ip=ip)
    return out


# --- User Management: Admin only ---

@router.get("/settings/users")
def list_users(_: accounts.Identity = Depends(_admin)):
    return accounts.list_users()


@router.post("/settings/users", status_code=201)
def add_user(body: UserIn, who: accounts.Identity = Depends(_admin), ip: str | None = Depends(_ip)):
    out = _handle(accounts.add_user, body.login_id, body.password, body.active)
    activity.record(who, "admin", "User added", f"User {out['login_id']!r}", ip=ip)
    return out


@router.patch("/settings/users/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, who: accounts.Identity = Depends(_admin), ip: str | None = Depends(_ip)):
    before = _user_login_id(user_id)
    out = _handle(accounts.update_user, user_id, login_id=body.login_id, password=body.password, active=body.active)
    changes = []
    if body.login_id is not None and out["login_id"] != before:
        changes.append(f"ID changed to {out['login_id']!r}")
    if body.password is not None:
        changes.append("password reset")
    if body.active is not None:
        changes.append("activated" if body.active else "deactivated")
    activity.record(who, "admin", "User updated", f"User {before!r}: {', '.join(changes) or 'no changes'}", ip=ip)
    return out


@router.delete("/settings/users/{user_id}")
def delete_user(user_id: int, who: accounts.Identity = Depends(_admin), ip: str | None = Depends(_ip)):
    before = _user_login_id(user_id)
    _handle(accounts.delete_user, user_id)
    activity.record(who, "admin", "User deleted", f"User {before!r}", ip=ip)
    return {"deleted": True}


def _user_login_id(user_id: int) -> str:
    return next((u["login_id"] for u in accounts.list_users() if u["id"] == user_id), f"#{user_id}")


@router.get("/settings/preferences")
def get_preferences(_: accounts.Identity = Depends(_who)):
    return accounts.get_preferences()


@router.put("/settings/preferences")
def set_preferences(body: PreferencesIn, who: accounts.Identity = Depends(_admin), ip: str | None = Depends(_ip)):
    """App-wide search preferences: Admin only (a User can view them, not change them)."""
    out = _handle(accounts.set_preferences, default_pincode=body.default_pincode,
                  default_search_type=body.default_search_type, results_per_page=body.results_per_page)
    activity.record(who, "settings", "Search preferences updated",
                    f"Default pincode {out['default_pincode'] or 'none'}, search type {out['default_search_type']}, "
                    f"{out['results_per_page']} results per page", ip=ip)
    return out
