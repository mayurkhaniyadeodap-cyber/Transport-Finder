"""Transporter Management: local manual overrides only — never the RDS/CSV/Excel data.
See app/services/overrides_store.py."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..schemas import ExistingRowOverrideIn, NewTransporterIn, OverrideOut, OverrideUpdateIn
from ..services import activity, overrides_store as store
from .auth import admin_only_router, client_ip

# Admin only, checked on the server: 401 without a session, 403 for a User.
router = APIRouter(prefix="/overrides", dependencies=[Depends(admin_only_router)])


def _path() -> Path:
    return Path(settings.overrides_db_path)


def _fields(body) -> dict:
    return {"transport_name": body.transport_name, "city": body.city, "pincode": body.pincode,
            "mobile": body.mobile, "status": body.status}


@router.get("", response_model=list[OverrideOut])
def list_overrides():
    return store.list_overrides(_path())


def _row_label(o: dict | None) -> str:
    """"TCI Express (Rajkot, 360003)" -- which row an override is about, for the Activity Log."""
    if not o:
        return "unknown row"
    name = o.get("override_transport_name") or o.get("source_transport_name") or "?"
    where = ", ".join(x for x in (o.get("override_city") or o.get("source_city"),
                                  o.get("override_pincode") or o.get("source_pincode")) if x)
    return f"{name} ({where})" if where else name


@router.post("", response_model=OverrideOut)
def upsert_existing_row_override(body: ExistingRowOverrideIn, who=Depends(admin_only_router),
                                 ip: str | None = Depends(client_ip)):
    if not body.source_transport_name.strip():
        raise HTTPException(422, "source_transport_name is required")
    row = store.upsert_existing(_path(), body.source_city, body.source_transport_name, body.source_pincode,
                                hidden=body.hidden, **_fields(body))
    activity.record(who, "admin", "Row override saved", _row_label(row), ip=ip)
    return row


@router.post("/new-transporter", response_model=OverrideOut)
def create_new_transporter(body: NewTransporterIn, who=Depends(admin_only_router), ip: str | None = Depends(client_ip)):
    if not body.transport_name.strip():
        raise HTTPException(422, "transport_name is required")
    row = store.create_new(_path(), body.transport_name, body.city, body.pincode, body.mobile, body.status)
    activity.record(who, "admin", "Row override added", _row_label(row), ip=ip)
    return row


@router.patch("/{override_id}", response_model=OverrideOut)
def update_override(override_id: int, body: OverrideUpdateIn, who=Depends(admin_only_router),
                    ip: str | None = Depends(client_ip)):
    row = store.update_by_id(_path(), override_id, hidden=body.hidden, **_fields(body))
    if not row:
        raise HTTPException(404, "override not found")
    activity.record(who, "admin", "Row override updated", _row_label(row), ip=ip)
    return row


@router.delete("/{override_id}")
def delete_override(override_id: int, who=Depends(admin_only_router), ip: str | None = Depends(client_ip)):
    before = store.get_by_id(_path(), override_id)
    if not store.delete_by_id(_path(), override_id):
        raise HTTPException(404, "override not found")
    activity.record(who, "admin", "Row override removed", _row_label(before), ip=ip)
    return {"deleted": True}
