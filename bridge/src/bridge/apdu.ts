// bridge/src/bridge/apdu.ts
// ISO 7816-4 APDU command builder for EU tachograph cards

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

export function parseApduResponse(buf: Buffer): { data: Buffer; sw1: number; sw2: number; ok: boolean } {
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

// EU tachograph EF file identifiers per EU Regulation 2016/799 Annex 1C
export const TACHOGRAPH_APDUS = {
  selectMasterFile: (): Buffer => buildApdu({ cla: 0x00, ins: 0xA4, p1: 0x00, p2: 0x0C }),
  selectEf: (fileId: Buffer): Buffer => buildApdu({
    cla: 0x00, ins: 0xA4, p1: 0x02, p2: 0x04, data: fileId,
  }),
  readBinary: (offset: number, length: number): Buffer => buildApdu({
    cla: 0x00, ins: 0xB0,
    p1: (offset >> 8) & 0x7F,
    p2: offset & 0xFF,
    le: length,
  }),
  getChallenge: (): Buffer => buildApdu({ cla: 0x00, ins: 0x84, p1: 0x00, p2: 0x00, le: 0x08 }),
  verifyPin: (pin: Buffer): Buffer => buildApdu({
    cla: 0x00, ins: 0x20, p1: 0x00, p2: 0x01, data: pin,
  }),
} as const;

export const EF_IDS = {
  ICC:             Buffer.from([0x00, 0x02]),
  IC_Manufacturing: Buffer.from([0x00, 0x05]),
  Application_Identification: Buffer.from([0x05, 0x01]),
  Card_Certificate:           Buffer.from([0xC1, 0x00]),
  CA_Certificate:             Buffer.from([0xC1, 0x08]),
  Identification:             Buffer.from([0x05, 0x20]),
  Card_Download:              Buffer.from([0x05, 0x0E]),
  Driving_Licence_Info:       Buffer.from([0x05, 0x21]),
  Events_Data:                Buffer.from([0x05, 0x02]),
  Faults_Data:                Buffer.from([0x05, 0x03]),
  Driver_Activity_Data:       Buffer.from([0x05, 0x04]),
  Vehicles_Used:              Buffer.from([0x05, 0x05]),
  Places:                     Buffer.from([0x05, 0x06]),
  Current_Usage:              Buffer.from([0x05, 0x07]),
  Control_Activity_Data:      Buffer.from([0x05, 0x08]),
  Specific_Conditions:        Buffer.from([0x05, 0x22]),
} as const;
