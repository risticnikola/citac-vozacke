// bridge/src/bridge/card-reader.ts
import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';
import type { CardData, CardType } from '../types.js';
import { TACHOGRAPH_APDUS, parseApduResponse, EF_IDS } from './apdu.js';
import { parseCardDump } from './parser.js';

const READ_TIMEOUT_MS = 15_000;
const MIN_DUMP_BYTES = 64;

export interface CardReaderEvents {
  card: [CardData];
  error: [Error];
  disconnect: [];
}

export class CardReader extends EventEmitter {
  private port: SerialPort | null = null;
  private readBuffer = Buffer.alloc(0);
  private pendingResolve: ((buf: Buffer) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;

  async open(portPath: string, baudRate = 9600): Promise<void> {
    this.port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
    await new Promise<void>((resolve, reject) => {
      this.port!.open((err) => err ? reject(err) : resolve());
    });
    this.port.on('data', (chunk: Buffer) => this.onData(chunk));
    this.port.on('close', () => this.emit('disconnect'));
    this.port.on('error', (err) => this.emit('error', err));
  }

  async readCard(): Promise<CardData> {
    if (!this.port?.isOpen) throw new Error('Port not open');

    // Send SELECT MASTER FILE
    await this.sendApdu(TACHOGRAPH_APDUS.selectMasterFile());

    // Read ICC EF to determine card type
    await this.sendApdu(TACHOGRAPH_APDUS.selectEf(EF_IDS.ICC));
    const iccResp = await this.sendApdu(TACHOGRAPH_APDUS.readBinary(0, 25));
    const cardType = this.detectCardType(iccResp.data);
    const cardSerial = iccResp.data.subarray(0, 8).toString('hex').toUpperCase();

    // Read Identification EF for parsed data
    await this.sendApdu(TACHOGRAPH_APDUS.selectEf(EF_IDS.Identification));
    const idResp = await this.sendApdu(TACHOGRAPH_APDUS.readBinary(0, 143));

    // Read full card dump (Identification + primary activity EF)
    const chunks: Buffer[] = [iccResp.data, idResp.data];
    const rawDump = Buffer.concat(chunks);

    if (rawDump.length < MIN_DUMP_BYTES) {
      throw new Error(`Card dump too short: ${rawDump.length} bytes`);
    }

    const parsedData = parseCardDump(rawDump, cardType);

    const cardData: CardData = { cardType, cardSerial, rawDump, parsedData };
    this.emit('card', cardData);
    return cardData;
  }

  async close(): Promise<void> {
    if (this.port?.isOpen) {
      await new Promise<void>((resolve) => this.port!.close(() => resolve()));
    }
    this.port = null;
  }

  private async sendApdu(command: Buffer): Promise<{ data: Buffer; sw1: number; sw2: number; ok: boolean }> {
    await new Promise<void>((resolve, reject) => {
      this.port!.write(command, (err) => err ? reject(err) : resolve());
    });
    const raw = await this.awaitResponse();
    const resp = parseApduResponse(raw);
    if (!resp.ok) {
      throw new Error(`APDU error: SW=${resp.sw1.toString(16).padStart(2,'0')}${resp.sw2.toString(16).padStart(2,'0')}`);
    }
    return resp;
  }

  private awaitResponse(): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(new Error('APDU response timeout'));
      }, READ_TIMEOUT_MS);

      this.pendingResolve = (buf) => { clearTimeout(timer); resolve(buf); };
      this.pendingReject = (err) => { clearTimeout(timer); reject(err); };
    });
  }

  private onData(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    if (this.readBuffer.length >= 2 && this.pendingResolve) {
      const response = this.readBuffer;
      this.readBuffer = Buffer.alloc(0);
      const fn = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      fn(response);
    }
  }

  private detectCardType(iccData: Buffer): CardType {
    if (iccData.length < 2) return 'vehicle';
    const typeCode = iccData[0];
    switch (typeCode) {
      case 0x01: return 'driver';
      case 0x02: return 'vehicle';
      case 0x03: return 'workshop';
      case 0x04: return 'control';
      default:   return 'vehicle';
    }
  }
}
