from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..schemas import SearchQuery, SearchResponse, SuggestionOut
from ..services import excel_search
from ..services.rds_source import RdsUnavailable
from ..services.transport_status import StatusConfigError
from ..services import search as search_service

router = APIRouter(prefix="/transport")

FILE_SOURCES = ("excel", "vacalvers_csv", "rds")
# RdsUnavailable reaches here only if the CSV fallback also failed (excel_search falls back to it
# automatically otherwise) — a real "no source is reachable" condition.
_SOURCE_ERRORS = (FileNotFoundError, StatusConfigError, RdsUnavailable)


def _excel_missing(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=str(exc))


@router.get("/search", response_model=SearchResponse)
def search(
    pincode: str | None = None,
    city: str | None = None,
    state: str | None = None,
    transport_name: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = SearchQuery(pincode=pincode, city=city, state=state, transport_name=transport_name)
    if settings.data_source in FILE_SOURCES:
        try:
            return excel_search.search_transport(query, page=page, page_size=page_size)
        except _SOURCE_ERRORS as exc:
            raise _excel_missing(exc)
    return search_service.search_transport(db, query)


@router.get("/list", response_model=list[str])
def list_transporters(db: Session = Depends(get_db)):
    if settings.data_source in FILE_SOURCES:
        try:
            return excel_search.list_transporters()
        except _SOURCE_ERRORS as exc:
            raise _excel_missing(exc)
    return search_service.list_transporters(db)


@router.get("/photo")
def photo(key: str, v: str | None = None):
    """A transporter's profile photo (viewable by every role). `v` is only a cache-buster: the URL
    changes whenever the photo does, so the image can be cached for good."""
    found = excel_search.get_transporter_photo(key)
    if found is None:
        raise HTTPException(404, "no photo")
    content_type, data = found
    return Response(content=data, media_type=content_type, headers={
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    })


@router.get("/suggest", response_model=list[SuggestionOut])
def suggest(q: str = "", limit: int = Query(10, ge=1, le=25)):
    """Autocomplete suggestions for the unified search box. File sources only (same as the rest of
    Transport Finder's live search) — the optional MySQL `db` path doesn't implement this."""
    if settings.data_source not in FILE_SOURCES:
        return []
    try:
        return excel_search.suggest(q, limit=limit)
    except _SOURCE_ERRORS as exc:
        raise _excel_missing(exc)
