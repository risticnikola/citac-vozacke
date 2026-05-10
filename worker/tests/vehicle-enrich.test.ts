// worker/tests/vehicle-enrich.test.ts
import { describe, it, expect, vi } from 'vitest';
import { detectAnomalies } from '../src/services/anomaly-detector.service.js';

describe('detectAnomalies', () => {
  it('returns severity none when no anomalies detected', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ cnt: '2' }] })   // read frequency: 2 (under threshold)
        .mockResolvedValueOnce({ rows: [] }),                // no duplicate vehicles
    } as any;

    const result = await detectAnomalies(client, 'tenant-1', 'vehicle-1', 'read-1');
    expect(result.severity).toBe('none');
    expect(result.anomalies).toHaveLength(0);
  });

  it('detects high read frequency anomaly', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ cnt: '15' }] })  // 15 reads in 1 hour — over threshold
        .mockResolvedValueOnce({ rows: [] }),
    } as any;

    const result = await detectAnomalies(client, 'tenant-1', 'vehicle-1', 'read-1');
    expect(result.severity).toBe('low');
    expect(result.anomalies[0]).toMatch(/High read frequency/);
  });

  it('detects card serial on multiple vehicles', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })
        .mockResolvedValueOnce({ rows: [{ vehicle_id: 'vehicle-2' }] }), // duplicate
    } as any;

    const result = await detectAnomalies(client, 'tenant-1', 'vehicle-1', 'read-1');
    expect(result.severity).toBe('low');
    expect(result.anomalies[0]).toMatch(/multiple vehicles/);
  });

  it('returns high severity when multiple anomalies detected', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ cnt: '20' }] })          // high frequency
        .mockResolvedValueOnce({ rows: [{ vehicle_id: 'v2' }, { vehicle_id: 'v3' }] }), // duplicates
    } as any;

    const result = await detectAnomalies(client, 'tenant-1', 'vehicle-1', 'read-1');
    expect(result.severity).toBe('medium');
    expect(result.anomalies).toHaveLength(2);
  });
});
