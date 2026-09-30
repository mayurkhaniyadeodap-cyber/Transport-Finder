"""Search over an (transport, pincode, city, state) index built from whichever source
`settings.data_source` names. Primary: the live read-only RDS ("rds"); if it is unreachable, this
falls back automatically to the VaCalvers CSV export ("vacalvers_csv") so search keeps working.
Also supports the older dispatch workbook ("excel"). Same priority as the DB search: exact pincode
-> city + state -> state. Only what the resolved source contains is returned; none of its other
columns (customer, address, price, ...) are read. Results are paginated.

One row per Transport Name, everywhere (pincode/city/state/city+state search, /api/transport/list,
and Transporter Management, which all funnel through this module): `dedupe_transport_rows()` below
is the single shared place this is enforced. A transporter serving several pincodes (whether in one
city or, for a state search, several) has those pincodes combined into a single comma-separated
field on one row, rather than one row per pincode. Grouping ignores case, spacing and punctuation
(so "TCI Express" / "tci  express" / "TCI-EXPRESS" collapse together, including a manually
overridden name typed with different spacing/case) but never merges genuinely different names.

Search (and autocomplete) return Active transporters only: a row whose status (transport_status.py,
then a per-row override, then an Admin's transporter-level setting) is Not Active is dropped before
matching, as is a transporter an Admin hid or deleted as a whole. Manage Transporters
(manage_transporters()) still lists them all so an Admin can manage them and set them back to Active.

Each result row also carries `service_cities`: every distinct city that transporter's real rows
cover India-wide (the same allowlisted data search uses; nothing invented).

A separate, unrelated filter applies: only transporters present in the courier_name column of
data/transporters.xlsx (transporter_filter.py) are returned — an app-side filter only, never
touching the source data.

Local manual overrides (Transporter Management, overrides_store.py) are layered on top last:
RDS real data -> local override -> combined result. A "hidden" override drops the row entirely; any
other override_* field replaces just that one displayed field, leaving the rest exactly as the
source has it. A "new transporter" override (no source row at all) is injected as its own row,
matched into pincode/city/state search the same way a real one would be. Nothing here ever writes
to the RDS/CSV/Excel source — only the local overrides SQLite file changes."""
import json
import logging
import math
import re
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlencode

from ..config import settings
from ..schemas import ManagedTransporterOut, SearchQuery, SearchResponse, TransportResult
from . import (
    branch_source, excel_source as src, overrides_store, rds_source, transport_status,
    transporter_filter, transporter_logos, transporter_synonyms, vacalvers_source,
)

CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"
logger = logging.getLogger(__name__)


def _resolve_source() -> str:
    """The source actually used for this request. RDS is tried first when configured as primary;
    if it's unavailable, falls back to the CSV automatically (logged, not surfaced as an error)."""
    if settings.data_source != "rds":
        return settings.data_source
    try:
        rds_source.get_index(CACHE_DIR, settings.rds_env_path, settings.rds_cache_ttl_seconds)
        return "rds"
    except rds_source.RdsUnavailable as exc:
        logger.warning("RDS unavailable (%s); falling back to the VaCalvers CSV.", exc)
        return "vacalvers_csv"


def _load_index(source: str) -> src.ExcelIndex:
    if source == "rds":
        return rds_source.get_index(CACHE_DIR, settings.rds_env_path, settings.rds_cache_ttl_seconds)
    if source == "vacalvers_csv":
        return vacalvers_source.get_index(settings.vacalvers_csv_path, CACHE_DIR)
    return src.get_index(settings.excel_path, CACHE_DIR)


def _contact_lookup(source: str):
    """Returns fn(transport, pincode, city, state) -> (contact_number, branch_name, address).
    RDS: a courier-name-keyed phone directory (courier_locations), unrelated to destination city.
    Excel/CSV: the existing VRL branch CSV (branch_source), matched by pincode then city+state."""
    if source == "rds":
        phonebook = rds_source.get_phonebook(CACHE_DIR, settings.rds_env_path, settings.rds_cache_ttl_seconds)

        def lookup(transport, pincode, city, state):
            return phonebook.get(src.key(transport)), None, None

        return lookup

    branches = branch_source.get_index(settings.branches_csv)

    def lookup(transport, pincode, city, state):
        b = branches.lookup(transport, pincode, city, state) if branches else None
        return (b.phones, b.name, b.address) if b else (None, None, None)

    return lookup


def _override_key(city: str | None, transport: str, pincode: str | None) -> tuple:
    return (src.key(city), transport, pincode)


def _load_overrides() -> dict[tuple, dict]:
    """One lookup, keyed by (city, transport, pincode) exactly like an Entry — for an edited
    existing row that's its original (source_*) identity; for a new transporter, its own
    override_* fields (there's no source row for it to key off)."""
    rows = overrides_store.list_overrides(Path(settings.overrides_db_path))
    out = {}
    for o in rows:
        if o["is_new"]:
            name = o.get("override_transport_name")
            if not name:
                continue
            key = _override_key(o.get("override_city"), name, o.get("override_pincode"))
        else:
            key = _override_key(o.get("source_city"), o.get("source_transport_name"), o.get("source_pincode"))
        out[key] = o
    return out


def _synthetic_entries(overrides: dict[tuple, dict]) -> list[src.Entry]:
    """New-transporter overrides, turned into ordinary Entry objects so they flow through search
    exactly like a real row would."""
    return [
        src.Entry(transport=o["override_transport_name"], pincode=o.get("override_pincode"),
                  city=o.get("override_city"), state=None, count=0, last_date=None)
        for o in overrides.values() if o["is_new"]
    ]


def _allowed(entries: list[src.Entry], overrides: dict[tuple, dict]) -> list[src.Entry]:
    """Drop every entry for a blocklisted courier or a locally-hidden row (app-side only; neither
    the source data nor, for a courier-list exclusion, anything is written anywhere). A manually
    added transporter (no source row) is never subject to the source-derived allowlist — it was
    added on purpose, so it's shown unless explicitly hidden.

    The allowlist check uses the entry's *canonical* name (transporter_synonyms), not its raw
    spelling: a misspelled variant like "Blueadart" is itself absent from transporters.xlsx (only
    "Bluedart" is listed), so checking the raw name would silently drop that entry's pincodes
    entirely instead of merging them into "Bluedart" later in dedupe_transport_rows(). The entry
    itself is left untouched here — only this allowlist decision uses the canonical name."""
    out = []
    for e in entries:
        o = overrides.get(_override_key(e.city, e.transport, e.pincode))
        if o and o["hidden"]:
            continue
        display_name = transporter_synonyms.canonical_name(e.transport)
        if not (o and o["is_new"]) and transporter_filter.is_excluded_transporter(display_name):
            continue
        out.append(e)
    return out


def _load_transporter_settings() -> dict[str, dict]:
    return overrides_store.list_transporter_settings(Path(settings.overrides_db_path))


def _statuses() -> transport_status.StatusTable:
    return transport_status.get_table(settings.transport_status_csv, settings.unlisted_transport_status)


def _entry_status(e: src.Entry, overrides: dict[tuple, dict], statuses) -> str:
    o = overrides.get(_override_key(e.city, e.transport, e.pincode))
    return (o and o.get("override_status")) or statuses.status_of(e.transport)


def _active_only(entries: list[src.Entry], overrides: dict[tuple, dict], tsettings: dict[str, dict],
                 statuses) -> list[src.Entry]:
    """Drops what a user must never find in search: a transporter an Admin hid or deleted as a
    whole, and any Not Active row (an Admin's transporter-level status wins over the row's own)."""
    out = []
    for e in entries:
        ts = tsettings.get(src.key(_resolved_display_name(e, overrides)))
        if ts and (ts["hidden"] or ts["deleted"]):
            continue
        status = (ts and ts["status"]) or _entry_status(e, overrides, statuses)
        if status != transport_status.NOT_ACTIVE:
            out.append(e)
    return out


def _overrides_signature(overrides: dict[tuple, dict]) -> str:
    # Full content, not updated_at: that has 1-second resolution, so two quick edits would collide.
    return json.dumps(sorted(overrides.values(), key=lambda o: o["id"]), sort_keys=True)


_groups_cache: dict = {}


def _transporter_groups(idx: src.ExcelIndex, overrides: dict[tuple, dict]) -> dict[str, dict]:
    """Every allowed transporter India-wide, keyed like dedupe_transport_rows() groups them:
    {key: {"name", "entries", "cities", "pincodes"}}. Cities/pincodes are what each row displays
    (per-row overrides applied), de-duplicated and sorted. Cached like _suggest_vocab(), and
    rebuilt when the index, a local override, the allowlist or the synonym table changes."""
    global _groups_cache
    signature = (
        _overrides_signature(overrides), transporter_filter.ALLOWED_TRANSPORTERS,
        transporter_filter.is_excluded_transporter, transporter_synonyms.canonical_name,
    )
    c = _groups_cache
    if c.get("entries") is idx.entries and c.get("signature") == signature:
        return c["groups"]

    groups: dict[str, dict] = {}
    for e in _allowed(idx.entries + _synthetic_entries(overrides), overrides):
        name = _resolved_display_name(e, overrides)
        g = groups.setdefault(src.key(name), {"name": name, "entries": [], "cities": {}, "pincodes": set()})
        g["entries"].append(e)
        o = overrides.get(_override_key(e.city, e.transport, e.pincode))
        city = (o and o.get("override_city")) or e.city
        pincode = (o and o.get("override_pincode")) or e.pincode
        if city:
            g["cities"].setdefault(src.key(city), city)
        if pincode:
            g["pincodes"].add(pincode)
    for g in groups.values():
        g["cities"] = sorted(g["cities"].values(), key=str.lower)
        g["pincodes"] = sorted(g["pincodes"])
    _groups_cache = {"entries": idx.entries, "signature": signature, "groups": groups}
    return groups


_locations_cache: dict = {}


def _locations(idx: src.ExcelIndex) -> tuple[dict, dict]:
    """From the real data: pincode -> (city, state), and city key -> state."""
    global _locations_cache
    c = _locations_cache
    if c.get("entries") is idx.entries:
        return c["pin"], c["city"]
    pin, city = {}, {}
    for e in idx.entries:
        if e.pincode and e.pincode not in pin:
            pin[e.pincode] = (e.city, e.state)
        if e.city and e.state:
            city.setdefault(src.key(e.city), e.state)
    _locations_cache = {"entries": idx.entries, "pin": pin, "city": city}
    return pin, city


_catalog_cache: dict = {}


def _catalog(idx: src.ExcelIndex, overrides: dict[tuple, dict], tsettings: dict[str, dict]) -> dict:
    """The real-data groups (_transporter_groups) with an Admin's transporter-level edits applied —
    what Search, suggestions and Manage Transporters all read:
      groups:     {key: {"name" (displayed), "base_name", "entries", "cities", "pincodes", "is_new"}}
      entries:    every entry, flat (city/state search);  by_pincode: pincode -> entries
      by_name:    match key of each displayed name -> group key (transporter-name search, actions)
    A rename only changes the displayed name. Edited Service Cities / Pincodes (or an Admin-added
    transporter) replace that transporter's real entries with generated ones: one per pincode
    (located in its real city/state, when the data knows it) and one per service city — so the
    edited lists are exactly what pincode/city/state search then matches. Hidden/deleted/status are
    applied later, by _active_only(). Cached; rebuilt when the groups or any setting change."""
    global _catalog_cache
    base = _transporter_groups(idx, overrides)
    signature = json.dumps(tsettings, sort_keys=True)
    c = _catalog_cache
    if c.get("base") is base and c.get("signature") == signature:
        return c["catalog"]

    pin_loc, city_state = _locations(idx)
    groups = {gk: {**g, "base_name": g["name"], "is_new": False} for gk, g in base.items()}
    for gk, ts in tsettings.items():
        g = groups.get(gk)
        if g is None and not ts["is_new"]:
            continue  # a setting for a transporter no longer in the data
        base_name = g["base_name"] if g else ts["transport_name"]
        display = ts["display_name"] or base_name
        if g is not None and ts["service_cities"] is None and ts["pincodes"] is None:
            groups[gk] = {**g, "name": display}
            continue
        cities = ts["service_cities"] if ts["service_cities"] is not None else (g["cities"] if g else [])
        pincodes = ts["pincodes"] if ts["pincodes"] is not None else (g["pincodes"] if g else [])
        entries = [src.Entry(base_name, p, *pin_loc.get(p, (None, None)), 0, None) for p in pincodes]
        entries += [src.Entry(base_name, None, city, city_state.get(src.key(city)), 0, None) for city in cities]
        groups[gk] = {
            "name": display, "base_name": base_name, "is_new": g is None,
            "entries": entries or [src.Entry(base_name, None, None, None, 0, None)],
            "cities": sorted(cities, key=str.lower), "pincodes": sorted(pincodes),
        }

    flat = [e for g in groups.values() for e in g["entries"]]
    by_pincode: dict[str, list[src.Entry]] = {}
    for e in flat:
        if e.pincode:
            by_pincode.setdefault(e.pincode, []).append(e)
    catalog = {
        "groups": groups, "entries": flat, "by_pincode": by_pincode,
        "by_name": {_transporter_key(g["name"]): gk for gk, g in groups.items()},
    }
    _catalog_cache = {"base": base, "signature": signature, "catalog": catalog}
    return catalog


def _clean(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def _row_for_entry(e: src.Entry, o: dict | None, contact_lookup, statuses) -> TransportResult:
    if o and o["is_new"]:
        contact_number, branch_name, address = None, None, None  # no source row to look these up on
    else:
        contact_number, branch_name, address = contact_lookup(e.transport, e.pincode, e.city, e.state)
    status = statuses.status_of(e.transport)
    override_id = None
    if o:
        override_id = o["id"]
        contact_number = o.get("override_mobile") or contact_number
        status = o.get("override_status") or status
    return TransportResult(
        transport_name=(o and o.get("override_transport_name")) or e.transport,
        city=(o and o.get("override_city")) or e.city,
        state=e.state,
        pincode=(o and o.get("override_pincode")) or e.pincode,
        contact_number=contact_number,
        branch_name=branch_name,
        address=address,
        status=status,
        override_id=override_id,
    )


def dedupe_transport_rows(rows: list[TransportResult]) -> list[TransportResult]:
    """The single place every search path (pincode, city, state, city+state, /list, Transporter
    Management) funnels through to guarantee one row per Transport Name. Two layers decide whether
    two rows are "the same" transporter:
      1. `excel_source.key()` — case/spacing/punctuation-insensitive — so "TCI Express",
         "tci  express" and "TCI-EXPRESS" collapse together.
      2. `transporter_synonyms.canonical_name()` — the approved India-wide spelling-variation audit
         (e.g. "Blueadart" -> "Bluedart", "Akash Roadways" -> "Aakash Roadways"), applied first so a
         known variant is grouped, and displayed, under its canonical name.
    Genuinely different names ("Kishan" / "Kishan Travels", "Patel Transport" / "Patel Transport
    Co") never merge under either layer. The first row encountered for a name is kept as the
    display row (its City/Mobile/Status don't vary by pincode for the same transporter), with its
    transport_name swapped to the canonical spelling if it was a known variant; every row's unique,
    non-blank pincodes are combined into that one row, sorted ascending, as a comma-separated
    string. Sorted by transporter name."""
    grouped: dict[str, TransportResult] = {}
    pincodes: dict[str, list[str]] = {}
    for row in rows:
        canonical = transporter_synonyms.canonical_name(row.transport_name)
        gk = src.key(canonical)
        if gk not in grouped:
            grouped[gk] = row if canonical == row.transport_name else row.model_copy(update={"transport_name": canonical})
            pincodes[gk] = []
        if row.pincode and row.pincode not in pincodes[gk]:
            pincodes[gk].append(row.pincode)

    combined = [
        row.model_copy(update={"pincode": ", ".join(sorted(pincodes[gk]))}) if pincodes[gk] else row
        for gk, row in grouped.items()
    ]
    return sorted(combined, key=lambda r: r.transport_name.lower())


def _official_logo(gk: str, groups: dict[str, dict]) -> dict | None:
    """The verified logo whose name is exactly this transporter's displayed name, or else exactly
    its original (pre-rename) name -- the same transporter either way. Never a similar name."""
    logos = transporter_logos.official_logos()
    g = groups.get(gk)
    return (logos.get(_transporter_key(g["name"])) if g else None) or logos.get(gk)


def _photo_versions(groups: dict[str, dict]) -> dict[str, tuple[str, str]]:
    """name_key -> (source, content hash) for every transporter with an image: a verified official
    logo (exact-name match only), with an Admin-uploaded photo taking precedence over it."""
    photos = {}
    if transporter_logos.official_logos():
        for gk in groups:
            logo = _official_logo(gk, groups)
            if logo:
                photos[gk] = ("official", logo["sha256"])
    photos.update({gk: ("admin", sha) for gk, sha in overrides_store.list_photo_versions(Path(settings.overrides_db_path)).items()})
    return photos


def _photo_url(gk: str, photos: dict[str, tuple[str, str]]) -> str | None:
    """Versioned by the image's content hash, so a changed photo gets a new URL (no stale cache)."""
    found = photos.get(gk)
    return f"/api/transport/photo?{urlencode({'key': gk, 'v': found[1][:16]})}" if found else None


def _photo_source(gk: str, photos: dict[str, tuple[str, str]]) -> str | None:
    found = photos.get(gk)
    return found[0] if found else None


def _with_transporter_details(row: TransportResult, tsettings: dict[str, dict], groups: dict[str, dict],
                              photos: dict[str, tuple[str, str]]) -> TransportResult:
    """An Admin's transporter-level Name/Status/Mobile (if set) over the row's own, plus the
    transporter's service cities and profile photo."""
    gk = src.key(row.transport_name)  # already canonical after dedupe_transport_rows
    ts = tsettings.get(gk) or {}
    g = groups.get(gk)
    return row.model_copy(update={
        "transport_name": g["name"] if g else row.transport_name,
        "status": ts.get("status") or row.status,
        "contact_number": ts.get("mobile") or row.contact_number,
        "shipment_charge": ts.get("shipment_charge") or None,
        "service_cities": g["cities"] if g else ([row.city] if row.city else []),
        "photo_url": _photo_url(gk, photos),
        "photo_source": _photo_source(gk, photos),
    })


def _rows(
    entries: list[src.Entry], source: str, page: int, page_size: int, overrides: dict[tuple, dict],
    tsettings: dict[str, dict], groups: dict[str, dict],
) -> tuple[list[TransportResult], int]:
    """Builds a TransportResult for every matching entry, then deduplicates to one row per
    Transport Name (see dedupe_transport_rows) before paginating, so total/page/total_pages
    describe the deduplicated result set, not the raw per-pincode rows."""
    merged: dict[tuple, src.Entry] = {}
    for e in entries:
        merged.setdefault((src.key(e.city), e.transport, e.pincode), e)
    unique_entries = sorted(
        merged.values(),
        key=lambda e: (e.city is None, (e.city or "").lower(), e.transport.lower(), e.pincode or ""),
    )[: settings.excel_max_rows]  # safety ceiling on one search's total match count

    contact_lookup = _contact_lookup(source)
    statuses = _statuses()

    rows = [
        _row_for_entry(e, overrides.get(_override_key(e.city, e.transport, e.pincode)), contact_lookup, statuses)
        for e in unique_entries
    ]
    photos = _photo_versions(groups)
    ordered = sorted(  # re-sorted: an Admin rename can change a row's place
        (_with_transporter_details(r, tsettings, groups, photos) for r in dedupe_transport_rows(rows)),
        key=lambda r: r.transport_name.lower(),
    )
    total = len(ordered)

    start = (page - 1) * page_size
    return ordered[start : start + page_size], total


def _response(echo: SearchQuery, level: str, entries: list[src.Entry], source: str, page: int, page_size: int,
              overrides: dict[tuple, dict], tsettings: dict[str, dict], groups: dict[str, dict]) -> SearchResponse:
    rows, total = _rows(entries, source, page, page_size, overrides, tsettings, groups)
    total_pages = math.ceil(total / page_size) if total else 0
    return SearchResponse(
        search=echo, match_level=level, results=rows,
        total=total, page=page, page_size=page_size, total_pages=total_pages,
    )


def search_transport(query: SearchQuery, page: int = 1, page_size: int | None = None) -> SearchResponse:
    page = max(1, page)
    page_size = max(1, min(page_size or settings.default_page_size, settings.max_page_size))
    pincode, city, state = _clean(query.pincode), _clean(query.city), _clean(query.state)
    transport_name = _clean(query.transport_name)
    echo = SearchQuery(pincode=pincode, city=city, state=state, transport_name=transport_name)
    empty = dict(total=0, page=page, page_size=page_size, total_pages=0)

    if not (pincode or city or state or transport_name):
        return SearchResponse(search=echo, message="Enter a pincode, city, state or transporter name.", results=[], **empty)
    if pincode and not re.fullmatch(r"\d{6}", pincode):
        return SearchResponse(search=echo, message="Pincode must be 6 digits.", results=[], **empty)

    source = _resolve_source()
    idx = _load_index(source)
    overrides = _load_overrides()
    tsettings = _load_transporter_settings()
    statuses = _statuses()
    # Already allowlisted, with local overrides and Admin edits applied; the cached index is untouched.
    cat = _catalog(idx, overrides, tsettings)
    groups = cat["groups"]

    def respond(level: str, rows: list[src.Entry]) -> SearchResponse:
        return _response(echo, level, rows, source, page, page_size, overrides, tsettings, groups)

    def active(entries: list[src.Entry]) -> list[src.Entry]:
        return _active_only(entries, overrides, tsettings, statuses)

    if transport_name:
        # Matches the displayed (override/Admin rename + synonym-canonicalised) name, so searching
        # a known variant spelling finds its canonical transporter too, already merged.
        gk = cat["by_name"].get(_transporter_key(transport_name))
        rows = active(groups[gk]["entries"]) if gk else []
        if rows:
            return respond("transporter", rows)

    if pincode:
        rows = active(cat["by_pincode"].get(pincode, []))
        if rows:
            return respond("pincode", rows)

    if city:
        ck = src.key(city)
        sk = src.key(state) if state else None
        rows = active([
            e for e in cat["entries"]
            if e.city and src.key(e.city) == ck and (sk is None or (e.state and src.key(e.state) == sk))
        ])
        if rows:
            return respond("city_state", rows)

    if state:
        sk = src.key(state)
        rows = active([e for e in cat["entries"] if e.state and src.key(e.state) == sk])
        if rows:
            return respond("state", rows)

    return SearchResponse(search=echo, message="No transporters found for this search.", results=[], **empty)


def _resolved_display_name(e: src.Entry, overrides: dict[tuple, dict]) -> str:
    """The name this entry would actually display as: an override rename if one applies, then
    canonicalised through the synonym table — the same identity dedupe_transport_rows() groups by."""
    o = overrides.get(_override_key(e.city, e.transport, e.pincode))
    name = (o and o.get("override_transport_name")) or e.transport
    return transporter_synonyms.canonical_name(name)


def list_transporters() -> list[str]:
    """Every allowed transporter name, Active and Not Active, except any an Admin hid or deleted."""
    idx = _load_index(_resolve_source())
    overrides = _load_overrides()
    tsettings = _load_transporter_settings()
    return sorted(
        g["name"] for gk, g in _catalog(idx, overrides, tsettings)["groups"].items()
        if not (tsettings.get(gk, {}).get("hidden") or tsettings.get(gk, {}).get("deleted"))
    )


def _transporter_key(name: str) -> str:
    return src.key(transporter_synonyms.canonical_name(name))


class InvalidTransporter(ValueError):
    """Bad input for an Admin edit/add (answered 422)."""


class TransporterConflict(ValueError):
    """The name is already used by another transporter (answered 409)."""


def _clean_list(values: list[str] | None, *, pincodes: bool = False) -> list[str] | None:
    if values is None:
        return None
    out: dict[str, str] = {}
    for v in values:
        v = " ".join((v or "").split())
        if v:
            out.setdefault(v if pincodes else src.key(v), v)
    cleaned = list(out.values())
    if pincodes:
        bad = [p for p in cleaned if not re.fullmatch(r"\d{6}", p)]
        if bad:
            raise InvalidTransporter(f"Pincodes must be 6 digits: {', '.join(bad)}")
    return cleaned


def manage_transporters() -> dict:
    """Manage Transporters: every allowed transporter (Active, Not Active and hidden alike, plus any
    an Admin added), one row each, with its service cities and pincodes. Mobile and Status come from
    the same per-row logic search uses (its first row, in search's own order), with an Admin's
    transporter-level setting on top. Deleted transporters are listed separately so they can be
    restored."""
    source = _resolve_source()
    idx = _load_index(source)
    overrides = _load_overrides()
    tsettings = _load_transporter_settings()
    statuses = _statuses()
    contact_lookup = _contact_lookup(source)
    groups = _catalog(idx, overrides, tsettings)["groups"]
    photos = _photo_versions(groups)

    def order(e: src.Entry):
        return (e.city is None, (e.city or "").lower(), e.transport.lower(), e.pincode or "")

    items, deleted = [], []
    for gk, g in groups.items():
        ts = tsettings.get(gk) or {}
        if ts.get("deleted"):
            deleted.append(g["name"])
            continue
        first = min(g["entries"], key=order)
        row = _row_for_entry(first, overrides.get(_override_key(first.city, first.transport, first.pincode)),
                             contact_lookup, statuses)
        any_active = any(_entry_status(e, overrides, statuses) != transport_status.NOT_ACTIVE for e in g["entries"])
        items.append(ManagedTransporterOut(
            transport_name=g["name"],
            service_cities=g["cities"],
            pincodes=g["pincodes"],
            mobile=ts.get("mobile") or row.contact_number,
            shipment_charge=ts.get("shipment_charge") or None,
            status=ts.get("status") or (transport_status.ACTIVE if any_active else transport_status.NOT_ACTIVE),
            hidden=bool(ts.get("hidden")),
            added_locally=g["is_new"] or all(
                (overrides.get(_override_key(e.city, e.transport, e.pincode)) or {}).get("is_new") for e in g["entries"]
            ),
            edited=not g["is_new"] and any(
                ts.get(f) not in (None, "") for f in ("status", "mobile", "display_name", "service_cities", "pincodes", "shipment_charge")
            ),
            photo_url=_photo_url(gk, photos),
            photo_source=_photo_source(gk, photos),
        ))
    items.sort(key=lambda t: t.transport_name.lower())
    return {"results": items, "total": len(items), "deleted": sorted(deleted, key=str.lower)}


MAX_SHIPMENT_CHARGE = Decimal("1000000")


def normalize_shipment_charge(value: str) -> str:
    """An Admin-entered approx. charge per box in rupees: "" (clear it) or a non-negative amount with
    up to 2 decimals, e.g. "45", "75.50", "₹120". Stored as "45" / "75.50" / "120" -- never
    calculated from order or RDS data."""
    text = str(value).strip().replace("₹", "").replace(",", "").strip()
    if not text:
        return ""
    if not re.fullmatch(r"\d+(\.\d{1,2})?", text):
        raise InvalidTransporter("Approx. Shipment Charge / 1 Box must be an amount in rupees with up to 2 decimals, e.g. 45 or 75.50.")
    amount = Decimal(text)
    if amount > MAX_SHIPMENT_CHARGE:
        raise InvalidTransporter("Approx. Shipment Charge / 1 Box looks too large.")
    return str(int(amount)) if amount == amount.to_integral_value() else f"{amount:.2f}"


def update_transporter(transport_name: str, *, name: str | None = None, service_cities: list[str] | None = None,
                       pincodes: list[str] | None = None, shipment_charge: str | None = None, **fields) -> dict | None:
    """Admin edit of a whole transporter, found by its displayed name: rename, Service Cities,
    Pincodes, and status/mobile/hidden/deleted. Stored locally only. Returns None if no such
    transporter exists (in the data, among Admin-added ones, or among deleted ones to restore)."""
    idx = _load_index(_resolve_source())
    overrides = _load_overrides()
    tsettings = _load_transporter_settings()
    cat = _catalog(idx, overrides, tsettings)
    gk = cat["by_name"].get(_transporter_key(transport_name))
    g = cat["groups"].get(gk) if gk else None
    if g is None:
        return None

    changes = dict(fields)
    if name is not None:
        name = " ".join(name.split())
        if not name:
            raise InvalidTransporter("Transporter Name cannot be empty.")
        other = cat["by_name"].get(_transporter_key(name))
        if other is not None and other != gk:
            raise TransporterConflict(f'Another transporter is already named "{cat["groups"][other]["name"]}".')
        changes["display_name"] = "" if name == g["base_name"] else name
    if service_cities is not None:
        changes["service_cities"] = _clean_list(service_cities)
    if pincodes is not None:
        changes["pincodes"] = _clean_list(pincodes, pincodes=True)
    if shipment_charge is not None:
        changes["shipment_charge"] = normalize_shipment_charge(shipment_charge)
    return overrides_store.set_transporter_settings(Path(settings.overrides_db_path), gk, g["base_name"], **changes)


def add_transporter(name: str, service_cities: list[str], pincodes: list[str], mobile: str | None = None,
                    status: str | None = None) -> dict:
    """A brand-new transporter an Admin adds, with no real rows: its own name, Service Cities and
    Pincodes are its full definition (searchable by any of them). Exempt from the allowlist, like a
    row-level added transporter. Stored locally only."""
    name = " ".join((name or "").split())
    if not name:
        raise InvalidTransporter("Transporter Name is required.")
    cities = _clean_list(service_cities)
    pins = _clean_list(pincodes, pincodes=True)
    idx = _load_index(_resolve_source())
    overrides = _load_overrides()
    tsettings = _load_transporter_settings()
    cat = _catalog(idx, overrides, tsettings)
    gk = _transporter_key(name)
    existing = cat["by_name"].get(gk) or (gk if gk in cat["groups"] or gk in tsettings else None)
    if existing is not None:
        shown = cat["groups"][existing]["name"] if existing in cat["groups"] else tsettings[existing]["transport_name"]
        raise TransporterConflict(f'"{shown}" already exists — edit it instead.')
    return overrides_store.set_transporter_settings(
        Path(settings.overrides_db_path), gk, name, is_new=True, service_cities=cities, pincodes=pins,
        mobile=(mobile or "").strip() or None, status=status or transport_status.ACTIVE, hidden=False, deleted=False,
    )


MAX_PHOTO_BYTES = 2 * 1024 * 1024


# The image type from the file's own leading bytes -- never trusted from the upload's Content-Type
# header -- so only a real JPEG/PNG/WebP is ever stored and served back (no SVG or HTML that a
# browser could execute). Shared with the official-logo loader.
detect_image_type = transporter_logos.detect_image_type


def _existing_transporter_key(transport_name: str) -> str | None:
    idx = _load_index(_resolve_source())
    cat = _catalog(idx, _load_overrides(), _load_transporter_settings())
    return cat["by_name"].get(_transporter_key(transport_name))


def set_transporter_photo(transport_name: str, data: bytes) -> str | None:
    """Admin upload of a transporter's profile photo (stored locally in SQLite only). Returns the
    new photo URL, or None if there's no such transporter."""
    if not data:
        raise InvalidTransporter("The photo file is empty.")
    if len(data) > MAX_PHOTO_BYTES:
        raise InvalidTransporter("The photo must be 2 MB or smaller.")
    content_type = detect_image_type(data)
    if content_type is None:
        raise InvalidTransporter("The photo must be a JPEG, PNG or WebP image.")
    gk = _existing_transporter_key(transport_name)
    if gk is None:
        return None
    version = overrides_store.set_photo(Path(settings.overrides_db_path), gk, content_type, data)
    return _photo_url(gk, {gk: ("admin", version)})


def remove_transporter_photo(transport_name: str) -> bool | None:
    """True if a photo was removed, False if it had none, None if there's no such transporter.
    A verified official logo (if any) shows again once the Admin's photo is removed."""
    gk = _existing_transporter_key(transport_name)
    if gk is None:
        return None
    return overrides_store.delete_photo(Path(settings.overrides_db_path), gk)


def get_transporter_photo(name_key: str) -> tuple[str, bytes] | None:
    """The image to serve: the Admin's uploaded photo, else the verified official logo, else None."""
    found = overrides_store.get_photo(Path(settings.overrides_db_path), name_key)
    if found is not None:
        return found
    if not transporter_logos.official_logos():
        return None
    groups = _catalog(_load_index(_resolve_source()), _load_overrides(), _load_transporter_settings())["groups"]
    logo = _official_logo(name_key, groups) if name_key in groups else None
    return (logo["content_type"], logo["data"]) if logo else None


_suggest_cache: dict = {}


def _suggest_vocab() -> dict[str, list]:
    """Every distinct pincode/city/state/transporter name a search could currently return, each
    paired with its match key. Filtering the full India-wide index through the allowlist takes
    ~1s, far too slow to redo per keystroke, so this is cached — and rebuilt as soon as anything it
    depends on changes: the catalog (itself rebuilt when the index, a local override, an Admin
    setting, the allowlist or the synonym table changes) or the status table. Uses the exact same
    filtering every search uses (allowlist, hidden, Active only), so it never suggests anything a
    search wouldn't return."""
    global _suggest_cache
    source = _resolve_source()
    idx = _load_index(source)
    overrides = _load_overrides()
    tsettings = _load_transporter_settings()
    statuses = _statuses()
    cat = _catalog(idx, overrides, tsettings)
    c = _suggest_cache
    if c.get("catalog") is cat and c.get("statuses") is statuses:
        return c["vocab"]

    entries = _active_only(cat["entries"], overrides, tsettings, statuses)
    names: dict[str, str] = {}
    for e in entries:
        g = cat["groups"].get(src.key(_resolved_display_name(e, overrides)))
        if g:
            names.setdefault(src.key(g["name"]), g["name"])

    def keyed(values):
        return sorted(((src.key(v), v) for v in values), key=lambda kv: kv[1])

    vocab = {
        "pincode": sorted({e.pincode for e in entries if e.pincode}),
        "city": keyed({e.city for e in entries if e.city}),
        "state": keyed({e.state for e in entries if e.state}),
        "transporter": sorted(((k, v) for k, v in names.items()), key=lambda kv: kv[1]),
    }
    _suggest_cache = {"catalog": cat, "statuses": statuses, "vocab": vocab}
    return vocab


def suggest(q: str, limit: int = 10, per_type: int = 5) -> list[dict]:
    """Autocomplete suggestions for the unified search box, each tagged with its type (pincode,
    city, state or transporter). Built entirely from the same already-loaded, already-allowlisted
    entries every search already uses — no new RDS query, and no change to search, dedupe, synonym,
    Mobile or Status logic. A pincode/city/state is only suggested if it would actually return rows
    (i.e. it survives the same allowlist filter search does), so a suggestion never leads to an
    empty result. Prefix match only, case/spacing-insensitive for city/state/transporter."""
    q = _clean(q)
    if not q:
        return []
    qk = src.key(q)
    v = _suggest_vocab()

    pincodes = [p for p in v["pincode"] if p.startswith(q)]
    cities = [d for k, d in v["city"] if k.startswith(qk)]
    states = [d for k, d in v["state"] if k.startswith(qk)]
    names = [d for k, d in v["transporter"] if k.startswith(qk)]

    out = [{"type": "pincode", "value": x} for x in pincodes[:per_type]]
    out += [{"type": "city", "value": x} for x in cities[:per_type]]
    out += [{"type": "state", "value": x} for x in states[:per_type]]
    out += [{"type": "transporter", "value": x} for x in names[:per_type]]
    return out[:limit]
