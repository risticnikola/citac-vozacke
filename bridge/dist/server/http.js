"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpServer = createHttpServer;
// bridge/src/server/http.ts
// Local HTTP server — bound to 127.0.0.1 only; used by the browser extension
const http_1 = __importDefault(require("http"));
const port_manager_js_1 = require("../bridge/port-manager.js");
function createHttpServer(client, port) {
    const server = http_1.default.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', 'null'); // Electron renderer only
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        try {
            if (req.method === 'GET' && url.pathname === '/health') {
                res.writeHead(200).end(JSON.stringify({
                    ok: true,
                    readerOpen: (0, port_manager_js_1.isReaderOpen)(),
                    activeReader: (0, port_manager_js_1.getActiveReaderName)(),
                    queueDepth: client.getQueueDepth(),
                }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/reader/open') {
                const body = await readBody(req);
                const { readerName } = JSON.parse(body || '{}');
                await (0, port_manager_js_1.openReader)(readerName);
                res.writeHead(200).end(JSON.stringify({ ok: true, readerName: readerName ?? 'default' }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/reader/close') {
                await (0, port_manager_js_1.closeReader)();
                res.writeHead(200).end(JSON.stringify({ ok: true }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/queue/drain') {
                const result = await client.drainQueue();
                res.writeHead(200).end(JSON.stringify(result));
                return;
            }
            res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
        }
        catch (err) {
            res.writeHead(500).end(JSON.stringify({ error: err.message ?? 'Internal error' }));
        }
    });
    server.listen(port, '127.0.0.1');
    return server;
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}
//# sourceMappingURL=http.js.map