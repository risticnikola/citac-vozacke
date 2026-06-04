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
