'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { BridgeCardEvent, BridgeWsMessage } from '@/types';

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3050')
  .replace(/^http/, 'ws');
const MAX_BACKOFF_MS = 30_000;

export interface BridgeSocketState {
  connected: boolean;
  lastCard: BridgeCardEvent | null;
  clearCard: () => void;
}

export function useBridgeSocket(): BridgeSocketState {
  const [connected, setConnected] = useState(false);
  const [lastCard, setLastCard]   = useState<BridgeCardEvent | null>(null);
  const wsRef    = useRef<WebSocket | null>(null);
  const backoff  = useRef(2_000);
  const destroyed = useRef(false);

  const connect = useCallback(() => {
    if (destroyed.current) return;
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('token') : null;
      if (!token) return;
      const ws = new WebSocket(`${WS_BASE}/v1/events/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[bridge-ws] connected to', `${WS_BASE}/v1/events/ws`);
        setConnected(true);
        backoff.current = 2_000;
      };

      ws.onmessage = (ev) => {
        try {
          const msg: BridgeWsMessage = JSON.parse(ev.data);
          console.log('[bridge-ws] message received:', msg);
          if (msg.type === 'card.read') {
            console.log('[bridge-ws] card data:', msg.payload);
            setLastCard(msg.payload as BridgeCardEvent);
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!destroyed.current) {
          setTimeout(connect, backoff.current);
          backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket constructor can throw in SSR — just skip
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

  const clearCard = useCallback(() => setLastCard(null), []);

  return { connected, lastCard, clearCard };
}
