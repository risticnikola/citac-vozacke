// bridge/src/main.ts — Electron main process
import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { initQueue, enqueue } from './bridge/queue.js';
import { CloudClient } from './cloud/client.js';
import { createHttpServer } from './server/http.js';
import { createWsServer, broadcast } from './server/websocket.js';
import { openReader } from './bridge/port-manager.js';
import type { BridgeConfig } from './types.js';

const CONFIG: BridgeConfig = {
  cloudApiUrl:    process.env.CLOUD_API_URL    ?? 'http://localhost:3000',
  deviceId:       process.env.DEVICE_ID        ?? 'local-device',
  privateKeyPem:  process.env.DEVICE_PRIVATE_KEY ?? '',
  httpPort:       parseInt(process.env.BRIDGE_HTTP_PORT ?? '4000', 10),
  wsPort:         parseInt(process.env.BRIDGE_WS_PORT   ?? '4001', 10),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'null').split(','),
};

const DB_PATH = path.join(app.getPath('userData'), 'offline-queue.db');

let win: BrowserWindow | null = null;

app.whenReady().then(async () => {
  initQueue(DB_PATH);

  const cloudClient = new CloudClient(
    CONFIG.cloudApiUrl, CONFIG.deviceId, process.env.TENANT_ID ?? '', CONFIG.privateKeyPem,
  );

  const httpServer = createHttpServer(cloudClient, CONFIG.httpPort);
  const wss = createWsServer(CONFIG.wsPort, CONFIG.allowedOrigins);

  // Drain offline queue every 30 seconds
  setInterval(() => cloudClient.drainQueue().catch(console.error), 30_000);

  // Auto-update check on startup + every 4 hours
  autoUpdater.checkForUpdatesAndNotify().catch(console.error);
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(console.error), 4 * 60 * 60 * 1000);

  win = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    title: 'Vehicle Card Bridge',
  });

  await win.loadFile('renderer/index.html');

  ipcMain.handle('ports:list', async () => {
    const { listPorts } = await import('./bridge/port-manager.js');
    return listPorts();
  });

  ipcMain.handle('reader:start', async (_ev, portPath: string) => {
    const reader = await openReader(portPath);
    reader.on('card', async (cardData) => {
      const item = {
        deviceId: CONFIG.deviceId,
        cardSerial: cardData.cardSerial,
        cardType: cardData.cardType,
        rawDump: cardData.rawDump,
        idempotencyKey: `${CONFIG.deviceId}-${cardData.cardSerial}-${Date.now()}`,
      };
      enqueue(item);
      broadcast(wss, { type: 'card.read', payload: { ...item, rawDump: undefined } });
      cloudClient.drainQueue().catch(console.error);
    });
    return { ok: true };
  });

  win.on('closed', () => { win = null; });

  httpServer.on('error', (err) => console.error({ err }, 'HTTP server error'));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
