import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('settings', {
  listReaders: (): Promise<string[]> =>
    ipcRenderer.invoke('readers:list'),

  getConfig: (): Promise<{ deviceId: string; preferredReader: string | null }> =>
    ipcRenderer.invoke('settings:get-config'),

  saveReader: (name: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('settings:save-reader', { name }),

  reactivate: (args: { token: string; label: string | null }): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('settings:reactivate', args),
});
