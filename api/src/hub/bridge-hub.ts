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

export const bridgeEvents = new EventEmitter();

const bridgeSockets = new Map<string, Set<WebSocket>>();

export function getBridgeSocketsForTenant(tenantId: string): Set<WebSocket> {
  return bridgeSockets.get(tenantId) ?? new Set();
}

export function attachBridgeHub(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

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
        `SELECT public_key_pem FROM devices WHERE id = $1 AND revoked_at IS NULL`,
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

      const tenantSet = bridgeSockets.get(tenantId) ?? new Set<WebSocket>();
      bridgeSockets.set(tenantId, tenantSet);
      tenantSet.add(ws);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type: string } & Record<string, unknown>;
          if (msg.type === 'card_data') {
            bridgeEvents.emit('card_data', {
              tenantId,
              cardType:   String(msg.cardType   ?? ''),
              cardSerial: String(msg.cardSerial ?? ''),
              parsedData: msg.parsedData ?? null,
            } satisfies CardDataEvent);
          }
        } catch { /* ignore malformed */ }
      });

      ws.on('close', () => {
        bridgeSockets.get(tenantId)?.delete(ws);
      });

      ws.on('error', () => ws.close());
    } catch (err) {
      ws.close(4001, 'Internal error');
    }
  });
}
