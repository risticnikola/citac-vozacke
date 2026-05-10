import { WebSocketServer } from 'ws';
import type { WsMessage } from '../types.js';
export declare function createWsServer(port: number, allowedOrigins: string[]): WebSocketServer;
export declare function broadcast(wss: WebSocketServer, msg: WsMessage): void;
