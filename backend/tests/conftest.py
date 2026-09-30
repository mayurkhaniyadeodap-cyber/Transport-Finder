import pytest

from app.config import settings
from app.main import app
from app.routes.auth import admin_only_router


def pytest_configure(config):
    config.addinivalue_line("markers", "real_auth: run with the real Admin-only check on /api/manage and /api/overrides")


@pytest.fixture(autouse=True)
def _isolated_overrides_db(tmp_path, monkeypatch):
    """Never read or write the real local overrides file (data/transporter_overrides.db) from a
    test — real Admin edits there would otherwise leak into results."""
    monkeypatch.setattr(settings, "overrides_db_path", str(tmp_path / "overrides.db"))
    # Likewise the real verified-logo folder: tests that want logos write their own.
    monkeypatch.setattr(settings, "transporter_logos_dir", str(tmp_path / "no_logos"))


@pytest.fixture(autouse=True)
def _signed_in_as_admin_for_data_tests(request):
    """Tests of Manage/overrides *data behaviour* run as a signed-in Admin, so they don't each have
    to log in. Tests marked `real_auth` (see test_manage_auth.py) get the real server-side check."""
    if request.node.get_closest_marker("real_auth"):
        yield
        return
    app.dependency_overrides[admin_only_router] = lambda: None
    yield
    app.dependency_overrides.pop(admin_only_router, None)
