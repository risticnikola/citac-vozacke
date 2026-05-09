// bridge/src/types.ts

export type CardType = 'driver' | 'vehicle' | 'workshop' | 'control';

export interface CardData {
  cardType: CardType;
  cardSerial: string;
  rawDump: Buffer;
  parsedData?: Record<string, unknown>;
}

export interface QueuedRead {
  id: number;
  deviceId: string;
  cardSerial: string;
  cardType: CardType;
  rawDump: Buffer;
  idempotencyKey: string;
  retryCount: number;
  createdAt: number;
}

export interface BridgeConfig {
  cloudApiUrl: string;
  deviceId: string;
  privateKeyPem: string;
  httpPort: number;
  wsPort: number;
  allowedOrigins: string[];
}

export interface WsMessage {
  type: 'card.read' | 'device.status' | 'error';
  payload: unknown;
}

export interface DeviceStatus {
  connected: boolean;
  port?: string;
  queueDepth: number;
  lastReadAt?: string;
}
