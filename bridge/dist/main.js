"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// bridge/src/main.ts — Electron main process
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const path_1 = __importDefault(require("path"));
const queue_js_1 = require("./bridge/queue.js");
const client_js_1 = require("./cloud/client.js");
const http_js_1 = require("./server/http.js");
const websocket_js_1 = require("./server/websocket.js");
const port_manager_js_1 = require("./bridge/port-manager.js");
const CONFIG = {
    cloudApiUrl: process.env.CLOUD_API_URL ?? 'http://localhost:3000',
    deviceId: process.env.DEVICE_ID ?? 'local-device',
    privateKeyPem: process.env.DEVICE_PRIVATE_KEY ?? '',
    httpPort: parseInt(process.env.BRIDGE_HTTP_PORT ?? '4000', 10),
    wsPort: parseInt(process.env.BRIDGE_WS_PORT ?? '4001', 10),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'null').split(','),
};
const DB_PATH = path_1.default.join(electron_1.app.getPath('userData'), 'offline-queue.db');
let win = null;
electron_1.app.whenReady().then(async () => {
    (0, queue_js_1.initQueue)(DB_PATH);
    const cloudClient = new client_js_1.CloudClient(CONFIG.cloudApiUrl, CONFIG.deviceId, process.env.TENANT_ID ?? '', CONFIG.privateKeyPem);
    const httpServer = (0, http_js_1.createHttpServer)(cloudClient, CONFIG.httpPort);
    const wss = (0, websocket_js_1.createWsServer)(CONFIG.wsPort, CONFIG.allowedOrigins);
    // Drain offline queue every 30 seconds
    setInterval(() => cloudClient.drainQueue().catch(console.error), 30_000);
    // Auto-update check on startup + every 4 hours
    electron_updater_1.autoUpdater.checkForUpdatesAndNotify().catch(console.error);
    setInterval(() => electron_updater_1.autoUpdater.checkForUpdatesAndNotify().catch(console.error), 4 * 60 * 60 * 1000);
    win = new electron_1.BrowserWindow({
        width: 400,
        height: 300,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
        title: 'Vehicle Card Bridge',
    });
    await win.loadFile('renderer/index.html');
    // IPC: start the reader (optional readerName to select a specific PC/SC reader)
    electron_1.ipcMain.handle('reader:start', async (_ev, readerName) => {
        const reader = await (0, port_manager_js_1.openReader)(readerName);
        reader.on('card', async (cardData) => {
            const item = {
                deviceId: CONFIG.deviceId,
                cardSerial: cardData.cardSerial,
                cardType: cardData.cardType,
                rawDump: cardData.rawDump,
                idempotencyKey: `${CONFIG.deviceId}-${cardData.cardSerial}-${Date.now()}`,
            };
            (0, queue_js_1.enqueue)(item);
            (0, websocket_js_1.broadcast)(wss, {
                type: 'card.read',
                payload: {
                    cardType: cardData.cardType,
                    cardSerial: cardData.cardSerial,
                    parsedData: cardData.parsedData,
                },
            });
            cloudClient.drainQueue().catch(console.error);
        });
        return { ok: true };
    });
    electron_1.ipcMain.handle('reader:stop', async () => {
        const { closeReader } = await Promise.resolve().then(() => __importStar(require('./bridge/port-manager.js')));
        await closeReader();
        return { ok: true };
    });
    win.on('closed', () => { win = null; });
    httpServer.on('error', (err) => console.error({ err }, 'HTTP server error'));
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
//# sourceMappingURL=main.js.map