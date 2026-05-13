// bridge/src/cloud/ws-client.ts
// Outbound WebSocket client — connects to the server hub, handles scan commands.
import WebSocket from 'ws';
import { getToken } from './auth.js';
import { readFromActive } from '../bridge/port-manager.js';

export interface WsClientConfig {
  cloudApiUrl:   string;
  deviceId:      string;
  tenantId:      string;
  privateKeyPem: string;
}

// Minimal pino-shaped logger backed by console
const log = {
  name: 'server-ws-client',
  info:  (msg: string) => console.info(`[${new Date().toISOString()}] INFO  server-ws-client: ${msg}`),
  warn:  (msg: string) => console.warn(`[${new Date().toISOString()}] WARN  server-ws-client: ${msg}`),
  error: (msg: string) => console.error(`[${new Date().toISOString()}] ERROR server-ws-client: ${msg}`),
};

const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;

export function createServerWsClient(cfg: WsClientConfig): void {
  let backoffMs = BACKOFF_MIN_MS;
  let ws: WebSocket | null = null;

  function buildWsUrl(): string {
    const wsUrl = cfg.cloudApiUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
    return `${wsUrl}/v1/devices/ws`;
  }

  function connect(): void {
    const wsUrl = buildWsUrl();
    const token = getToken(cfg.deviceId, cfg.tenantId, cfg.privateKeyPem);

    ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    ws.on('open', () => {
      log.info(`Connected to server hub at ${wsUrl}`);
      backoffMs = BACKOFF_MIN_MS;
    });

    ws.on('message', async (data: WebSocket.RawData) => {
      let msg: { type?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        log.warn('Received non-JSON message from server hub — ignoring');
        return;
      }

      if (msg.type === 'scan') {
        try {
          const cardData = await readFromActive();
          send({
            type:       'card_data',
            cardType:   cardData.cardType,
            cardSerial: cardData.cardSerial,
            parsedData: cardData.parsedData,
          });
        } catch (err: any) {
          send({ type: 'scan_error', error: (err as Error).message });
        }
      }
    });

    ws.on('close', (_code: number, _reason: Buffer) => {
      log.warn(`Disconnected from server hub — reconnecting in ${backoffMs}ms`);
      ws = null;
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    });

    ws.on('error', (err: Error) => {
      log.error(`WebSocket error: ${err.message}`);
      ws?.close();
    });
  }

  function send(payload: object): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  connect();
}
