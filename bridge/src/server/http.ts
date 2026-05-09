// bridge/src/server/http.ts
// Local HTTP server — bound to 127.0.0.1 only; used by the browser extension
import http from 'http';
import type { CloudClient } from '../cloud/client.js';
import { openReader, closeReader, getActiveReaderName, isReaderOpen } from '../bridge/port-manager.js';

export function createHttpServer(client: CloudClient, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', 'null'); // Electron renderer only

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200).end(JSON.stringify({
          ok: true,
          readerOpen: isReaderOpen(),
          activeReader: getActiveReaderName(),
          queueDepth: client.getQueueDepth(),
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
