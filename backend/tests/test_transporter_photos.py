"""Transporter profile photos: Admin upload/replace/remove (Manage Transporters), stored only in the
local SQLite file; viewable by everyone via a versioned URL on search and Manage rows."""
import csv
import sqlite3

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import excel_search as es
from app.services import transporter_filter as tf
from app.services import vacalvers_source as vc

client = TestClient(app)

COLUMNS = ["OrderNo", "CustomerBillingState", "CustomerBillingCity", "CustomerBillingPinCode", "ShipmentCourier"]
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 32


@pytest.fixture()
def data(tmp_path, monkeypatch):
    path = tmp_path / "orders.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerow({"OrderNo": "#1", "CustomerBillingState": "Gujarat", "CustomerBillingCity": "Rajkot",
                    "CustomerBillingPinCode": "360001", "ShipmentCourier": "KISHAN TRAVELS"})
        w.writerow({"OrderNo": "#2", "CustomerBillingState": "Gujarat", "CustomerBillingCity": "Ahmedabad",
                    "CustomerBillingPinCode": "380001", "ShipmentCourier": "TCI EXPRESS"})
    allowlist = tmp_path / "allowlist.xlsx"
    wb = openpyxl.Workbook()
    wb.active.append(["courier_name"])
    for n in ("KISHAN TRAVELS", "TCI EXPRESS"):
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
    return tmp_path


def upload(name, body, content_type="image/png"):
    return client.post("/api/manage/transporters/photo", params={"transport_name": name}, content=body,
                       headers={"Content-Type": content_type})


def search_row(name):
    r = client.get("/api/transport/search", params={"transport_name": name})
    return r.json()["results"][0]


def managed(name):
    return next(t for t in client.get("/api/manage/transporters").json()["results"] if t["transport_name"] == name)


def test_no_photo_means_no_photo_url(data):
    assert search_row("Kishan Travels")["photo_url"] is None
    assert managed("Kishan Travels")["photo_url"] is None


def test_admin_upload_is_served_back_exactly_and_shown_on_search_and_manage_rows(data):
    r = upload("Kishan Travels", PNG)
    assert r.status_code == 200, r.text
    url = r.json()["photo_url"]
    assert search_row("Kishan Travels")["photo_url"] == url == managed("Kishan Travels")["photo_url"]
    got = client.get(url)
    assert got.status_code == 200 and got.content == PNG
    assert got.headers["content-type"] == "image/png"
    assert got.headers["x-content-type-options"] == "nosniff"
    assert search_row("TCI Express")["photo_url"] is None  # only that transporter


@pytest.mark.parametrize("body, expected", [(PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp")])
def test_jpeg_png_webp_are_accepted_by_their_real_bytes(data, body, expected):
    url = upload("Kishan Travels", body, content_type="application/octet-stream").json()["photo_url"]
    assert client.get(url).headers["content-type"] == expected


def test_changing_the_photo_changes_its_url_and_content(data):
    first = upload("Kishan Travels", PNG).json()["photo_url"]
    second = upload("Kishan Travels", JPEG).json()["photo_url"]
    assert first != second  # versioned: no stale browser cache after a change
    assert client.get(second).content == JPEG
    assert search_row("Kishan Travels")["photo_url"] == second


def test_remove_photo(data):
    url = upload("Kishan Travels", PNG).json()["photo_url"]
    r = client.delete("/api/manage/transporters/photo", params={"transport_name": "Kishan Travels"})
    assert r.status_code == 200 and r.json() == {"removed": True}
    assert search_row("Kishan Travels")["photo_url"] is None
    assert client.get(url).status_code == 404


@pytest.mark.parametrize("body", [
    b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
    b"<html><script>alert(1)</script></html>",
    b"GIF89a....",
    b"",
])
def test_non_images_are_rejected_even_if_labelled_as_images(data, body):
    r = upload("Kishan Travels", body, content_type="image/png")
    assert r.status_code == 422
    assert search_row("Kishan Travels")["photo_url"] is None


def test_oversized_photo_is_rejected(data):
    r = upload("Kishan Travels", PNG + b"\x00" * (es.MAX_PHOTO_BYTES + 1))
    assert r.status_code == 413


def test_unknown_transporter_is_404(data):
    assert upload("Nobody Logistics", PNG).status_code == 404
    assert client.delete("/api/manage/transporters/photo", params={"transport_name": "Nobody Logistics"}).status_code == 404


def test_photo_follows_a_rename_and_an_admin_added_transporter_can_have_one(data):
    upload("Kishan Travels", PNG)
    client.patch("/api/manage/transporters", json={"transport_name": "Kishan Travels", "name": "Kishan Roadlines"})
    assert managed("Kishan Roadlines")["photo_url"] is not None
    client.post("/api/manage/transporters", json={"transport_name": "Om Logistics", "pincodes": ["395007"]})
    assert upload("Om Logistics", JPEG).status_code == 200
    assert search_row("Om Logistics")["photo_url"] is not None


def test_photo_survives_delete_and_restore(data):
    url = upload("Kishan Travels", PNG).json()["photo_url"]
    client.delete("/api/manage/transporters", params={"transport_name": "Kishan Travels"})
    client.post("/api/manage/transporters/restore", json={"transport_name": "Kishan Travels"})
    assert managed("Kishan Travels")["photo_url"] == url


def test_photo_is_stored_in_the_local_sqlite_file_and_survives_a_restart(data, monkeypatch):
    url = upload("Kishan Travels", PNG).json()["photo_url"]
    conn = sqlite3.connect(settings.overrides_db_path)
    assert conn.execute("SELECT content_type, length(data) FROM transporter_photos").fetchall() == [("image/png", len(PNG))]
    conn.close()
    for cache in ("_groups_cache", "_catalog_cache", "_suggest_cache", "_locations_cache"):
        monkeypatch.setattr(es, cache, {})
    monkeypatch.setattr(vc, "_index", None)
    with TestClient(app) as restarted:  # runs startup again against the same file
        assert restarted.get("/api/transport/search", params={"transport_name": "Kishan Travels"}).json()["results"][0]["photo_url"] == url
        assert restarted.get(url).content == PNG
