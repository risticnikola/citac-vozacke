"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signDeviceToken = signDeviceToken;
exports.getToken = getToken;
// bridge/src/cloud/auth.ts
// Device authentication: RS256 JWT signed with the device's private key
const crypto_1 = require("crypto");
const crypto_2 = require("crypto");
const TOKEN_LIFETIME_SECS = 3600;
function signDeviceToken(deviceId, tenantId, privateKeyPem) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + TOKEN_LIFETIME_SECS;
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        sub: deviceId,
        tenantId,
        iat: now,
        exp,
        jti: (0, crypto_2.randomUUID)(),
    })).toString('base64url');
    const toSign = `${header}.${payload}`;
    const key = (0, crypto_1.createPrivateKey)({ key: privateKeyPem, format: 'pem' });
    const sign = (0, crypto_1.createSign)('RSA-SHA256');
    sign.update(toSign);
    const signature = sign.sign(key).toString('base64url');
    return { token: `${toSign}.${signature}`, expiresAt: exp * 1000 };
}
let cached = null;
function getToken(deviceId, tenantId, privateKeyPem) {
    const nowMs = Date.now();
    if (!cached || cached.expiresAt - nowMs < 60_000) {
        cached = signDeviceToken(deviceId, tenantId, privateKeyPem);
    }
    return cached.token;
}
//# sourceMappingURL=auth.js.map