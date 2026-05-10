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
  cloudApiUrl:    process.env.CLOUD_API_URL      ?? 'http://localhost:3000',
  deviceId:       process.env.DEVICE_ID          ?? 'local-device',
  privateKeyPem:  process.env.DEVICE_PRIVATE_KEY ?? '',
  httpPort:       parseInt(process.env.BRIDGE_HTTP_PORT ?? '4000', 10),
  wsPort:         parseInt(process.env.BRIDGE_WS_PORT   ?? '4001', 10),
  allowedOrigins: (process.env.ALLOWED_ORIGINS   ?? 'null').split(','),
};

const DB_PATH = path.join(app.getPath('userData'), 'offline-queue.db');

// Works in both dev (tsx, __dirname = src/) and built (electron, __dirname = dist/)
const PRELOAD_PATH = app.isPackaged
  ? path.join(__dirname, 'preload.js')
  : path.join(__dirname, '..', 'dist', 'preload.js');

let win: BrowserWindow | null = null;

function sendToRenderer(channel: string, payload: unknown) {
  win?.webContents.send(channel, payload);
}

app.whenReady().then(async () => {
  initQueue(DB_PATH);

  const cloudClient = new CloudClient(
    CONFIG.cloudApiUrl, CONFIG.deviceId, process.env.TENANT_ID ?? '', CONFIG.privateKeyPem,
  );

  const httpServer = createHttpServer(cloudClient, CONFIG.httpPort);
  const wss = createWsServer(CONFIG.wsPort, CONFIG.allowedOrigins);

  setInterval(() => cloudClient.drainQueue().catch(console.error), 30_000);

  autoUpdater.checkForUpdatesAndNotify().catch(console.error);
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(console.error), 4 * 60 * 60 * 1000);

  win = new BrowserWindow({
    width: 480,
    height: 520,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD_PATH,
    },
    title: 'Vehicle Card Bridge',
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  ipcMain.handle('reader:start', async (_ev, readerName?: string) => {
    const reader = await openReader(readerName);

    sendToRenderer('reader:status', { connected: true, readerName: readerName ?? null });

    reader.on('card', async (cardData) => {
      const item = {
        deviceId:       CONFIG.deviceId,
        cardSerial:     cardData.cardSerial,
        cardType:       cardData.cardType,
        rawDump:        cardData.rawDump,
        parsedData:     cardData.parsedData,
        idempotencyKey: `${CONFIG.deviceId}-${cardData.cardSerial}-${Date.now()}`,
      };
      enqueue(item);
      broadcast(wss, {
        type: 'card.read',
        payload: {
          cardType:   cardData.cardType,
          cardSerial: cardData.cardSerial,
          parsedData: cardData.parsedData,
        },
      });
      sendToRenderer('card:data', {
        cardType:   cardData.cardType,
        cardSerial: cardData.cardSerial,
        parsedData: cardData.parsedData,
      });
      cloudClient.drainQueue().catch(console.error);
    });

    reader.on('disconnect', (code) => {
      sendToRenderer('reader:status', { connected: false });
      sendToRenderer('reader:error', `Reader disconnected (exit code ${code})`);
    });

    reader.on('error', (err: Error) => {
      sendToRenderer('reader:error', err.message);
    });

    return { ok: true };
  });

  ipcMain.handle('reader:stop', async () => {
    const { closeReader } = await import('./bridge/port-manager.js');
    await closeReader();
    sendToRenderer('reader:status', { connected: false });
    return { ok: true };
  });

  win.on('closed', () => { win = null; });

  httpServer.on('error', (err) => console.error({ err }, 'HTTP server error'));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
