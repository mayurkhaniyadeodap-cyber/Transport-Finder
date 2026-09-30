"""Normalisation helpers shared by every importer."""
import re

_TRANSPORT_ALIASES = {
    "tci": "TCI Express",
    "tci express": "TCI Express",
    "vrl": "VRL Logistics",
    "vrl logistics": "VRL Logistics",
}

_TRUE = {"yes", "y", "true", "1", "available"}
_FALSE = {"no", "n", "false", "0", "not available"}


def _blank(value) -> bool:
    return value is None or str(value).strip().lower() in {"", "nan", "none", "null", "na", "n/a", "-"}


def _title(value) -> str | None:
    """'new_delhi' / 'NEW DELHI' / 'new delhi' -> 'New Delhi'."""
    if _blank(value):
        return None
    text = re.sub(r"[_\s]+", " ", str(value)).strip()
    return text.title()


def normalize_city(value) -> str | None:
    return _title(value)


def normalize_state(value) -> str | None:
    return _title(value)


def normalize_district(value) -> str | None:
    return _title(value)


def normalize_pincode(value) -> str | None:
    """Return a 6-digit pincode string, or None if invalid. Always a string."""
    if _blank(value):
        return None
    text = str(value).strip()
    if re.fullmatch(r"\d+\.0", text):  # Excel/pandas float artefact
        text = text[:-2]
    return text if re.fullmatch(r"\d{6}", text) else None


def normalize_transport_name(value) -> str | None:
    if _blank(value):
        return None
    key = re.sub(r"\s+", " ", str(value)).strip().lower()
    return _TRANSPORT_ALIASES.get(key, _title(value))


def normalize_bool(value) -> bool | None:
    """Yes/No -> bool; blank/unknown -> None (never guess)."""
    if isinstance(value, bool):
        return value
    if _blank(value):
        return None
    key = str(value).strip().lower()
    if key in _TRUE:
        return True
    if key in _FALSE:
        return False
    return None


def clean_text(value) -> str | None:
    return None if _blank(value) else re.sub(r"\s+", " ", str(value)).strip()


def normalize_branch_name(value) -> str:
    """Branch names are kept as the source spells them (e.g. 'XPHJ-PAHARGANJ'); only trimmed."""
    return clean_text(value) or ""
