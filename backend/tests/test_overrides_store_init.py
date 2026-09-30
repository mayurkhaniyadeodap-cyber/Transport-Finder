"""SQLite Admin-data store: safe initialisation, in-place migration with a safety backup, restart
persistence, risky-location warnings, and startup initialisation. Never touches the real
data/transporter_overrides.db (every test uses its own tmp_path)."""
import sqlite3
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import overrides_store as store


def _old_schema_db(path: Path) -> None:
    """A database as the first release wrote it: transporter_settings without the columns added
    later (display_name, service_cities, pincodes, is_new)."""
    conn = sqlite3.connect(str(path))
    conn.executescript("""
        CREATE TABLE transporter_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT, is_new INTEGER NOT NULL DEFAULT 0,
            source_city TEXT, source_transport_name TEXT, source_pincode TEXT,
            override_transport_name TEXT, override_city TEXT, override_pincode TEXT,
            override_mobile TEXT, override_status TEXT, hidden INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE transporter_settings (
            name_key TEXT PRIMARY KEY, transport_name TEXT NOT NULL, status TEXT, mobile TEXT,
            hidden INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO transporter_overrides (is_new, override_transport_name, override_city, override_pincode,
            override_mobile, override_status, created_at, updated_at)
            VALUES (1, 'Avadh Travels', 'Vansda', '396580', '9429778378', 'Active', '2026-09-29', '2026-09-29');
        INSERT INTO transporter_settings (name_key, transport_name, status, mobile, hidden, deleted, created_at, updated_at)
            VALUES ('kishan travels', 'Kishan Travels', 'Not Active', '9000000000', 1, 0, '2026-09-29', '2026-09-29'),
                   ('tci express', 'TCI Express', NULL, NULL, 0, 1, '2026-09-29', '2026-09-29');
    """)
    conn.commit()
    conn.close()


def test_init_creates_a_missing_database_and_its_folder(tmp_path):
    db = tmp_path / "new" / "data" / "transporter_overrides.db"
    info = store.init_db(db)
    assert db.is_file()
    assert info["created"] is True and info["integrity"] == "ok"
    assert (info["row_overrides"], info["transporter_settings"]) == (0, 0)


def test_init_on_an_existing_current_database_changes_nothing(tmp_path):
    db = tmp_path / "overrides.db"
    store.set_transporter_settings(db, "tci express", "TCI Express", deleted=True)
    info = store.init_db(db)
    assert info["created"] is False and info["transporter_settings"] == 1 and info["deleted"] == 1
    assert not list(tmp_path.glob("*.pre-migration-*"))  # nothing to migrate -> no backup


def test_old_schema_is_migrated_in_place_keeping_every_row(tmp_path):
    db = tmp_path / "overrides.db"
    _old_schema_db(db)
    info = store.init_db(db)
    assert (info["row_overrides"], info["transporter_settings"], info["deleted"]) == (1, 2, 1)
    settings_rows = store.list_transporter_settings(db)
    kishan = settings_rows["kishan travels"]
    assert (kishan["status"], kishan["mobile"], kishan["hidden"], kishan["deleted"]) == ("Not Active", "9000000000", True, False)
    assert kishan["display_name"] is None and kishan["service_cities"] is None and kishan["is_new"] is False
    assert settings_rows["tci express"]["deleted"] is True
    assert store.list_overrides(db)[0]["override_transport_name"] == "Avadh Travels"
    # the migrated file works for new-style writes too
    store.set_transporter_settings(db, "kishan travels", "Kishan Travels", service_cities=["Rajkot"])
    assert store.list_transporter_settings(db)["kishan travels"]["service_cities"] == ["Rajkot"]


def test_migration_writes_a_full_backup_first_and_only_once(tmp_path):
    db = tmp_path / "overrides.db"
    _old_schema_db(db)
    store.init_db(db)
    backups = list(tmp_path.glob("overrides.pre-migration-*.db"))
    assert len(backups) == 1
    conn = sqlite3.connect(str(backups[0]))
    cols = {r[1] for r in conn.execute("PRAGMA table_info(transporter_settings)")}
    assert "display_name" not in cols  # the backup is the untouched pre-migration copy
    assert conn.execute("SELECT COUNT(*) FROM transporter_settings").fetchone()[0] == 2
    conn.close()
    store.init_db(db)  # already migrated -> no second backup
    assert len(list(tmp_path.glob("overrides.pre-migration-*.db"))) == 1


def test_every_admin_change_survives_a_restart(tmp_path):
    db = tmp_path / "overrides.db"
    store.create_new(db, "Avadh Travels", "Vansda", "396580", mobile="9429778378", status="Active")
    store.set_transporter_settings(db, "om logistics", "Om Logistics", is_new=True, service_cities=["Surat"],
                                   pincodes=["395007"], mobile="9812345678", status="Active")
    store.set_transporter_settings(db, "kishan travels", "Kishan Travels", display_name="Kishan Roadlines",
                                   status="Not Active", hidden=True)
    store.set_transporter_settings(db, "tci express", "TCI Express", deleted=True)
    # "Restart": nothing is held in memory by the store; a fresh init + read sees it all from disk.
    info = store.init_db(db)
    assert (info["row_overrides"], info["transporter_settings"], info["deleted"]) == (1, 3, 1)
    s = store.list_transporter_settings(db)
    assert s["om logistics"]["is_new"] and s["om logistics"]["pincodes"] == ["395007"]
    assert (s["kishan travels"]["display_name"], s["kishan travels"]["status"], s["kishan travels"]["hidden"]) == (
        "Kishan Roadlines", "Not Active", True)
    assert s["tci express"]["deleted"] is True


def test_location_warning_flags_cache_temp_and_build_folders(tmp_path):
    assert store.location_warning(Path(tempfile.gettempdir()) / "x" / "overrides.db") is not None
    assert store.location_warning(Path("C:/app/backend/.cache/overrides.db")) is not None
    assert store.location_warning(Path("C:/app/frontend/dist/overrides.db")) is not None
    assert store.location_warning(Path("C:/wherehous_tool/Transport Finder/data/transporter_overrides.db")) is None


def test_default_location_is_the_project_data_folder():
    default = Path(type(settings)().overrides_db_path)
    assert default.parent.name == "data" and default.name == "transporter_overrides.db"
    assert store.location_warning(default) is None


def test_server_startup_initialises_the_configured_database(tmp_path, monkeypatch):
    db = tmp_path / "startup" / "overrides.db"
    monkeypatch.setattr(settings, "overrides_db_path", str(db))
    with TestClient(app) as client:  # the context manager runs the lifespan (startup) hook
        assert db.is_file()
        assert client.get("/api/health").json() == {"status": "ok"}  # API behaviour unchanged
