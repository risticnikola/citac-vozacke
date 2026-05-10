import http from 'http';
import type { CloudClient } from '../cloud/client.js';
export declare function createHttpServer(client: CloudClient, port: number): http.Server;
