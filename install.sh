#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}▶${RESET} $*"; }
success() { echo -e "${GREEN}✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✖${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }

# ─── Script location ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Flags ────────────────────────────────────────────────────────────────────
SKIP_GLOBAL=false
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --no-global) SKIP_GLOBAL=true ;;
    --no-build)  SKIP_BUILD=true ;;
    --help|-h)
      echo "Usage: ./install.sh [--no-global] [--no-build]"
      echo "  --no-global  Skip 'npm link' (don't install koa globally)"
      echo "  --no-build   Skip TypeScript and Vite build steps"
      exit 0
      ;;
  esac
done

# ─── Pre-flight checks ────────────────────────────────────────────────────────
header "Pre-flight checks"

# Node.js ≥ 18
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install Node.js 18+ from https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  error "Node.js 18+ required (found v$(node --version))"
  exit 1
fi
success "Node.js $(node --version)"

# npm
if ! command -v npm &>/dev/null; then
  error "npm not found. Install npm (ships with Node.js)."
  exit 1
fi
success "npm $(npm --version)"

# Engram CLI (optional — warn, don't fail)
if command -v engram &>/dev/null; then
  success "Engram CLI found"
elif python3 -c "import importlib.util; exit(0 if importlib.util.find_spec('engram') else 1)" &>/dev/null; then
  success "Engram Python module found"
else
  warn "Engram CLI not found — memory features will be unavailable"
  warn "See: https://github.com/koalalorenzo/engram"
  warn "Or install the skill: ~/.claude/skills/engram/cli/engram.py"
fi

# ─── Install dependencies ─────────────────────────────────────────────────────
header "Installing dependencies"

info "Root packages"
npm install --prefix "$SCRIPT_DIR"
success "Root packages installed"

info "Web packages"
npm install --prefix "$SCRIPT_DIR/web"
success "Web packages installed"

npm rebuild better-sqlite3 --prefix "$SCRIPT_DIR" 2>/dev/null || warn "could not rebuild better-sqlite3 (may need build tools; run manually if koa fails to start)"

# ─── Build ────────────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == false ]]; then
  header "Building"

  info "Compiling TypeScript"
  npm run build --prefix "$SCRIPT_DIR"
  success "TypeScript compiled → dist/"

  info "Building web console"
  npm run build:web --prefix "$SCRIPT_DIR"
  success "Web console built → web/dist/"
fi

# ─── API key setup ────────────────────────────────────────────────────────────
# Koa reads its key from the credentials store (~/.koa/credentials) via
# `koa config set api-key`, NOT from a .env file. We persist through that path so
# the key is actually used at runtime. This runs AFTER the build.
header "API key setup"

API_KEY="${ANTHROPIC_API_KEY:-}"

if [[ -z "$API_KEY" && -t 0 ]]; then
  read -rp "  Enter your Anthropic API key (or press Enter to skip): " API_KEY || API_KEY=""
fi

if [[ -n "$API_KEY" ]]; then
  if node "$SCRIPT_DIR/dist/cli/index.js" config set api-key "$API_KEY" 2>/dev/null; then
    success "API key saved to credentials store"
  else
    warn "Could not save key via 'koa config set' — run after install:"
    warn "  koa config set api-key <your-key>"
  fi
else
  warn "No API key provided. Set one before running koa:"
  warn "  koa config set api-key <your-key>"
fi

# ─── Global CLI link ──────────────────────────────────────────────────────────
if [[ "$SKIP_GLOBAL" == false ]]; then
  header "Linking CLI globally"
  if (cd "$SCRIPT_DIR" && npm link) 2>/dev/null; then
    success "'koa' command available globally"
  else
    warn "npm link failed (may need sudo or nvm). Run manually:"
    warn "  cd \"$SCRIPT_DIR\" && npm link"
  fi
fi

# ─── Git hooks ────────────────────────────────────────────────────────────────
header "Installing git hooks"

HOOKS_DST="$SCRIPT_DIR/.git/hooks"

if [[ -d "$HOOKS_DST" ]]; then
  for hook in post-commit post-merge post-checkout; do
    dst="$HOOKS_DST/$hook"
    if [[ -L "$dst" ]] && [[ "$(readlink "$dst")" == "../../scripts/git-hooks/$hook" ]]; then
      success "$hook already linked"
    else
      ln -sf "../../scripts/git-hooks/$hook" "$dst"
      success "$hook → scripts/git-hooks/$hook"
    fi
  done
else
  warn "No .git/hooks directory (not a git checkout) — skipping git hook install"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Installation complete.${RESET}"
echo ""
echo -e "  ${BOLD}koa${RESET}           — start TUI chat session"
echo -e "  ${BOLD}koa web${RESET}       — start web console on http://localhost:3000"
echo -e "  ${BOLD}koa query <terms>${RESET} — search Engram memory"
echo ""
if [[ "$SKIP_GLOBAL" == true ]] || ! command -v koa &>/dev/null; then
  echo -e "  Run without global link: ${CYAN}npm start --prefix \"$SCRIPT_DIR\"${RESET}"
  echo ""
fi
