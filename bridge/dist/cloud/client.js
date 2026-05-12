"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudClient = void 0;
const auth_js_1 = require("./auth.js");
const queue_js_1 = require("../bridge/queue.js");
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000];
class CloudClient {
    apiUrl;
    deviceId;
    tenantId;
    privateKeyPem;
    constructor(apiUrl, deviceId, tenantId, privateKeyPem) {
        this.apiUrl = apiUrl;
        this.deviceId = deviceId;
        this.tenantId = tenantId;
        this.privateKeyPem = privateKeyPem;
    }
    async uploadCardRead(item) {
        const token = (0, auth_js_1.getToken)(this.deviceId, this.tenantId, this.privateKeyPem);
        let lastErr = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                const resp = await fetch(`${this.apiUrl}/v1/card-reads`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Idempotency-Key': item.idempotencyKey,
                    },
                    body: JSON.stringify({
                        deviceId: item.deviceId,
                        ...(item.rawDump.length > 0 ? { rawDump: item.rawDump.toString('base64') } : {}),
                        cardSerial: item.cardSerial,
                        cardType: item.cardType,
                        parsedData: item.parsedData,
                    }),
                    signal: AbortSignal.timeout(15_000),
                });
                if (resp.status === 201 || resp.status === 200) {
                    return (await resp.json());
                }
                if (resp.status === 422) {
                    // Validation error — do not retry
                    throw Object.assign(new Error(`Validation error: ${resp.status}`), { noRetry: true });
                }
                throw new Error(`HTTP ${resp.status}`);
            }
            catch (err) {
                lastErr = err;
                if (err.noRetry || attempt === MAX_ATTEMPTS - 1)
                    break;
                await sleep(RETRY_DELAYS_MS[attempt]);
            }
        }
        throw lastErr ?? new Error('Upload failed');
    }
    async drainQueue() {
        const items = (0, queue_js_1.dequeueReady)();
        let uploaded = 0;
        let failed = 0;
        for (const item of items) {
            try {
                await this.uploadCardRead(item);
                (0, queue_js_1.markSuccess)(item.id);
                uploaded++;
            }
            catch {
                (0, queue_js_1.markFailed)(item.id);
                failed++;
            }
        }
        return { uploaded, failed };
    }
    async heartbeat() {
        const token = (0, auth_js_1.getToken)(this.deviceId, this.tenantId, this.privateKeyPem);
        await fetch(`${this.apiUrl}/v1/devices/heartbeat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
        });
    }
    getQueueDepth() {
        return (0, queue_js_1.queueDepth)();
    }
}
exports.CloudClient = CloudClient;
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=client.js.map