// bridge/tests/apdu.test.ts
import { describe, it, expect } from 'vitest';
import { buildApdu, parseApduResponse, ISO7816 } from '../src/bridge/apdu.js';

describe('buildApdu', () => {
  it('builds a 4-byte command with no data and no Le', () => {
    const buf = buildApdu({ cla: 0x00, ins: 0xA4, p1: 0x00, p2: 0x0C });
    expect(buf).toEqual(Buffer.from([0x00, 0xA4, 0x00, 0x0C]));
  });

  it('includes Lc and data bytes', () => {
    const data = Buffer.from([0xAB, 0xCD]);
    const buf = buildApdu({ cla: 0x00, ins: 0xA4, p1: 0x02, p2: 0x04, data });
    expect(buf).toEqual(Buffer.from([0x00, 0xA4, 0x02, 0x04, 0x02, 0xAB, 0xCD]));
  });

  it('includes Le byte', () => {
    const buf = buildApdu({ cla: 0x00, ins: 0xB0, p1: 0x00, p2: 0x00, le: 0x10 });
    expect(buf).toEqual(Buffer.from([0x00, 0xB0, 0x00, 0x00, 0x10]));
  });
});

describe('parseApduResponse', () => {
  it('parses success response 0x9000', () => {
    const buf = Buffer.from([0x01, 0x02, 0x90, 0x00]);
    const r = parseApduResponse(buf);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual(Buffer.from([0x01, 0x02]));
    expect(r.sw1).toBe(0x90);
    expect(r.sw2).toBe(0x00);
  });

  it('parses error response', () => {
    const buf = Buffer.from([0x6A, 0x82]);
    const r = parseApduResponse(buf);
    expect(r.ok).toBe(false);
    expect(r.data.length).toBe(0);
  });

  it('throws on too-short buffer', () => {
    expect(() => parseApduResponse(Buffer.from([0x90]))).toThrow();
  });
});

describe('ISO7816 helpers', () => {
  it('selectMasterFile produces correct bytes', () => {
    expect(ISO7816.selectMasterFile()).toEqual(
      Buffer.from([0x00, 0xA4, 0x00, 0x0C]),
    );
  });

  it('readBinary encodes 2-byte offset correctly', () => {
    const buf = ISO7816.readBinary(0x0100, 0x20);
    expect(buf[2]).toBe(0x01); // P1 = high byte
    expect(buf[3]).toBe(0x00); // P2 = low byte
    expect(buf[4]).toBe(0x20); // Le
  });

  it('selectEfById encodes the file ID bytes', () => {
    const fileId = Buffer.from([0x00, 0x02]);
    const buf = ISO7816.selectEfById(fileId);
    expect(buf.slice(5, 7)).toEqual(fileId);
  });
});
