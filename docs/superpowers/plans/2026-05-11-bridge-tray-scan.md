# Bridge Tray App + Web Scan Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Electron bridge from a windowed app to a headless system-tray app, add a pull-based `/reader/scan` HTTP endpoint, add a Scan button to the web vehicles page, and produce cross-platform installers.

**Architecture:** Bridge runs as a tray-only Electron process (no BrowserWindow). On startup it auto-opens the card reader and waits. When the web app POSTs to `http://localhost:4000/reader/scan`, the bridge reads the card, emits the result over WebSocket (port 4001), and returns the card data in the HTTP response. The web's existing `BridgeProvider → CardToast` pipeline handles display — the Scan button only triggers the read.

**Tech Stack:** Electron 30, TypeScript, ws, electron-builder 24, Next.js 14, React Query

---

## Sprint 1 — Bridge: Remove UI, Add Tray
**Checkpoint:** Bridge starts, shows a tray icon, auto-opens the reader, no window appears.

---

### Task 1: Rewrite `bridge/src/main.ts`

**Files:**
- Modify: `bridge/src/main.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
// bridge/src/main.ts
import { app, Tray, Menu, nativeImage } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { fileURLToPath } from 'url';
import { initQueue, enqueue } from './bridge/queue.js';
import { CloudClient } from './cloud/client.js';
import { createHttpServer } from './server/http.js';
import { createWsServer, broadcast } from './server/websocket.js';
import { openReader, closeReader, isReaderOpen } from './bridge/port-manager.js';
import type { BridgeConfig } from './types.js';
import type { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const CONFIG: BridgeConfig = {
  cloudApiUrl:    process.env.CLOUD_API_URL      ?? 'http://localhost:3000',
  deviceId:       process.env.DEVICE_ID!,
  privateKeyPem:  process.env.DEVICE_PRIVATE_KEY!,
  httpPort:       parseInt(process.env.BRIDGE_HTTP_PORT ?? '4000', 10),
  wsPort:         parseInt(process.env.BRIDGE_WS_PORT   ?? '4001', 10),
  allowedOrigins: (process.env.ALLOWED_ORIGINS   ?? 'null').split(','),
};

const DB_PATH = path.join(app.getPath('userData'), 'offline-queue.db');

let tray: Tray | null = null;

function getIconPath(active: boolean): string {
  const name = active ? 'tray-icon-active.png' : 'tray-icon.png';
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', name)
    : path.join(__dirname, '..', 'assets', name);
}

function buildMenu(
  readerOpen: boolean,
  cloudClient: CloudClient,
  wss: WebSocketServer,
): ReturnType<typeof Menu.buildFromTemplate> {
  return Menu.buildFromTemplate([
    {
      label: 'Open reader',
      enabled: !readerOpen,
      click: () => tryOpenReader(cloudClient, wss),
    },
    {
      label: 'Close reader',
      enabled: readerOpen,
      click: async () => {
        await closeReader();
        updateTray(false, cloudClient, wss);
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function updateTray(
  readerOpen: boolean,
  cloudClient: CloudClient,
  wss: WebSocketServer,
): void {
  if (!tray) return;
  const iconPath = getIconPath(readerOpen);
  try {
    tray.setImage(iconPath);
  } catch {
    tray.setImage(nativeImage.createEmpty());
  }
  tray.setToolTip(`Vehicle Card Bridge — reader ${readerOpen ? 'open' : 'closed'}`);
  tray.setContextMenu(buildMenu(readerOpen, cloudClient, wss));
}

async function tryOpenReader(cloudClient: CloudClient, wss: WebSocketServer): Promise<void> {
  try {
    const reader = await openReader();

    reader.on('card', async (cardData) => {
      enqueue({
        deviceId:       CONFIG.deviceId,
        cardSerial:     cardData.cardSerial,
        cardType:       cardData.cardType,
        rawDump:        cardData.rawDump,
        parsedData:     cardData.parsedData,
        idempotencyKey: `${CONFIG.deviceId}-${cardData.cardSerial}-${Date.now()}`,
      });
      broadcast(wss, {
        type: 'card.read',
        payload: {
          cardType:   cardData.cardType,
          cardSerial: cardData.cardSerial,
          parsedData: cardData.parsedData,
        },
      });
      cloudClient.drainQueue().catch(console.error);
    });

    reader.on('disconnect', () => updateTray(false, cloudClient, wss));

    updateTray(true, cloudClient, wss);
  } catch (err: any) {
    console.error({ err }, 'Failed to open card reader');
  }
}

app.whenReady().then(async () => {
  const missing = (['DEVICE_ID', 'DEVICE_PRIVATE_KEY', 'TENANT_ID'] as const)
    .filter((k) => !process.env[k]);
  if (missing.length) {
    const { dialog } = await import('electron');
    dialog.showErrorBox(
      'Configuration Error',
      `Missing required environment variables:\n${missing.join('\n')}\n\nConfigure them and restart.`,
    );
    app.quit();
    return;
  }

  app.setLoginItemSettings({ openAtLogin: true });

  initQueue(DB_PATH);

  const cloudClient = new CloudClient(
    CONFIG.cloudApiUrl, CONFIG.deviceId, process.env.TENANT_ID ?? '', CONFIG.privateKeyPem,
  );

  const wss = createWsServer(CONFIG.wsPort, CONFIG.allowedOrigins);
  createHttpServer(cloudClient, CONFIG.httpPort);

  setInterval(() => cloudClient.drainQueue().catch(console.error), 30_000);
  autoUpdater.checkForUpdatesAndNotify().catch(console.error);
  setInterval(
    () => autoUpdater.checkForUpdatesAndNotify().catch(console.error),
    4 * 60 * 60 * 1000,
  );

  // Create system tray — use empty image as placeholder until assets/tray-icon.png exists
  const iconPath = getIconPath(false);
  let initialIcon: string | Electron.NativeImage;
  try {
    initialIcon = iconPath; // will throw in Tray constructor if file missing
  } catch {
    initialIcon = nativeImage.createEmpty();
  }
  tray = new Tray(initialIcon as any);
  updateTray(false, cloudClient, wss);

  // Prevent Electron from quitting when there are no windows
  app.on('window-all-closed', () => { /* stay alive in tray */ });

  // Auto-open reader on startup
  await tryOpenReader(cloudClient, wss);
});
```

- [ ] **Step 2: Create placeholder icon files so Tray constructor doesn't throw**

```bash
mkdir bridge\assets
```

Then run this Node one-liner to write a minimal 16x16 gray PNG:

```bash
cd bridge && node -e "
const fs = require('fs');
// Minimal 1x1 PNG (gray) scaled by electron as needed
const gray = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVQ4jWNgYGD4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==', 'base64');
const orange = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIUlEQVQ4jWP8z8BQz0AEYBw1YNQAKhsAAYMHqBsAAIAFAAH/AksBAAAASUVORK5CYII=', 'base64');
fs.writeFileSync('assets/tray-icon.png', gray);
fs.writeFileSync('assets/tray-icon-active.png', orange);
console.log('Icons written');
"
```

- [ ] **Step 3: Compile and verify no TypeScript errors**

```bash
cd bridge && npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 4: Commit**

```bash
git add bridge/src/main.ts bridge/assets/tray-icon.png bridge/assets/tray-icon-active.png
git commit -m "feat(bridge): replace BrowserWindow with system tray, auto-open reader on startup"
```

---

## ⏸ CHECKPOINT 1 — Wait for "next" before Sprint 2

---

## Sprint 2 — Bridge: Scan Endpoint + CORS Fix
**Checkpoint:** `curl -X POST http://localhost:4000/reader/scan` returns card data (or "Reader not open" if device disconnected).

---

### Task 2: Add `readFromActive()` to port-manager

**Files:**
- Modify: `bridge/src/bridge/port-manager.ts`

- [ ] **Step 1: Add the export after `isReaderOpen()`**

```typescript
// Add at the bottom of bridge/src/bridge/port-manager.ts
import type { CardData } from '../types.js';   // add this import at top of file

export async function readFromActive(): Promise<CardData> {
  if (!activeReader) throw new Error('No reader open');
  return activeReader.readCard();
}
```

Full updated file for reference:

```typescript
// bridge/src/bridge/port-manager.ts
import { CardReader } from './card-reader.js';
import type { CardData } from '../types.js';

let activeReader: CardReader | null = null;
let activeReaderName: string | null = null;

export async function openReader(readerName?: string): Promise<CardReader> {
  if (activeReader) {
    throw new Error(
      `Reader already open${activeReaderName ? ': ' + activeReaderName : ''}. Close it first.`,
    );
  }
  const reader = new CardReader();
  await reader.open(readerName);
  activeReader = reader;
  activeReaderName = readerName ?? null;

  reader.on('disconnect', () => {
    activeReader = null;
    activeReaderName = null;
  });

  return reader;
}

export async function closeReader(): Promise<void> {
  if (activeReader) {
    await activeReader.close();
    activeReader = null;
    activeReaderName = null;
  }
}

export function getActiveReaderName(): string | null {
  return activeReaderName;
}

export function isReaderOpen(): boolean {
  return activeReader !== null;
}

export async function readFromActive(): Promise<CardData> {
  if (!activeReader) throw new Error('No reader open');
  return activeReader.readCard();
}
```

- [ ] **Step 2: Verify types**

```bash
cd bridge && npx tsc --noEmit
```

Expected: no output.

---

### Task 3: Update HTTP server — add `/reader/scan` and fix CORS

**Files:**
- Modify: `bridge/src/server/http.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
// bridge/src/server/http.ts
import http from 'http';
import type { WebSocketServer } from 'ws';
import type { CloudClient } from '../cloud/client.js';
import {
  openReader, closeReader, getActiveReaderName, isReaderOpen, readFromActive,
} from '../bridge/port-manager.js';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3002';

function setCors(res: http.ServerResponse, req: http.IncomingMessage): void {
  const origin = req.headers['origin'] ?? '';
  // Allow the configured web origin and null (Electron renderer legacy)
  if (origin === WEB_ORIGIN || origin === 'null' || origin === '') {
    res.setHeader('Access-Control-Allow-Origin', origin || WEB_ORIGIN);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function createHttpServer(
  client: CloudClient,
  port: number,
): http.Server {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    setCors(res, req);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200).end(JSON.stringify({
          ok: true,
          readerOpen: isReaderOpen(),
          activeReader: getActiveReaderName(),
          queueDepth: client.getQueueDepth(),
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/reader/open') {
        const body = await readBody(req);
        const { readerName } = JSON.parse(body || '{}') as { readerName?: string };
        await openReader(readerName);
        res.writeHead(200).end(JSON.stringify({ ok: true, readerName: readerName ?? 'default' }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/reader/close') {
        await closeReader();
        res.writeHead(200).end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/reader/scan') {
        if (!isReaderOpen()) {
          res.writeHead(503).end(JSON.stringify({ error: 'Reader not open' }));
          return;
        }
        // readFromActive() calls activeReader.readCard() which emits 'card'.
        // The 'card' listener set up in tryOpenReader() (main.ts) handles
        // WebSocket broadcast and queue — no need to broadcast here too.
        const cardData = await readFromActive();
        res.writeHead(200).end(JSON.stringify({
          ok:         true,
          cardType:   cardData.cardType,
          cardSerial: cardData.cardSerial,
          parsedData: cardData.parsedData ?? null,
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/queue/drain') {
        const result = await client.drainQueue();
        res.writeHead(200).end(JSON.stringify(result));
        return;
      }

      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    } catch (err: any) {
      res.writeHead(500).end(JSON.stringify({ error: err.message ?? 'Internal error' }));
    }
  });

  server.listen(port, '127.0.0.1');
  return server;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
```

- [ ] **Step 2: Verify types**

```bash
cd bridge && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add bridge/src/bridge/port-manager.ts bridge/src/server/http.ts
git commit -m "feat(bridge): add /reader/scan endpoint and fix CORS for web origin"
```

---

## ⏸ CHECKPOINT 2 — Wait for "next" before Sprint 3

---

## Sprint 3 — Web: Scan Button
**Checkpoint:** Clicking "Scan card" on the vehicles page triggers a read; the CardToast appears.

---

### Task 4: Create `web/lib/bridge.ts`

**Files:**
- Create: `web/lib/bridge.ts`

- [ ] **Step 1: Write the file**

```typescript
// web/lib/bridge.ts
const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL ?? 'http://localhost:4000';

export async function scanCard(): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/reader/scan`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Scan failed (${res.status})`);
  }
  // Result arrives via WebSocket → CardToast. HTTP response is just confirmation.
}
```

- [ ] **Step 2: Add env var**

Create or update `web/.env.local` — add this line if not present:

```
NEXT_PUBLIC_BRIDGE_URL=http://localhost:4000
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/bridge.ts web/.env.local
git commit -m "feat(web): add bridge scanCard() helper"
```

---

### Task 5: Add Scan button to the vehicles page

**Files:**
- Modify: `web/app/(dashboard)/vehicles/page.tsx`

- [ ] **Step 1: Add the import and state**

At the top of `VehiclesPage`, add the `ScanLine` icon import to the existing lucide import line, and add `scanCard` import:

```typescript
import { Car, Plus, Search, ChevronRight, ScanLine } from 'lucide-react';
import { scanCard } from '@/lib/bridge';
```

Then inside `VehiclesPage`, after the existing `useState` lines, add:

```typescript
const [scanning, setScanning] = useState(false);
const [scanError, setScanError] = useState('');

async function handleScan() {
  setScanning(true);
  setScanError('');
  try {
    await scanCard();
    // Success: CardToast will appear from WebSocket event
  } catch (err: any) {
    setScanError(err.message ?? 'Scan failed');
    setTimeout(() => setScanError(''), 3000);
  } finally {
    setScanning(false);
  }
}
```

- [ ] **Step 2: Add the button to the header row**

Replace the existing header `<div className="flex items-center gap-3">` block:

```tsx
<div className="flex items-center gap-3">
  <div className="relative flex-1 max-w-sm">
    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
    <Input
      placeholder="Search by plate or VIN…"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="pl-8"
    />
  </div>
  <div className="flex flex-col items-end gap-1">
    <div className="flex gap-2">
      <Button variant="ghost" onClick={handleScan} disabled={scanning}>
        {scanning
          ? <Spinner className="h-4 w-4" />
          : <ScanLine className="h-4 w-4" />}
        {scanning ? 'Scanning…' : 'Scan card'}
      </Button>
      <Button onClick={() => router.push('/vehicles/new')}>
        <Plus className="h-4 w-4" />
        Add vehicle
      </Button>
    </div>
    {scanError && (
      <p className="text-xs text-red-400">{scanError}</p>
    )}
  </div>
</div>
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd web && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add web/app/"(dashboard)"/vehicles/page.tsx
git commit -m "feat(web): add Scan card button to vehicles page"
```

---

## ⏸ CHECKPOINT 3 — Wait for "next" before Sprint 4

---

## Sprint 4 — Packaging: Cross-Platform Installers
**Checkpoint:** `npm run electron:build` produces `dist-electron/` with `.exe` (Windows) or `.AppImage` (Linux) or `.dmg` (macOS).

---

### Task 6: Update `electron-builder.json5`

**Files:**
- Modify: `bridge/electron-builder.json5`

- [ ] **Step 1: Replace the file**

```json5
{
  appId: "com.citmec.bridge",
  productName: "Vehicle Card Bridge",
  copyright: "Copyright © 2026",

  directories: {
    output: "dist-electron",
    buildResources: "build",
  },

  // Include compiled JS, native assets, and package.json
  files: [
    "dist/**/*",
    "assets/**/*",
    "package.json",
  ],

  extraResources: [
    { from: "assets/", to: "assets/", filter: ["*.png"] },
  ],

  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/icon.ico",
  },

  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
    shortcutName: "Vehicle Card Bridge",
  },

  mac: {
    target: [{ target: "dmg", arch: ["universal"] }],
    icon: "build/icon.icns",
    category: "public.app-category.utilities",
  },

  linux: {
    target: [{ target: "AppImage", arch: ["x64"] }],
    icon: "build/icons",
    category: "Utility",
  },

  // No publish server yet — distribute installers manually
  publish: null,
}
```

- [ ] **Step 2: Create `build/` icon placeholders**

electron-builder requires icon files to exist even if they're placeholders. Create them:

```bash
cd bridge
mkdir -p build/icons
# Copy the same placeholder PNG as all icon sizes (not pixel-perfect, but buildable)
node -e "
const fs = require('fs');
const png = fs.readFileSync('assets/tray-icon.png');
fs.writeFileSync('build/icon.ico', png);        // not a real ICO, replace before shipping
fs.writeFileSync('build/icon.icns', png);       // not a real ICNS, replace before shipping
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  fs.writeFileSync('build/icons/' + size + 'x' + size + '.png', png);
}
console.log('Placeholder icons written');
"
```

> **Note:** These are placeholder PNGs renamed as ICO/ICNS. They will look broken as app icons but allow the build to complete. Replace `build/icon.ico`, `build/icon.icns`, and `build/icons/*.png` with real icons before distributing publicly.

- [ ] **Step 3: Add `linux-autostart` logic to `main.ts`**

On Linux, `app.setLoginItemSettings` is a no-op. After the `app.setLoginItemSettings` call in `main.ts`, add the Linux auto-start block:

```typescript
// Linux auto-start: write a .desktop file to ~/.config/autostart/
if (process.platform === 'linux' && app.isPackaged) {
  const { homedir } = await import('os');
  const autostartDir = path.join(homedir(), '.config', 'autostart');
  const desktopFile  = path.join(autostartDir, 'vehicle-card-bridge.desktop');
  const exePath = process.execPath;
  const desktop = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Vehicle Card Bridge',
    `Exec=${exePath}`,
    'Hidden=false',
    'NoDisplay=false',
    'X-GNOME-Autostart-enabled=true',
  ].join('\n');
  try {
    const { mkdir, writeFile } = await import('fs/promises');
    await mkdir(autostartDir, { recursive: true });
    await writeFile(desktopFile, desktop, { encoding: 'utf8' });
  } catch (err) {
    console.error({ err }, 'Failed to write Linux autostart entry');
  }
}
```

- [ ] **Step 4: Build and verify**

```bash
cd bridge
npm run build           # compile TypeScript → dist/
npm run electron:build  # package with electron-builder
```

Expected: `dist-electron/` folder contains:
- Windows: `Vehicle Card Bridge Setup 1.0.0.exe`
- macOS: `Vehicle Card Bridge-1.0.0.dmg`
- Linux: `Vehicle Card Bridge-1.0.0.AppImage`

(Only the current platform's installer is built unless you use `--linux --win --mac` flags with a CI runner that has all platforms available.)

- [ ] **Step 5: Commit**

```bash
git add bridge/electron-builder.json5 bridge/build/ bridge/src/main.ts
git commit -m "feat(bridge): add cross-platform electron-builder config and Linux autostart"
```

---

## ⏸ CHECKPOINT 4 — Done

All four sprints complete. The bridge is a tray app, scan works end-to-end, and installers can be built for distribution.
