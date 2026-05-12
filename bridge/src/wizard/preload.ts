// bridge/src/wizard/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wizard', {
  getDefaultApiUrl: (): Promise<string> =>
    ipcRenderer.invoke('wizard:get-default-api-url'),

  activate: (args: { token: string; label: string | null; apiUrl: string }): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('wizard:activate', args),
});
