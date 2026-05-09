// bridge/src/bridge/cpp-wrapper.ts
// Wraps the legacy C++ card-reading binary as a child process using JSON stdio.
// The C++ process receives JSON commands on stdin and writes JSON results to stdout.
// This isolates memory-unsafe native code from the Node.js event loop.
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import type { CardData, CardType } from '../types.js';

interface CppCommand {
  cmd: 'read_card' | 'get_status' | 'shutdown';
  port?: string;
}

interface CppResponse {
  type: 'card_data' | 'status' | 'error' | 'ack';
  cardSerial?: string;
  cardType?: CardType;
  rawDump?: string;    // hex-encoded
  parsedData?: Record<string, unknown>;
  status?: string;
  error?: string;
}

const BINARY_PATH = process.env.CPP_BINARY_PATH
  ?? path.join(process.resourcesPath ?? '.', 'native', 'citacVozacke');

const STARTUP_TIMEOUT_MS = 5_000;
const RESPONSE_TIMEOUT_MS = 20_000;

export class CppWrapper extends EventEmitter {
  private proc: ChildProcess | null = null;
  private lineBuffer = '';
  private pendingResolve: ((r: CppResponse) => void) | null = null;
  private pendingReject: ((e: Error) => void) | null = null;
  private responseTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    this.proc = spawn(BINARY_PATH, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.proc.stdout!.setEncoding('utf8');
    this.proc.stdout!.on('data', (chunk: string) => this.onData(chunk));
    this.proc.stderr!.on('data', (d: Buffer) => {
      console.error({ stderr: d.toString().trim() }, 'cpp binary stderr');
    });
    this.proc.on('exit', (code) => {
      this.emit('exit', code);
      this.rejectPending(new Error(`C++ binary exited with code ${code}`));
    });
    this.proc.on('error', (err) => {
      this.emit('error', err);
      this.rejectPending(err);
    });

    // Wait for the process to emit its initial "ready" ack
    await Promise.race([
      this.awaitResponse(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('C++ binary startup timeout')), STARTUP_TIMEOUT_MS),
      ),
    ]);
  }

  async readCard(port: string): Promise<CardData> {
    const resp = await this.send({ cmd: 'read_card', port });
    if (resp.type === 'error') throw new Error(resp.error ?? 'C++ read_card failed');
    if (!resp.cardSerial || !resp.cardType || !resp.rawDump) {
      throw new Error('C++ binary returned incomplete card_data');
    }
    return {
      cardType: resp.cardType,
      cardSerial: resp.cardSerial,
      rawDump: Buffer.from(resp.rawDump, 'hex'),
      parsedData: resp.parsedData,
    };
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return;
    try { await this.send({ cmd: 'shutdown' }); } catch { /* ignore */ }
    this.proc.kill('SIGTERM');
    this.proc = null;
  }

  private async send(cmd: CppCommand): Promise<CppResponse> {
    if (!this.proc?.stdin) throw new Error('C++ process not running');
    const line = JSON.stringify(cmd) + '\n';
    await new Promise<void>((resolve, reject) =>
      this.proc!.stdin!.write(line, (err) => err ? reject(err) : resolve()),
    );
    return this.awaitResponse();
  }

  private awaitResponse(): Promise<CppResponse> {
    return new Promise<CppResponse>((resolve, reject) => {
      this.responseTimer = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(new Error('C++ binary response timeout'));
      }, RESPONSE_TIMEOUT_MS);
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  private onData(chunk: string): void {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: CppResponse;
      try { parsed = JSON.parse(trimmed); }
      catch { console.error({ raw: trimmed }, 'non-JSON from C++ binary'); continue; }

      if (this.pendingResolve) {
        clearTimeout(this.responseTimer!);
        const fn = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        fn(parsed);
      } else {
        // Unsolicited event (e.g. card inserted spontaneously)
        this.emit('unsolicited', parsed);
      }
    }
  }

  private rejectPending(err: Error): void {
    if (this.pendingReject) {
      clearTimeout(this.responseTimer!);
      const fn = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      fn(err);
    }
  }
}
