import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import TransportBranch, TransportPincode
from ..schemas import SearchQuery, SearchResponse, TransportResult


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _key(value: str | None) -> str:
    """Case/punctuation-insensitive comparison key ('NEW_DELHI' == 'New Delhi')."""
    return re.sub(r"[\s_\-]+", " ", (value or "")).strip().lower()


def _eq(column, value: str):
    # Compare on a normalised column so underscores/case differences still match.
    return func.lower(func.replace(column, "_", " ")) == _key(value)


def _fetch(db: Session, pincode: str | None, city: str | None, state: str | None):
    limit = settings.max_results
    pin_q = select(TransportPincode)
    br_q = select(TransportBranch)
    if pincode:
        pin_q = pin_q.where(TransportPincode.pincode == pincode)
        br_q = br_q.where(TransportBranch.pincode == pincode)
    else:
        if city:
            pin_q = pin_q.where(_eq(TransportPincode.city, city))
            br_q = br_q.where(_eq(TransportBranch.city, city))
        if state:
            pin_q = pin_q.where(_eq(TransportPincode.state, state))
            br_q = br_q.where(_eq(TransportBranch.state, state))
    pin_rows = db.scalars(pin_q.order_by(TransportPincode.transport_name, TransportPincode.pincode).limit(limit)).all()
    br_rows = db.scalars(br_q.order_by(TransportBranch.transport_name, TransportBranch.branch_name).limit(limit)).all()
    return list(pin_rows), list(br_rows)


def _merge(db: Session, pin_rows, br_rows) -> list[TransportResult]:
    """Combine serviceability rows with branch rows. Never infers one from the other."""
    branches = list(br_rows)

    # Pull in branches referenced by serviceability rows but not matched by the query itself.
    known = {b.id for b in branches}
    names = {p.branch_name for p in pin_rows if p.branch_name}
    if names:
        extra = db.scalars(select(TransportBranch).where(TransportBranch.branch_name.in_(names))).all()
        branches.extend(b for b in extra if b.id not in known)

    by_name: dict[tuple[str, str], list[TransportBranch]] = {}
    for b in branches:
        by_name.setdefault((_key(b.transport_name), _key(b.branch_name)), []).append(b)

    used: set[int] = set()
    out: list[TransportResult] = []

    for p in pin_rows:
        candidates = by_name.get((_key(p.transport_name), _key(p.branch_name)), [])
        # prefer the branch record for the same pincode, else any record for that branch
        b = next((c for c in candidates if c.pincode == p.pincode), candidates[0] if candidates else None)
        if b:
            used.add(b.id)
        out.append(
            TransportResult(
                transport_name=p.transport_name,
                branch_name=p.branch_name or (b.branch_name if b else None) or None,
                location=p.location,
                city=p.city,
                state=p.state,
                pincode=p.pincode,
                serviceability=p.pincode_type,
                documents_required=p.documents_required,
                surface_delivery=p.surface_delivery,
                air_delivery=p.air_delivery,
                rail_delivery=p.rail_delivery,
                branch_type=b.branch_type if b else None,
                godown_name=b.godown_name if b else None,
                contact_number=b.contact_number if b else None,
                alternate_contact=b.alternate_contact if b else None,
                address=b.address if b else None,
                source_url=p.source_url,
                last_updated=p.last_updated,
            )
        )

    # Branches with no serviceability row: shown, but serviceability stays unknown (None).
    for b in br_rows:
        if b.id in used:
            continue
        out.append(
            TransportResult(
                transport_name=b.transport_name,
                branch_name=b.branch_name or None,
                city=b.city,
                state=b.state,
                pincode=b.pincode or None,
                branch_type=b.branch_type,
                godown_name=b.godown_name,
                contact_number=b.contact_number,
                alternate_contact=b.alternate_contact,
                address=b.address,
                source_url=b.source_url,
                last_updated=b.last_updated,
            )
        )
    return out


def search_transport(db: Session, query: SearchQuery) -> SearchResponse:
    pincode = _clean(query.pincode)
    city = _clean(query.city)
    state = _clean(query.state)
    echo = SearchQuery(pincode=pincode, city=city, state=state)

    if not (pincode or city or state):
        return SearchResponse(search=echo, message="Enter a pincode, city or state.", results=[], total_pages=0)
    if pincode and not re.fullmatch(r"\d{6}", pincode):
        return SearchResponse(search=echo, message="Pincode must be 6 digits.", results=[], total_pages=0)

    # Priority: exact pincode -> city + state -> state
    steps: list[tuple[str, tuple[str | None, str | None, str | None]]] = []
    if pincode:
        steps.append(("pincode", (pincode, None, None)))
    if city:
        steps.append(("city_state", (None, city, state)))
    if state:
        steps.append(("state", (None, None, state)))

    for level, (pin, c, s) in steps:
        pin_rows, br_rows = _fetch(db, pin, c, s)
        results = _merge(db, pin_rows, br_rows)
        if results:
            # This path (data_source="db") has no pagination of its own; report the whole result
            # set as a single page for consistency with the SearchResponse contract.
            return SearchResponse(
                search=echo, match_level=level, results=results,
                total=len(results), page=1, page_size=max(len(results), 1), total_pages=1,
            )

    return SearchResponse(search=echo, message="No transporters found for this search.", results=[], total_pages=0)


def list_transporters(db: Session) -> list[str]:
    names = set(db.scalars(select(TransportPincode.transport_name).distinct()).all())
    names |= set(db.scalars(select(TransportBranch.transport_name).distinct()).all())
    return sorted(names)
