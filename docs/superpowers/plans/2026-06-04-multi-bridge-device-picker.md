# Multi-Bridge Device Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each browser session select which connected bridge to scan with, persisted in localStorage, with real-time online-device list pushed via the existing WebSocket infrastructure.

**Architecture:** `bridge-hub` tracks a second map keyed by `deviceId` (storing ws + tenantId + name + platform). On connect/disconnect it emits events to `bridgeEvents`; `web-hub` listens and broadcasts `devices.list` to all browser WS clients for that tenant. The scan route accepts a `deviceId` body param and routes to the exact socket, verifying tenant ownership.

**Tech Stack:** Node.js / Fastify / ws (API), React / Next.js / Tailwind / lucide-react (web), vitest (tests)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `web/types/index.ts` | Add `OnlineDevice` type; add `'devices.list'` to `BridgeWsMessage` |
| Modify | `api/src/hub/bridge-hub.ts` | Add `deviceSockets` map; cache name/platform; emit events; export helpers |
| Modify | `api/src/hub/web-hub.ts` | Send snapshot on browser connect; subscribe to device events |
| Modify | `api/src/app.ts` | Scan route accepts `deviceId`, routes to specific socket with tenant check |
| Modify | `web/hooks/useBridgeSocket.ts` | `onlineDevices`, `selectedDeviceId`, localStorage persistence |
| Modify | `web/components/BridgeProvider.tsx` | Pass through new context fields |
| Modify | `web/components/TopBar.tsx` | Replace `BridgeStatus` with `BridgeDevicePicker` dropdown |
| Modify | `web/lib/bridge.ts` | `scanCard(deviceId: string)` |
| Modify | `web/app/(dashboard)/vehicles/page.tsx` | Pass `selectedDeviceId`; disable scan when null |
| Modify | `api/tests/unit/scan.test.ts` | Tests for deviceId routing and missing-deviceId 400 |

---

## Task 1: Add `OnlineDevice` type and update `BridgeWsMessage`

**Files:**
- Modify: `web/types/index.ts`

- [ ] **Step 1: Add `OnlineDevice` and extend types**

Open `web/types/index.ts`. Add the `OnlineDevice` interface after the Bridge/card reader section header, and add `'devices.list'` to `BridgeWsMessage`:

```ts
// ─── Bridge / card reader ─────────────────────────────────────────────────────

export interface OnlineDevice {
  id: string;
  name: string | null;
  platform: string | null;
}

export interface CardParsedData {
  // ... (unchanged)
}

export interface BridgeCardEvent {
  // ... (unchanged)
}

export interface BridgeWsMessage {
  type: 'card.read' | 'device.status' | 'error' | 'scan.error' | 'devices.list';
  payload?: unknown;
  error?: string;
  devices?: OnlineDevice[];
}
```

Replace only the `BridgeWsMessage` interface and add `OnlineDevice` before it. Do not touch other types.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors related to these types.

- [ ] **Step 3: Commit**

```bash
git add web/types/index.ts
git commit -m "feat: add OnlineDevice type and devices.list to BridgeWsMessage"
```

---

## Task 2: Update `bridge-hub.ts` — device tracking and events

**Files:**
- Modify: `api/src/hub/bridge-hub.ts`

- [ ] **Step 1: Replace the file with the updated implementation**

```ts
// api/src/hub/bridge-hub.ts
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import jwt from 'jsonwebtoken';
const { verify, decode } = jwt;
import { bypassPool } from '../db/client.js';
import { EventEmitter } from 'events';

export interface CardDataEvent {
  tenantId: string;
  cardType: string;
  cardSerial: string;
  parsedData: unknown;
}

export interface ScanErrorEvent {
  tenantId: string;
  error: string;
}

export interface DeviceOnlineEvent {
  tenantId: string;
  deviceId: string;
  name: string | null;
  platform: string | null;
}

export interface DeviceOfflineEvent {
  tenantId: string;
  deviceId: string;
}

export const bridgeEvents = new EventEmitter();

const PING_INTERVAL_MS = 25_000;

// Keyed by tenantId — used for broadcasting scan commands to any device for a tenant
const bridgeSockets = new Map<string, Set<WebSocket>>();

// Keyed by deviceId — used for routing scan to a specific device
interface DeviceEntry {
  ws:       WebSocket;
  tenantId: string;
  name:     string | null;
  platform: string | null;
}
const deviceSockets = new Map<string, DeviceEntry>();

export function getBridgeSocketsForTenant(tenantId: string): Set<WebSocket> {
  return bridgeSockets.get(tenantId) ?? new Set();
}

export function getDeviceEntry(deviceId: string): DeviceEntry | undefined {
  return deviceSockets.get(deviceId);
}

export function getOnlineDevicesForTenant(tenantId: string): { id: string; name: string | null; platform: string | null }[] {
  const result: { id: string; name: string | null; platform: string | null }[] = [];
  for (const [id, entry] of deviceSockets) {
    if (entry.tenantId === tenantId && entry.ws.readyState === WebSocket.OPEN) {
      result.push({ id, name: entry.name, platform: entry.platform });
    }
  }
  return result;
}

export function attachBridgeHub(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  const pingInterval = setInterval(() => {
    for (const clients of bridgeSockets.values()) {
      for (const ws of clients) {
        if ((ws as any).isAlive === false) { ws.terminate(); continue; }
        (ws as any).isAlive = false;
        ws.ping();
      }
    }
  }, PING_INTERVAL_MS);

  wss.on('close', () => clearInterval(pingInterval));

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url !== '/v1/devices/ws') return;
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    try {
      const authHeader = req.headers['authorization'] ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

      if (!token) {
        ws.close(4001, 'Missing Authorization');
        return;
      }

      let deviceId: string;
      let tenantId: string;
      try {
        const decoded = decode(token, { complete: true });
        if (!decoded || typeof decoded === 'string') throw new Error('bad jwt');
        const payload = decoded.payload as Record<string, string>;
        deviceId = payload.sub;
        tenantId = payload.tenantId;
        if (!deviceId || !tenantId) throw new Error('missing claims');
      } catch {
        ws.close(4001, 'Invalid token');
        return;
      }

      const { rows } = await bypassPool.query(
        `SELECT public_key_pem, name, platform FROM devices WHERE id = $1 AND revoked_at IS NULL`,
        [deviceId],
      );
      if (!rows.length) {
        ws.close(4001, 'Device not found');
        return;
      }

      try {
        verify(token, rows[0].public_key_pem, { algorithms: ['RS256'] });
      } catch {
        ws.close(4001, 'Invalid token signature');
        return;
      }

      const name:     string | null = rows[0].name     ?? null;
      const platform: string | null = rows[0].platform ?? null;

      // Register in both maps
      const tenantSet = bridgeSockets.get(tenantId) ?? new Set<WebSocket>();
      bridgeSockets.set(tenantId, tenantSet);
      tenantSet.add(ws);

      deviceSockets.set(deviceId, { ws, tenantId, name, platform });

      console.log(`[bridge-hub] device connected: deviceId=${deviceId} tenantId=${tenantId} totalForTenant=${tenantSet.size}`);
      ws.send(JSON.stringify({ type: 'ack' }));

      bridgeEvents.emit('device_online', { tenantId, deviceId, name, platform } satisfies DeviceOnlineEvent);

      (ws as any).isAlive = true;
      ws.on('pong', () => { (ws as any).isAlive = true; });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type: string } & Record<string, unknown>;
          console.log(`[bridge-hub] message from deviceId=${deviceId}: type=${msg.type}`);
          if (msg.type === 'card_data') {
            bridgeEvents.emit('card_data', {
              tenantId,
              cardType:   String(msg.cardType   ?? ''),
              cardSerial: String(msg.cardSerial ?? ''),
              parsedData: msg.parsedData ?? null,
            } satisfies CardDataEvent);
          } else if (msg.type === 'scan_error') {
            bridgeEvents.emit('scan_error', { tenantId, error: String(msg.error ?? 'Unknown error') });
          }
        } catch { /* ignore malformed */ }
      });

      ws.on('close', () => {
        bridgeSockets.get(tenantId)?.delete(ws);
        deviceSockets.delete(deviceId);
        console.log(`[bridge-hub] device disconnected: deviceId=${deviceId} tenantId=${tenantId}`);
        bridgeEvents.emit('device_offline', { tenantId, deviceId } satisfies DeviceOfflineEvent);
      });

      ws.on('error', () => ws.close());
    } catch (err) {
      ws.close(4001, 'Internal error');
    }
  });
}
```

- [ ] **Step 2: Type-check the API**

```bash
cd api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run existing tests to confirm no regressions**

```bash
cd api && npx vitest run tests/unit/bridge-hub.test.ts tests/unit/scan.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add api/src/hub/bridge-hub.ts
git commit -m "feat: track deviceSockets by deviceId, emit device_online/offline events"
```

---

## Task 3: Update `web-hub.ts` — push device list to browsers

**Files:**
- Modify: `api/src/hub/web-hub.ts`

- [ ] **Step 1: Replace the file with the updated implementation**

```ts
// api/src/hub/web-hub.ts
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import jwt from 'jsonwebtoken';
const { verify } = jwt;
import {
  bridgeEvents,
  getOnlineDevicesForTenant,
  type CardDataEvent,
  type ScanErrorEvent,
  type DeviceOnlineEvent,
  type DeviceOfflineEvent,
} from './bridge-hub.js';

const PING_INTERVAL_MS = 25_000;

const webSockets = new Map<string, Set<WebSocket>>();

export function broadcastToTenant(tenantId: string, msg: object): void {
  const clients = webSockets.get(tenantId) ?? new Set();
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function broadcastDeviceList(tenantId: string): void {
  broadcastToTenant(tenantId, {
    type:    'devices.list',
    devices: getOnlineDevicesForTenant(tenantId),
  });
}

// Register once at module load — bridgeEvents is a module singleton
bridgeEvents.on('card_data', (event: CardDataEvent) => {
  broadcastToTenant(event.tenantId, {
    type: 'card.read',
    payload: {
      cardType:   event.cardType,
      cardSerial: event.cardSerial,
      parsedData: event.parsedData,
    },
  });
});

bridgeEvents.on('scan_error', (event: ScanErrorEvent) => {
  broadcastToTenant(event.tenantId, { type: 'scan.error', error: event.error });
});

bridgeEvents.on('device_online', (event: DeviceOnlineEvent) => {
  broadcastDeviceList(event.tenantId);
});

bridgeEvents.on('device_offline', (event: DeviceOfflineEvent) => {
  broadcastDeviceList(event.tenantId);
});

export function attachWebHub(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  const pingInterval = setInterval(() => {
    for (const clients of webSockets.values()) {
      for (const ws of clients) {
        if ((ws as any).isAlive === false) { ws.terminate(); continue; }
        (ws as any).isAlive = false;
        ws.ping();
      }
    }
  }, PING_INTERVAL_MS);

  wss.on('close', () => clearInterval(pingInterval));

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!req.url?.startsWith('/v1/events/ws')) return;
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url!, `http://localhost`);
    const token = url.searchParams.get('token') ?? '';

    let tenantId: string;
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET not configured');
      const payload = verify(token, secret) as Record<string, string>;
      tenantId = payload.tenantId;
      if (!tenantId) throw new Error('missing tenantId');
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    const tenantSet = webSockets.get(tenantId) ?? new Set<WebSocket>();
    webSockets.set(tenantId, tenantSet);
    tenantSet.add(ws);

    // Send current online-device snapshot immediately
    ws.send(JSON.stringify({
      type:    'devices.list',
      devices: getOnlineDevicesForTenant(tenantId),
    }));

    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });
    ws.on('close', () => webSockets.get(tenantId)?.delete(ws));
    ws.on('error', () => ws.close());
  });
}
```

- [ ] **Step 2: Type-check**

```bash
cd api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/hub/web-hub.ts
git commit -m "feat: push devices.list snapshot and updates to browser WebSocket clients"
```

---

## Task 4: Update scan route to accept `deviceId`

**Files:**
- Modify: `api/src/app.ts`

- [ ] **Step 1: Update the scan route**

Find the `app.post('/v1/scan', ...)` block in `api/src/app.ts` and replace it with:

```ts
  interface ScanBody { deviceId?: string; }

  app.post<{ Body: ScanBody }>('/v1/scan', {
    preHandler: [app.authenticate, app.requireTenantContext],
  }, async (req, reply) => {
    const { getDeviceEntry } = await import('./hub/bridge-hub.js');
    const { WebSocket } = await import('ws');

    const { deviceId } = req.body ?? {};
    if (!deviceId) return reply.code(400).send({ error: 'deviceId required' });

    const entry = getDeviceEntry(deviceId);

    // Verify socket is open and belongs to the requesting tenant
    if (!entry || entry.ws.readyState !== WebSocket.OPEN) {
      return reply.code(503).send({ error: 'Device not connected' });
    }
    if (entry.tenantId !== req.tenantId) {
      // Don't leak that device exists — return same 503
      return reply.code(503).send({ error: 'Device not connected' });
    }

    entry.ws.send(JSON.stringify({ type: 'scan' }));
    console.log(`[scan] sent scan command to deviceId=${deviceId} tenantId=${req.tenantId}`);
    return reply.code(202).send({ ok: true });
  });
```

Remove the old scan block (the one that used `getBridgeSocketsForTenant` and `active[0]`).

- [ ] **Step 2: Type-check**

```bash
cd api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/app.ts
git commit -m "feat: scan route accepts deviceId, routes to specific bridge with tenant check"
```

---

## Task 5: Write and run updated API tests

**Files:**
- Modify: `api/tests/unit/scan.test.ts`

- [ ] **Step 1: Replace `scan.test.ts` with updated tests**

```ts
import { it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { buildApp } from '../../src/app.js';
import { attachBridgeHub } from '../../src/hub/bridge-hub.js';
import { attachWebHub } from '../../src/hub/web-hub.js';
import { sign } from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
const TENANT_ID = 'test-tenant-scan';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'test-secret';
  app = await buildApp();
  attachBridgeHub(app.server);
  attachWebHub(app.server);
  await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => { await app.close(); });

function userToken(tenantId = TENANT_ID) {
  return sign(
    { sub: 'user-1', tenantId, role: 'mechanic' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

it('POST /v1/scan returns 400 when deviceId is missing', async () => {
  const res = await app.inject({
    method:  'POST',
    url:     '/v1/scan',
    headers: { Authorization: `Bearer ${userToken()}`, 'Content-Type': 'application/json' },
    payload: {},
  });
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body).error).toMatch(/deviceId/i);
});

it('POST /v1/scan returns 503 when deviceId is not connected', async () => {
  const res = await app.inject({
    method:  'POST',
    url:     '/v1/scan',
    headers: { Authorization: `Bearer ${userToken()}`, 'Content-Type': 'application/json' },
    payload: { deviceId: 'device-that-does-not-exist' },
  });
  expect(res.statusCode).toBe(503);
  expect(JSON.parse(res.body).error).toMatch(/not connected/i);
});

it('POST /v1/scan returns 401 when not authenticated', async () => {
  const res = await app.inject({
    method:  'POST',
    url:     '/v1/scan',
    payload: { deviceId: 'any-device' },
  });
  expect(res.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run tests**

```bash
cd api && npx vitest run tests/unit/scan.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 3: Run all API tests to confirm no regressions**

```bash
cd api && npx vitest run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add api/tests/unit/scan.test.ts
git commit -m "test: update scan tests for deviceId routing"
```

---

## Task 6: Update `useBridgeSocket.ts` — online devices and device selection

**Files:**
- Modify: `web/hooks/useBridgeSocket.ts`

- [ ] **Step 1: Replace the file with the updated implementation**

```ts
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { BridgeCardEvent, BridgeWsMessage, OnlineDevice } from '@/types';

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3050')
  .replace(/^http/, 'ws');
const MAX_BACKOFF_MS = 30_000;
const STORAGE_KEY = 'bridge_selected_device';

function loadStoredDeviceId(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function saveDeviceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else     localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore — localStorage may be unavailable */ }
}

export interface BridgeSocketState {
  connected:           boolean;
  lastCard:            BridgeCardEvent | null;
  scanError:           string | null;
  onlineDevices:       OnlineDevice[];
  selectedDeviceId:    string | null;
  clearCard:           () => void;
  clearScanError:      () => void;
  setSelectedDeviceId: (id: string | null) => void;
}

export function useBridgeSocket(): BridgeSocketState {
  const [onlineDevices, setOnlineDevices]       = useState<OnlineDevice[]>([]);
  const [lastCard, setLastCard]                 = useState<BridgeCardEvent | null>(null);
  const [scanError, setScanError]               = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string | null>(null);

  const wsRef     = useRef<WebSocket | null>(null);
  const backoff   = useRef(2_000);
  const destroyed = useRef(false);
  const initialized = useRef(false);

  // Load stored selection on first mount (client only)
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setSelectedDeviceIdState(loadStoredDeviceId());
  }, []);

  const setSelectedDeviceId = useCallback((id: string | null) => {
    setSelectedDeviceIdState(id);
    saveDeviceId(id);
  }, []);

  const connect = useCallback(() => {
    if (destroyed.current) return;
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('token') : null;
      if (!token) return;
      const ws = new WebSocket(`${WS_BASE}/v1/events/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[bridge-ws] connected to', `${WS_BASE}/v1/events/ws`);
        backoff.current = 2_000;
      };

      ws.onmessage = (ev) => {
        try {
          const msg: BridgeWsMessage = JSON.parse(ev.data);

          if (msg.type === 'devices.list') {
            const devices = msg.devices ?? [];
            setOnlineDevices(devices);
            // If stored selection is no longer online, clear it
            setSelectedDeviceIdState((prev) => {
              if (prev && !devices.find((d) => d.id === prev)) {
                saveDeviceId(null);
                return null;
              }
              return prev;
            });
            return;
          }

          if (msg.type === 'card.read') {
            setLastCard(msg.payload as BridgeCardEvent);
          } else if (msg.type === 'scan.error') {
            setScanError(msg.error ?? 'Scan failed');
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        // Clear device list — will be refreshed on reconnect via snapshot
        setOnlineDevices([]);
        wsRef.current = null;
        if (!destroyed.current) {
          setTimeout(connect, backoff.current);
          backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
        }
      };

      ws.onerror = () => { ws.close(); };
    } catch {
      // WebSocket constructor can throw in SSR — skip
    }
  }, []);

  useEffect(() => {
    destroyed.current = false;
    connect();
    return () => {
      destroyed.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  const clearCard      = useCallback(() => setLastCard(null), []);
  const clearScanError = useCallback(() => setScanError(null), []);

  // connected = at least one bridge is online for this tenant
  const connected = onlineDevices.length > 0;

  return {
    connected,
    lastCard,
    scanError,
    onlineDevices,
    selectedDeviceId,
    clearCard,
    clearScanError,
    setSelectedDeviceId,
  };
}
```

- [ ] **Step 2: Type-check the web project**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/hooks/useBridgeSocket.ts
git commit -m "feat: add onlineDevices, selectedDeviceId, localStorage persistence to useBridgeSocket"
```

---

## Task 7: Update `BridgeProvider.tsx` to pass new context fields

**Files:**
- Modify: `web/components/BridgeProvider.tsx`

- [ ] **Step 1: Replace the file**

```ts
'use client';

import { createContext, useContext } from 'react';
import { useBridgeSocket, BridgeSocketState } from '@/hooks/useBridgeSocket';

const BridgeContext = createContext<BridgeSocketState>({
  connected:           false,
  lastCard:            null,
  scanError:           null,
  onlineDevices:       [],
  selectedDeviceId:    null,
  clearCard:           () => {},
  clearScanError:      () => {},
  setSelectedDeviceId: () => {},
});

export function BridgeProvider({ children }: { children: React.ReactNode }) {
  const state = useBridgeSocket();
  return <BridgeContext.Provider value={state}>{children}</BridgeContext.Provider>;
}

export function useBridge() {
  return useContext(BridgeContext);
}
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/BridgeProvider.tsx
git commit -m "feat: pass onlineDevices and selectedDeviceId through BridgeProvider context"
```

---

## Task 8: Replace `BridgeStatus` with `BridgeDevicePicker` in `TopBar.tsx`

**Files:**
- Modify: `web/components/TopBar.tsx`

- [ ] **Step 1: Replace the file**

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Menu, ChevronDown, Check } from 'lucide-react';
import { useBridge } from './BridgeProvider';
import { cn } from '@/lib/cn';
import type { OnlineDevice } from '@/types';

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/vehicles':  'Vehicles',
  '/reminders': 'Service Reminders',
  '/jobs':      'Jobs',
};

function getTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const prefix = Object.keys(TITLES).find((k) => k !== '/dashboard' && pathname.startsWith(k + '/'));
  return prefix ? TITLES[prefix] : 'CarMech';
}

function deviceLabel(d: OnlineDevice): string {
  if (d.name) return d.name;
  if (d.platform) return d.platform.charAt(0).toUpperCase() + d.platform.slice(1);
  return 'Unknown device';
}

function BridgeDevicePicker() {
  const { onlineDevices, selectedDeviceId, setSelectedDeviceId } = useBridge();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (onlineDevices.length === 0) {
    return (
      <div
        title="No card reader connected"
        className="flex items-center gap-1.5 text-xs text-neutral-500"
      >
        <span className="h-2 w-2 rounded-full bg-neutral-700" />
        <span className="hidden sm:inline">No reader</span>
      </div>
    );
  }

  const selected = onlineDevices.find((d) => d.id === selectedDeviceId) ?? null;
  const needsSelection = !selected;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={needsSelection ? 'Select a card reader' : `Using: ${deviceLabel(selected!)}`}
        className="flex items-center gap-1.5 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            needsSelection
              ? 'bg-amber-500'
              : 'bg-green-500 shadow-[0_0_6px] shadow-green-500/60',
          )}
        />
        <span className="hidden sm:inline">
          {needsSelection ? 'Select reader' : deviceLabel(selected!)}
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
          {onlineDevices.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                setSelectedDeviceId(d.id === selectedDeviceId ? null : d.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
            >
              <span className="flex-1 truncate">{deviceLabel(d)}</span>
              {d.id === selectedDeviceId && (
                <Check className="h-3 w-3 shrink-0 text-green-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar({ onMobileMenuToggle }: { onMobileMenuToggle: () => void }) {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-sm font-medium text-neutral-200">{getTitle(pathname)}</h1>
      </div>
      <BridgeDevicePicker />
    </header>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/TopBar.tsx
git commit -m "feat: replace BridgeStatus with BridgeDevicePicker dropdown in TopBar"
```

---

## Task 9: Wire up `scanCard` and `vehicles/page.tsx`

**Files:**
- Modify: `web/lib/bridge.ts`
- Modify: `web/app/(dashboard)/vehicles/page.tsx`

- [ ] **Step 1: Update `lib/bridge.ts`**

```ts
import { apiClient } from './api/client';

export async function scanCard(deviceId: string): Promise<void> {
  await apiClient.post('/v1/scan', { deviceId });
}
```

- [ ] **Step 2: Update `vehicles/page.tsx` — add `useBridge`, pass deviceId, disable when null**

At the top of `VehiclesPage`, add the import and hook:

```ts
import { useBridge } from '@/components/BridgeProvider';
```

Inside `VehiclesPage()`, add after `const [scanError, setScanError] = useState('');`:

```ts
  const { selectedDeviceId } = useBridge();
```

Replace the `handleScan` function:

```ts
  async function handleScan() {
    if (!selectedDeviceId) return;
    setScanning(true);
    setScanError('');
    try {
      await scanCard(selectedDeviceId);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err.message ?? 'Scan failed';
      setScanError(msg);
      setTimeout(() => setScanError(''), 3000);
    } finally {
      setScanning(false);
    }
  }
```

Replace the Scan button JSX:

```tsx
            <Button
              variant="ghost"
              onClick={handleScan}
              disabled={scanning || !selectedDeviceId}
              title={!selectedDeviceId ? 'Select a reader in the top bar' : undefined}
            >
              {scanning
                ? <Spinner className="h-4 w-4" />
                : <ScanLine className="h-4 w-4" />}
              {scanning ? 'Scanning…' : 'Scan card'}
            </Button>
```

- [ ] **Step 3: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/lib/bridge.ts web/app/\(dashboard\)/vehicles/page.tsx
git commit -m "feat: pass selectedDeviceId to scanCard, disable scan button when no device selected"
```

---

## Manual Verification Checklist

After all tasks are complete:

- [ ] Start API server and bridge app on two different machines (or two bridge processes)
- [ ] Both bridges connect → TopBar shows amber dot "Select reader" (neither selected yet)
- [ ] Click dropdown → both devices listed by name/platform
- [ ] Select one → green dot + device name, Scan button enabled
- [ ] Reload page → same device still selected (localStorage persisted)
- [ ] Click Scan → correct bridge receives scan command (check bridge log: "Scan command received")
- [ ] Kill selected bridge → TopBar switches to amber "Select reader", Scan button disables
- [ ] Select other bridge → scan works on that bridge
- [ ] Delete localStorage key manually → page loads with amber dot, no crash
