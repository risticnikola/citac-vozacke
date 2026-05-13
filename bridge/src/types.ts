// bridge/src/types.ts

export type CardType = 'vehicle_registration' | 'id_card' | 'other';

/** Structured data returned by the C++ binary (eVehicleRegistrationAPI.dll) */
export interface VehicleRegistrationData {
  // Vehicle identity
  vehicleIdNumber?: string;          // VIN
  registrationPlateNumber?: string;
  vehicleCategory?: string;          // M1, N1, etc.
  vehicleMake?: string;
  commercialDescription?: string;    // model / variant
  colourOfVehicle?: string;
  yearOfProduction?: number;

  // Technical
  engineCapacity?: number;           // cm³
  maximumNetPower?: number;          // kW
  typeOfFuel?: string;
  massInService?: number;            // kg
  numberOfAxles?: number;

  // Registration
  stateIssuing?: string;             // ISO 3166-1 alpha-3, e.g. "SRB"
  competentAuthority?: string;
  dateOfFirstRegistration?: string;  // YYYY-MM-DD
  registrationDate?: string;
  expiryDate?: string;

  // Owner
  ownersSurnameOrBusinessName?: string;
  ownersFirstName?: string;
  ownersAddress?: string;
  personalNo?: string;               // JMBG or company ID — handle as PII
}

export interface CardData {
  cardType: CardType;
  cardSerial: string;
  rawDump: Buffer;
  parsedData?: VehicleRegistrationData;
}

export interface QueuedRead {
  id: number;
  deviceId: string;
  cardSerial: string;
  cardType: CardType;
  rawDump: Buffer;
  parsedData?: VehicleRegistrationData;
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
