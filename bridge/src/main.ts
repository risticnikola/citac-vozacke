// bridge/src/main.ts
import { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import { initQueue, enqueue } from './bridge/queue.js';
import { CloudClient } from './cloud/client.js';
import { createServerWsClient } from './cloud/ws-client.js';
import { createHttpServer } from './server/http.js';
import { createWsServer, broadcast } from './server/websocket.js';
import { openReader, closeReader, isReaderOpen } from './bridge/port-manager.js';
import type { BridgeConfig } from './types.js';
import type { WebSocketServer } from 'ws';

// File logger — writes all console output to Desktop/bridge-log.txt
import os from 'os';
const LOG_FILE = path.join(os.homedir(), 'Desktop', 'bridge-log.txt');
function writeLog(level: string, ...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${level} ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch { /* ignore */ }
}
const _origLog   = console.log.bind(console);
const _origInfo  = console.info.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);
console.log   = (...a) => { _origLog(...a);   writeLog('LOG  ', ...a); };
console.info  = (...a) => { _origInfo(...a);  writeLog('INFO ', ...a); };
console.warn  = (...a) => { _origWarn(...a);  writeLog('WARN ', ...a); };
console.error = (...a) => { _origError(...a); writeLog('ERROR', ...a); };
// Clear log on startup so each run starts fresh
try { fs.writeFileSync(LOG_FILE, `=== Bridge started ${new Date().toISOString()} ===\n`, 'utf8'); } catch { /* ignore */ }

const DEFAULT_API_URL = process.env.DEFAULT_API_URL ?? 'http://localhost:3050';
const DB_PATH = path.join(app.getPath('userData'), 'offline-queue.db');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

interface DeviceConfig {
  deviceId:          string;
  devicePrivateKey:  string;
  tenantId:          string;
  cloudApiUrl?:      string;
  bridgeHttpPort?:   number;
  bridgeWsPort?:     number;
  allowedOrigins?:   string[];
}

function loadDeviceConfig(): DeviceConfig | null {
  const candidates = [
    CONFIG_PATH,
    path.join(process.resourcesPath ?? '.', 'config.json'),
    path.join(__dirname, '..', 'config.json'),
  ];
  console.log('[loadDeviceConfig] candidates:', candidates);
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const cfg = JSON.parse(raw) as Partial<DeviceConfig>;
      if (cfg.deviceId && cfg.devicePrivateKey && cfg.tenantId) {
        console.log('[loadDeviceConfig] loaded from:', candidate, '| cloudApiUrl:', (cfg as any).cloudApiUrl);
        return cfg as DeviceConfig;
      }
    } catch { /* try next */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tray helpers
// ---------------------------------------------------------------------------

let CONFIG!: BridgeConfig;
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
      click: () => tryOpenReader(cloudClient, wss, true),
    },
    {
      label: 'Close reader',
      enabled: readerOpen,
      click: async () => { await closeReader(); updateTray(false, cloudClient, wss); },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function updateTray(readerOpen: boolean, cloudClient: CloudClient, wss: WebSocketServer): void {
  if (!tray) return;
  try { tray.setImage(getIconPath(readerOpen)); }
  catch { tray.setImage(nativeImage.createEmpty()); }
  tray.setToolTip(`Vehicle Card Bridge — reader ${readerOpen ? 'open' : 'closed'}`);
  tray.setContextMenu(buildMenu(readerOpen, cloudClient, wss));
}

async function tryOpenReader(cloudClient: CloudClient, wss: WebSocketServer, notifyOnError = false): Promise<void> {
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
        payload: { cardType: cardData.cardType, cardSerial: cardData.cardSerial, parsedData: cardData.parsedData },
      });
      cloudClient.drainQueue().catch(console.error);
    });
    reader.on('error', (err: Error) => console.error('Card reader error:', err.message));
    reader.on('disconnect', () => updateTray(false, cloudClient, wss));
    updateTray(true, cloudClient, wss);
  } catch (err: any) {
    console.error({ err }, 'Failed to open card reader');
    if (notifyOnError && Notification.isSupported()) {
      new Notification({
        title: 'Vehicle Card Bridge',
        body: `Could not open card reader: ${(err as Error).message}`,
      }).show();
    }
  }
}

// ---------------------------------------------------------------------------
// Bridge startup (called after config is confirmed present)
// ---------------------------------------------------------------------------

async function startBridge(deviceCfg: DeviceConfig): Promise<void> {
  console.log('[startBridge] cloudApiUrl from config:', deviceCfg.cloudApiUrl, '| resolved:', deviceCfg.cloudApiUrl ?? DEFAULT_API_URL);
  CONFIG = {
    cloudApiUrl:    deviceCfg.cloudApiUrl ?? DEFAULT_API_URL,
    deviceId:       deviceCfg.deviceId,
    privateKeyPem:  deviceCfg.devicePrivateKey,
    httpPort:       deviceCfg.bridgeHttpPort  ?? parseInt(process.env.BRIDGE_HTTP_PORT ?? '4000', 10),
    wsPort:         deviceCfg.bridgeWsPort    ?? parseInt(process.env.BRIDGE_WS_PORT   ?? '4001', 10),
    allowedOrigins: deviceCfg.allowedOrigins  ?? (process.env.ALLOWED_ORIGINS ?? '*').split(','),
  };

  app.setLoginItemSettings({ openAtLogin: true });

  if (process.platform === 'linux' && app.isPackaged) {
    const { homedir } = await import('os');
    const autostartDir = path.join(homedir(), '.config', 'autostart');
    const desktop = [
      '[Desktop Entry]', 'Type=Application', 'Name=Vehicle Card Bridge',
      `Exec=${process.execPath}`, 'Hidden=false', 'NoDisplay=false',
      'X-GNOME-Autostart-enabled=true',
    ].join('\n');
    try {
      const { mkdir, writeFile } = await import('fs/promises');
      await mkdir(autostartDir, { recursive: true });
      await writeFile(path.join(autostartDir, 'vehicle-card-bridge.desktop'), desktop, { encoding: 'utf8' });
    } catch (err) { console.error({ err }, 'Failed to write Linux autostart entry'); }
  }

  initQueue(DB_PATH);

  const cloudClient = new CloudClient(
    CONFIG.cloudApiUrl, CONFIG.deviceId, deviceCfg.tenantId, CONFIG.privateKeyPem,
  );

  const wss = createWsServer(CONFIG.wsPort, CONFIG.allowedOrigins);
  createHttpServer(cloudClient, CONFIG.httpPort);

  setInterval(() => cloudClient.drainQueue().catch(console.error), 30_000);
  cloudClient.heartbeat().catch(console.error);
  setInterval(() => cloudClient.heartbeat().catch(console.error), 5 * 60_000);

  createServerWsClient({
    cloudApiUrl:   CONFIG.cloudApiUrl,
    deviceId:      CONFIG.deviceId,
    tenantId:      deviceCfg.tenantId,
    privateKeyPem: CONFIG.privateKeyPem,
  });

  autoUpdater.checkForUpdatesAndNotify().catch(console.error);
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(console.error), 4 * 60 * 60 * 1000);

  let initialIcon: string | Electron.NativeImage;
  try { initialIcon = getIconPath(false); }
  catch { initialIcon = nativeImage.createEmpty(); }
  tray = new Tray(initialIcon as any);
  updateTray(false, cloudClient, wss);

  app.on('window-all-closed', () => { /* stay alive in tray */ });

  await tryOpenReader(cloudClient, wss);
}

// ---------------------------------------------------------------------------
// Setup wizard (shown when no config.json exists)
// ---------------------------------------------------------------------------

function showWizard(): void {
  const win = new BrowserWindow({
    width:           480,
    height:          600,
    resizable:       false,
    center:          true,
    title:           'Vehicle Card Bridge — Setup',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload:          path.join(__dirname, 'wizard', 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  const htmlPath = app.isPackaged
    ? path.join(app.getAppPath(), 'wizard', 'index.html')
    : path.join(__dirname, '..', 'wizard', 'index.html');
  win.loadFile(htmlPath);
  win.setMenuBarVisibility(false);

  ipcMain.handle('wizard:get-default-api-url', () => DEFAULT_API_URL);

  ipcMain.handle('wizard:activate', async (_event, args: {
    token: string;
    label: string | null;
    apiUrl: string;
  }) => {
    try {
      const res = await fetch(`${args.apiUrl}/v1/devices/activate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token:    args.token,
          label:    args.label,
          platform: process.platform === 'win32' ? 'windows'
                  : process.platform === 'darwin' ? 'macos'
                  : 'linux',
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        return { ok: false, error: body.error ?? `Server returned ${res.status}` };
      }

      const data = await res.json() as { deviceId: string; devicePrivateKey: string; tenantId: string };

      const config: DeviceConfig = {
        deviceId:        data.deviceId,
        devicePrivateKey: data.devicePrivateKey,
        tenantId:        data.tenantId,
        cloudApiUrl:     args.apiUrl,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

      // Start bridge then close wizard
      win.close();
      await startBridge(config);

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message ?? 'Network error — check the server URL.' };
    }
  });

  // If the user closes the wizard without activating, quit
  win.on('closed', () => {
    if (!loadDeviceConfig()) app.quit();
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    const deviceCfg = loadDeviceConfig();
    if (!deviceCfg) {
      showWizard();
      return;
    }
    await startBridge(deviceCfg);
  });
}
