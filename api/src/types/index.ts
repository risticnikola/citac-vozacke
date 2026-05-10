// api/src/types/index.ts
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface TenantJwtPayload {
  sub: string;
  tenantId: string;
  role: 'mechanic' | 'garage_admin' | 'saas_admin';
  type: 'user';
  iat: number;
  exp: number;
}

export interface DeviceJwtPayload {
  sub: string;
  tenantId: string;
  keyId: string;
  type: 'device';
  iat: number;
  exp: number;
}

export type JwtPayload = TenantJwtPayload | DeviceJwtPayload;

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireTenantContext: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    jwtPayload: JwtPayload;
    tenantId: string;
  }
}

export interface CardRead {
  id: string;
  tenant_id: string;
  device_id: string;
  vehicle_id: string | null;
  idempotency_key: string;
  raw_dump_s3_key: string;
  parsed_data: Record<string, unknown>;
  card_serial: string | null;
  card_type: 'driver' | 'vehicle' | 'workshop' | 'control' | null;
  read_status: 'success' | 'partial' | 'error';
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
}
