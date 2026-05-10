export interface DeviceToken {
    token: string;
    expiresAt: number;
}
export declare function signDeviceToken(deviceId: string, tenantId: string, privateKeyPem: string): DeviceToken;
export declare function getToken(deviceId: string, tenantId: string, privateKeyPem: string): string;
