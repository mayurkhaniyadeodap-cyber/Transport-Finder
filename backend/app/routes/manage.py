"""Manage Transporters (Admin): every transporter, one row each, plus transporter-level Edit, Add,
Hide/Unhide, Delete and Restore. All of it is stored in the local overrides SQLite file only — never
the RDS/CSV/Excel data."""
from fastapi import APIRouter, Depends, HTTPException, Request

from ..config import settings
from ..schemas import (
    ManageListOut, TransporterAddIn, TransporterNameIn, TransporterSettingsIn, TransporterSettingsOut,
)
from ..services import activity, excel_search
from .auth import admin_only_router, client_ip
from .transport import _SOURCE_ERRORS, _excel_missing, FILE_SOURCES

# Admin only, checked on the server: 401 without a session, 403 for a User.
router = APIRouter(prefix="/manage", dependencies=[Depends(admin_only_router)])


def _require_file_source() -> None:
    if settings.data_source not in FILE_SOURCES:
        raise HTTPException(404, "Manage Transporters needs the RDS/CSV/Excel data source")


def _call(fn, *args, **kwargs):
    _require_file_source()
    try:
        return fn(*args, **kwargs)
    except _SOURCE_ERRORS as exc:
        raise _excel_missing(exc)
    except excel_search.TransporterConflict as exc:
        raise HTTPException(409, str(exc))
    except excel_search.InvalidTransporter as exc:
        raise HTTPException(422, str(exc))


def _update(transport_name: str, **fields) -> dict:
    if not transport_name.strip():
        raise HTTPException(422, "transport_name is required")
    row = _call(excel_search.update_transporter, transport_name, **fields)
    if row is None:
        raise HTTPException(404, f"transporter not found: {transport_name}")
    return row


@router.get("/transporters", response_model=ManageListOut)
def list_transporters():
    return _call(excel_search.manage_transporters)


@router.post("/transporters", response_model=TransporterSettingsOut)
def add_transporter(body: TransporterAddIn, who=Depends(admin_only_router), ip: str | None = Depends(client_ip)):
    out = _call(excel_search.add_transporter, body.transport_name, body.service_cities, body.pincodes,
                body.mobile, body.status)
    activity.record(who, "admin", "Transporter added", body.transport_name.strip(), ip=ip)
    return out


# Field names as the Edit form shows them, for the Activity Log.
_FIELD_LABELS = {
    "name": "name", "service_cities": "service cities", "pincodes": "pincodes", "status": "status",
    "mobile": "mobile", "hidden": "visibility", "shipment_charge": "shipment charge",
}


@router.patch("/transporters", response_model=TransporterSettingsOut)
def update_transporter(body: TransporterSettingsIn, who=Depends(admin_only_router), ip: str | None = Depends(client_ip)):
    out = _update(body.transport_name, name=body.name, service_cities=body.service_cities, pincodes=body.pincodes,
                  status=body.status, mobile=body.mobile, hidden=body.hidden,
                  shipment_charge=None if body.shipment_charge is None else str(body.shipment_charge))
    changed = [label for f, label in _FIELD_LABELS.items() if getattr(body, f) is not None]
    if changed == ["visibility"]:
        activity.record(who, "admin", "Transporter hidden" if body.hidden else "Transporter unhidden",
                        body.transport_name, ip=ip)
    else:
        detail = f"{body.transport_name}: {', '.join(changed) or 'no changes'}"
        if body.name:
            detail += f" (renamed to {body.name.strip()!r})"
        activity.record(who, "admin", "Transporter updated", detail, ip=ip)
    return out


@router.delete("/transporters", response_model=TransporterSettingsOut)
def delete_transporter(transport_name: str, who=Depends(admin_only_router), ip: str | None = Depends(client_ip)):
    out = _update(transport_name, deleted=True)
    activity.record(who, "admin", "Transporter deleted", transport_name, ip=ip)
    return out


@router.post("/transporters/restore", response_model=TransporterSettingsOut)
def restore_transporter(body: TransporterNameIn, who=Depends(admin_only_router), ip: str | None = Depends(client_ip)):
    out = _update(body.transport_name, deleted=False)
    activity.record(who, "admin", "Transporter restored", body.transport_name, ip=ip)
    return out


@router.post("/transporters/photo")
async def upload_photo(transport_name: str, request: Request, who=Depends(admin_only_router),
                       ip: str | None = Depends(client_ip)):
    """Upload/replace a transporter's profile photo: the raw image bytes as the request body
    (JPEG, PNG or WebP, max 2 MB). Stored in the local SQLite file only."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > excel_search.MAX_PHOTO_BYTES:
        raise HTTPException(413, "The photo must be 2 MB or smaller.")
    data = await request.body()
    photo_url = _call(excel_search.set_transporter_photo, transport_name, data)
    if photo_url is None:
        raise HTTPException(404, f"transporter not found: {transport_name}")
    activity.record(who, "admin", "Transporter photo uploaded", transport_name, ip=ip)
    return {"photo_url": photo_url}


@router.delete("/transporters/photo")
def remove_photo(transport_name: str, who=Depends(admin_only_router), ip: str | None = Depends(client_ip)):
    removed = _call(excel_search.remove_transporter_photo, transport_name)
    if removed is None:
        raise HTTPException(404, f"transporter not found: {transport_name}")
    if removed:
        activity.record(who, "admin", "Transporter photo removed", transport_name, ip=ip)
    return {"removed": removed}
