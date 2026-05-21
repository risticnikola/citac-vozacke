// bridge/src/bridge/port-manager.ts
// Manages the active CardReader session. For USB PC/SC smart card readers the
// "port" is a PC/SC reader name (e.g. "ACS ACR122U 00") — the C++ binary
// enumerates available readers and accepts an optional name override.
import { CardReader } from './card-reader.js';
import { CppWrapper } from './cpp-wrapper.js';
import type { CardData } from '../types.js';

let activeReader: CardReader | null = null;
let activeReaderName: string | null = null;

/** Open the first available PC/SC reader (or a specific one by name). */
export async function openReader(readerName?: string): Promise<CardReader> {
  if (activeReader) {
    throw new Error(
      `Reader already open${activeReaderName ? ': ' + activeReaderName : ''}. Close it first.`,
    );
  }
  const reader = new CardReader();
  await reader.open(readerName);
  activeReader = reader;
  activeReaderName = readerName ?? null;

  reader.on('disconnect', () => {
    activeReader = null;
    activeReaderName = null;
  });

  return reader;
}

export async function closeReader(): Promise<void> {
  if (activeReader) {
    await activeReader.close();
    activeReader = null;
    activeReaderName = null;
  }
}

export function getActiveReaderName(): string | null {
  return activeReaderName;
}

export function isReaderOpen(): boolean {
  return activeReader !== null;
}

export async function readFromActive(): Promise<CardData> {
  if (!activeReader) throw new Error('No reader open');
  return activeReader.readCard();
}

export function listReaders(): Promise<string[]> {
  return CppWrapper.listReaders();
}
