// bridge/src/bridge/apdu.ts
// Generic ISO 7816-4 APDU command builder.
// The C++ binary (eVehicleRegistrationAPI.dll) handles all card communication
// for the vehicle registration use case; this module is kept for low-level
// diagnostics and future card-type extensions.

export interface ApduCommand {
  cla: number;   // Class byte
  ins: number;   // Instruction byte
  p1: number;    // Parameter 1
  p2: number;    // Parameter 2
  data?: Buffer; // Command data (Lc + body)
  le?: number;   // Expected response length
}

export function buildApdu(cmd: ApduCommand): Buffer {
  const parts: number[] = [cmd.cla, cmd.ins, cmd.p1, cmd.p2];
  if (cmd.data && cmd.data.length > 0) {
    parts.push(cmd.data.length);
    for (const byte of cmd.data) parts.push(byte);
  }
  if (cmd.le !== undefined) parts.push(cmd.le);
  return Buffer.from(parts);
}

export function parseApduResponse(buf: Buffer): {
  data: Buffer; sw1: number; sw2: number; ok: boolean;
} {
  if (buf.length < 2) throw new Error('APDU response too short');
  const sw1 = buf[buf.length - 2];
  const sw2 = buf[buf.length - 1];
  return {
    data: buf.subarray(0, buf.length - 2),
    sw1,
    sw2,
    ok: sw1 === 0x90 && sw2 === 0x00,
  };
}

/** Standard ISO 7816-4 commands for diagnostic use */
export const ISO7816 = {
  selectMasterFile: (): Buffer =>
    buildApdu({ cla: 0x00, ins: 0xA4, p1: 0x00, p2: 0x0C }),
  selectEfById: (fileId: Buffer): Buffer =>
    buildApdu({ cla: 0x00, ins: 0xA4, p1: 0x02, p2: 0x04, data: fileId }),
  readBinary: (offset: number, length: number): Buffer =>
    buildApdu({ cla: 0x00, ins: 0xB0, p1: (offset >> 8) & 0x7F, p2: offset & 0xFF, le: length }),
  getChallenge: (): Buffer =>
    buildApdu({ cla: 0x00, ins: 0x84, p1: 0x00, p2: 0x00, le: 0x08 }),
} as const;
