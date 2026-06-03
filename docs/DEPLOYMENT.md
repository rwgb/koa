# Koa Deployment Guide

## Local Setup

```bash
# 1. Build
npm run build

# 2. Link the CLI globally (first time only)
npm link

# 3. Set your API key
koa config set api-key sk-ant-...

# 4. (Optional) Generate a web token for auth
koa config set web-token

# 5. Run migrations
koa migrate

# 6. Start the web console
koa web
```

The web console listens on `http://localhost:3000` by default.

---

## Systemd Service

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
Environment=ANTHROPIC_API_KEY=sk-ant-...
Environment=KOA_HOME=%h
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable koa
systemctl --user start koa
```

Logs: `journalctl --user -u koa -f`

---

## External Access via Tailscale (Preferred)

Tailscale is the recommended approach — no public internet exposure, no port forwarding.

1. Install Tailscale on the host: https://tailscale.com/download
2. Join your tailnet: `sudo tailscale up`
3. Note your machine's Tailscale IP (e.g. `100.x.x.x`) or MagicDNS name
4. Access Koa from any device on your tailnet: `http://<tailscale-ip>:3000`

For TLS on Tailscale (HTTPS), enable Tailscale HTTPS certificates:

```bash
sudo tailscale cert <machine-name>.<tailnet>.ts.net
```

Then configure nginx to terminate TLS (see section below).

---

## nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name koa.internal.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name koa.internal.example.com;

    ssl_certificate     /etc/ssl/certs/koa.crt;
    ssl_certificate_key /etc/ssl/private/koa.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Restrict to Tailscale network (adjust subnet as needed)
    allow 100.64.0.0/10;
    deny all;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        # SSE support: disable buffering for /api/chat
        proxy_buffering    off;
    }
}
```

Koa itself does not terminate TLS — always place a TLS-terminating proxy in front for external access.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `KOA_HOME` | No | Base directory (default: `~`) — data stored at `$KOA_HOME/.koa/` |
| `KOA_WEB_TOKEN` | No | Bearer token for web console auth (set via `koa config set web-token`) |
| `KOA_MODEL` | No | Default model: `fast` / `standard` / `powerful` or full model ID |
| `KOA_MAX_TOKENS` | No | Max tokens per response (default: 8096) |
| `KOA_NO_CACHE` | No | Set to `true` to disable response caching |
| `KOA_SMART_ROUTING` | No | Set to `true` to enable smart model routing |
| `KOA_COMPACT_TURNS` | No | Auto-compact after N turns (default: 10) |
| `KOA_CHECKPOINT_TURNS` | No | Auto-checkpoint every N turns (default: 5) |
| `KOA_CHECKPOINT_MINUTES` | No | Auto-checkpoint every N minutes (default: 15) |

Variables set in the environment take precedence over values in `~/.koa/config.json` and `~/.koa/credentials`.
