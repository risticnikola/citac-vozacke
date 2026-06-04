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
    try {
      ws.send(JSON.stringify({
        type:    'devices.list',
        devices: getOnlineDevicesForTenant(tenantId),
      }));
    } catch { /* client may have disconnected before snapshot sent */ }

    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });
    ws.on('close', () => webSockets.get(tenantId)?.delete(ws));
    ws.on('error', () => ws.close());
  });
}
