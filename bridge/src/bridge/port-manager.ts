// bridge/src/bridge/port-manager.ts
import { SerialPort } from 'serialport';
import { CardReader } from './card-reader.js';

export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
}

// Ensures at most one active CardReader per port path
const activeSessions = new Map<string, CardReader>();

export async function listPorts(): Promise<PortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    serialNumber: p.serialNumber,
  }));
}

export async function openReader(portPath: string): Promise<CardReader> {
  if (activeSessions.has(portPath)) {
    throw new Error(`Port ${portPath} already in use`);
  }
  const reader = new CardReader();
  await reader.open(portPath);
  activeSessions.set(portPath, reader);
  reader.on('disconnect', () => activeSessions.delete(portPath));
  return reader;
}

export async function closeReader(portPath: string): Promise<void> {
  const reader = activeSessions.get(portPath);
  if (reader) {
    await reader.close();
    activeSessions.delete(portPath);
  }
}

export function getActivePort(): string | null {
  const first = activeSessions.keys().next();
  return first.done ? null : first.value;
}
