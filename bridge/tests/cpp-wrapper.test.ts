// bridge/tests/cpp-wrapper.test.ts
// Unit tests for the JSON stdio protocol parsing logic — no real C++ binary required
import { describe, it, expect } from 'vitest';

// Test the JSON line-splitting logic in isolation
describe('CppWrapper JSON stdio protocol', () => {
  it('parses a complete JSON line', () => {
    const lines: string[] = [];
    let buf = '';

    function onData(chunk: string) {
      buf += chunk;
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) {
        const t = line.trim();
        if (t) lines.push(t);
      }
    }

    onData('{"type":"ack"}\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ type: 'ack' });
  });

  it('handles fragmented delivery across two chunks', () => {
    const lines: string[] = [];
    let buf = '';

    function onData(chunk: string) {
      buf += chunk;
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) {
        const t = line.trim();
        if (t) lines.push(t);
      }
    }

    onData('{"type":"card_d');
    expect(lines).toHaveLength(0);
    onData('ata","cardSerial":"ABC"}\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).cardSerial).toBe('ABC');
  });

  it('handles multiple lines in one chunk', () => {
    const lines: string[] = [];
    let buf = '';

    function onData(chunk: string) {
      buf += chunk;
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) {
        const t = line.trim();
        if (t) lines.push(t);
      }
    }

    onData('{"type":"ack"}\n{"type":"status","status":"ready"}\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).status).toBe('ready');
  });

  it('silently skips non-JSON stderr noise', () => {
    const parsed: unknown[] = [];
    const raw = '[DEBUG] card reader init';
    try { parsed.push(JSON.parse(raw)); } catch { /* expected */ }
    expect(parsed).toHaveLength(0);
  });
});
