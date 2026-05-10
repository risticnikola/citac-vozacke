import type { QueuedRead } from '../types.js';
interface UploadResult {
    id: string;
}
export declare class CloudClient {
    private readonly apiUrl;
    private readonly deviceId;
    private readonly tenantId;
    private readonly privateKeyPem;
    constructor(apiUrl: string, deviceId: string, tenantId: string, privateKeyPem: string);
    uploadCardRead(item: QueuedRead): Promise<UploadResult>;
    drainQueue(): Promise<{
        uploaded: number;
        failed: number;
    }>;
    getQueueDepth(): number;
}
export {};
