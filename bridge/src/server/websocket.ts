// bridge/src/server/websocket.ts
// WebSocket server — bound to 127.0.0.1; Origin allowlist prevents cross-site access
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { WsMessage } from '../types.js';

export function createWsServer(port: number, allowedOrigins: string[]): WebSocketServer {
  const wss = new WebSocketServer({ host: '127.0.0.1', port });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const origin = req.headers['origin'] ?? '';
    if (!allowedOrigins.includes(origin) && origin !== '') {
      ws.close(4003, 'Origin not allowed');
      return;
    }

    ws.on('error', (err) => console.error({ err }, 'ws error'));
    ws.on('message', () => { /* read-only server; ignore incoming messages */ });
  });

  return wss;
}

export function broadcast(wss: WebSocketServer, msg: WsMessage): void {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
