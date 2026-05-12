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
// bridge/src/main.ts
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const queue_js_1 = require("./bridge/queue.js");
const client_js_1 = require("./cloud/client.js");
const http_js_1 = require("./server/http.js");
const websocket_js_1 = require("./server/websocket.js");
const port_manager_js_1 = require("./bridge/port-manager.js");
const DEFAULT_API_URL = process.env.DEFAULT_API_URL ?? 'http://localhost:3050';
const DB_PATH = path_1.default.join(electron_1.app.getPath('userData'), 'offline-queue.db');
const CONFIG_PATH = path_1.default.join(electron_1.app.getPath('userData'), 'config.json');
function loadDeviceConfig() {
    const candidates = [
        CONFIG_PATH,
        path_1.default.join(process.resourcesPath ?? '.', 'config.json'),
        path_1.default.join(__dirname, '..', 'config.json'),
    ];
    for (const candidate of candidates) {
        try {
            const raw = fs_1.default.readFileSync(candidate, 'utf8');
            const cfg = JSON.parse(raw);
            if (cfg.deviceId && cfg.devicePrivateKey && cfg.tenantId)
                return cfg;
        }
        catch { /* try next */ }
    }
    return null;
}
// ---------------------------------------------------------------------------
// Tray helpers
// ---------------------------------------------------------------------------
let CONFIG;
let tray = null;
function getIconPath(active) {
    const name = active ? 'tray-icon-active.png' : 'tray-icon.png';
    return electron_1.app.isPackaged
        ? path_1.default.join(process.resourcesPath, 'assets', name)
        : path_1.default.join(__dirname, '..', 'assets', name);
}
function buildMenu(readerOpen, cloudClient, wss) {
    return electron_1.Menu.buildFromTemplate([
        {
            label: 'Open reader',
            enabled: !readerOpen,
            click: () => tryOpenReader(cloudClient, wss),
        },
        {
            label: 'Close reader',
            enabled: readerOpen,
            click: async () => { await (0, port_manager_js_1.closeReader)(); updateTray(false, cloudClient, wss); },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => electron_1.app.quit() },
    ]);
}
function updateTray(readerOpen, cloudClient, wss) {
    if (!tray)
        return;
    try {
        tray.setImage(getIconPath(readerOpen));
    }
    catch {
        tray.setImage(electron_1.nativeImage.createEmpty());
    }
    tray.setToolTip(`Vehicle Card Bridge — reader ${readerOpen ? 'open' : 'closed'}`);
    tray.setContextMenu(buildMenu(readerOpen, cloudClient, wss));
}
async function tryOpenReader(cloudClient, wss) {
    try {
        const reader = await (0, port_manager_js_1.openReader)();
        reader.on('card', async (cardData) => {
            (0, queue_js_1.enqueue)({
                deviceId: CONFIG.deviceId,
                cardSerial: cardData.cardSerial,
                cardType: cardData.cardType,
                rawDump: cardData.rawDump,
                parsedData: cardData.parsedData,
                idempotencyKey: `${CONFIG.deviceId}-${cardData.cardSerial}-${Date.now()}`,
            });
            (0, websocket_js_1.broadcast)(wss, {
                type: 'card.read',
                payload: { cardType: cardData.cardType, cardSerial: cardData.cardSerial, parsedData: cardData.parsedData },
            });
            cloudClient.drainQueue().catch(console.error);
        });
        reader.on('disconnect', () => updateTray(false, cloudClient, wss));
        updateTray(true, cloudClient, wss);
    }
    catch (err) {
        console.error({ err }, 'Failed to open card reader');
    }
}
// ---------------------------------------------------------------------------
// Bridge startup (called after config is confirmed present)
// ---------------------------------------------------------------------------
async function startBridge(deviceCfg) {
    CONFIG = {
        cloudApiUrl: deviceCfg.cloudApiUrl ?? DEFAULT_API_URL,
        deviceId: deviceCfg.deviceId,
        privateKeyPem: deviceCfg.devicePrivateKey,
        httpPort: deviceCfg.bridgeHttpPort ?? parseInt(process.env.BRIDGE_HTTP_PORT ?? '4000', 10),
        wsPort: deviceCfg.bridgeWsPort ?? parseInt(process.env.BRIDGE_WS_PORT ?? '4001', 10),
        allowedOrigins: deviceCfg.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ?? '*').split(','),
    };
    electron_1.app.setLoginItemSettings({ openAtLogin: true });
    if (process.platform === 'linux' && electron_1.app.isPackaged) {
        const { homedir } = await Promise.resolve().then(() => __importStar(require('os')));
        const autostartDir = path_1.default.join(homedir(), '.config', 'autostart');
        const desktop = [
            '[Desktop Entry]', 'Type=Application', 'Name=Vehicle Card Bridge',
            `Exec=${process.execPath}`, 'Hidden=false', 'NoDisplay=false',
            'X-GNOME-Autostart-enabled=true',
        ].join('\n');
        try {
            const { mkdir, writeFile } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            await mkdir(autostartDir, { recursive: true });
            await writeFile(path_1.default.join(autostartDir, 'vehicle-card-bridge.desktop'), desktop, { encoding: 'utf8' });
        }
        catch (err) {
            console.error({ err }, 'Failed to write Linux autostart entry');
        }
    }
    (0, queue_js_1.initQueue)(DB_PATH);
    const cloudClient = new client_js_1.CloudClient(CONFIG.cloudApiUrl, CONFIG.deviceId, deviceCfg.tenantId, CONFIG.privateKeyPem);
    const wss = (0, websocket_js_1.createWsServer)(CONFIG.wsPort, CONFIG.allowedOrigins);
    (0, http_js_1.createHttpServer)(cloudClient, CONFIG.httpPort);
    setInterval(() => cloudClient.drainQueue().catch(console.error), 30_000);
    cloudClient.heartbeat().catch(console.error);
    setInterval(() => cloudClient.heartbeat().catch(console.error), 5 * 60_000);
    electron_updater_1.autoUpdater.checkForUpdatesAndNotify().catch(console.error);
    setInterval(() => electron_updater_1.autoUpdater.checkForUpdatesAndNotify().catch(console.error), 4 * 60 * 60 * 1000);
    let initialIcon;
    try {
        initialIcon = getIconPath(false);
    }
    catch {
        initialIcon = electron_1.nativeImage.createEmpty();
    }
    tray = new electron_1.Tray(initialIcon);
    updateTray(false, cloudClient, wss);
    electron_1.app.on('window-all-closed', () => { });
    await tryOpenReader(cloudClient, wss);
}
// ---------------------------------------------------------------------------
// Setup wizard (shown when no config.json exists)
// ---------------------------------------------------------------------------
function showWizard() {
    const win = new electron_1.BrowserWindow({
        width: 480,
        height: 600,
        resizable: false,
        center: true,
        title: 'Vehicle Card Bridge — Setup',
        backgroundColor: '#0a0a0a',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'wizard', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    const htmlPath = electron_1.app.isPackaged
        ? path_1.default.join(electron_1.app.getAppPath(), 'wizard', 'index.html')
        : path_1.default.join(__dirname, '..', 'wizard', 'index.html');
    win.loadFile(htmlPath);
    win.setMenuBarVisibility(false);
    electron_1.ipcMain.handle('wizard:get-default-api-url', () => DEFAULT_API_URL);
    electron_1.ipcMain.handle('wizard:activate', async (_event, args) => {
        try {
            const res = await fetch(`${args.apiUrl}/v1/devices/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: args.token,
                    label: args.label,
                    platform: process.platform === 'win32' ? 'windows'
                        : process.platform === 'darwin' ? 'macos'
                            : 'linux',
                }),
                signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                return { ok: false, error: body.error ?? `Server returned ${res.status}` };
            }
            const data = await res.json();
            const config = {
                deviceId: data.deviceId,
                devicePrivateKey: data.devicePrivateKey,
                tenantId: data.tenantId,
                cloudApiUrl: args.apiUrl,
            };
            fs_1.default.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
            // Start bridge then close wizard
            win.close();
            await startBridge(config);
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: err.message ?? 'Network error — check the server URL.' };
        }
    });
    // If the user closes the wizard without activating, quit
    win.on('closed', () => {
        if (!loadDeviceConfig())
            electron_1.app.quit();
    });
}
// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
electron_1.app.whenReady().then(async () => {
    const deviceCfg = loadDeviceConfig();
    if (!deviceCfg) {
        showWizard();
        return;
    }
    await startBridge(deviceCfg);
});
//# sourceMappingURL=main.js.map