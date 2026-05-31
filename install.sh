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
fi

# ─── Environment setup ────────────────────────────────────────────────────────
header "Environment setup"

ENV_FILE="$SCRIPT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  # Check if key is actually set (non-empty)
  if grep -qE '^ANTHROPIC_API_KEY=.+' "$ENV_FILE"; then
    success ".env already configured"
  else
    warn ".env exists but ANTHROPIC_API_KEY is empty"
    read -rp "  Enter your Anthropic API key: " API_KEY
    # Replace or append the key
    if grep -q '^ANTHROPIC_API_KEY=' "$ENV_FILE"; then
      sed -i.bak "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${API_KEY}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
      echo "ANTHROPIC_API_KEY=${API_KEY}" >> "$ENV_FILE"
    fi
    success ".env updated"
  fi
else
  info "Creating .env"
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" > "$ENV_FILE"
    success ".env created from environment variable"
  else
    read -rp "  Enter your Anthropic API key (or press Enter to skip): " API_KEY
    if [[ -n "$API_KEY" ]]; then
      echo "ANTHROPIC_API_KEY=${API_KEY}" > "$ENV_FILE"
      success ".env created"
    else
      cat > "$ENV_FILE" <<'EOF'
# Required — get your key at https://console.anthropic.com
ANTHROPIC_API_KEY=
EOF
      warn ".env created without API key — edit it before running koa"
    fi
  fi
fi

# ─── Install dependencies ─────────────────────────────────────────────────────
header "Installing dependencies"

info "Root packages"
npm install --prefix "$SCRIPT_DIR"
success "Root packages installed"

info "Web packages"
npm install --prefix "$SCRIPT_DIR/web"
success "Web packages installed"

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
