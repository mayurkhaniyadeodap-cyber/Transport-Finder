import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import health, manage, overrides, settings_routes, transport
from .services import overrides_store

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
    yield


# The interactive API docs describe every endpoint, so they exist only in development.
_docs = settings.app_env == "development"
app = FastAPI(
    title="Transport Finder",
    lifespan=lifespan,
    docs_url="/docs" if _docs else None,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

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
