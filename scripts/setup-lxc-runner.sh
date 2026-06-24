#!/usr/bin/env bash
# Install and register a GitHub Actions self-hosted runner on the Koa LXC.
# Run this locally — it generates a token and SSHes to 192.168.1.200 to set up.
#
# Usage:
#   ./scripts/setup-lxc-runner.sh [runner-version]
#
# Requires: gh CLI authenticated locally, SSH access to root@192.168.1.200
set -euo pipefail

RUNNER_VERSION=${1:-2.323.0}
RUNNER_DIR=/opt/actions-runner
REPO=rwgb/koa
LXC_HOST=root@192.168.1.200

log() { echo "[runner-setup] $*"; }

# ── 1. Generate registration token (local — requires gh auth) ────────────────
log "Generating runner registration token for ${REPO}..."
RUNNER_TOKEN=$(gh api -X POST "repos/${REPO}/actions/runners/registration-token" -q .token)
if [[ -z "$RUNNER_TOKEN" ]]; then
  echo "ERROR: Failed to generate registration token. Is gh CLI authenticated?" >&2
  exit 1
fi
log "Token obtained."

# ── 2. Detect latest runner version if not pinned ───────────────────────────
if [[ "$RUNNER_VERSION" == "latest" ]]; then
  RUNNER_VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
    | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')
  log "Latest runner version: ${RUNNER_VERSION}"
fi

ARCH=linux-x64
TAR="actions-runner-${ARCH}-${RUNNER_VERSION}.tar.gz"

# ── 3. Install on LXC via SSH ────────────────────────────────────────────────
log "Installing runner v${RUNNER_VERSION} on ${LXC_HOST}..."
ssh "$LXC_HOST" bash -s -- "$RUNNER_DIR" "$TAR" "$RUNNER_VERSION" "$ARCH" "$REPO" "$RUNNER_TOKEN" <<'REMOTE'
set -euo pipefail
RUNNER_DIR=$1; TAR=$2; RUNNER_VERSION=$3; ARCH=$4; REPO=$5; RUNNER_TOKEN=$6

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [[ ! -f "$TAR" ]]; then
  echo "[lxc] Downloading runner tarball..."
  curl -fsSL -o "$TAR" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TAR}"
fi
tar xzf "$TAR"

echo "[lxc] Configuring runner..."
RUNNER_ALLOW_RUNASROOT=1 ./config.sh \
  --url "https://github.com/${REPO}" \
  --token "$RUNNER_TOKEN" \
  --name "koa-lxc" \
  --labels "self-hosted,koa-lxc" \
  --unattended \
  --replace

echo "[lxc] Installing systemd service..."
RUNNER_ALLOW_RUNASROOT=1 ./svc.sh install root
RUNNER_ALLOW_RUNASROOT=1 ./svc.sh start

echo "[lxc] Runner service status:"
./svc.sh status || true
REMOTE

log "Runner installed. Verifying registration..."
sleep 5
gh api "repos/${REPO}/actions/runners" -q \
  '.runners[] | select(.name == "koa-lxc") | "name=\(.name) status=\(.status)"'

log "Done. Visit https://github.com/${REPO}/settings/actions/runners to confirm."
