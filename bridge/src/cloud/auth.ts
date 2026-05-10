// bridge/src/cloud/auth.ts
// Device authentication: RS256 JWT signed with the device's private key
import { createPrivateKey, createSign } from 'crypto';
import { randomUUID } from 'crypto';

export interface DeviceToken {
  token: string;
  expiresAt: number;
}

const TOKEN_LIFETIME_SECS = 3600;

export function signDeviceToken(deviceId: string, tenantId: string, privateKeyPem: string): DeviceToken {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_LIFETIME_SECS;

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: deviceId,
    tenantId,
    iat: now,
    exp,
    jti: randomUUID(),
  })).toString('base64url');

  const toSign = `${header}.${payload}`;
  const key = createPrivateKey({ key: privateKeyPem, format: 'pem' });
  const sign = createSign('RSA-SHA256');
  sign.update(toSign);
  const signature = sign.sign(key).toString('base64url');

  return { token: `${toSign}.${signature}`, expiresAt: exp * 1000 };
}

let cached: DeviceToken | null = null;

export function getToken(deviceId: string, tenantId: string, privateKeyPem: string): string {
  const nowMs = Date.now();
  if (!cached || cached.expiresAt - nowMs < 60_000) {
    cached = signDeviceToken(deviceId, tenantId, privateKeyPem);
  }
  return cached.token;
}
