# Bridge Tray App + Web Scan Button — Design Spec
Date: 2026-05-11

## Overview

Convert the Electron bridge from a windowed app to a headless system-tray app. Add a pull-based card scan trigger: the mechanic clicks "Scan card" in the browser, the bridge reads the card, and the result flows through the existing WebSocket → CardToast pipeline.

---

## Bridge Changes

### Remove
- `BrowserWindow` creation and all related code
- `preload.ts` and the `preload` webPreferences entry
- IPC handlers (`reader:start`, `reader:stop`)
- `sendToRenderer` function
- `renderer/` directory (HTML/CSS/JS for the old UI window)
- `import { ipcMain }` from electron

### Add: System Tray

Use Electron's built-in `Tray` + `Menu` APIs. Icon stored at `bridge/assets/tray-icon.png` (16×16 or 22×22, provided as a placeholder until real icon is made).

Context menu items:
- **Reader: Open** — calls `openReader()`, disabled when already open
- **Reader: Close** — calls `closeReader()`, disabled when not open
- _(separator)_
- **Quit** — calls `app.quit()`

Tray tooltip: `"Vehicle Card Bridge — reader open"` or `"Vehicle Card Bridge — reader closed"`.

Tray icon updates when reader state changes (two icon variants: active / inactive).

### Auto-open reader on startup

After creating the tray, call `openReader()` immediately. If it fails (no device connected), log the error and leave reader closed — the mechanic can open it from the tray menu or plug in the device and click "Open".

### Auto-start on login

Call `app.setLoginItemSettings({ openAtLogin: true })` once during `app.whenReady()`. No toggle in UI for now — always on.

### HTTP server: add `/reader/scan`

New endpoint: `POST /reader/scan`

Behaviour:
1. If reader is not open → `503 { error: 'Reader not open' }`
2. Call `activeReader.readCard()` (already implemented in `CardReader`)
3. Broadcast result via WebSocket (`broadcast(wss, { type: 'card.read', payload: ... })`)
4. Return `200 { ok: true, cardType, cardSerial, parsedData }`
5. On error → `500 { error: message }`

The WebSocket broadcast is the primary delivery path to the web app. The HTTP response is a secondary confirmation.

### HTTP server: CORS

Change `Access-Control-Allow-Origin` from `'null'` (Electron renderer) to `process.env.WEB_ORIGIN ?? 'http://localhost:3002'` so the browser web app can call the HTTP endpoints.

Also add handling for `OPTIONS` preflight: return 204 with appropriate `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`.

---

## Web Changes

### Scan button — vehicles list page

Location: top-right area of the vehicles list page, alongside the existing "New vehicle" button.

States:
- **Idle:** "Scan card" with a `ScanLine` (lucide) icon, outlined/ghost style
- **Loading:** spinner, button disabled, text "Scanning…"
- **Error:** small red text below the button for 3 seconds: "Card reader not connected" or "Scan failed"
- **Success:** button resets to idle; the existing `CardToast` appears with the card data

Logic:
1. Click → set loading state
2. `POST http://localhost:4000/reader/scan` (no auth header; bridge is local-only)
3. On success → reset to idle (CardToast fires from WebSocket independently)
4. On network error / non-2xx → show error message, reset after 3 s
5. Timeout after 10 s if bridge doesn't respond

### No new state management needed

The card data delivery path is already complete: bridge WebSocket → `useBridgeSocket` hook → `BridgeProvider` → `CardToast`. The scan button only triggers the read; it does not need to handle the card data itself.

### Bridge URL

Hardcoded to `http://localhost:4000` for now (matches `BRIDGE_HTTP_PORT` default). Move to an env var (`NEXT_PUBLIC_BRIDGE_URL`) so it can be overridden in production config.

---

## Data Flow

```
[Mechanic clicks "Scan card"]
        ↓
[Web: POST localhost:4000/reader/scan]
        ↓
[Bridge HTTP server: /reader/scan]
        ↓
[CardReader.readCard() → C++ binary → eVehicleRegistrationAPI.dll]
        ↓
[Bridge: broadcast via WebSocket (port 4001)]
        ↓
[Web: useBridgeSocket receives card.read event]
        ↓
[BridgeProvider → CardToast appears with card data]
```

---

## Files Changed

### Bridge
- `bridge/src/main.ts` — rewrite: remove window/IPC, add Tray, auto-open reader, auto-start
- `bridge/src/server/http.ts` — add `/reader/scan`, fix CORS
- `bridge/src/bridge/port-manager.ts` — add `readFromActive()` so http.ts can trigger a card read without importing `CardReader` directly
- `bridge/assets/tray-icon.png` — placeholder icon (create minimal PNG)
- `bridge/assets/tray-icon-active.png` — variant for open reader state

### Web
- `web/app/(dashboard)/vehicles/page.tsx` — add Scan button
- `web/lib/bridge.ts` (new) — `scanCard()` fetch helper + `BRIDGE_URL` constant
- `web/.env.local` (if not exists) — `NEXT_PUBLIC_BRIDGE_URL=http://localhost:4000`

---

## Packaging & Distribution

Users download a pre-built installer from a download link. Built with `electron-builder`.

### Per platform
| Platform | Output | Notes |
|----------|--------|-------|
| Windows  | `.exe` NSIS installer | Auto-start via registry; installs to Program Files |
| macOS    | `.dmg` | Auto-start via `app.setLoginItemSettings`; arm64 + x64 universal build |
| Linux    | `.AppImage` | Portable, no install needed; auto-start via `~/.config/autostart` `.desktop` file written by the app |

### electron-builder config (in `bridge/package.json`)
- `appId`: `com.citmec.bridge`
- `productName`: `Vehicle Card Bridge`
- Windows: NSIS one-click installer, icon from `assets/icon.ico`
- macOS: DMG, icon from `assets/icon.icns`
- Linux: AppImage, icon from `assets/icon.png`
- `publish`: not configured yet (manual distribution via download link for now)

### Download link
Hosted wherever the SaaS web app is deployed (e.g. `/downloads/bridge-setup.exe`). Each platform gets its own link. Version shown in the download page matches the `bridge/package.json` version. This is a static file host — no auto-update server needed in sprint 1.

---

## Out of Scope

- Tray icon design (placeholder used; real icon added later)
- Auto-update server / Squirrel / electron-updater publish config
- Code signing (Windows SmartScreen warning will appear; acceptable for now)
- Bridge settings UI
- Multiple simultaneous readers
- Auth on bridge HTTP endpoints (local-only, 127.0.0.1 bound)
