import { EventEmitter } from 'events';
import type { CardData } from '../types.js';
export declare class CppWrapper extends EventEmitter {
    private proc;
    private lineBuffer;
    private pendingResolve;
    private pendingReject;
    private responseTimer;
    start(readerName?: string): Promise<void>;
    readCard(port?: string): Promise<CardData>;
    shutdown(): Promise<void>;
    private send;
    private awaitResponse;
    private onData;
    private rejectPending;
}
