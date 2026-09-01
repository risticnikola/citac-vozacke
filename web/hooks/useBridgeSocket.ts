'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { BridgeCardEvent, BridgeWsMessage, OnlineDevice } from '@/types';

function getWsBase(): string {
  if (typeof window === 'undefined') return '';
  const envBase = process.env.NEXT_PUBLIC_API_URL;
  if (envBase) return envBase.replace(/^http/, 'ws');
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
}
const MAX_BACKOFF_MS = 30_000;
const STORAGE_KEY = 'bridge_selected_device';

function loadStoredDeviceId(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function saveDeviceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else     localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore — localStorage may be unavailable */ }
}

export interface BridgeSocketState {
  connected:           boolean;
  lastCard:            BridgeCardEvent | null;
  scanError:           string | null;
  onlineDevices:       OnlineDevice[];
  selectedDeviceId:    string | null;
  clearCard:           () => void;
  clearScanError:      () => void;
  setSelectedDeviceId: (id: string | null) => void;
}

export function useBridgeSocket(): BridgeSocketState {
  const [onlineDevices, setOnlineDevices]             = useState<OnlineDevice[]>([]);
  const [lastCard, setLastCard]                       = useState<BridgeCardEvent | null>(null);
  const [scanError, setScanError]                     = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceIdState]  = useState<string | null>(null);

  const wsRef       = useRef<WebSocket | null>(null);
  const backoff     = useRef(2_000);
  const destroyed   = useRef(false);
  const initialized = useRef(false);

  // Load stored selection on first client-side mount only
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setSelectedDeviceIdState(loadStoredDeviceId());
  }, []);

  const setSelectedDeviceId = useCallback((id: string | null) => {
    setSelectedDeviceIdState(id);
    saveDeviceId(id);
  }, []);

  const connect = useCallback(() => {
    if (destroyed.current) return;
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('token') : null;
      if (!token) return;
      const wsBase = getWsBase();
      const ws = new WebSocket(`${wsBase}/v1/events/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[bridge-ws] connected to', `${wsBase}/v1/events/ws`);
        backoff.current = 2_000;
      };

      ws.onmessage = (ev) => {
        try {
          const msg: BridgeWsMessage = JSON.parse(ev.data);

          if (msg.type === 'devices.list') {
            const devices = msg.devices ?? [];
            setOnlineDevices(devices);
            // If stored selection is no longer online, clear it
            setSelectedDeviceIdState((prev) => {
              if (prev && !devices.find((d) => d.id === prev)) {
                saveDeviceId(null);
                return null;
              }
              return prev;
            });
            return;
          }

          if (msg.type === 'card.read') {
            setLastCard(msg.payload as BridgeCardEvent);
          } else if (msg.type === 'scan.error') {
            setScanError(msg.error ?? 'Scan failed');
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        // Clear device list — will be refreshed on reconnect via snapshot
        setOnlineDevices([]);
        wsRef.current = null;
        if (!destroyed.current) {
          setTimeout(connect, backoff.current);
          backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
        }
      };

      ws.onerror = () => { ws.close(); };
    } catch {
      // WebSocket constructor can throw in SSR — skip
    }
  }, []);

  useEffect(() => {
    destroyed.current = false;
    connect();
    return () => {
      destroyed.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  const clearCard      = useCallback(() => setLastCard(null), []);
  const clearScanError = useCallback(() => setScanError(null), []);

  // connected = at least one bridge is online for this tenant
  const connected = onlineDevices.length > 0;

  return {
    connected,
    lastCard,
    scanError,
    onlineDevices,
    selectedDeviceId,
    clearCard,
    clearScanError,
    setSelectedDeviceId,
  };
}
