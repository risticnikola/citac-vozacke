"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWsServer = createWsServer;
exports.broadcast = broadcast;
// bridge/src/server/websocket.ts
// WebSocket server — bound to 127.0.0.1; Origin allowlist prevents cross-site access
const ws_1 = require("ws");
function createWsServer(port, allowedOrigins) {
    const wss = new ws_1.WebSocketServer({ host: '127.0.0.1', port });
    wss.on('connection', (ws, req) => {
        const origin = req.headers['origin'] ?? '';
        if (!allowedOrigins.includes(origin) && origin !== '') {
            ws.close(4003, 'Origin not allowed');
            return;
        }
        ws.on('error', (err) => console.error({ err }, 'ws error'));
        ws.on('message', () => { });
    });
    return wss;
}
function broadcast(wss, msg) {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(payload);
        }
    }
}
//# sourceMappingURL=websocket.js.map