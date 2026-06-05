# Koa iOS Client

SwiftUI app for the Koa personal AI assistant. Connects to your Koa server via Tailscale for secure remote access.

## Requirements

- Xcode 15+
- iOS 17+ deployment target
- Apple Developer account (for APNs push notifications)
- Koa server accessible on your Tailscale network

## Xcode Project Setup

1. Open Xcode → File → New → Project → iOS App
2. Product Name: `Koa`
3. Bundle Identifier: `com.yourname.koa` (must match `APNS_BUNDLE_ID` on server)
4. Interface: SwiftUI, Language: Swift
5. Drag all `.swift` files from `ios/Koa/` into the Xcode project navigator
6. Remove the auto-generated `ContentView.swift` if present

## Capabilities

In Xcode → Target → Signing & Capabilities, add:
- **Push Notifications** (required for APNs)
- **Siri** (required for Siri Shortcuts)
- **Background Modes** → check "Remote notifications"

## APNs Server Configuration

1. Apple Developer Portal → Certificates, Identifiers & Profiles → Keys → Create a new key with APNs enabled
2. Download the `.p8` file and note the Key ID and Team ID
3. Set on your Koa server:
   ```bash
   export APNS_KEY_ID=ABCDEF1234
   export APNS_TEAM_ID=YOURTEAMID
   export APNS_BUNDLE_ID=com.yourname.koa
   export APNS_KEY_PATH=/path/to/AuthKey_ABCDEF1234.p8
   # or use base64: export APNS_KEY_BASE64=$(base64 -i AuthKey.p8)
   # For development/sandbox builds:
   export APNS_SANDBOX=true
   ```

## Tailscale Setup

1. Install Tailscale on the Mac running Koa: https://tailscale.com/download
2. Install Tailscale on your iPhone
3. Join both to the same tailnet
4. In the Koa iOS app Settings, set Server URL to your machine's Tailscale address:
   - `http://100.x.x.x:3000` (Tailscale IP), or
   - `https://machine-name.tail12345.ts.net` (MagicDNS with TLS cert)

See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) for nginx TLS reverse proxy setup.

## Siri Shortcuts

After first launch, add shortcuts in the Shortcuts app:
- **"Ask Koa what's next"** → AskKoaIntent
- **"Mark that done"** → MarkTaskDoneIntent (requires task context from previous interaction)

## File Overview

| File | Purpose |
|------|---------|
| `KoaApp.swift` | App entry, AppDelegate for APNs registration |
| `Models.swift` | Data models: Task, Project, ChatMessage, etc. |
| `AppState.swift` | @Observable app state, auth, preferences |
| `KoaAPI.swift` | REST + SSE API client |
| `SseStream.swift` | URLSession SSE streaming utility |
| `KoaIntents.swift` | App Intents for Siri Shortcuts |
| `AuthView.swift` | Bearer token login screen |
| `ChatView.swift` | Chat with SSE streaming |
| `TaskBoardView.swift` | Kanban task board |
| `TaskDetailView.swift` | Task detail and editing |
| `SettingsView.swift` | Server config, push toggle |
