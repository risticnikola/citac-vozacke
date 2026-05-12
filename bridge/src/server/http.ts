// bridge/src/server/http.ts
import http from 'http';
import type { CloudClient } from '../cloud/client.js';
import {
  openReader, closeReader, getActiveReaderName, isReaderOpen, readFromActive,
} from '../bridge/port-manager.js';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? '*';

function setCors(res: http.ServerResponse, req: http.IncomingMessage): void {
  const origin = req.headers['origin'] ?? '';
  res.setHeader('Access-Control-Allow-Origin', WEB_ORIGIN === '*' ? (origin || '*') : WEB_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function createHttpServer(client: CloudClient, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    setCors(res, req);

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200).end(JSON.stringify({
          ok:           true,
          readerOpen:   isReaderOpen(),
          activeReader: getActiveReaderName(),
          queueDepth:   client.getQueueDepth(),
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/reader/open') {
        const body = await readBody(req);
        const { readerName } = JSON.parse(body || '{}') as { readerName?: string };
        await openReader(readerName);
        res.writeHead(200).end(JSON.stringify({ ok: true, readerName: readerName ?? 'default' }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/reader/close') {
        await closeReader();
        res.writeHead(200).end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/reader/scan') {
        if (!isReaderOpen()) {
          res.writeHead(503).end(JSON.stringify({ error: 'Reader not open' }));
          return;
        }
        // readFromActive() → activeReader.readCard() → emits 'card' event →
        // the listener in main.ts handles WebSocket broadcast and queue.
        const cardData = await readFromActive();
        res.writeHead(200).end(JSON.stringify({
          ok:         true,
          cardType:   cardData.cardType,
          cardSerial: cardData.cardSerial,
          parsedData: cardData.parsedData ?? null,
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/queue/drain') {
        const result = await client.drainQueue();
        res.writeHead(200).end(JSON.stringify(result));
        return;
      }

      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    } catch (err: any) {
      res.writeHead(500).end(JSON.stringify({ error: err.message ?? 'Internal error' }));
    }
  });

  server.listen(port, '127.0.0.1');
  return server;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
