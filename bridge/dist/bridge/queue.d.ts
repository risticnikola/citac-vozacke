import type { QueuedRead } from '../types.js';
export declare function initQueue(dbPath: string): void;
export declare function enqueue(item: Omit<QueuedRead, 'id' | 'retryCount' | 'createdAt'>): void;
export declare function dequeueReady(limit?: number): QueuedRead[];
export declare function markSuccess(id: number): void;
export declare function markFailed(id: number): void;
export declare function queueDepth(): number;
