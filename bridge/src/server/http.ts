// bridge/src/server/http.ts
// Local HTTP server — bound to 127.0.0.1 only; used by the browser extension
import http from 'http';
import type { CloudClient } from '../cloud/client.js';
import { listPorts, openReader, closeReader, getActivePort } from '../bridge/port-manager.js';

export function createHttpServer(client: CloudClient, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', 'null'); // Electron renderer

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200).end(JSON.stringify({ ok: true, queueDepth: client.getQueueDepth() }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/ports') {
        const ports = await listPorts();
        res.writeHead(200).end(JSON.stringify(ports));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/ports/open') {
        const body = await readBody(req);
        const { portPath } = JSON.parse(body) as { portPath: string };
        if (!portPath) { res.writeHead(400).end(JSON.stringify({ error: 'portPath required' })); return; }
        await openReader(portPath);
        res.writeHead(200).end(JSON.stringify({ ok: true, portPath }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/ports/close') {
        const activePort = getActivePort();
        if (activePort) await closeReader(activePort);
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
