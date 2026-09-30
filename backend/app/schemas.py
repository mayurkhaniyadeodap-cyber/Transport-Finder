from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class SearchQuery(BaseModel):
    pincode: str | None = None
    city: str | None = None
    state: str | None = None
    transport_name: str | None = None


class TransportResult(BaseModel):
    transport_name: str
    branch_name: str | None = None
    location: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    serviceability: str | None = None  # from source pincode_type; None if unknown
    documents_required: str | None = None
    surface_delivery: bool | None = None
    air_delivery: bool | None = None
    rail_delivery: bool | None = None
    branch_type: str | None = None
    godown_name: str | None = None
    contact_number: str | None = None
    alternate_contact: str | None = None
    address: str | None = None
    source_url: str | None = None
    last_updated: datetime | None = None
    status: str | None = None  # transporter status from the transport master (Active or Not Active)
    override_id: int | None = None  # set if a local manual override applies to this row (see /api/overrides)
    service_cities: list[str] = Field(default_factory=list)  # every city this transporter's real rows cover
    photo_url: str | None = None  # the transporter's image: an Admin-uploaded photo, else a verified official logo
    photo_source: str | None = None  # "admin" | "official" | None (no verified image)
    shipment_charge: str | None = None  # Admin-entered approx. charge per box in rupees ("75.50"); None = not set


class SearchResponse(BaseModel):
    search: SearchQuery
    match_level: str | None = None  # "pincode" | "city_state" | "state" | "transporter" | None
    message: str | None = None
    results: list[TransportResult]  # current page only
    total: int = 0  # total matches across all pages
    page: int = 1
    page_size: int = 50
    total_pages: int = 1


class SuggestionOut(BaseModel):
    type: str  # "pincode" | "city" | "state" | "transporter"
    value: str


VALID_STATUSES = {"Active", "Not Active"}


def _check_status(v: str | None) -> str | None:
    if v is not None and v not in VALID_STATUSES:
        raise ValueError(f"status must be 'Active' or 'Not Active', got {v!r}")
    return v


class ExistingRowOverrideIn(BaseModel):
    """Edit (or first override of) a row that came from the real source, identified by exactly what
    that row currently shows — the same (city, transport, pincode) excel_search.py already keys on."""
    source_city: str | None = None
    source_transport_name: str
    source_pincode: str | None = None
    transport_name: str | None = None
    city: str | None = None
    pincode: str | None = None
    mobile: str | None = None
    status: str | None = None
    hidden: bool | None = None

    _validate_status = field_validator("status")(_check_status)


class NewTransporterIn(BaseModel):
    transport_name: str
    city: str | None = None
    pincode: str | None = None
    mobile: str | None = None
    status: str | None = None

    _validate_status = field_validator("status")(_check_status)


class OverrideUpdateIn(BaseModel):
    """Partial update of an existing override record (either kind) by its id."""
    transport_name: str | None = None
    city: str | None = None
    pincode: str | None = None
    mobile: str | None = None
    status: str | None = None
    hidden: bool | None = None

    _validate_status = field_validator("status")(_check_status)


class ManagedTransporterOut(BaseModel):
    transport_name: str
    service_cities: list[str]
    pincodes: list[str]
    mobile: str | None = None
    status: str
    hidden: bool
    added_locally: bool  # every row is a locally added transporter (no real source row)
    edited: bool  # an Admin set its Status or Mobile at transporter level
    photo_url: str | None = None
    photo_source: str | None = None  # "admin" | "official" | None
    shipment_charge: str | None = None  # approx. charge per box in rupees, set by an Admin


class ManageListOut(BaseModel):
    results: list[ManagedTransporterOut]
    total: int
    deleted: list[str]  # names of deleted transporters, restorable


class TransporterSettingsIn(BaseModel):
    """Admin edit of a whole transporter, found by its current displayed `transport_name`.
    A field left out (None) is unchanged. `service_cities`/`pincodes` replace the whole list."""
    transport_name: str
    name: str | None = None  # new displayed name
    service_cities: list[str] | None = None
    pincodes: list[str] | None = None
    status: str | None = None
    mobile: str | None = None
    hidden: bool | None = None
    shipment_charge: str | float | None = None  # rupees per box, up to 2 decimals; "" clears it

    _validate_status = field_validator("status")(_check_status)


class TransporterAddIn(BaseModel):
    transport_name: str
    service_cities: list[str] = Field(default_factory=list)
    pincodes: list[str] = Field(default_factory=list)
    mobile: str | None = None
    status: str | None = None

    _validate_status = field_validator("status")(_check_status)


class TransporterNameIn(BaseModel):
    transport_name: str


class TransporterSettingsOut(BaseModel):
    transport_name: str  # the name the settings are keyed by (never changes)
    display_name: str | None = None  # an Admin rename, if any
    service_cities: list[str] | None = None  # None = real data
    pincodes: list[str] | None = None  # None = real data
    is_new: bool = False
    status: str | None = None
    mobile: str | None = None
    shipment_charge: str | None = None
    hidden: bool
    deleted: bool
    updated_at: str


class OverrideOut(BaseModel):
    id: int
    is_new: bool
    source_city: str | None = None
    source_transport_name: str | None = None
    source_pincode: str | None = None
    override_transport_name: str | None = None
    override_city: str | None = None
    override_pincode: str | None = None
    override_mobile: str | None = None
    override_status: str | None = None
    hidden: bool
    created_at: str
    updated_at: str
