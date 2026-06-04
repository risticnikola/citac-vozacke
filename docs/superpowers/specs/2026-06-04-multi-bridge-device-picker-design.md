# Multi-Bridge Device Picker Design

**Date:** 2026-06-04  
**Status:** Approved

## Problem

Multiple bridge instances can connect under the same tenant (home PC, work laptop, etc.).
The scan route (`POST /v1/scan`) always sends to `active[0]` — whichever bridge happened
to connect first. When two bridges are online simultaneously, scans go to the wrong device.

## Goal

Let each browser session select which connected bridge to scan with. The selection persists
across page refreshes but gracefully handles the selected device going offline.

## Approach

Use the existing WebSocket infrastructure (web-hub) to push real-time device presence to
browsers. No polling, no separate REST endpoint for online status.

---

## Architecture

### Data flow

```
bridge connects → bridge-hub stores socket + fetches name/platform from DB
              → emits device_online to bridgeEvents
              → web-hub broadcasts devices.list to all browser WS clients for that tenant

browser WS connects → web-hub immediately sends current devices.list snapshot

bridge disconnects → bridge-hub removes socket
                  → emits device_offline to bridgeEvents
                  → web-hub broadcasts updated devices.list

user clicks Scan → POST /v1/scan { deviceId } → bridge-hub routes to that socket
```

---

## API Changes

### `bridge-hub.ts`

**New map:**
```ts
deviceSockets: Map<deviceId, { ws: WebSocket; name: string | null; platform: string | null }>
```

Both `bridgeSockets` (by tenantId) and `deviceSockets` (by deviceId) are kept in sync.

**On bridge connect:**
- Fetch `name`, `platform` from DB for the connecting deviceId (already doing a DB roundtrip for public key verification — extend the same query)
- Store in `deviceSockets`
- Emit `device_online` to `bridgeEvents` with `{ tenantId, deviceId, name, platform }`

**On bridge disconnect:**
- Remove from `deviceSockets`
- Emit `device_offline` to `bridgeEvents` with `{ tenantId, deviceId }`

**New exports:**
```ts
getOnlineDevicesForTenant(tenantId: string): { id: string; name: string | null; platform: string | null }[]
```

### `web-hub.ts`

**On browser WS connect:**
- Call `getOnlineDevicesForTenant(tenantId)`
- Send `{ type: 'devices.list', devices: [...] }` immediately

**New subscriptions:**
```ts
bridgeEvents.on('device_online',  ...) // broadcast updated devices.list to tenant's browser clients
bridgeEvents.on('device_offline', ...) // same
```

Both handlers call `getOnlineDevicesForTenant(tenantId)` and broadcast the full updated list
(not a delta) — simpler for the client to handle.

### `app.ts` — scan route

**Request body:** `{ deviceId: string }`

**Routing:**
- Look up socket via `deviceSockets.get(deviceId)`
- If not found or not OPEN → 503 `{ error: 'Device not connected' }`
- If found → send `{ type: 'scan' }` to that socket

---

## Web Changes

### `useBridgeSocket.ts`

**New state:**
```ts
onlineDevices: { id: string; name: string | null; platform: string | null }[]
selectedDeviceId: string | null
```

**localStorage key:** `bridge_selected_device`

**On mount:**
- Read `localStorage.getItem('bridge_selected_device')` → set as initial `selectedDeviceId`
- If key missing or localStorage unavailable → `null`

**On `devices.list` message:**
- Update `onlineDevices`
- If current `selectedDeviceId` is not in new list → set `selectedDeviceId = null`
  (device went offline; user must re-select; do NOT auto-switch)

**`setSelectedDeviceId(id: string | null)`:**
- Update state
- Persist to `localStorage.setItem('bridge_selected_device', id)` or `removeItem` if null

**Updated `connected` field:**  
`connected = onlineDevices.length > 0` (at least one bridge online for this tenant)

**New export on `BridgeSocketState`:**
```ts
onlineDevices: { id: string; name: string | null; platform: string | null }[]
selectedDeviceId: string | null
setSelectedDeviceId: (id: string | null) => void
```

### `BridgeProvider.tsx`

Pass through new fields from `useBridgeSocket` via context. No logic changes needed.

### `TopBar.tsx` — `BridgeStatus` → `BridgeDevicePicker`

**States:**

| Condition | Dot color | Label | Clickable |
|-----------|-----------|-------|-----------|
| 0 devices online | Grey | "No reader" | No |
| Devices online, none selected OR selected went offline | Amber | "Select reader" | Yes → opens dropdown |
| Device selected + online | Green | device name or platform or "Device" | Yes → opens dropdown to switch |

**Dropdown:**
- Lists all online devices
- Each item shows: `name ?? platform ?? 'Unknown device'`
- Checkmark on currently selected
- Clicking an item calls `setSelectedDeviceId(id)`
- Clicking selected item again deselects (sets null)

**Device label priority:** `name` → `platform` (capitalized) → `'Unknown device'`

### `lib/bridge.ts`

```ts
export async function scanCard(deviceId: string): Promise<void> {
  await apiClient.post('/v1/scan', { deviceId });
}
```

### `vehicles/page.tsx`

- Read `selectedDeviceId` from `useBridge()`
- Scan button disabled when `!selectedDeviceId` (no device selected or device offline)
- Tooltip/hint text when disabled: "Select a reader in the top bar"
- Pass `selectedDeviceId` to `scanCard(selectedDeviceId)`

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Selected device goes offline | `selectedDeviceId` → null, amber dot, scan disabled |
| `localStorage` not available | Silently fall back to null (in-memory only) |
| Stored deviceId not in devices.list on load | Treat as null, let user pick fresh |
| `POST /v1/scan` with offline deviceId | API returns 503; web shows scan error |

---

## Out of Scope

- Scan-to-all (broadcast) mode — not needed; user always selects explicitly
- Device rename UI — uses existing name from activation wizard
- Admin device management UI changes — no changes needed
