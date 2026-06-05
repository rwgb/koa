# Koa Runbook

## Overview

Koa is a personal AI assistant CLI and web console built on Claude. All persistent data lives in `~/.koa/` (override with the `KOA_HOME` environment variable):

| Path | Contents |
|------|----------|
| `~/.koa/koa.db` | SQLite database — projects, tasks, decisions, audit log |
| `~/.koa/config.json` | Persistent runtime configuration |
| `~/.koa/credentials` | Encrypted credentials (API key, web token) |
| `~/.koa/logs/` | JSON structured logs, one file per day |
| `~/.koa/backups/` | Database backups created by `koa backup` |

---

## Starting Koa

### Interactive chat (TUI)

```bash
koa chat
koa chat --model fast          # use Haiku (cheaper)
koa chat --model powerful      # use Opus
koa chat --no-cache            # disable response cache
```

### Web console

```bash
koa web                        # http://localhost:3000
koa web --port 8080            # custom port
koa web --no-open              # don't launch browser
```

---

## Database Operations

### Migrations

Run on every deploy or after upgrading Koa. Safe to run multiple times.

```bash
koa migrate
```

### Backup

Copy the database to `~/.koa/backups/koa-<timestamp>.db`. Keeps the last 14 backups automatically.

```bash
koa backup
```

### Restore

**Stop koa first, then restore, then restart.**

```bash
systemctl --user stop koa        # or kill the process
koa restore koa-2026-05-31T12-00-00.db   # filename from ~/.koa/backups/
systemctl --user start koa
```

You can also pass an absolute path to a backup file.

### Export

Export all projects, tasks, and decisions as a JSON file.

```bash
koa export                        # writes koa-export-<date>.json
koa export /tmp/my-export.json    # custom path
```

### Import

Import from a `koa export` JSON file. Existing IDs are skipped (idempotent).

```bash
koa import koa-export-2026-05-31.json
```

### Maintenance

Run `VACUUM` and `ANALYZE` to reclaim space and update query planner statistics.

```bash
koa maintenance
```

Run this weekly or after bulk deletes.

### Seed

Populate a fresh database with sample data for UI testing.

```bash
koa seed
```

Creates a "Demo" project with 5 tasks across all statuses. Skips if "Demo" already exists.

---

## Health Check

### CLI

```bash
koa health
```

Prints DB connection status, WAL size, and row counts per table.

### HTTP

```bash
curl http://localhost:3000/api/ping
# → {"ok":true}
```

---

## Systemd Unit

Create `~/.config/systemd/user/koa.service`:

```ini
[Unit]
Description=Koa Personal AI Assistant
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/koa web --no-open --port 3000
Restart=on-failure
RestartSec=5
EnvironmentFile=%h/.config/koa/env
Environment=KOA_HOME=%h/.local/share/koa
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

Create the env file with your secrets before starting the service. Keep it out of version control:

```bash
mkdir -p ~/.config/koa
chmod 700 ~/.config/koa
cat > ~/.config/koa/env <<'EOF'
ANTHROPIC_API_KEY=your-key-here
EOF
chmod 600 ~/.config/koa/env
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable koa
systemctl --user start koa
systemctl --user status koa
```

---

## Log Rotation

Logs are written to `~/.koa/logs/koa-<YYYY-MM-DD>.log` in JSON format (one entry per line).

Create `/etc/logrotate.d/koa` (or `~/.config/logrotate/koa` for user-level rotation):

```
/home/<user>/.koa/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 <user> <user>
}
```

Run manually: `logrotate -f /etc/logrotate.d/koa`

---

## Tailscale + nginx TLS

For external access, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

The recommended pattern is:

1. Expose the koa web process on `localhost:3000`
2. Reverse-proxy through nginx with TLS termination
3. Restrict access to your Tailscale network (no public internet exposure)

Koa itself does not terminate TLS.
