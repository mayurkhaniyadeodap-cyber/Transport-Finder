"""Verified official company logos (data/transporter_logos/manifest.json): matched to the exact
transporter name only, never to a similar-sounding one; an Admin upload overrides them."""
import json

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import excel_search as es
from app.services import transporter_filter as tf
from app.services import vacalvers_source as vc
from test_transporter_photos import COLUMNS, JPEG, PNG, managed, search_row, upload

import csv

client = TestClient(app)
LOGO = b"\x89PNG\r\n\x1a\n" + b"\x01" * 40


@pytest.fixture()
def data(tmp_path, monkeypatch):
    path = tmp_path / "orders.csv"
    names = ["TCI EXPRESS", "TCI FREIGHT", "OM LOGISTICS", "OM LOGISTICS LTD", "KISHAN TRAVELS"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for i, n in enumerate(names):
            w.writerow({"OrderNo": f"#{i}", "CustomerBillingState": "Gujarat", "CustomerBillingCity": "Rajkot",
                        "CustomerBillingPinCode": "360001", "ShipmentCourier": n})
    allowlist = tmp_path / "allowlist.xlsx"
    wb = openpyxl.Workbook()
    wb.active.append(["courier_name"])
    for n in names:
        wb.active.append([n])
    wb.save(allowlist)
    monkeypatch.setattr(tf, "ALLOWED_TRANSPORTERS", tf._load_allowed_names(allowlist))
    monkeypatch.setattr(settings, "data_source", "vacalvers_csv")
    monkeypatch.setattr(settings, "vacalvers_csv_path", str(path))
    monkeypatch.setattr(settings, "branches_csv", str(tmp_path / "no_branches.csv"))
    monkeypatch.setattr(settings, "transport_status_csv", str(tmp_path / "status.csv"))
    monkeypatch.setattr(settings, "unlisted_transport_status", "Active")
    monkeypatch.setattr(es, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(vc, "_index", None)
    monkeypatch.setattr(vc, "_index_sig", None)
    logos = tmp_path / "logos"
    logos.mkdir()
    monkeypatch.setattr(settings, "transporter_logos_dir", str(logos))
    return logos


def write_logos(folder, entries, files=None):
    for name, body in (files or {}).items():
        (folder / name).write_bytes(body)
    (folder / "manifest.json").write_text(json.dumps({"logos": entries}), encoding="utf-8")


def entry(name, file="logo.png", source="https://example.com/"):
    return {"transport_name": name, "file": file, "source_url": source, "retrieved": "2026-09-29"}


def test_official_logo_is_shown_for_the_exact_transporter_name(data):
    write_logos(data, [entry("TCI Express")], {"logo.png": LOGO})
    row = search_row("TCI Express")
    assert row["photo_source"] == "official"
    assert client.get(row["photo_url"]).content == LOGO
    assert managed("TCI Express")["photo_url"] == row["photo_url"]


def test_case_and_spacing_are_ignored_but_nothing_else(data):
    write_logos(data, [entry("  tci   EXPRESS ")], {"logo.png": LOGO})
    assert search_row("TCI Express")["photo_source"] == "official"


def test_similar_names_do_not_get_the_logo(data):
    write_logos(data, [entry("TCI Express"), entry("Om Logistics", file="om.png")], {"logo.png": LOGO, "om.png": LOGO})
    assert search_row("TCI Freight")["photo_url"] is None  # same brand prefix, different transporter
    assert search_row("Om Logistics Ltd")["photo_url"] is None  # one word more
    assert search_row("Kishan Travels")["photo_url"] is None
    assert search_row("Om Logistics")["photo_source"] == "official"


def test_a_renamed_transporter_matches_by_the_name_it_now_shows(data):
    write_logos(data, [entry("Kishan Roadlines Pvt Ltd")], {"logo.png": LOGO})
    assert search_row("Kishan Travels")["photo_url"] is None
    client.patch("/api/manage/transporters", json={"transport_name": "Kishan Travels", "name": "Kishan Roadlines Pvt Ltd"})
    row = search_row("Kishan Roadlines Pvt Ltd")
    assert row["photo_source"] == "official" and client.get(row["photo_url"]).content == LOGO


def test_no_verified_image_means_no_photo(data):
    assert search_row("TCI Express")["photo_url"] is None
    assert search_row("TCI Express")["photo_source"] is None


@pytest.mark.parametrize("bad", [
    entry("TCI Express", source=None),  # no provenance
    entry("TCI Express", file="missing.png"),
    entry("TCI Express", file="logo.svg"),  # SVG isn't served
    entry("TCI Express", file="../escape.png"),
])
def test_unverified_or_unsafe_entries_are_skipped(data, bad):
    write_logos(data, [bad], {"logo.svg": b"<svg xmlns='http://www.w3.org/2000/svg'/>"})
    (data.parent / "escape.png").write_bytes(LOGO)
    assert search_row("TCI Express")["photo_url"] is None


def test_admin_upload_overrides_the_official_logo_and_removing_it_brings_the_logo_back(data):
    write_logos(data, [entry("TCI Express")], {"logo.png": LOGO})
    official = search_row("TCI Express")["photo_url"]
    url = upload("TCI Express", JPEG).json()["photo_url"]
    row = search_row("TCI Express")
    assert row["photo_url"] == url != official and row["photo_source"] == "admin"
    assert client.get(url).content == JPEG
    client.delete("/api/manage/transporters/photo", params={"transport_name": "TCI Express"})
    assert search_row("TCI Express")["photo_url"] == official
    assert client.get(official).content == LOGO


def test_the_shipped_manifest_is_complete_and_every_logo_loads(monkeypatch):
    from pathlib import Path
    from app.services import transporter_logos
    folder = Path(__file__).resolve().parents[2] / "data" / "transporter_logos"
    entries = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))["logos"]
    monkeypatch.setattr(settings, "transporter_logos_dir", str(folder))
    loaded = transporter_logos.official_logos()
    assert len(loaded) == len(entries)  # nothing skipped as unverified/unsafe
    for e in entries:
        assert e["source_url"].startswith("https://") and e["retrieved"]
        assert loaded[transporter_logos._name_key(e["transport_name"])]["transport_name"] == e["transport_name"]


def test_admin_can_still_upload_for_a_transporter_with_no_logo(data):
    write_logos(data, [entry("TCI Express")], {"logo.png": LOGO})
    assert upload("TCI Freight", PNG).status_code == 200
    assert search_row("TCI Freight")["photo_source"] == "admin"
