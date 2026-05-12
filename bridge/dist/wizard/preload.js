"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// bridge/src/wizard/preload.ts
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('wizard', {
    getDefaultApiUrl: () => electron_1.ipcRenderer.invoke('wizard:get-default-api-url'),
    activate: (args) => electron_1.ipcRenderer.invoke('wizard:activate', args),
});
//# sourceMappingURL=preload.js.map