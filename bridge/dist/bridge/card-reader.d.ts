import { EventEmitter } from 'events';
import type { CardData } from '../types.js';
export declare class CardReader extends EventEmitter {
    private wrapper;
    open(readerName?: string): Promise<void>;
    readCard(): Promise<CardData>;
    close(): Promise<void>;
    isOpen(): boolean;
}
