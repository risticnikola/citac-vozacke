// api/src/hub/web-hub.ts
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { verify } from 'jsonwebtoken';
import { bridgeEvents, type CardDataEvent } from './bridge-hub.js';

const webSockets = new Map<string, Set<WebSocket>>();

export function broadcastToTenant(tenantId: string, msg: object): void {
  const clients = webSockets.get(tenantId) ?? new Set();
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
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

export function attachWebHub(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

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

    ws.on('close', () => webSockets.get(tenantId)?.delete(ws));
    ws.on('error', () => ws.close());
  });
}
