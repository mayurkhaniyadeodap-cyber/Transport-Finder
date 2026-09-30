"""Approx. Shipment Charge / 1 Box: an Admin-entered amount per transporter, stored only in the local
SQLite file (never RDS), shown on search rows / the profile and in Manage Transporters."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import excel_search as es
from app.services import vacalvers_source as vc
from test_transporter_photos import data, managed, search_row  # noqa: F401  (data is a fixture)

client = TestClient(app)


def set_charge(name, value):
    return client.patch("/api/manage/transporters", json={"transport_name": name, "shipment_charge": value})


def test_no_charge_by_default(data):
    assert search_row("Kishan Travels")["shipment_charge"] is None
    assert managed("Kishan Travels")["shipment_charge"] is None


@pytest.mark.parametrize("value, stored", [
    ("45", "45"), ("75.50", "75.50"), ("75.5", "75.50"), ("120", "120"), ("₹ 1,250.00", "1250"), (60, "60"), (99.9, "99.90"),
    ("0", "0"),
])
def test_admin_sets_a_charge_including_decimals(data, value, stored):
    r = set_charge("Kishan Travels", value)
    assert r.status_code == 200, r.text
    assert r.json()["shipment_charge"] == stored
    assert search_row("Kishan Travels")["shipment_charge"] == stored
    assert managed("Kishan Travels")["shipment_charge"] == stored


@pytest.mark.parametrize("value", ["abc", "-5", "12.345", "1e3", "10000001"])
def test_invalid_amounts_are_rejected(data, value):
    assert set_charge("Kishan Travels", value).status_code == 422
    assert search_row("Kishan Travels")["shipment_charge"] is None


def test_empty_clears_it_and_leaving_it_out_keeps_it(data):
    set_charge("Kishan Travels", "75.50")
    client.patch("/api/manage/transporters", json={"transport_name": "Kishan Travels", "mobile": "9876543210"})
    assert search_row("Kishan Travels")["shipment_charge"] == "75.50"  # other edits don't touch it
    set_charge("Kishan Travels", "")
    assert search_row("Kishan Travels")["shipment_charge"] is None


def test_only_that_transporter_gets_it_and_search_is_unchanged(data):
    before = client.get("/api/transport/search", params={"state": "Gujarat"}).json()
    set_charge("Kishan Travels", "45")
    after = client.get("/api/transport/search", params={"state": "Gujarat"}).json()
    assert [r["transport_name"] for r in after["results"]] == [r["transport_name"] for r in before["results"]]
    assert search_row("TCI Express")["shipment_charge"] is None
    assert managed("Kishan Travels")["edited"] is True


def test_unknown_transporter_is_404(data):
    assert set_charge("Nobody Logistics", "45").status_code == 404


def test_it_follows_a_rename_and_survives_delete_and_restore(data):
    set_charge("Kishan Travels", "75.50")
    client.patch("/api/manage/transporters", json={"transport_name": "Kishan Travels", "name": "Kishan Roadlines"})
    assert managed("Kishan Roadlines")["shipment_charge"] == "75.50"
    client.delete("/api/manage/transporters", params={"transport_name": "Kishan Roadlines"})
    client.post("/api/manage/transporters/restore", json={"transport_name": "Kishan Roadlines"})
    assert managed("Kishan Roadlines")["shipment_charge"] == "75.50"


def test_stored_in_the_local_sqlite_file_and_survives_a_restart(data, monkeypatch):
    set_charge("Kishan Travels", "75.50")
    conn = sqlite3.connect(settings.overrides_db_path)
    assert conn.execute("SELECT shipment_charge FROM transporter_settings WHERE name_key = 'kishan travels'").fetchone() == ("75.50",)
    conn.close()
    for cache in ("_groups_cache", "_catalog_cache", "_suggest_cache", "_locations_cache"):
        monkeypatch.setattr(es, cache, {})
    monkeypatch.setattr(vc, "_index", None)
    with TestClient(app) as restarted:  # runs startup again against the same file
        row = restarted.get("/api/transport/search", params={"transport_name": "Kishan Travels"}).json()["results"][0]
        assert row["shipment_charge"] == "75.50"


def test_an_older_database_gets_the_column_in_place(tmp_path):
    from pathlib import Path
    from app.services import overrides_store
    db = tmp_path / "old.db"
    conn = sqlite3.connect(db)
    conn.execute("""CREATE TABLE transporter_settings (name_key TEXT PRIMARY KEY, transport_name TEXT NOT NULL, status TEXT,
                    mobile TEXT, hidden INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    conn.execute("INSERT INTO transporter_settings (name_key, transport_name, mobile, created_at, updated_at) VALUES ('k', 'K', '99', 'x', 'x')")
    conn.commit()
    conn.close()
    overrides_store._connect(Path(db)).close()
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT mobile, shipment_charge FROM transporter_settings").fetchall() == [("99", None)]  # data kept
    conn.close()
    assert list(tmp_path.glob("old.pre-migration-*.db"))
