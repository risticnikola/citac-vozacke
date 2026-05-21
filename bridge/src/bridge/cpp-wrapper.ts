// bridge/src/bridge/cpp-wrapper.ts
// Spawns citacVozacke.exe and communicates via newline-delimited JSON on stdio.
import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';

interface CardResponse {
  cardType?:   string;
  cardSerial:  string;
  rawDump:     string; // base64-encoded
  parsedData?: unknown;
}

interface PendingRead {
  resolve: (v: CardResponse) => void;
  reject:  (e: Error) => void;
}

export class CppWrapper extends EventEmitter {
  private proc:    ChildProcess | null = null;
  private pending: PendingRead  | null = null;
  private buf = '';

  async start(readerName?: string): Promise<void> {
    const exePath = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'citacVozacke.exe')
      : path.join(__dirname, '..', '..', '..', 'citacVozacke', 'citacVozacke.exe');

    this.proc = spawn(exePath, readerName ? [readerName] : [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.on('exit', (code) => {
      this.emit('exit', code);
      this.proc = null;
      if (this.pending) {
        this.pending.reject(new Error(`citacVozacke.exe exited with code ${code}`));
        this.pending = null;
      }
    });

    this.proc.on('error', (err) => {
      this.emit('error', err);
      if (this.pending) {
        this.pending.reject(err as Error);
        this.pending = null;
      }
    });

    this.proc.stdin!.on('error', () => { /* ignore write-after-close */ });
    this.proc.stdout!.setEncoding('utf8');
    this.proc.stdout!.on('data', (chunk: string) => {
      this.buf += chunk;
      const lines = this.buf.split('\n');
      this.buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const msg = JSON.parse(t) as { type: string; error?: string } & Record<string, unknown>;
          if (msg.type === 'card_data' && this.pending) {
            this.pending.resolve(msg as unknown as CardResponse);
            this.pending = null;
          } else if (msg.type === 'error' && this.pending) {
            this.pending.reject(new Error(msg.error ?? 'citacVozacke error'));
            this.pending = null;
          }
        } catch { /* ignore non-JSON stderr noise */ }
      }
    });

    await new Promise<void>((r) => setTimeout(r, 500));
  }

  readCard(): Promise<CardResponse> {
    return new Promise<CardResponse>((resolve, reject) => {
      if (!this.proc)    return reject(new Error('CppWrapper not started'));
      if (this.pending)  return reject(new Error('Read already in progress'));
      this.pending = { resolve, reject };
      this.proc.stdin!.write(JSON.stringify({ cmd: 'read_card' }) + '\n');
    });
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return;
    this.proc.stdin!.end();
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { this.proc?.kill(); resolve(); }, 2000);
      this.proc!.once('exit', () => { clearTimeout(t); resolve(); });
    });
    this.proc = null;
  }

  static listReaders(): Promise<string[]> {
    return new Promise((resolve) => {
      const exePath = app.isPackaged
        ? path.join(process.resourcesPath, 'native', 'citacVozacke.exe')
        : path.join(__dirname, '..', '..', '..', 'citacVozacke', 'citacVozacke.exe');

      const proc = spawn(exePath, ['--list'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '';
      proc.stdout!.setEncoding('utf8');
      proc.stdout!.on('data', (chunk: string) => { buf += chunk; });
      proc.on('exit', () => {
        try {
          const msg = JSON.parse(buf.trim()) as { type: string; readers: string[] };
          resolve(msg.type === 'readers' ? msg.readers : []);
        } catch {
          resolve([]);
        }
      });
      proc.on('error', () => resolve([]));
      setTimeout(() => { proc.kill(); resolve([]); }, 5000);
    });
  }
}
