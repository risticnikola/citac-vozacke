// bridge/src/main.ts
import { app, Tray, Menu, nativeImage } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { initQueue, enqueue } from './bridge/queue.js';
import { CloudClient } from './cloud/client.js';
import { createHttpServer } from './server/http.js';
import { createWsServer, broadcast } from './server/websocket.js';
import { openReader, closeReader, isReaderOpen } from './bridge/port-manager.js';
import type { BridgeConfig } from './types.js';
import type { WebSocketServer } from 'ws';

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
  try {
    tray.setImage(getIconPath(readerOpen));
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

  // Linux auto-start via .desktop file (setLoginItemSettings is a no-op on Linux)
  if (process.platform === 'linux' && app.isPackaged) {
    const { homedir } = await import('os');
    const autostartDir = path.join(homedir(), '.config', 'autostart');
    const desktopFile  = path.join(autostartDir, 'vehicle-card-bridge.desktop');
    const desktop = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Vehicle Card Bridge',
      `Exec=${process.execPath}`,
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

  // Create system tray
  let initialIcon: string | Electron.NativeImage;
  try {
    initialIcon = getIconPath(false);
  } catch {
    initialIcon = nativeImage.createEmpty();
  }
  tray = new Tray(initialIcon as any);
  updateTray(false, cloudClient, wss);

  // Keep the app alive even with no windows
  app.on('window-all-closed', () => { /* stay alive in tray */ });

  // Auto-open reader on startup
  await tryOpenReader(cloudClient, wss);
});
