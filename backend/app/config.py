from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # "production" turns off the interactive API docs (/docs, /redoc, /openapi.json); "development"
    # (the default, for local work) keeps them. Any other value stops the server at startup.
    app_env: Literal["development", "production"] = "development"
    database_url: str = "mysql+pymysql://root:password@localhost:3306/transport_finder"
    cors_origins: str = "http://localhost:5173"
    max_results: int = 100
    excel_max_rows: int = 10000  # safety ceiling on total matches considered for one search
    default_page_size: int = 50  # search results are paginated this many rows per page
    max_page_size: int = 200
    # "rds" (primary) reads the live, read-only Vacalvers MySQL RDS; "vacalvers_csv" (fallback) reads
    # the VaCalvers order-export file; "excel" reads the dispatch workbook; "db" uses DATABASE_URL
    # (MySQL, unrelated project schema).
    data_source: str = "rds"
    excel_path: str = str(Path(__file__).resolve().parents[2].parent / "DAILY DISPATCH SHEET.xlsx")
    vacalvers_csv_path: str = str(
        Path(__file__).resolve().parents[2].parent / "L135 Orders 01.09.26 to 30.09.26.csv"
    )
    # RDS credentials are read from this .env file at connection time (see rds_source.py), never
    # stored here. Its content, not this path, is sensitive.
    rds_env_path: str = str(Path(__file__).resolve().parents[2] / ".env")
    rds_cache_ttl_seconds: int = 1800  # how long to reuse a built RDS index before re-querying
    # Branch list used only to look up Mobile No (optional: if missing, Mobile No is "Not Available").
    # Transport master/status list (see app/services/transport_status.py). Unlisted transporters get the default.
    # Lives inside this project (parents[2] = "Transport Finder"), unlike excel_path/vacalvers_csv_path/
    # branches_csv above, which point at real source files kept one level up, next to the project folder.
    transport_status_csv: str = str(Path(__file__).resolve().parents[2] / "data" / "transport_status.csv")
    unlisted_transport_status: str = "Active"
    branches_csv: str = str(Path(__file__).resolve().parents[2].parent / "Branches_LIST_20260926.csv")
    # Local manual overrides for Transporter Management (edit/add/hide) — never the RDS/CSV/Excel data.
    # Also inside the project, same as transport_status_csv above.
    overrides_db_path: str = str(Path(__file__).resolve().parents[2] / "data" / "transporter_overrides.db")
    # Verified official company logos (manifest.json + image files), matched by exact transporter name.
    transporter_logos_dir: str = str(Path(__file__).resolve().parents[2] / "data" / "transporter_logos")

    # The project-root .env, whichever folder the server is started from (real environment
    # variables still take precedence over it).
    model_config = SettingsConfigDict(env_file=str(PROJECT_ROOT / ".env"), extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
