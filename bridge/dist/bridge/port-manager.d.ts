import { CardReader } from './card-reader.js';
import type { CardData } from '../types.js';
/** Open the first available PC/SC reader (or a specific one by name). */
export declare function openReader(readerName?: string): Promise<CardReader>;
export declare function closeReader(): Promise<void>;
export declare function getActiveReaderName(): string | null;
export declare function isReaderOpen(): boolean;
export declare function readFromActive(): Promise<CardData>;
