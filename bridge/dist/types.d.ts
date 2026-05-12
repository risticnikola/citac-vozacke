export type CardType = 'vehicle_registration' | 'id_card' | 'other';
/** Structured data returned by the C++ binary (eVehicleRegistrationAPI.dll) */
export interface VehicleRegistrationData {
    vehicleIdNumber?: string;
    registrationPlateNumber?: string;
    vehicleCategory?: string;
    vehicleMake?: string;
    commercialDescription?: string;
    colourOfVehicle?: string;
    yearOfProduction?: number;
    engineCapacity?: number;
    maximumNetPower?: number;
    typeOfFuel?: string;
    massInService?: number;
    numberOfAxles?: number;
    stateIssuing?: string;
    competentAuthority?: string;
    dateOfFirstRegistration?: string;
    registrationDate?: string;
    expiryDate?: string;
    ownersSurnameOrBusinessName?: string;
    ownersFirstName?: string;
    ownersAddress?: string;
    personalNo?: string;
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
