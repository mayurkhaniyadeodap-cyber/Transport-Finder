"""Session checks shared by the API routes (the same sign-in sessions Settings uses; see
services/accounts.py). A request carries its session as `Authorization: Bearer <token>`."""
from fastapi import Depends, Header, HTTPException

from ..services import accounts


def bearer_token(authorization: str | None = Header(default=None)) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def current_identity(token: str | None = Depends(bearer_token)) -> accounts.Identity:
    """The signed-in Admin or User; 401 without a valid session."""
    try:
        return accounts.session_identity(token)
    except accounts.AuthError as exc:
        raise HTTPException(401, str(exc))


def require_admin(who: accounts.Identity = Depends(current_identity)) -> accounts.Identity:
    """401 without a valid session, 403 for a User."""
    if who.role != "admin":
        raise HTTPException(403, "Only the Admin can do this.")
    return who


def admin_only_router(_: accounts.Identity = Depends(require_admin)) -> None:
    """Router-level guard for everything that changes (or lists for editing) transporter data:
    /api/manage/* and /api/overrides/*. Search stays open, as before."""
