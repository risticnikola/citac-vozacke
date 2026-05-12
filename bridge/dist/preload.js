"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('bridge', {
    startReader: (readerName) => electron_1.ipcRenderer.invoke('reader:start', readerName),
    stopReader: () => electron_1.ipcRenderer.invoke('reader:stop'),
    onCard: (cb) => {
        electron_1.ipcRenderer.on('card:data', (_ev, data) => cb(data));
    },
    onStatus: (cb) => {
        electron_1.ipcRenderer.on('reader:status', (_ev, status) => cb(status));
    },
    onError: (cb) => {
        electron_1.ipcRenderer.on('reader:error', (_ev, message) => cb(message));
    },
});
//# sourceMappingURL=preload.js.map