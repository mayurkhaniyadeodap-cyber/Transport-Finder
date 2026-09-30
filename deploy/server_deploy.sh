#!/usr/bin/env bash
# Transport Finder - deploy at https://care.deodap.info/transport-finder/ on the shared Ubuntu server.
# Run on the server as "ubuntu":   bash /tmp/server_deploy.sh
# Code source: /tmp/tf.tgz if present (the local project folder), otherwise the GitHub repo.
# Safe to re-run: updates the code, keeps .env and data/transporter_overrides.db.
# The only change to other apps: one "include" line in the care.deodap.info Nginx site (backed up,
# tested with nginx -t, rolled back automatically if the test fails).
set -euo pipefail

REPO="https://github.com/mayurkhaniyadeodap-cyber/Transport-Finder.git"
BASE_PATH="/transport-finder"
PUBLIC_URL="https://care.deodap.info$BASE_PATH/"
APP_DIR="/opt/transport-finder"
APP_USER="transportfinder"
PORT=8030   # 8000 is already used by another app on this server
CARE_SITE="/etc/nginx/sites-available/care.deodap.info"
SNIPPET="/etc/nginx/snippets/transport-finder.conf"

echo "== 1. App user and code"
id "$APP_USER" >/dev/null 2>&1 || sudo useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
SRC=$(mktemp -d)
if [ -f /tmp/tf.tgz ]; then
  tar -xzf /tmp/tf.tgz -C "$SRC"
else
  sudo apt-get install -y git >/dev/null
  git clone --depth 1 "$REPO" "$SRC"
  rm -rf "$SRC/.git"
fi
rm -f "$SRC/.env" "$SRC"/*.pem "$SRC/data/transporter_overrides.db"   # never overwrite server secrets/data
sudo cp -a "$SRC/." "$APP_DIR/"
rm -rf "$SRC"
sudo mkdir -p "$APP_DIR/source" "$APP_DIR/backend/.cache"

echo "== 2. .env (production)"
if ! sudo test -e "$APP_DIR/.env"; then
  sudo tee "$APP_DIR/.env" >/dev/null <<EOF
APP_ENV=production
CORS_ORIGINS=https://care.deodap.info
# Vacalvers RDS read-only account - fill these in, then: sudo systemctl restart transport-finder
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=
# Fallback files (optional) - copy them into $APP_DIR/source/
VACALVERS_CSV_PATH=$APP_DIR/source/L135 Orders 01.09.26 to 30.09.26.csv
BRANCHES_CSV=$APP_DIR/source/Branches_LIST_20260926.csv
EOF
fi
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo chmod 600 "$APP_DIR/.env"

echo "== 3. Python backend"
sudo apt-get install -y python3-venv >/dev/null
sudo test -x "$APP_DIR/.venv/bin/python" || sudo -u "$APP_USER" -H python3 -m venv "$APP_DIR/.venv"
sudo -u "$APP_USER" -H "$APP_DIR/.venv/bin/pip" install -q --upgrade pip
sudo -u "$APP_USER" -H "$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"

echo "== 4. Frontend build (served under $BASE_PATH/)"
cd "$APP_DIR/frontend"
sudo -u "$APP_USER" -H npm ci --no-audit --no-fund
sudo -u "$APP_USER" -H npm run build -- --base "$BASE_PATH/"
cd /
# Nginx (www-data) needs to read the built files; the rest of the app dir stays private.
sudo chmod 711 "$APP_DIR"
sudo chmod 755 "$APP_DIR/frontend"
sudo chmod -R a+rX "$APP_DIR/frontend/dist"

echo "== 5. systemd service"
sudo tee /etc/systemd/system/transport-finder.service >/dev/null <<EOF
[Unit]
Description=Transport Finder API ($PUBLIC_URL)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port $PORT --workers 1 --proxy-headers
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable transport-finder >/dev/null
sudo systemctl restart transport-finder
sleep 4
sudo journalctl -u transport-finder -n 15 --no-pager

echo "== 6. Nginx: $BASE_PATH on care.deodap.info"
sudo tee "$SNIPPET" >/dev/null <<EOF
# Transport Finder ($APP_DIR) - included from $CARE_SITE
location = $BASE_PATH { return 301 $BASE_PATH/; }

location ^~ $BASE_PATH/api/ {
    client_max_body_size 3m;   # transporter images up to 2 MB
    proxy_pass http://127.0.0.1:$PORT/api/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 120s;
}

location ^~ $BASE_PATH/ {
    alias $APP_DIR/frontend/dist/;
    index index.html;
    try_files \$uri \$uri/ $BASE_PATH/index.html;
}
EOF
if ! sudo grep -q "snippets/transport-finder.conf" "$CARE_SITE"; then
  BACKUP="$CARE_SITE.bak-$(date +%Y%m%d-%H%M%S)"
  sudo cp -a "$CARE_SITE" "$BACKUP"
  # Insert inside the HTTPS server block, right after its "location = / { return 404; }" line.
  sudo sed -i '0,/^\(\s*\)location = \/ { return 404; }/s//&\n\n    include snippets\/transport-finder.conf;/' "$CARE_SITE"
  if ! sudo grep -q "snippets/transport-finder.conf" "$CARE_SITE"; then
    echo "Could not find the insertion point in $CARE_SITE - nothing changed."; exit 1
  fi
  echo "care.deodap.info site backed up to $BACKUP"
fi
if ! sudo nginx -t; then
  echo "nginx -t FAILED - restoring the previous care.deodap.info config"
  if [ -n "${BACKUP:-}" ]; then sudo cp -a "$BACKUP" "$CARE_SITE"; sudo rm -f "$SNIPPET"; fi
  sudo nginx -t || true
  exit 1
fi
sudo systemctl reload nginx

echo "== 7. Checks"
sleep 2
curl -s -o /dev/null -w "API health (local):      %{http_code}\n" "http://127.0.0.1:$PORT/api/health" || true
curl -s -o /dev/null -w "Site page   $PUBLIC_URL: %{http_code}\n" "$PUBLIC_URL" || true
curl -s -o /dev/null -w "Site API    ${PUBLIC_URL}api/health: %{http_code}\n" "${PUBLIC_URL}api/health" || true
curl -s -o /dev/null -w "Care app still OK (https://care.deodap.info/email_automation/): %{http_code}\n" "https://care.deodap.info/email_automation/" || true
echo
echo "Live: $PUBLIC_URL"
