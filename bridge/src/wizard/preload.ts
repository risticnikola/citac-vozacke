// bridge/src/wizard/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wizard', {
  activate: (args: { token: string; label: string | null }): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('wizard:activate', args),

  listReaders: (): Promise<string[]> =>
    ipcRenderer.invoke('readers:list'),

  confirmReader: (readerName: string | null): Promise<void> =>
    ipcRenderer.invoke('wizard:confirm-reader', { readerName }),
});
