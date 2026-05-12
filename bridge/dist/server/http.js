"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpServer = createHttpServer;
// bridge/src/server/http.ts
const http_1 = __importDefault(require("http"));
const port_manager_js_1 = require("../bridge/port-manager.js");
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? '*';
function setCors(res, req) {
    const origin = req.headers['origin'] ?? '';
    res.setHeader('Access-Control-Allow-Origin', WEB_ORIGIN === '*' ? (origin || '*') : WEB_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function createHttpServer(client, port) {
    const server = http_1.default.createServer(async (req, res) => {
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
            if (req.method === 'POST' && url.pathname === '/reader/scan') {
                if (!(0, port_manager_js_1.isReaderOpen)()) {
                    res.writeHead(503).end(JSON.stringify({ error: 'Reader not open' }));
                    return;
                }
                // readFromActive() → activeReader.readCard() → emits 'card' event →
                // the listener in main.ts handles WebSocket broadcast and queue.
                const cardData = await (0, port_manager_js_1.readFromActive)();
                res.writeHead(200).end(JSON.stringify({
                    ok: true,
                    cardType: cardData.cardType,
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