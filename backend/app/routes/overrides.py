"""Transporter Management: local manual overrides only — never the RDS/CSV/Excel data.
See app/services/overrides_store.py."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..schemas import ExistingRowOverrideIn, NewTransporterIn, OverrideOut, OverrideUpdateIn
from ..services import overrides_store as store
from .auth import admin_only_router

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


@router.post("", response_model=OverrideOut)
def upsert_existing_row_override(body: ExistingRowOverrideIn):
    if not body.source_transport_name.strip():
        raise HTTPException(422, "source_transport_name is required")
    return store.upsert_existing(_path(), body.source_city, body.source_transport_name, body.source_pincode,
                                  hidden=body.hidden, **_fields(body))


@router.post("/new-transporter", response_model=OverrideOut)
def create_new_transporter(body: NewTransporterIn):
    if not body.transport_name.strip():
        raise HTTPException(422, "transport_name is required")
    return store.create_new(_path(), body.transport_name, body.city, body.pincode, body.mobile, body.status)


@router.patch("/{override_id}", response_model=OverrideOut)
def update_override(override_id: int, body: OverrideUpdateIn):
    row = store.update_by_id(_path(), override_id, hidden=body.hidden, **_fields(body))
    if not row:
        raise HTTPException(404, "override not found")
    return row


@router.delete("/{override_id}")
def delete_override(override_id: int):
    if not store.delete_by_id(_path(), override_id):
        raise HTTPException(404, "override not found")
    return {"deleted": True}
