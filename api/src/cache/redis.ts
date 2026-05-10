// api/src/cache/redis.ts
import { Redis } from 'ioredis';

const FAILURE_THRESHOLD = 5;
const RESET_MS = 30_000;

let failures = 0;
let circuitOpenAt: number | null = null;

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  lazyConnect: false,
  connectTimeout: 3_000,
});
redis.on('error', () => {});

function isOpen(): boolean {
  if (circuitOpenAt === null) return false;
  if (Date.now() - circuitOpenAt > RESET_MS) { circuitOpenAt = null; failures = 0; return false; }
  return true;
}
function fail(): void { if (++failures >= FAILURE_THRESHOLD) circuitOpenAt = Date.now(); }
function ok(): void { failures = 0; circuitOpenAt = null; }

export async function safeGet(key: string): Promise<string | null> {
  if (isOpen()) return null;
  try { const v = await redis.get(key); ok(); return v; } catch { fail(); return null; }
}

export async function safeSet(key: string, value: string, ttl: number): Promise<void> {
  if (isOpen()) return;
  try { await redis.setex(key, ttl, value); ok(); } catch { fail(); }
}

export function isRedisHealthy(): boolean {
  return redis.status === 'ready' && !isOpen();
}

// Atomic sliding-window rate limiter. Returns true if the request is allowed.
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window_ms)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, tostring(now) .. math.random(1000000))
  redis.call('PEXPIRE', key, window_ms)
  return 0
end
return 1
`;

let rateLimitSha: string | null = null;

export async function checkRateLimit(
  key: string, windowMs: number, limit: number,
): Promise<boolean> {
  if (isOpen()) return true;
  if (!rateLimitSha) rateLimitSha = await redis.script('LOAD', RATE_LIMIT_SCRIPT) as string;
  try {
    const result = await redis.evalsha(rateLimitSha, 1, key, windowMs, limit, Date.now());
    ok();
    return result === 0;
  } catch { fail(); return true; }
}
