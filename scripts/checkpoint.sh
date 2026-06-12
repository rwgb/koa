#!/usr/bin/env bash
# Koa session checkpoint — call after DEVLOG.md and STATE.md are updated.
# Usage: ./scripts/checkpoint.sh <label> [summary]
#   label   — e.g. "CP6" or "CP6: smart routing"
#   summary — optional one-liner appended to the ntfy body
#
# Sends an ntfy notification and prints a confirmation.
# Exits non-zero if any step fails so callers see the failure.

set -euo pipefail

LABEL="${1:-checkpoint}"
SUMMARY="${2:-}"

KOA_CREDENTIALS="${KOA_HOME:-${HOME}}/.koa/credentials"
# Portable parsing (BSD/macOS grep has no -P): take everything after the first '='.
NTFY_TOPIC="${KOA_NTFY_TOPIC:-$(grep -m1 '^NTFY_TOPIC=' "${KOA_CREDENTIALS}" 2>/dev/null | cut -d= -f2- || true)}"
NTFY_BASE_URL="${KOA_NTFY_BASE_URL:-$(grep -m1 '^NTFY_BASE_URL=' "${KOA_CREDENTIALS}" 2>/dev/null | cut -d= -f2- || true)}"
NTFY_BASE_URL="${NTFY_BASE_URL:-https://ntfy.sh}"

if [[ -z "${NTFY_TOPIC}" ]]; then
  echo "WARNING: NTFY_TOPIC not configured — checkpoint notification skipped" >&2
  exit 0
fi

NTFY_URL="${NTFY_BASE_URL}/${NTFY_TOPIC}"

# ── Sanity checks ────────────────────────────────────────────────────────────

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || pwd)"

if [[ ! -f "${REPO_ROOT}/DEVLOG.md" ]]; then
  echo "ERROR: DEVLOG.md not found at ${REPO_ROOT}" >&2
  exit 1
fi

# Warn (not fail) if DEVLOG.md hasn't been touched in the last 10 minutes
DEVLOG_AGE=$(( $(date +%s) - $(stat -f %m "${REPO_ROOT}/DEVLOG.md" 2>/dev/null || stat -c %Y "${REPO_ROOT}/DEVLOG.md") ))
if (( DEVLOG_AGE > 600 )); then
  echo "WARNING: DEVLOG.md was last modified ${DEVLOG_AGE}s ago — did you forget to update it?" >&2
fi

# ── Build notification body ───────────────────────────────────────────────────

BRANCH="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
BODY="${LABEL}"
if [[ -n "${SUMMARY}" ]]; then
  BODY="${BODY} — ${SUMMARY}"
fi
BODY="${BODY} [${BRANCH}]"

# ── Send ntfy ────────────────────────────────────────────────────────────────

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -d "${BODY}" \
  -H "Title: Koa checkpoint" \
  -H "Priority: default" \
  -H "Tags: white_check_mark" \
  "${NTFY_URL}")

if [[ "${HTTP_STATUS}" != "200" ]]; then
  echo "ERROR: ntfy returned HTTP ${HTTP_STATUS}" >&2
  exit 1
fi

echo "[checkpoint] ✓ ${BODY}"
echo "[checkpoint] ntfy → ${NTFY_URL}"
