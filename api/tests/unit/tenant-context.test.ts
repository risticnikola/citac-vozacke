// api/tests/unit/tenant-context.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '../../src/db/tenant-context.js';

describe('withTenantContext', () => {
  it('sets RLS config then commits on success', async () => {
    const calls: string[] = [];
    const mockClient = {
      query: vi.fn(async (sql: string) => { calls.push(sql.trim().split('\n')[0]); }),
      release: vi.fn(),
    };
    const mockPool = { connect: vi.fn().mockResolvedValue(mockClient) } as any;

    const result = await withTenantContext(mockPool, 'tenant-uuid', async (c) => {
      await c.query('SELECT 1');
      return 42;
    });

    expect(result).toBe(42);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('set_config');
    expect(calls[2]).toBe('SELECT 1');
    expect(calls[3]).toBe('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rolls back and releases on error', async () => {
    const calls: string[] = [];
    const mockClient = {
      query: vi.fn(async (sql: string) => { calls.push(sql.trim().split('\n')[0]); }),
      release: vi.fn(),
    };
    const mockPool = { connect: vi.fn().mockResolvedValue(mockClient) } as any;

    await expect(
      withTenantContext(mockPool, 'tenant-uuid', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    expect(calls).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
