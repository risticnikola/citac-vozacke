import { describe, it, expect } from 'vitest';
import { normalizePlate } from '../../src/lib/plate.js';

describe('normalizePlate', () => {
  it('normalizes a clean standard plate', () => {
    expect(normalizePlate('KV138-NC')).toBe('KV138-NC');
  });

  it('normalizes lowercase with spaces', () => {
    expect(normalizePlate('kv 138 nc')).toBe('KV138-NC');
  });

  it('normalizes mixed dash/space separators regardless of case', () => {
    expect(normalizePlate('KV-138-NC')).toBe('KV138-NC');
    expect(normalizePlate('kv138nc')).toBe('KV138-NC');
  });

  it('normalizes a 4-digit standard plate', () => {
    expect(normalizePlate('bg3254lm')).toBe('BG3254-LM');
    expect(normalizePlate('BG 3254-LM')).toBe('BG3254-LM');
  });

  it('leaves a diplomatic-style plate untouched apart from trimming', () => {
    expect(normalizePlate('  CD 123-A  ')).toBe('CD 123-A');
  });

  it('leaves a custom word plate untouched', () => {
    expect(normalizePlate('MOJAUZDA')).toBe('MOJAUZDA');
  });

  it('leaves a town+custom-string plate untouched', () => {
    expect(normalizePlate('BG-ZMAJ')).toBe('BG-ZMAJ');
  });

  it('leaves a 3-letter-town near-miss untouched', () => {
    expect(normalizePlate('KVL138-NC')).toBe('KVL138-NC');
  });

  it('leaves a 5-digit near-miss untouched', () => {
    expect(normalizePlate('KV13800-NC')).toBe('KV13800-NC');
  });

  it('leaves a letters-only string untouched', () => {
    expect(normalizePlate('ABCDEFG')).toBe('ABCDEFG');
  });

  it('only trims whitespace, does not throw, on empty string', () => {
    expect(normalizePlate('   ')).toBe('');
  });
});
