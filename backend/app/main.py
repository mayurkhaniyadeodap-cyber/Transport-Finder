import logging
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import settings
from .routes import activity, health, manage, overrides, settings_routes, transport
from .services import excel_search, overrides_store

log = logging.getLogger("uvicorn.error")  # shows in the uvicorn console alongside its own startup lines


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Admin data (adds, edits, hide, delete...) lives only in this SQLite file -- say where, so a
    # deployment pointing at the wrong path is obvious instead of silently starting empty.
    info = overrides_store.init_db(Path(settings.overrides_db_path))
    log.info(
        "Admin data (SQLite): %s - %s; %d row overrides, %d transporter settings (%d deleted), %d photos; integrity %s",
        info["path"], "NEW empty database created" if info["created"] else "existing database",
        info["row_overrides"], info["transporter_settings"], info["deleted"], info["photos"], info["integrity"],
    )
    if settings.app_env == "production":
        log.info("Environment: production - API docs (/docs, /redoc, /openapi.json) are disabled")
    else:
        log.warning("Environment: development - API docs are public at /docs. Set APP_ENV=production for deployment.")
    if info["warning"]:
        log.warning("Admin data SQLite file is at risk of being lost: %s. Set OVERRIDES_DB_PATH to a "
                    "persistent location.", info["warning"])
    # Load the data and build the search caches now, in the background, instead of on the first
    # user's search. The server answers right away; a search arriving first just waits for the same lock.
    if settings.warm_caches_on_startup:
        threading.Thread(target=_warm, name="warm-caches", daemon=True).start()
    yield


def _warm() -> None:
    started = time.perf_counter()
    try:
        excel_search.warm()
    except Exception as exc:  # a search will report/fall back as usual; warming is only a head start
        log.warning("Cache warm-up skipped: %s", exc)
        return
    log.info("Search caches ready in %.1fs", time.perf_counter() - started)


# The interactive API docs describe every endpoint, so they exist only in development.
_docs = settings.app_env == "development"
app = FastAPI(
    title="Transport Finder",
    lifespan=lifespan,
    docs_url="/docs" if _docs else None,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

# Search and Manage responses are JSON lists of cities/pincodes that compress ~6-10x.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(transport.router, prefix="/api")
app.include_router(overrides.router, prefix="/api")
app.include_router(manage.router, prefix="/api")
app.include_router(settings_routes.router, prefix="/api")
app.include_router(activity.router, prefix="/api")
