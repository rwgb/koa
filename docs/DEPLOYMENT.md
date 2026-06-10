# Koa Deployment Guide

This guide covers local development setup, deploying to a homelab server (Debian 12 LXC), the systemd service, Caddy reverse proxy, and Tailscale access.

---

## Local Development Setup

```bash
# 1. Clone and install dependencies
git clone git@github.com:<your-username>/koa.git
cd koa
./install.sh

# 2. Verify the CLI is linked
koa --version

# 3. Run DB migrations
koa migrate

# 4. Start the web console
koa web
# Opens http://localhost:3000 automatically
```

The install script handles: dependency install, TypeScript compile, Vite build, and `npm link` for the global `koa` command. Pass `--no-global` to skip the link step.

### Development servers (hot-reload)

```bash
# Terminal 1 — Express + AgentLoop
npm run dev

# Terminal 2 — Vite dev server with /api proxy
cd web && npm run dev
# Open http://localhost:5173
```

---

## Docker Deployment

A multi-stage Dockerfile is included. The final image is minimal: no build tools, no source files — only compiled output and production dependencies.

### Build

```bash
docker build -t koa:latest .
```

The build stages:
1. **builder** — installs all deps, runs `tsc` and `npm run build:web`, then prunes to production deps
2. **runtime** — copies `dist/`, `web/dist/`, and prod `node_modules/` into a `node:20-slim` image

### Run

```bash
docker run -d \
  --name koa \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e KOA_WEB_TOKEN=your-secret-token \
  -e KOA_HOME=/data \
  -v koa-data:/data \
  koa:latest
```

The container runs as a non-root `koa` user. All persistent data is written to `/data` (override with `KOA_HOME`).

### Docker Compose

```yaml
version: "3.9"
services:
  koa:
    image: koa:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      KOA_WEB_TOKEN: ${KOA_WEB_TOKEN}
      KOA_HOME: /data
    volumes:
      - koa-data:/data

volumes:
  koa-data:
```

---

## Homelab: Debian 12 LXC Setup

The `deploy/bootstrap.sh` script prepares a fresh Debian 12 LXC container. It is idempotent — safe to re-run after updates.

### What bootstrap.sh does

1. Installs Node.js 20 LTS via NodeSource
2. Installs Caddy via the official apt repository
3. Creates a `koa` system user (no shell, no home directory)
4. Creates `/opt/koa`, `/var/lib/koa`, `/etc/koa` with appropriate permissions (`750`/`640`)
5. Creates `/etc/koa/env` skeleton (fill in before starting)
6. Copies and enables the systemd service

### Run the bootstrap

```bash
# On the target server (run as root)
scp deploy/bootstrap.sh root@<server>:/tmp/
scp deploy/koa.service root@<server>:/tmp/

ssh root@<server>
bash /tmp/bootstrap.sh
```

The script will tell you what to do next:

```
Done. Edit /etc/koa/env, deploy the build to /opt/koa, then: systemctl start koa
```

### Fill in /etc/koa/env

```bash
nano /etc/koa/env
```

At minimum:

```
ANTHROPIC_API_KEY=sk-ant-...
KOA_WEB_TOKEN=<strong-random-token>
KOA_HOME=/var/lib/koa
```

The file is owned `root:koa` with mode `0640` — the `koa` service user can read it, other users cannot.

---

## Deploy Script

`scripts/deploy.sh` builds locally and rsyncs the compiled output to the remote server.

```bash
# Set the target
export KOA_HOST=koa@192.168.1.50

# Run deploy (builds, syncs, restarts)
./scripts/deploy.sh
```

The script:
1. Runs `npm run build` and `npm run build:web` locally (aborts on failure)
2. rsyncs `dist/`, `web/dist/`, `node_modules/`, and `package.json` to `$REMOTE_DIR` (default `/opt/koa`)
3. SSHs to the server and runs `sudo systemctl restart koa`

### Sudoers for restricted restart

Scope `sudo` to the restart command only. On the server:

```bash
visudo -f /etc/sudoers.d/koa
```

Add:

```
koa ALL=(root) NOPASSWD: /bin/systemctl restart koa
koa ALL=(root) NOPASSWD: /bin/systemctl is-active --quiet koa
```

---

## systemd Service

The service file at `deploy/koa.service` is installed to `/etc/systemd/system/koa.service` by bootstrap.sh.

```ini
[Unit]
Description=Koa Personal AI Assistant
After=network.target

[Service]
Type=simple
User=koa
Group=koa
WorkingDirectory=/opt/koa
EnvironmentFile=/etc/koa/env
ExecStart=/usr/bin/node /opt/koa/dist/cli/index.js web --port 3000
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=koa

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/koa

[Install]
WantedBy=multi-user.target
```

### Service commands

```bash
systemctl start koa
systemctl stop koa
systemctl restart koa
systemctl status koa

# Follow logs
journalctl -u koa -f

# Logs since last boot
journalctl -u koa -b
```

### Hardening notes

- `NoNewPrivileges` — no SUID escalation
- `PrivateTmp` — isolated `/tmp`
- `ProtectSystem=strict` — filesystem is read-only except for `ReadWritePaths`
- `ReadWritePaths=/var/lib/koa` — the only directory Koa can write to
- If you need Koa to write to additional paths (e.g., a project directory for file tools), add them to `ReadWritePaths`

---

## Caddy Reverse Proxy

Caddy handles TLS termination, HSTS, and structured logging. The Caddyfile is in `deploy/Caddyfile`.

### Install

Bootstrap already installs Caddy. If you need to install it manually:

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

### Configure

Copy the Caddyfile:

```bash
cp deploy/Caddyfile /etc/caddy/Caddyfile
```

Edit it to set your domain (or use the environment variable):

```
koa.example.com {
    reverse_proxy localhost:3000 {
        ...
    }
}
```

Or run with `KOA_DOMAIN` set:

```bash
KOA_DOMAIN=koa.example.com caddy run --config /etc/caddy/Caddyfile
```

The Caddyfile sets these security headers on every response:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Server` | (removed) |

Logs are written to `/var/log/caddy/koa.log` in structured JSON format.

### Enable Caddy service

```bash
systemctl enable --now caddy
```

### Reload after Caddyfile changes

```bash
systemctl reload caddy
# or
caddy reload --config /etc/caddy/Caddyfile
```

---

## Tailscale Access

The recommended setup is to keep Koa off the public internet and access it exclusively over your Tailscale network.

```bash
# Install Tailscale on the server
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Get the Tailscale IP
tailscale ip -4
# → 100.x.x.x
```

Configure Caddy to listen only on the Tailscale interface by setting `KOA_DOMAIN` to your Tailscale machine name (automatically issued a TLS certificate by Tailscale's CA):

```
koa.example.ts.net {
    reverse_proxy localhost:3000 {
        ...
    }
}
```

Tailscale issues a certificate for your machine name via LetsEncrypt + their ACME proxy, so you get HTTPS without opening any ports to the internet.

### Restricting to Tailscale only

Bind Koa to `localhost` (already the default — it does not bind to `0.0.0.0`). Caddy listens on the Tailscale IP. Traffic from outside your tailnet cannot reach either service.

---

## Environment Variables Reference

Copy `.env.example` to `/etc/koa/env` on the server and fill in values. Never commit a file with real secrets.

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key |
| `KOA_WEB_TOKEN` | — | Bearer token for web console auth |
| `KOA_HOME` | `~/.koa` | Root for DB, credentials, memories, logs |
| `KOA_MODEL` | `claude-haiku-4-5-20251001` | Default Claude model |
| `KOA_MAX_TOKENS` | model max | Max output tokens per turn |
| `KOA_PROVIDER` | `anthropic` | `anthropic` or `ollama` |
| `KOA_OLLAMA_MODEL` | `llama3.2` | Ollama model tag |
| `KOA_OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `KOA_SMART_ROUTING` | `false` | Auto-route by message complexity |
| `KOA_ENGRAM` | `true` | Enable Engram memory |
| `KOA_COMPACT_TURNS` | `20` | Context compaction window |
| `KOA_CHECKPOINT_TURNS` | — | Auto-checkpoint every N turns |
| `KOA_CHECKPOINT_MINUTES` | — | Auto-checkpoint every N minutes |
| `KOA_MAX_TOOL_OUTPUT` | `20000` | Max chars per tool call output |
| `KOA_NO_CACHE` | `false` | Disable prompt caching |
| `KOA_SANDBOX_BACKEND` | `local` | `local` or `docker` |
| `KOA_SANDBOX_TIMEOUT_MS` | `10000` | Code execution timeout |
| `KOA_TTS_PROVIDER` | `say` | `say` (macOS) or `elevenlabs` |
| `ELEVENLABS_API_KEY` | — | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | — | ElevenLabs voice ID |
| `SPIDERBRAIN_BRAIN` | — | Path to `synganglion.json` |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `GMAIL_CLIENT_ID` | — | Gmail OAuth client ID |
| `GMAIL_CLIENT_SECRET` | — | Gmail OAuth client secret |
| `GOOGLE_GMAIL_REFRESH_TOKEN` | — | Gmail refresh token |
| `GOOGLE_CALENDAR_CLIENT_ID` | — | Calendar OAuth client ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | — | Calendar OAuth client secret |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `SLACK_BOT_TOKEN` | — | Slack bot token |
| `SLACK_APP_TOKEN` | — | Slack app-level token |
| `TWILIO_ACCOUNT_SID` | — | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | — | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | — | Twilio phone number |
| `APNS_KEY_PATH` | — | Path to APNs `.p8` key file |
| `APNS_KEY_ID` | — | APNs key ID |
| `APNS_TEAM_ID` | — | Apple Developer team ID |
| `APNS_BUNDLE_ID` | — | iOS app bundle ID |
| `APNS_SANDBOX` | `true` | `true` for dev, `false` for production |
| `BRAVE_API_KEY` | — | Brave Search API key |
| `OPENAI_API_KEY` | — | OpenAI key for Whisper transcription |
| `KOA_DEBUG` | — | Set to any value for verbose logging |
| `NODE_ENV` | `production` | Node environment |

---

## Health Checks

### HTTP health check

```bash
curl http://localhost:3000/api/health
# → {"status":"ok","db":"ok","channels":{...},"uptime":1234.5,"version":"0.2.0"}
```

The health endpoint does not require auth. It is suitable for Caddy's health check, Uptime Kuma, or any monitoring tool.

### CLI health check

```bash
koa health
```

Prints DB connection status, WAL size, and row counts per table.

---

## Database Backup and Restore

Koa uses SQLite. The database lives at `$KOA_HOME/koa.db` (default `~/.koa/koa.db` or `/var/lib/koa/koa.db` on a server).

### Backup

```bash
koa backup
# Creates ~/.koa/backups/koa-<ISO-timestamp>.db
# Keeps the last 14 backups automatically
```

Automate with cron:

```cron
0 2 * * * /usr/local/bin/koa backup >> /var/log/koa-backup.log 2>&1
```

### Restore

**Stop the service before restoring.**

```bash
systemctl stop koa
koa restore koa-2026-05-31T12-00-00.db   # filename from ~/.koa/backups/
# or pass an absolute path
koa restore /path/to/backup.db
systemctl start koa
```

### Export / Import

```bash
# Export all projects, tasks, and decisions to JSON
koa export
# → koa-export-<date>.json

# Export to a specific path
koa export /tmp/koa-backup.json

# Import (idempotent — existing IDs are skipped)
koa import koa-export-2026-05-31.json
```

---

## Log Rotation

Logs are written to `$KOA_HOME/logs/koa-<YYYY-MM-DD>.log` in JSON format (one entry per line).

Create `/etc/logrotate.d/koa`:

```
/var/lib/koa/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 koa koa
}
```

Run manually: `logrotate -f /etc/logrotate.d/koa`

---

## Upgrading

```bash
# On your development machine
git pull
npm install
./scripts/deploy.sh
```

The deploy script builds and restarts the service automatically. Run `koa migrate` after deploy if there are DB schema changes.

```bash
ssh koa@<server> koa migrate
```

---

## Proxmox Homelab: LXC + Ollama VM (Terraform)

This section covers the production homelab topology: Koa runs in a lightweight **LXC container** (VMID 200) and Ollama in a dedicated **VM** (VMID 201) on the same Proxmox host.

```
Proxmox skull (192.168.1.161)
├── LXC 200: koa   [Debian 12]  192.168.1.200
│   ├── Koa app (Node.js, systemd, Caddy)
│   └── KOA_OLLAMA_BASE_URL=http://192.168.1.201:11434
└── VM  201: ollama [Debian 12]  192.168.1.201
    ├── Ollama (port 11434, CPU-only)
    └── ufw: 11434 restricted to 192.168.1.0/24
```

### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.7
- SSH agent running with your private key loaded (`ssh-add ~/.ssh/id_ed25519`)
- Tailscale auth key from [tailscale.com/admin/settings/keys](https://login.tailscale.com/admin/settings/keys)
- Proxmox `local` storage must have **Snippets** enabled:
  `Datacenter → Storage → local → Edit → Content → check Snippets`

### First-time setup

```bash
cd infra/terraform

# 1. Copy and fill in secrets
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars   # set proxmox_password, tailscale_authkey, ssh_public_key

# 2. Download provider and modules
terraform init

# 3. Preview what will be created
terraform plan

# 4. Provision LXC + VM (downloads Debian template + cloud image on first run)
terraform apply
```

Terraform will:
1. Download the Debian 12 LXC template and cloud image to Proxmox `local` storage
2. Create LXC 200 (`koa`) with static IP `192.168.1.200`
3. Create VM 201 (`ollama`) with static IP `192.168.1.201`
4. SSH into the LXC and run `deploy/bootstrap.sh` (Node.js, Caddy, systemd service)
5. Set `KOA_OLLAMA_BASE_URL=http://192.168.1.201:11434` in `/etc/koa/env`
6. Connect both to Tailscale

### Deploy the app after provisioning

```bash
# Wait for Ollama VM cloud-init to complete (~2 min)
ssh root@192.168.1.201 "cloud-init status --wait"

# Build and push the app to the LXC
npm run build
KOA_HOST=root@192.168.1.200 ./scripts/deploy.sh

# Pull a model on the Ollama VM
ssh root@192.168.1.201 "ollama pull llama3.2:3b"

# Set secrets on the LXC and start Koa
ssh root@192.168.1.200 "nano /etc/koa/env"   # fill KOA_WEB_TOKEN, set KOA_PROVIDER=ollama
ssh root@192.168.1.200 "systemctl start koa"
```

### Using the TUI remotely

The Koa TUI runs in-process and requires direct access to the agent loop. The simplest remote experience is SSH:

```bash
# One-off
ssh -t root@192.168.1.200 koa

# Add to ~/.zshrc for seamless local-feel access
alias koa='ssh -t root@192.168.1.200 koa'
```

Via Tailscale (from anywhere):

```bash
alias koa='ssh -t root@koa.your-tailnet.ts.net koa'
```

The web console at `http://192.168.1.200` (or `https://koa.your-tailnet.ts.net` via Tailscale) provides browser-based access with no SSH required.

### Updating the deployment

```bash
# After code changes:
npm run build && KOA_HOST=root@192.168.1.200 ./scripts/deploy.sh

# After infra changes:
cd infra/terraform && terraform apply
```

### Tearing down

```bash
cd infra/terraform
terraform destroy   # removes LXC 200 and VM 201; downloaded templates are preserved
```
