# Transport Finder

Find which transporters serve a location. Search by **Pincode** (the main search), **City**, **State**, or
**City + State**, and get a paginated table of
`City | Transport | Mobile | Pincode | Status`.

Stack: React + Vite + TypeScript (frontend), FastAPI (backend). The **primary data source is the live, read-only
Vacalvers RDS**; if it's unreachable, the app automatically falls back to the VaCalvers CSV export so search keeps
working. The original MySQL path is still in the code but is not the default.

```
Transport Finder/
├── backend/        FastAPI app + tests
├── frontend/       React UI (login, sidebar nav, search, Manage Transporters)
├── data/           transport_status.csv, transporters.xlsx, transporter_synonyms.csv,
│                   transporter_overrides.db (local manual overrides, gitignored)
├── data_import/    optional CSV/Excel -> MySQL importers
├── database/       optional MySQL schema
└── requirements.txt   the only Python requirements file
```

Sign-in is required: a demo Admin/User login gates the app (frontend-only, no backend auth system —
see [Login & sessions](#login--sessions)). Admin can reach **Manage Transporters**; User can only
search.

## Data sources (kept next to this folder, i.e. in `C:\wherehous_tool`)

| Source | Used for |
|---|---|
| Vacalvers RDS (live, read-only) | **Primary source** (default, `DATA_SOURCE=rds`): the same kind of order data, live |
| `L135 Orders 01.09.26 to 30.09.26.csv` | **Automatic fallback** if the RDS is unreachable, and `DATA_SOURCE=vacalvers_csv` |
| `DAILY DISPATCH SHEET.xlsx` | Alternate source: `DATA_SOURCE=excel` (older dispatch log, no longer the default) |
| `Branches_LIST_20260926.csv` | Mobile No lookup for the CSV/Excel sources (a **VRL Logistics** branch list) |
| `data/transport_status.csv` | Transport master: Active / Not Active per transporter |

The files are never modified. Only four columns of the order export are ever read — `CustomerBillingCity`,
`CustomerBillingState`, `CustomerBillingPinCode`, `ShipmentCourier` — mapped to City, State, Pincode and
Transport. Its other ~36 columns (customer name, phone, address, GSTIN, order number, price, order status,
order date, ...) are never read out, stored or shown. **All** rows are used regardless of `OrderStatus`
(Dispatched/Packed/New/...) or date — nothing is filtered by status or recency.

### What the order export can and cannot tell you
A row means "this transporter carried an order to this city/pincode/state" — it is not a serviceability claim and
has no branch, godown or contact data. Transporter names are shown as written in `ShipmentCourier`, with only case
and spacing normalised: spelling variants such as `DTDC` / `DTDC Courier` or `TCI` / `TCI Express` are **separate**
transporters. Values that are not transporter names are ignored: `SELF PICKUP`, `CUSTOMER LABEL`, `OTHER`, `COD`,
`LOCAL`, and any `DRIVER: <name>` value (a person's name, not a company). Orders with a blank `ShipmentCourier`
(the large majority — courier is usually filled in only after dispatch) contribute nothing to the table.

The older `DAILY DISPATCH SHEET.xlsx` path (`DATA_SOURCE=excel`) works the same way but parses pincode/city/state
out of one free-text column instead of three separate ones; see the git history for its own notes.

### Primary source: live RDS (`DATA_SOURCE=rds`)
Reads the same kind of order data live from the read-only Vacalvers RDS instead of a static file export.
**If the RDS is unreachable** (bad/missing credentials, network, connection error), search **automatically falls
back** to the VaCalvers CSV (`vacalvers_csv`) rather than failing — this is logged as a warning server-side, not
shown as an error to the user. A 503 is only returned if the CSV fallback is unavailable too (e.g. the file is
missing). To force the CSV instead of RDS, set `DATA_SOURCE=vacalvers_csv` explicitly.

- **Credentials**: `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` in the project root `.env` (path configurable
  via `RDS_ENV_PATH`). Never stored in Settings, logged, or sent to the frontend. The DB user must have SELECT/SHOW
  VIEW only — this app never issues anything else, and additionally runs `SET SESSION TRANSACTION READ ONLY` on
  every connection as a second guard.
- **Tables read** (found by inspecting `information_schema`, not guessed): `orders` (`buyer_city`, `buyer_state_id`,
  `buyer_pincode`, `shipment_courier_id`/`shipment_courier`), `states` (id→name), `couriers` (id→name),
  `courier_locations` (a courier-name-keyed contact-phone directory — used for Mobile No here instead of the VRL CSV;
  a number is only used when every location row for that courier name agrees on one phone).
- **Excluded courier values** are broader than the CSV's, matching junk actually seen in this database: self pickup,
  local/hand delivery, COD, a driver's own name (`DRIVER:`/the observed typo `DRIVAR:`), "customer label"/"other(s)",
  numeric/tracking-number noise, and a short list of obvious test rows (`demo`, `abc`, ...).
- **City is blanked** (shown as Not Available), not the whole row, when `buyer_city` looks like a pincode or a full
  address (comma-separated, or unusually long) rather than a city name, since that field is free text and sometimes
  holds an address — the pincode/state/transporter are still searchable.
- Query result is cached (`backend/.cache/rds_index.json`) for `RDS_CACHE_TTL_SECONDS`, since `orders` has ~2.4M rows;
  a single aggregate query (a few seconds) rebuilds it, not one query per search.
- Active/Not Active and the default pincode work identically to the other sources.

## Quick start

```bash
# 1. Python (from the project root)
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# 2. Backend
cd backend
uvicorn app.main:app --reload          # http://localhost:8000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                            # http://localhost:5173, proxies /api to :8000
```

The first search after the backend starts reads the ~50 MB order export (a few seconds). The result is cached in
`backend/.cache/`, so later starts are fast, and the cache refreshes automatically if the file changes.

## Production deployment (Ubuntu + Nginx)

The backend (FastAPI/Uvicorn) listens only on `127.0.0.1:8000`; Nginx serves the built frontend
(`frontend/dist/`) over HTTPS and forwards `/api/` to it. The examples use `/opt/transport-finder`
and a system user `transportfinder` — adjust to taste. On Ubuntu the virtualenv's Python is
**`.venv/bin/python`** (not `.venv/Scripts/python`, which is Windows).

### 1. Server packages and app user

```bash
sudo apt update
sudo apt install -y python3 python3-venv nginx certbot python3-certbot-nginx sqlite3
# Node.js 20 LTS or newer is needed only to build the frontend (e.g. from NodeSource).
sudo useradd --system --create-home --home-dir /opt/transport-finder --shell /usr/sbin/nologin transportfinder
```

Python 3.10 or newer is required (Ubuntu 22.04 / 24.04 are fine).

### 2. Code, backend and frontend build

```bash
cd /opt/transport-finder
# Get the code: git clone <private repo> .   (or copy it; never rsync --delete over an existing install)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd frontend && npm ci && npm run build && cd ..      # -> frontend/dist/
```

### 3. Configuration (`.env`)

```bash
cp .env.example .env
nano .env        # APP_ENV=production, CORS_ORIGINS=https://your-domain, DB_* (read-only RDS account),
                 # VACALVERS_CSV_PATH / BRANCHES_CSV (see step 4)
chmod 600 .env
```

`APP_ENV=production` turns off `/docs`, `/redoc` and `/openapi.json`. The RDS security group must
allow this server's IP on port 3306; the RDS account must have only `SELECT, SHOW VIEW`.

### 4. Data files (copy once; never overwrite an existing server copy)

| Copy to the server | Notes |
|---|---|
| `data/transporter_overrides.db` | **All Admin data** — edits, uploaded transporter images, shipment charges, accounts, Users, sessions, preferences. Not in Git (`*.db`): copy it separately, with the app stopped |
| `data/transporter_logos/` | Verified official logos (in Git) |
| `data/transporters.xlsx`, `data/transporter_synonyms.csv`, `data/transport_status.csv` | Transporter list, spellings, statuses (in Git) |
| Order export CSV, `Branches_LIST_*.csv`, `DAILY DISPATCH SHEET.xlsx` | Put them in `/opt/transport-finder/source/` (ignored by Git — the order export holds customer details) and set `VACALVERS_CSV_PATH` / `BRANCHES_CSV` in `.env` |

```bash
sudo chown -R transportfinder:transportfinder /opt/transport-finder
```

The service user must be able to **write** `data/` (SQLite keeps its journal file next to the
database) and `backend/.cache/` (the RDS snapshot, rebuilt automatically).

### 5. systemd service

`/etc/systemd/system/transport-finder.service`:

```ini
[Unit]
Description=Transport Finder API
After=network-online.target
Wants=network-online.target

[Service]
User=transportfinder
Group=transportfinder
WorkingDirectory=/opt/transport-finder
ExecStart=/opt/transport-finder/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Production command: no `--reload`, and **one worker** (the sign-in lockout and the RDS snapshot
live in the process's memory).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now transport-finder
journalctl -u transport-finder -n 30
```

The log must show `Environment: production - API docs (...) are disabled` and
`Admin data (SQLite): /opt/transport-finder/data/transporter_overrides.db - existing database`
— **"NEW empty database created" means it's pointing at the wrong file: stop and fix
`OVERRIDES_DB_PATH` before anyone signs in.**

### 6. Nginx

`/etc/nginx/sites-available/transport-finder`:

```nginx
server {
    listen 80;
    server_name your-domain;

    root /opt/transport-finder/frontend/dist;
    index index.html;

    # Transporter images can be up to 2 MB (Nginx's default limit is 1 MB).
    client_max_body_size 3m;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # the first search after a refresh reads the RDS snapshot
    }

    location / {
        try_files $uri /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/transport-finder /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Keep port 8000 closed to the outside (e.g. `sudo ufw allow 'Nginx Full' && sudo ufw allow OpenSSH && sudo ufw enable`).

### 7. HTTPS

Point the domain's DNS (A record) at the server, open ports 80 and 443, then:

```bash
sudo certbot --nginx -d your-domain --redirect   # certificate + HTTP -> HTTPS redirect
sudo certbot renew --dry-run                     # renewal is automatic via a systemd timer
```

Serve over HTTPS only — passwords and session tokens travel in requests. Once HTTPS works, you can
add `add_header Strict-Transport-Security "max-age=31536000" always;` to the HTTPS server block.

### 8. First sign-in and checks

- `https://your-domain/docs` must return 404 (production mode).
- Sign in as the Admin and **change the Admin password** (Settings → Security); **reset every User's
  password** (Settings → User Management) — before anyone else can reach the site.

### SQLite and transporter-image persistence

Everything an Admin changes — including **uploaded transporter images** (stored inside the database,
not as separate files) and **shipment charges** — lives in one file:
`data/transporter_overrides.db` (or `OVERRIDES_DB_PATH`). It survives restarts and redeploys as long
as that file is kept: it's ignored by Git, so `git pull` leaves it alone, but a fresh clone, a new
container image or `rsync --delete` would not — for those, set `OVERRIDES_DB_PATH` to a folder
outside the app (e.g. `/var/lib/transport-finder/transporter_overrides.db`). Verified official logos
are files in `data/transporter_logos/` (in Git; or set `TRANSPORTER_LOGOS_DIR`).

Back it up daily (safe while the server runs), and before every deployment:

```bash
sudo -u transportfinder mkdir -p /opt/transport-finder/backups
sudo -u transportfinder sqlite3 /opt/transport-finder/data/transporter_overrides.db \
  ".backup '/opt/transport-finder/backups/transporter_overrides-$(date +%F).db'"
```

(e.g. from a daily cron job; copy `backups/` off the server too — it's ignored by Git because it
holds password hashes). To restore: stop the service, copy a backup over the database file, start
it and check the "existing database" log line.

### Updating an existing installation

```bash
cd /opt/transport-finder
# back up the database first (above), then:
sudo -u transportfinder git pull          # data/transporter_overrides.db and .env are untouched
sudo -u transportfinder .venv/bin/pip install -r requirements.txt
cd frontend && sudo -u transportfinder npm ci && sudo -u transportfinder npm run build && cd ..
sudo systemctl restart transport-finder
```

## Search behaviour

Priority: exact **pincode** → **city (+ state)** → **state**. If a level has no (Active) results, the next level is
tried. No field is pre-filled anywhere — the main Search page's single box and the 3-field Pincode/City/State
form (used only by Manage Transporters, `frontend/src/components/SearchForm.tsx`) both start empty.

Results are **one row per Transport Name** (sorted by name), never two rows for the same
transporter: if a transporter serves several pincodes — even across different cities on a state
search — its unique pincodes are combined, sorted ascending, into a single comma-separated field
on that one row (e.g. `394107, 394210, 395001`); City, Mobile and Status come from the first
pincode encountered. Two names count as the same transporter if either is true:
1. They're identical after ignoring case, spacing and punctuation (`TCI Express` / `tci  express` / `TCI-EXPRESS`), or
2. One is a known spelling/typing variant of the other per the approved audit in
   `data/transporter_synonyms.csv` (e.g. `Akash Roadways` merges into `Aakash Roadways`; `Kishna`
   merges into `Kishan`) — see [Transporter name synonyms](#transporter-name-synonyms-spelling-variations).

Genuinely different names are never merged by either rule (`Kishan` / `Kishan Travels`, `Patel
Transport` / `Patel Transport Co` — different word counts, so never a synonym). Paginated at 50 rows
per page (`page`/`page_size` query params; `page_size` capped at 200) **after** this grouping, so
`total`/`page`/`page_size`/`total_pages` describe the grouped result set, not the raw per-pincode rows.

### Mobile
On RDS (the primary source), Mobile comes from `courier_locations`, a courier-name-keyed contact-phone directory —
used only when every location row for that courier name agrees on a single phone; otherwise it stays **Not
Available** rather than guessing. On the CSV/Excel sources, Mobile comes **only** from `Branches_LIST_20260926.csv`,
and only for VRL rows (`VRL Logistics`, `VRL Logistic`, `VRL` — exact names; misspellings are not merged):
1. The pincode must match the pincode in a branch's address. If several branches share it, only the branch whose
   name equals the city is used; if that is still not exactly one branch, no number is shown.
2. Otherwise the city must equal a branch name exactly and the state must agree.

Everything else shows **Not Available**. Customer phone numbers are never read from any source, so they can never
end up here. Other transporters need their own verified branch/contact data to get numbers.

### Active / Not Active
`data/transport_status.csv` has columns `transport_name,status` (status is exactly `Active` or `Not Active`).

- **Search shows Active transporters only.** A Not Active row is dropped before matching, in every search type and
  in autocomplete suggestions (and `total`/pagination count only what's shown). **Manage Transporters still lists
  Not Active transporters**, so an Admin can set them back to Active. A row's status comes from this file, then a
  per-row override, then an Admin's transporter-level status, which wins over both.
- A transporter with **no row** in the file is labelled **Active**. This is a documented default
  (`UNLISTED_TRANSPORT_STATUS`), never a guess about the real world. The file ships with no rows.
- Names match exactly after ignoring case and spacing. Add one row per spelling.
- A bad status value, a bad header or conflicting duplicate rows make the API answer `503` with a clear message
  instead of ever guessing a status.
- Edits are picked up automatically; no restart needed.

### Transporter allowlist
`app/services/transporter_filter.py` is the single place controlling which transporters Transport
Finder shows: `RDS → real transport data → transporter allowlist → Transport Finder`. It is an
**allowlist**, not a blocklist: only names present in the `courier_name` column of
`data/transporters.xlsx` (a copy of the uploaded transporter list, 388 names) are returned from
pincode, city, state search and `/api/transport/list`. Every other column in that sheet
(`order_count`, `normalized_key`, `variation_group_size`, `variation_group_total_orders`, ...) is
ignored. Anything not in the `courier_name` column is hidden, whether or not it's a "real"
transporter, until it's added to the sheet.

A raw allowlist name (e.g. `"BLUEDART"`) is compared against the *display* form Transport Finder
already computes for it (`"Bluedart"` — title-cased, with acronyms like "DTDC" fixed and stray
leading/trailing punctuation stripped, exactly as every source's own `normalize_transport()` already
did before this change). Matching is case-insensitive and ignores extra spaces/hyphens/punctuation
as a result. This isn't renaming or merging anything: the raw name and the displayed name are never
altered or combined, only compared.

This is app-side only — the RDS and CSV/Excel source data are never modified. To update the list
later, replace `data/transporters.xlsx` with a new workbook that has a `courier_name` column — no
code change needed. This replaces the earlier `transport_audit.csv`-based allowlist
(`courier_filter.py`, removed).

### Transporter name synonyms (spelling variations)
`app/services/transporter_synonyms.py` merges known spelling/typing variants of the same
transporter into one display row (e.g. `Blueadart` → `Bluedart`, `Jalaram Trasnport` → `Jalaram
Transport`, `Pavan Parcle Service` → `Pavan Parcel Service`). The list, `data/transporter_synonyms.csv`
(one `variant_name,canonical_name` row per known variant), came from a one-time, read-only,
India-wide audit of the live RDS `orders` table (all states, not just one) — every pair of the then
~635 distinct display names was compared with a conservative, transposition-aware edit-distance
check (same word count, every differing word a close typo, a word with a digit must match exactly
so weight tiers like `1Kg`/`10Kg` are never touched), then reviewed by hand before being applied. The
canonical name is whichever spelling had the most orders in the audit, not necessarily the
"correct" spelling.

This is applied in the same shared place as the exact-match dedup above
(`excel_search.dedupe_transport_rows()`), so it covers every search type and `/api/transport/list`
identically, and it never touches the RDS, `transporters.xlsx`, or the local overrides file. The
allowlist check itself also uses the canonical name, not the raw variant spelling, so a misspelled
variant that isn't itself in `transporters.xlsx` (only its canonical form is) still contributes its
pincodes instead of being silently dropped. To add, remove or correct a merge later, edit
`data/transporter_synonyms.csv` directly — no code change needed.

### Transporter Management (local manual overrides)
Admin-only: a **Manage Transporters** item appears in the sidebar (never for the User role — see
[Login & sessions](#login--sessions)) that lets you change what Transport Finder shows,
without ever touching the RDS or the CSV/Excel files: `RDS real data → local override → combined
result`.

**All Transporters** lists every allowlisted transporter once (Active, Not Active and hidden alike)
with its Service Cities, Pincodes, Mobile and Status, a **Transporter Name search** (instant,
case/spacing-insensitive, matches anywhere in the name), and three actions per transporter, each
applied to *all* of its rows at once:

- **Edit** (side panel): Transporter Name, Service Cities, Pincode(s), Mobile Number, Status
  (Active / Not Active) and Visibility (Visible / Hidden). Cities and pincodes are comma- or
  line-separated; pincodes must be 6 digits. Only fields you actually change are saved, and the
  change shows in Search and this list immediately.
  - **Name**: a rename changes the displayed name everywhere (Search, suggestions, transporter-name
    search). The old name no longer finds it. Renaming to another transporter's name is refused
    (`409`); renaming back to the original clears the rename.
  - **Service Cities / Pincode(s)**: once edited, the list *replaces* the real-data list for that
    transporter, both on screen and for search: pincode search matches exactly these pincodes, and
    city search matches these cities plus the real city of each listed pincode. State search uses
    the real state of each pincode/city, where the data knows it. Lists you don't touch keep
    following the real data.
  - **Status**: setting a Not Active transporter to **Active** brings it back into Search.
- **Hide / Unhide**: a hidden transporter disappears from Search and suggestions but stays in this
  list (marked *Hidden*) so it can be unhidden. The same as Visibility in Edit.
- **Delete** (asks for confirmation): removes it from Search *and* this list. It moves to a
  **Deleted transporters** section with a **Restore** button — nothing is erased, and the real
  data is untouched.

**+ Add Transporter** (top of the page) adds a transporter with no real order behind it: Transporter
Name (required, must not already exist), Service Cities, Pincode(s), Mobile Number and Status
(default Active). It appears in this list (tagged *Added*) and in Search by name, any of its
pincodes or cities, and their states. It is exempt from the `transporters.xlsx` allowlist (it was
added on purpose), and can then be edited, hidden, deleted and restored like any other.

These transporter-level edits and added transporters live in a `transporter_settings` table in the
same local SQLite file, keyed by the transporter's match name (case/spacing-insensitive,
synonym-canonical). They survive restarts. New columns are added to an existing file automatically.

**Service Cities** (search cards, table, details drawer, and this list) are, unless an Admin edited
them, every distinct city that transporter's real, allowlisted rows cover India-wide — the
destination cities in the order data, with row-level city overrides applied. Nothing is invented;
spellings come from the data as-is (e.g. both `Ahmedabad` and `Ahemdabad` can appear).

Below that, **Current local overrides** still lists the older row-level edits (one city + pincode
row at a time) and lets you edit or remove them. For a row-level override you can edit its transport
name, city, pincode, mobile number and Active/Not Active status. Leaving a field blank keeps whatever
the real source shows for it.

Overrides are stored in `data/transporter_overrides.db`, a small local SQLite file **inside this
project** (`app/services/overrides_store.py`) — never in the RDS/CSV/Excel source, and gitignored
(`*.db`) like the rest of the local cache/data files. Editing the same row twice updates one record,
identified by its original (city, transport name, pincode); a manually added transporter is exempt
from the transporter allowlist above (it was added on purpose) but is still subject to the same
pincode/city/state search matching as a real row. Deleting an edit-override reverts that row to
exactly what the real source shows; deleting a new-transporter override removes it entirely.

### Admin data storage (SQLite) — production notes
Every Admin change — add, edit (name, mobile, service cities, pincodes), Active / Not Active,
Hide / Unhide, Delete / Restore, and **transporter photos** — is stored **only** in
`data/transporter_overrides.db` (three tables: `transporter_settings` for whole-transporter changes,
`transporter_overrides` for row-level edits, `transporter_photos` for profile photos). The Vacalvers
RDS stays read-only (`SELECT, SHOW VIEW`); nothing is ever written there.

**Approx. Shipment Charge / 1 Box (₹):** an amount the Admin types in the Edit Transporter form (e.g.
`45`, `75.50`, `120`; a leading ₹ or commas are accepted; up to 2 decimals; empty clears it). It's
stored per transporter in the same SQLite file (`transporter_settings.shipment_charge`), never in
the RDS, and is never calculated from order data. Everyone sees it on the Transporter Profile
(`Not Available` when empty); search results carry it as `shipment_charge`.

**Pincodes on screen** show the first 2, then `+X more` (search cards, table, profile, Manage
Transporters); the full list is kept in the data and shown on the profile's Coverage tab.

**Transporter images:** each transporter shows, in this order:

1. **An Admin-uploaded image.** The Admin uploads or replaces it in Manage Transporters, in the Add / Edit form, and it saves with the rest of the form.
   - JPEG, PNG or WebP only, up to 2 MB. The server checks the file's actual bytes, not its name or declared type, so nothing else (such as SVG or HTML) can be stored or served.
   - It is kept per transporter, so it follows a rename and survives Delete / Restore.
   - It lives inside the same SQLite file, so the backup below covers it too. The file grows by up to 2 MB per image.
2. **A verified official company logo** from `data/transporter_logos/`.
   - `manifest.json` lists each logo with its exact transporter name, the company's official page, the logo's URL and the retrieval date.
   - A logo is attached only when the transporter's displayed name (or its original name, if an Admin renamed it) is **exactly** that name. Case and spacing are ignored; nothing else is. There is no similar-name matching: "Delhi Rajasthan" doesn't get "Delhi Rajasthan Transport"'s logo.
   - Entries without a source, missing files and non-JPEG/PNG/WebP files (including SVG) are skipped and logged.
   - An Admin upload overrides the logo. Removing the upload brings the logo back.
   - Eleven transporters currently have one; add more by dropping a file in the folder and adding a manifest entry.
3. **Otherwise, a neutral "No image available" placeholder**, never a generic or invented picture.

Everyone (Admin and User) sees the image on search cards, table rows, the profile (**View Profile**) and the Manage list. The profile says where the image came from. Users can't change it. Nothing is stored in the RDS.

- **Startup:** the server creates the file and tables if they don't exist, migrates an older schema
  in place, and logs one line with the absolute path, row counts and an integrity check, e.g.
  `Admin data (SQLite): …\data\transporter_overrides.db - existing database; 1 row overrides, 53
  transporter settings (23 deleted); integrity ok`. If that line says **NEW empty database
  created** on a server that already had Admin data, it is pointing at the wrong file — stop and fix
  `OVERRIDES_DB_PATH` before making changes.
- **Migrations are backed up:** before any in-place schema upgrade of an existing file, a full copy
  is written next to it as `transporter_overrides.pre-migration-<UTC time>.db`.
- **Persistence:** the file is outside `.cache/`, `dist/` and temp folders (the server logs a warning
  if `OVERRIDES_DB_PATH` points into one), so restarts, rebuilds and cache clears never touch it. It is
  gitignored (`*.db`), so `git pull` leaves it alone — but a deployment that replaces the whole project
  folder (fresh clone, `rsync --delete`, new container image) would lose it. For such deployments,
  keep `data/` on persistent storage, or set `OVERRIDES_DB_PATH` to an **absolute** path outside the
  project (e.g. `D:\transport-finder-data\transporter_overrides.db`) and copy the existing file there
  once.
- **Backup (recommended daily, and before every deployment):** use SQLite's online backup, which is
  safe while the server is running (a plain file copy is only safe with the server stopped):

  ```bash
  # Windows (development machine). On the Ubuntu server use the sqlite3 command in
  # "Production deployment -> SQLite and transporter-image persistence" above.
  mkdir -p backups
  .venv/Scripts/python.exe -c "import sqlite3,datetime; s=sqlite3.connect('data/transporter_overrides.db'); d=sqlite3.connect(f'backups/transporter_overrides-{datetime.datetime.now():%Y%m%d-%H%M}.db'); s.backup(d); d.close(); s.close()"
  ```

  Keep the `backups/` folder (or copy it) somewhere off this machine. **To restore:** stop the server,
  copy the chosen backup over `data/transporter_overrides.db`, start the server, and check the startup
  log line.

## Login & sessions
Sign-in is checked by the **backend** (`backend/app/services/accounts.py`) against accounts stored
in the local SQLite file (`data/transporter_overrides.db`) — never the RDS: the single Admin account
(table `app_accounts`) and any number of Users (table `app_users`, managed by the Admin in
Settings). Passwords are stored only as salted **PBKDF2-SHA256** hashes (600,000 iterations);
nothing stores or logs a plain-text password.

| Role | Lands on | Can access Manage Transporters |
|---|---|---|
| Admin | Search | Yes |
| User | Search | No — not shown in the navigation, refused by the server (`403`), and redirected back to Search if reached any other way |

A brand-new database starts with one bootstrap Admin and one bootstrap User account (created by
`backend/app/services/accounts.py`). Their initial credentials are not documented here: get them from
the maintainer, and **change both passwords immediately** — the Admin in Settings → Security, the
User in Settings → User Management → Reset Password — before the app is reachable by anyone else.

A successful login returns a random session token. The browser keeps only the role and that token in
`sessionStorage` (`frontend/src/session.ts`) — never the password — so a refresh keeps you signed in,
and it clears when the tab closes or on **Log out**. The database keeps only a SHA-256 of each token;
sessions expire after 12 hours, and changing a password signs out that account's other sessions.
After 5 wrong passwords for the same ID, that ID's login is refused for 5 minutes.

**Forgotten password:** a User's password is reset by the Admin in Settings → User Management. For
the Admin: stop the server and delete the Admin row (`DELETE FROM app_accounts WHERE role =
'admin';` with any SQLite tool, after a backup) — on the next login it's recreated as the bootstrap
Admin account described above, whose password must then be changed straight away.

### Settings page
Open **Settings** from the navigation (sidebar / bottom bar) or the account menu. Both roles see it:

- **Account** — the signed-in role and current ID; change your own ID (needs your current password).
- **Appearance** — Light, Dark or System (follows the device). Stored per browser in `localStorage`,
  so it's kept after a browser restart.
- **Preferences** — app-wide search defaults stored in SQLite (`app_settings`): default pincode
  (pre-fills the search box), default search type (Automatic = the existing pincode → city → state →
  transporter chain; or always City/State/Pincode/Transporter for typed text), results per page
  (10/25/50/100). **Admin only** can change them — the server refuses a User (`403`); a User sees
  them read-only. The defaults (no pincode, Automatic, 50) keep search exactly as before.
- **Security** — change your own password (current password required; at least 8 characters with a
  letter and a number) and Log out.
- **User Management** (Admin only — not shown to a User, and every `/api/settings/users` call
  answers `403` for a User session) — add Users; change a User's ID; reset a User's password (no old
  password needed); activate/deactivate; delete (with a confirmation). User IDs must be unique,
  ignoring letter case, and can't equal the Admin's ID. A deactivated User gets "This account has
  been deactivated" at login (only after the right password, so it doesn't reveal which IDs exist);
  deactivating, deleting or resetting a User's password signs them out everywhere at once. Every
  User has the same User permissions (Search only).

Each person can change only their own ID and password in Account/Security; a User session can never
change the Admin account or another User. **Upgrade note:** the first time this version runs, the
earlier single User account is moved into `app_users` unchanged (same ID and password) — or, on a
fresh database, the original demo User is created. Deleting every User doesn't bring it back. Role gating for Manage Transporters still lives in `TransportFinder.tsx` (the navigation
doesn't render it for a User, and a guard resets the view to Search).

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | `{"status": "ok"}` |
| `GET /api/transport/search?pincode=&city=&state=&transport_name=&page=&page_size=` | Paginated rows (Active transporters only) with `city`, `transport_name`, `contact_number`, `pincode`, `status`, `service_cities` (every real city this transporter covers), `override_id` (set if a local override applies), plus `total`/`page`/`page_size`/`total_pages`; missing values are `null`. `transport_name` matches the same displayed (override + synonym-canonical) name, case/spacing-insensitive, and returns that transporter's merged row (`match_level: "transporter"`) |
| `GET /api/transport/list` | All transporter names (Active and Not Active), except hidden or deleted ones |
| `GET /api/transport/suggest?q=&limit=` | Autocomplete for the search box: `[{type, value}]` where `type` is `pincode`/`city`/`state`/`transporter`, prefix-matched against the same allowlisted data search uses (so a suggestion never leads to an empty result). The vocabulary is cached and rebuilt automatically when the index, a local override, the allowlist or the synonym table changes |
| `GET /api/overrides` | Every local override record |
| `POST /api/overrides` | Create/update the override for an existing row — body: `source_city`, `source_transport_name`, `source_pincode`, plus any of `transport_name`/`city`/`pincode`/`mobile`/`status`/`hidden` to change |
| `POST /api/overrides/new-transporter` | Add a transporter with no real source row — body: `transport_name` (required), `city`, `pincode`, `mobile`, `status` |
| `PATCH /api/overrides/{id}` | Partially update an override (either kind) by its id |
| `DELETE /api/overrides/{id}` | Remove an override (reverts an edited row; deletes an added one) |
| `GET /api/manage/transporters` | Manage Transporters: `{results, total, deleted}` — one row per transporter with `transport_name`, `service_cities`, `pincodes`, `mobile`, `status`, `hidden`, `added_locally`, `edited`; `deleted` lists restorable names |
| `POST /api/manage/transporters` | Add a transporter — body: `transport_name` (required), `service_cities`, `pincodes` (lists), `mobile`, `status` (`409` if the name exists, `422` for a bad pincode) |
| `PATCH /api/manage/transporters` | Transporter-level Edit/Hide — body: `transport_name` (its current displayed name) plus any of `name` (rename), `service_cities`, `pincodes` (each replaces the whole list), `status`, `mobile`, `hidden`, `shipment_charge` (`404` if no such transporter, `409` for a name clash, `422` for bad input) |
| `DELETE /api/manage/transporters?transport_name=` | Delete a transporter (local, restorable) |
| `POST /api/manage/transporters/restore` | Restore a deleted transporter — body: `transport_name` |
| `POST /api/manage/transporters/photo?transport_name=` | Upload/replace a transporter's photo — body: the raw image bytes (JPEG/PNG/WebP, ≤ 2 MB; `422` if not a real image, `413` if too big, `404` unknown transporter); returns `{photo_url}` |
| `DELETE /api/manage/transporters/photo?transport_name=` | Remove a transporter's photo |
| `GET /api/transport/photo?key=&v=` | A photo, as linked by `photo_url` on search and Manage rows (`v` changes whenever the photo does) |
| `POST /api/auth/login` | Sign in — body: `role` (`admin`/`user`), `login_id`, `password`; returns `{token, role, login_id}` (`401` wrong credentials, `429` too many attempts) |
| `POST /api/auth/logout` | End the session in `Authorization: Bearer <token>` |
| `GET /api/settings/account` | The signed-in role and its login ID (needs the Bearer token; `401` without a valid session) |
| `PATCH /api/settings/account` | Change your own ID and/or password — body: `current_password` plus `new_login_id` and/or `new_password` (`422` wrong current password or invalid value) |
| `GET /api/settings/preferences` | App-wide search preferences (any signed-in role) |
| `GET /api/settings/users` | **Admin only**: every User `[{id, login_id, active, created_at, updated_at}]` (never a password or hash) |
| `POST /api/settings/users` | **Admin only**: add a User — body: `login_id`, `password`, optional `active` (`422` duplicate ID or weak password) |
| `PATCH /api/settings/users/{id}` | **Admin only**: any of `login_id` (change ID), `password` (reset), `active` (`404` unknown User) |
| `DELETE /api/settings/users/{id}` | **Admin only**: delete a User and end their sessions |
| `PUT /api/settings/preferences` | Save preferences — body: any of `default_pincode`, `default_search_type`, `results_per_page` (**Admin only**, `403` for a User) |

The `/api/auth` and `/api/settings` endpoints check the session token on the server. The other
endpoints are unchanged: the Admin/User split for Manage Transporters is enforced in the frontend (see
[Login & sessions](#login--sessions)), and those endpoints are not authenticated, same as before.

## Configuration

Settings are read from environment variables or the **project-root `.env`** (whichever folder the
server starts from; see `.env.example`). Real environment variables win over the file.

| Variable | Default | Meaning |
|---|---|---|
| `APP_ENV` | `development` | `production` disables `/docs`, `/redoc` and `/openapi.json`; `development` keeps them. Any other value stops the server at startup |
| `DATA_SOURCE` | `rds` | `rds` (primary, live RDS, auto-falls back to `vacalvers_csv` if unreachable), `vacalvers_csv` (order export), `excel` (dispatch workbook) or `db` (MySQL) |
| `RDS_ENV_PATH` | project root `.env` | File holding `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` for `DATA_SOURCE=rds` |
| `DEFAULT_PAGE_SIZE` | `50` | Rows per page when `page_size` isn't given |
| `MAX_PAGE_SIZE` | `200` | Largest `page_size` the API accepts (a larger value is rejected, not clamped) |
| `RDS_CACHE_TTL_SECONDS` | `1800` | How long an RDS-built index is reused before re-querying |
| `VACALVERS_CSV_PATH` | `..\L135 Orders 01.09.26 to 30.09.26.csv` | VaCalvers order export |
| `EXCEL_PATH` | `..\DAILY DISPATCH SHEET.xlsx` | Dispatch workbook (only used when `DATA_SOURCE=excel`) |
| `BRANCHES_CSV` | `..\Branches_LIST_20260926.csv` | Mobile No lookup file (optional; if missing, Mobile No is Not Available) |
| `TRANSPORT_STATUS_CSV` | `data/transport_status.csv` | Active / Not Active list |
| `UNLISTED_TRANSPORT_STATUS` | `Active` | Status for transporters with no row |
| `OVERRIDES_DB_PATH` | `data/transporter_overrides.db` | Local SQLite store for Manage Transporters edits, uploaded images, charges, accounts and sessions (never RDS/CSV/Excel) |
| `TRANSPORTER_LOGOS_DIR` | `data/transporter_logos` | Verified official logos (`manifest.json` + image files) |
| `EXCEL_MAX_ROWS` | `10000` | Row cap for one search |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed frontend origins, comma-separated (e.g. `https://transport-finder.example.com`) |
| `DATABASE_URL` | local MySQL URL | Only used when `DATA_SOURCE=db` |

## Tests

```bash
python -m pytest backend/tests -q     # backend (no database needed)
cd frontend && npm test               # frontend
cd frontend && npm run build          # TypeScript check + production build
```

## Frontend notes

The UI follows the `transport_finder_redesign.tsx` prototype, rebuilt in the app's own plain CSS
(`src/styles.css`) and inline SVG icons (`src/components/Icons.tsx`) — no Tailwind or icon library.
Shared pieces (avatar, type chip, status/override badges, numbered pagination, truck illustration)
live in `src/components/ui.tsx`.

- **Shell:** a navy **sidebar** (Menu: Search, plus Manage Transporters for Admin) and a top bar
  with the page title and the account menu (Log out). Below 900px the same nav becomes a bottom tab
  bar.
- **Login:** a navy brand panel beside the sign-in card; Admin/User is a segmented switch.
- **Search:** a navy hero with the single search box, Popular Searches and an "About the data" row.
  Once a search runs, a compact sticky search bar with a back button replaces the hero. Loading
  shows skeleton cards. A 6-digit value is sent as pincode; anything else is tried as city, then
  state, then transporter name (`searchUnified()` in `src/searchDefaults.ts`), still just the one
  existing search API.
- **Results:** "N transporters found" with the matched place, stat tiles (Transporters / Active /
  Phone available / Transport types — computed from the *whole* matching set by a capped background
  fetch of the same search endpoint), then a **Cards** or **Table** view and numbered pagination.
- **Transporter profile** (**View Profile** on every result card and table row; read-only for both
  roles): a navy cover with the transporter's photo (or the default truck picture), name, location,
  status and type; Call / Copy number when a mobile exists; an **Overview** tab (mobile, location,
  service cities, pincodes, status, transport type) and a **Coverage** tab (every service city and
  pincode); Copy information.
- **Manage Transporters:** count tiles, the All Transporters table with name search and icon
  actions (Edit / Hide–Unhide / Delete), Deleted transporters (Restore) and Current local overrides.
  Add and Edit open a centered form (a bottom sheet on phones).

The "Transport Type" chip and the avatar colour are guessed client-side from keywords in the name
(`deriveTransportType()`) — cosmetic only; the API has no such field. Everything else shown is
exactly what the API returns; nothing is invented.

`VITE_USE_MOCK` in `frontend/.env.development` is `false`; `true` serves built-in sample data from `src/mock/` for UI
testing without a backend (delete that folder when no longer needed).

## Optional: MySQL path

Not used by default. To use it: create the tables with `mysql -u root -p < database/schema.sql`, set `DATA_SOURCE=db`
and `DATABASE_URL` in `backend/.env`, then load data with the importers in `data_import/`
(`tci_import.py`, `vrl_import.py`; they read CSV/Excel exports and upsert on
`transport_name + pincode + branch_name`). The Active/Not Active status label and Mobile lookup apply to the
`rds`/`vacalvers_csv`/`excel` sources only; `db` has no `status` or verified `contact_number` data of its own.

## Adding a transporter's mobile numbers
Provide a branch/contact file for that transporter and add a lookup like `backend/app/services/branch_source.py`
(exact transporter-name check, then pincode or city + state match). Without a reliable match the value stays
"Not Available".
