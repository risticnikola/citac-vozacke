// bridge/tests/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseVehicleCard, parseDriverCard } from '../src/bridge/parser.js';

describe('parseVehicleCard', () => {
  it('returns empty ParsedCard for short buffer', () => {
    const result = parseVehicleCard(Buffer.alloc(5));
    expect(result.cardType).toBe('vehicle');
    expect(result.vin).toBeUndefined();
  });

  it('parses vehicle registration nation and number', () => {
    const buf = Buffer.alloc(64, 0);
    buf.write('DEU', 0, 'ascii');
    buf.write('HH-AB-1234\0\0\0', 3, 'latin1');
    const r = parseVehicleCard(buf);
    expect(r.vehicleRegistrationNation).toBe('DEU');
    expect(r.vehicleRegistrationNumber).toBe('HH-AB-1234');
  });

  it('parses VIN at offset 16', () => {
    const buf = Buffer.alloc(64, 0);
    const vin = 'WBA3A5C55EF123456';
    buf.write(vin, 16, 'ascii');
    const r = parseVehicleCard(buf);
    expect(r.vin).toBe(vin);
  });
});

describe('parseDriverCard', () => {
  it('returns empty ParsedCard for short buffer', () => {
    const result = parseDriverCard(Buffer.alloc(10));
    expect(result.cardType).toBe('driver');
  });

  it('parses holder surname', () => {
    const buf = Buffer.alloc(100, 0);
    buf[0] = 0x00; // code page
    buf.write('MUSTERMANN', 1, 'latin1');
    const r = parseDriverCard(buf);
    expect(r.holderSurname).toContain('MUSTERMANN');
  });
});
