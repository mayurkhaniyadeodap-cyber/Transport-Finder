"""Sign-in and the Settings page. Accounts, sessions and preferences are stored only in the local
SQLite file (see services/accounts.py) -- nothing here touches the RDS."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..services import accounts
from .auth import bearer_token as _token, current_identity as _who, require_admin as _admin

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
def login(body: LoginIn):
    return _handle(accounts.login, body.role, body.login_id, body.password)


@router.post("/auth/logout")
def logout(token: str | None = Depends(_token)):
    accounts.logout(token)
    return {"ok": True}


@router.get("/settings/account")
def get_account(who: accounts.Identity = Depends(_who)):
    return _handle(accounts.account_info, who)


@router.patch("/settings/account")
def update_account(body: AccountUpdateIn, who: accounts.Identity = Depends(_who), token: str | None = Depends(_token)):
    """The signed-in person's own ID/password only -- never another account's."""
    return _handle(accounts.update_account, who, token, body.current_password,
                   new_login_id=body.new_login_id, new_password=body.new_password)


# --- User Management: Admin only ---

@router.get("/settings/users")
def list_users(_: accounts.Identity = Depends(_admin)):
    return accounts.list_users()


@router.post("/settings/users", status_code=201)
def add_user(body: UserIn, _: accounts.Identity = Depends(_admin)):
    return _handle(accounts.add_user, body.login_id, body.password, body.active)


@router.patch("/settings/users/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, _: accounts.Identity = Depends(_admin)):
    return _handle(accounts.update_user, user_id, login_id=body.login_id, password=body.password, active=body.active)


@router.delete("/settings/users/{user_id}")
def delete_user(user_id: int, _: accounts.Identity = Depends(_admin)):
    _handle(accounts.delete_user, user_id)
    return {"deleted": True}


@router.get("/settings/preferences")
def get_preferences(_: accounts.Identity = Depends(_who)):
    return accounts.get_preferences()


@router.put("/settings/preferences")
def set_preferences(body: PreferencesIn, _: accounts.Identity = Depends(_admin)):
    """App-wide search preferences: Admin only (a User can view them, not change them)."""
    return _handle(accounts.set_preferences, default_pincode=body.default_pincode,
                   default_search_type=body.default_search_type, results_per_page=body.results_per_page)
