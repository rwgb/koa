#!/usr/bin/env bash
# Bootstrap Koa on a fresh Debian 12 LXC/VM (idempotent — safe to re-run)
set -euo pipefail

KOA_USER=koa
KOA_DIR=/opt/koa
KOA_HOME=/var/lib/koa
KOA_CONF=/etc/koa

log() { echo "[bootstrap] $*"; }

# --- Node.js 20 LTS via NodeSource ---
if ! command -v node &>/dev/null || [[ "$(node --version)" != v20* ]]; then
  log "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  log "Node.js $(node --version) already installed"
fi

# --- Caddy via apt ---
if ! command -v caddy &>/dev/null; then
  log "Installing Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
else
  log "Caddy already installed"
fi

# --- koa system user ---
if ! id "$KOA_USER" &>/dev/null; then
  log "Creating system user $KOA_USER..."
  useradd --system --no-create-home --shell /usr/sbin/nologin "$KOA_USER"
else
  log "User $KOA_USER already exists"
fi

# --- Directories ---
log "Creating directories..."
mkdir -p "$KOA_DIR" "$KOA_HOME" "$KOA_CONF" /var/log/caddy
chown "$KOA_USER:$KOA_USER" "$KOA_DIR" "$KOA_HOME"
chmod 750 "$KOA_DIR" "$KOA_HOME" "$KOA_CONF"

# --- env file skeleton (if not present) ---
if [[ ! -f "$KOA_CONF/env" ]]; then
  log "Creating $KOA_CONF/env skeleton (fill in before starting)..."
  cat > "$KOA_CONF/env" <<'ENV'
ANTHROPIC_API_KEY=
KOA_WEB_TOKEN=
KOA_HOME=/var/lib/koa
KOA_OLLAMA_BASE_URL=http://localhost:11434
ENV
  chmod 640 "$KOA_CONF/env"
  chown root:"$KOA_USER" "$KOA_CONF/env"
fi

# --- systemd service ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Installing systemd service..."
cp "$SCRIPT_DIR/koa.service" /etc/systemd/system/koa.service
systemctl daemon-reload
systemctl enable koa

log "Done. Edit $KOA_CONF/env, deploy the build to $KOA_DIR, then: systemctl start koa"
