// bridge/src/bridge/parser.ts
// Parses raw EU tachograph card binary dumps per Regulation 2016/799 Annex 1C
import type { CardType } from '../types.js';

export interface ParsedCard {
  cardType: CardType;
  cardSerial?: string;
  holderSurname?: string;
  holderFirstName?: string;
  birthDate?: string;
  licenceNumber?: string;
  issuingCountry?: string;
  expiryDate?: string;
  vehicleRegistrationNation?: string;
  vehicleRegistrationNumber?: string;
  vin?: string;
}

function readBcdDate(buf: Buffer, offset: number): string | undefined {
  if (offset + 4 > buf.length) return undefined;
  // TimeReal encoding: seconds since 1970-01-01 00:00:00 UTC (4 bytes big-endian)
  const secs = buf.readUInt32BE(offset);
  if (secs === 0 || secs === 0xFFFFFFFF) return undefined;
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

function readString(buf: Buffer, offset: number, maxLen: number): string {
  const end = Math.min(offset + maxLen, buf.length);
  const slice = buf.subarray(offset, end);
  // CodePage24 encoding: first byte is code page, rest is IA5 string
  const codePage = slice[0];
  const text = slice.subarray(1).toString('latin1').replace(/\0+$/, '').trim();
  void codePage; // code page handling left for full implementation
  return text;
}

export function parseVehicleCard(dump: Buffer): ParsedCard {
  // EF_Identification starts at offset 0 in a pre-concatenated dump.
  // In production this must be keyed by EF_ID offsets from a read session map.
  const result: ParsedCard = { cardType: 'vehicle' };

  if (dump.length < 10) return result;

  // Vehicle registration (offset 0..13): nation (3 bytes IA5) + number (13 bytes)
  result.vehicleRegistrationNation = dump.subarray(0, 3).toString('ascii').replace(/\0+$/, '').trim();
  result.vehicleRegistrationNumber = dump.subarray(3, 16).toString('latin1').replace(/\0+$/, '').trim();

  // VIN at offset 16 (17 bytes)
  if (dump.length >= 33) {
    result.vin = dump.subarray(16, 33).toString('ascii').replace(/\0+$/, '').trim();
  }

  return result;
}

export function parseDriverCard(dump: Buffer): ParsedCard {
  const result: ParsedCard = { cardType: 'driver' };
  if (dump.length < 40) return result;

  // Holder surname at offset 0 (36 bytes CodePage24)
  result.holderSurname = readString(dump, 0, 36);
  // First names at offset 36 (36 bytes)
  result.holderFirstName = readString(dump, 36, 36);
  // Birth date at offset 72 (4 bytes TimeReal)
  result.birthDate = readBcdDate(dump, 72);
  // Preferred language at offset 76 (2 bytes IA5) — skipped for now
  // Expiry date at offset 78 (4 bytes TimeReal)
  result.expiryDate = readBcdDate(dump, 78);
  // Issuing country at offset 82 (3 bytes IA5)
  if (dump.length >= 85) {
    result.issuingCountry = dump.subarray(82, 85).toString('ascii').replace(/\0+$/, '').trim();
  }

  return result;
}

export function parseCardDump(dump: Buffer, cardType: CardType): ParsedCard {
  switch (cardType) {
    case 'vehicle':  return parseVehicleCard(dump);
    case 'driver':   return parseDriverCard(dump);
    default:         return { cardType };
  }
}
