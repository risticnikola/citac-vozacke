'use client';

import { createContext, useContext } from 'react';
import { useBridgeSocket, BridgeSocketState } from '@/hooks/useBridgeSocket';

const BridgeContext = createContext<BridgeSocketState>({
  connected: false,
  lastCard: null,
  scanError: null,
  onlineDevices: [],
  selectedDeviceId: null,
  clearCard: () => {},
  clearScanError: () => {},
  setSelectedDeviceId: () => {},
});

export function BridgeProvider({ children }: { children: React.ReactNode }) {
  const state = useBridgeSocket();
  return <BridgeContext.Provider value={state}>{children}</BridgeContext.Provider>;
}

export function useBridge() {
  return useContext(BridgeContext);
}
