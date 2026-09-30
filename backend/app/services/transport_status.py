"""Transport master/status: which transporters are Active or Not Active.

Source: a CSV (default `data/transport_status.csv`) with columns `transport_name,status`.
Status must be exactly "Active" or "Not Active" (case/spacing-insensitive). Lines starting with # are comments.

Rules:
- Names are matched exactly after normalising case, spaces and punctuation. Nothing fuzzy:
  "DTDC" and "DTDC Transport" are different transporters and need their own row.
- A transporter with NO row is treated as `settings.unlisted_transport_status` (default "Active"),
  i.e. it is shown. Statuses are never guessed from the transporter's name or history.
- An invalid status value, conflicting duplicate rows or a bad header raise StatusConfigError
  (the API answers 503) so a typo can never let a Not Active transporter through.
- A missing CSV means "no statuses configured": every transporter gets the unlisted default.
- The file is re-read automatically when it changes, so edits apply without a restart.
"""
import csv
import re
import threading
from dataclasses import dataclass
from pathlib import Path

ACTIVE = "Active"
NOT_ACTIVE = "Not Active"


class StatusConfigError(ValueError):
    pass


def _key(v: str | None) -> str:
    return re.sub(r"[\s_\-.,]+", " ", v or "").strip().lower()


def parse_status(value: str | None) -> str | None:
    k = _key(value)
    return {"active": ACTIVE, "not active": NOT_ACTIVE}.get(k)


@dataclass(frozen=True)
class StatusTable:
    statuses: dict[str, str]
    default: str

    def status_of(self, transport_name: str) -> str:
        return self.statuses.get(_key(transport_name), self.default)

    def is_active(self, transport_name: str) -> bool:
        return self.status_of(transport_name) == ACTIVE


def _load(path: Path, default: str) -> StatusTable:
    if parse_status(default) is None:
        raise StatusConfigError(f'unlisted_transport_status must be "Active" or "Not Active", got {default!r}')
    statuses: dict[str, str] = {}
    if path.is_file():
        with path.open(newline="", encoding="utf-8-sig") as f:
            lines = [ln for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
        reader = csv.DictReader(lines)
        cols = {(c or "").strip().lower(): c for c in (reader.fieldnames or [])}
        if "transport_name" not in cols or "status" not in cols:
            raise StatusConfigError(f"{path.name}: header must contain transport_name,status")
        for n, row in enumerate(reader, start=2):
            name = (row[cols["transport_name"]] or "").strip()
            raw = (row[cols["status"]] or "").strip()
            if not name:
                continue
            status = parse_status(raw)
            if status is None:
                raise StatusConfigError(
                    f'{path.name} row {n}: status {raw!r} for "{name}" must be "Active" or "Not Active"'
                )
            k = _key(name)
            if statuses.get(k, status) != status:
                raise StatusConfigError(f'{path.name} row {n}: "{name}" is listed with conflicting statuses')
            statuses[k] = status
    return StatusTable(statuses, parse_status(default))


_lock = threading.Lock()
_cache: tuple[tuple, StatusTable] | None = None


def get_table(path: str, default: str = ACTIVE) -> StatusTable:
    global _cache
    p = Path(path)
    st = p.stat() if p.is_file() else None
    sig = (str(p), st.st_size if st else None, st.st_mtime_ns if st else None, default)
    with _lock:
        if _cache is None or _cache[0] != sig:
            _cache = (sig, _load(p, default))
        return _cache[1]
