"""Activity Log: the app reports panel opens, searches and profile views here; everything else
(sign-ins, Admin changes, settings) is recorded by the server where it happens. Reading it needs a
session: the Admin sees everyone's activity, a User only their own."""
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..services import accounts, activity
from .auth import client_ip, current_identity

router = APIRouter(prefix="/activity")


class ActivityIn(BaseModel):
    type: Literal["panel_open", "search", "profile_view"]
    detail: str | None = None


@router.post("", status_code=201)
def report(body: ActivityIn, who: accounts.Identity = Depends(current_identity), ip: str | None = Depends(client_ip)):
    kind, event = activity.CLIENT_EVENTS[body.type]
    activity.record(who, kind, event, body.detail, ip=ip)
    return {"ok": True}


@router.get("")
def list_activity(
    who: accounts.Identity = Depends(current_identity),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    kind: str | None = None,
    q: str | None = None,
):
    return activity.list_activity(who, limit=limit, offset=offset, kind=kind, q=q)
