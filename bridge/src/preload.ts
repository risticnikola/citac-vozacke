import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bridge', {
  startReader: (readerName?: string) =>
    ipcRenderer.invoke('reader:start', readerName),

  stopReader: () =>
    ipcRenderer.invoke('reader:stop'),

  onCard: (cb: (data: unknown) => void) => {
    ipcRenderer.on('card:data', (_ev, data) => cb(data));
  },

  onStatus: (cb: (status: { connected: boolean; readerName?: string }) => void) => {
    ipcRenderer.on('reader:status', (_ev, status) => cb(status));
  },

  onError: (cb: (message: string) => void) => {
    ipcRenderer.on('reader:error', (_ev, message) => cb(message));
  },
});
