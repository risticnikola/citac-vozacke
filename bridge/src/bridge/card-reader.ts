// bridge/src/bridge/card-reader.ts
// Delegates all card I/O to the C++ binary via CppWrapper.
// The binary uses eVehicleRegistrationAPI.dll + Windows PC/SC stack — Node.js
// never touches the USB smart card reader directly.
import { EventEmitter } from 'events';
import { CppWrapper } from './cpp-wrapper.js';
import { parseCardOutput, mapCardType } from './parser.js';
import type { CardData } from '../types.js';

export class CardReader extends EventEmitter {
  private wrapper: CppWrapper | null = null;

  async open(readerName?: string): Promise<void> {
    this.wrapper = new CppWrapper();
    await this.wrapper.start(readerName);

    this.wrapper.on('exit', (code: number | null) => this.emit('disconnect', code));
    this.wrapper.on('error', (err: Error) => this.emit('error', err));
  }

  async readCard(): Promise<CardData> {
    if (!this.wrapper) throw new Error('Reader not open');

    const raw = await this.wrapper.readCard();
    const cardType = mapCardType(raw.cardType as string | undefined);

    const cardData: CardData = {
      cardType,
      cardSerial: raw.cardSerial,
      rawDump: Buffer.from(raw.rawDump as string, 'base64'),
      parsedData: parseCardOutput(raw.parsedData as any),
    };

    this.emit('card', cardData);
    return cardData;
  }

  async close(): Promise<void> {
    if (this.wrapper) {
      await this.wrapper.shutdown();
      this.wrapper = null;
    }
  }

  isOpen(): boolean {
    return this.wrapper !== null;
  }
}
