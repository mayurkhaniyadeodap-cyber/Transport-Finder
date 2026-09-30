"""Production settings: API docs off in production (on in development), a typo in APP_ENV refuses to
start, and CORS_ORIGINS controls which browser origins may call the API. Each case starts the app in
a fresh Python process, exactly as the server would with those environment variables."""
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

PROBE = """
import json
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
def preflight(origin):
    r = c.options("/api/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
    return r.headers.get("access-control-allow-origin")
print(json.dumps({
    "docs": c.get("/docs").status_code, "redoc": c.get("/redoc").status_code,
    "openapi": c.get("/openapi.json").status_code, "health": c.get("/api/health").status_code,
    "search": c.get("/api/transport/list").status_code != 404,
    "cors_allowed": preflight("https://transport-finder.example.com"), "cors_other": preflight("https://evil.example"),
    "debug": app.debug,
}))
"""


def run(tmp_path, **env):
    full = {**os.environ, "OVERRIDES_DB_PATH": str(tmp_path / "o.db"), "TRANSPORTER_LOGOS_DIR": str(tmp_path / "logos"),
            "DATA_SOURCE": "vacalvers_csv", "VACALVERS_CSV_PATH": str(tmp_path / "none.csv"), **env}
    return subprocess.run([sys.executable, "-c", PROBE], cwd=BACKEND, env=full, capture_output=True, text=True, timeout=120)


def test_production_hides_the_api_docs(tmp_path):
    out = run(tmp_path, APP_ENV="production", CORS_ORIGINS="https://transport-finder.example.com")
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout.strip().splitlines()[-1])
    assert (r["docs"], r["redoc"], r["openapi"]) == (404, 404, 404)
    assert r["health"] == 200 and r["search"]  # the API itself still works
    assert r["debug"] is False


def test_development_keeps_the_api_docs(tmp_path):
    out = run(tmp_path, APP_ENV="development")
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout.strip().splitlines()[-1])
    assert (r["docs"], r["redoc"], r["openapi"]) == (200, 200, 200)


def test_an_unknown_app_env_refuses_to_start(tmp_path):
    out = run(tmp_path, APP_ENV="prod")  # a typo must not silently leave the docs public
    assert out.returncode != 0 and "app_env" in out.stderr.lower()


def test_cors_origins_is_configurable_for_the_production_domain(tmp_path):
    out = run(tmp_path, APP_ENV="production", CORS_ORIGINS="https://transport-finder.example.com, https://tf2.example.com")
    r = json.loads(out.stdout.strip().splitlines()[-1])
    assert r["cors_allowed"] == "https://transport-finder.example.com"
    assert r["cors_other"] is None  # any other site's browser is refused
