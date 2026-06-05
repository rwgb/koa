#!/usr/bin/env bash
# Push-and-restart deploy to a remote Koa host.
# Usage: KOA_HOST=user@host ./scripts/deploy.sh
set -euo pipefail

: "${KOA_HOST:?KOA_HOST must be set (e.g. koa@192.168.1.50)}"
REMOTE_DIR=${KOA_REMOTE_DIR:-/opt/koa}

log() { echo "[deploy] $*"; }

# --- Build ---
log "Building TypeScript..."
npm run build

log "Building web UI..."
npm run build:web

# --- Sync ---
log "Syncing to $KOA_HOST:$REMOTE_DIR ..."
rsync -az --delete \
  dist/ \
  "$KOA_HOST:$REMOTE_DIR/dist/"

rsync -az --delete \
  web/dist/ \
  "$KOA_HOST:$REMOTE_DIR/web/dist/"

rsync -az --delete \
  --exclude='.cache' \
  node_modules/ \
  "$KOA_HOST:$REMOTE_DIR/node_modules/"

rsync -az \
  package.json \
  "$KOA_HOST:$REMOTE_DIR/package.json"

# --- Restart ---
log "Restarting koa service..."
ssh "$KOA_HOST" "sudo systemctl restart koa && systemctl is-active --quiet koa && echo 'koa is running'"

log "Deploy complete."
