"""Verified official company logos, kept as local files next to the Admin data (never in the RDS).

`<transporter_logos_dir>/manifest.json` lists each logo:

    {"logos": [{"transport_name": "TCI Express", "file": "tci-express.png",
                "source_url": "https://www.tciexpress.in/", "retrieved": "2026-09-29"}]}

A logo is attached only to the transporter whose name is exactly `transport_name` (compared the same
way every transporter name already is: case and spacing ignored, known spelling variants folded by the
synonym table). There is deliberately no fuzzy/similar-name matching: "Om Logistics" and "Om Logistics
Ltd" are different transporters unless the synonym table already says they're the same one.

An entry without a `source_url`, a missing file, or a file that isn't a real JPEG/PNG/WebP is skipped
(and logged), so nothing unverified is ever shown. An Admin-uploaded photo always takes precedence.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from ..config import settings
from . import excel_source as src
from . import transporter_synonyms

log = logging.getLogger("uvicorn.error")

_cache: dict = {"sig": None, "logos": {}}


def _name_key(name: str) -> str:
    return src.key(transporter_synonyms.canonical_name(name))


def detect_image_type(data: bytes) -> str | None:
    """JPEG/PNG/WebP only, from the file's own leading bytes (no SVG/HTML that a browser could run)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _signature(folder: Path):
    try:
        return tuple(sorted((p.name, p.stat().st_mtime_ns, p.stat().st_size) for p in folder.iterdir() if p.is_file()))
    except OSError:
        return None


def _load(folder: Path) -> dict[str, dict]:
    manifest = folder / "manifest.json"
    if not manifest.is_file():
        return {}
    try:
        entries = json.loads(manifest.read_text(encoding="utf-8")).get("logos", [])
    except (OSError, ValueError, AttributeError) as exc:
        log.warning("Transporter logos: can't read %s (%s); no official logos shown.", manifest, exc)
        return {}
    logos: dict[str, dict] = {}
    for e in entries:
        name, file, source_url = (e.get("transport_name") or "").strip(), (e.get("file") or "").strip(), e.get("source_url")
        path = (folder / file).resolve() if file else None
        if not (name and path and source_url) or path.parent != folder.resolve() or not path.is_file():
            log.warning("Transporter logos: skipping incomplete entry %r.", e)
            continue
        data = path.read_bytes()
        content_type = detect_image_type(data)
        if content_type is None:
            log.warning("Transporter logos: %s isn't a JPEG/PNG/WebP image; skipped.", path.name)
            continue
        logos[_name_key(name)] = {
            "transport_name": name, "content_type": content_type, "data": data,
            "sha256": hashlib.sha256(data).hexdigest(), "source_url": source_url, "retrieved": e.get("retrieved"),
        }
    return logos


def official_logos() -> dict[str, dict]:
    """name_key -> verified logo, re-read whenever the folder changes."""
    folder = Path(settings.transporter_logos_dir)
    sig = (str(folder), _signature(folder))
    if _cache["sig"] != sig:
        _cache["logos"] = _load(folder) if sig[1] is not None else {}
        _cache["sig"] = sig
    return _cache["logos"]
