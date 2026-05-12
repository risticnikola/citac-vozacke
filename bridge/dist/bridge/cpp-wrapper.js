"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CppWrapper = void 0;
// bridge/src/bridge/cpp-wrapper.ts
// Wraps the legacy C++ card-reading binary as a child process using JSON stdio.
// The C++ process receives JSON commands on stdin and writes JSON results to stdout.
// This isolates memory-unsafe native code from the Node.js event loop.
const child_process_1 = require("child_process");
const events_1 = require("events");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const DEBUG_LOG = path_1.default.join(os_1.default.homedir(), 'bridge-debug.log');
function debugLog(obj) {
    try {
        fs_1.default.appendFileSync(DEBUG_LOG, new Date().toISOString() + ' ' + JSON.stringify(obj) + '\n');
    }
    catch { /* ignore */ }
}
const BINARY_NAME = 'citacVozacke' + (process.platform === 'win32' ? '.exe' : '');
const BINARY_PATH = process.env.CPP_BINARY_PATH
    ?? path_1.default.join(process.resourcesPath ?? '.', 'native', BINARY_NAME);
const STARTUP_TIMEOUT_MS = 5_000;
const RESPONSE_TIMEOUT_MS = 20_000;
class CppWrapper extends events_1.EventEmitter {
    proc = null;
    lineBuffer = '';
    pendingResolve = null;
    pendingReject = null;
    responseTimer = null;
    async start(readerName) {
        const args = readerName ? ['--reader', readerName] : [];
        this.proc = (0, child_process_1.spawn)(BINARY_PATH, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        this.proc.stdout.setEncoding('utf8');
        this.proc.stdout.on('data', (chunk) => this.onData(chunk));
        this.proc.stderr.on('data', (d) => {
            debugLog({ event: 'stderr', line: d.toString().trim() });
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
            new Promise((_, rej) => setTimeout(() => rej(new Error('C++ binary startup timeout')), STARTUP_TIMEOUT_MS)),
        ]);
    }
    async readCard(port) {
        const resp = await this.send({ cmd: 'read_card', port });
        debugLog({ event: 'card_response', resp });
        if (resp.type === 'error')
            throw new Error(resp.error ?? 'C++ read_card failed');
        if (!resp.cardSerial || !resp.cardType) {
            throw new Error(`C++ binary returned incomplete card_data: ${JSON.stringify(resp)}`);
        }
        return {
            cardType: resp.cardType,
            cardSerial: resp.cardSerial,
            rawDump: resp.rawDump?.length ? Buffer.from(resp.rawDump, 'hex') : Buffer.alloc(0),
            // If the binary puts vehicle fields at the top level instead of under `parsedData`, fall back to the full response
            parsedData: resp.parsedData ?? resp,
        };
    }
    async shutdown() {
        if (!this.proc)
            return;
        try {
            await this.send({ cmd: 'shutdown' });
        }
        catch { /* ignore */ }
        this.proc.kill('SIGTERM');
        this.proc = null;
    }
    async send(cmd) {
        if (!this.proc?.stdin)
            throw new Error('C++ process not running');
        const line = JSON.stringify(cmd) + '\n';
        await new Promise((resolve, reject) => this.proc.stdin.write(line, (err) => err ? reject(err) : resolve()));
        return this.awaitResponse();
    }
    awaitResponse() {
        return new Promise((resolve, reject) => {
            this.responseTimer = setTimeout(() => {
                this.pendingResolve = null;
                this.pendingReject = null;
                reject(new Error('C++ binary response timeout'));
            }, RESPONSE_TIMEOUT_MS);
            this.pendingResolve = resolve;
            this.pendingReject = reject;
        });
    }
    onData(chunk) {
        this.lineBuffer += chunk;
        const lines = this.lineBuffer.split('\n');
        this.lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            debugLog({ event: 'raw_line', line: trimmed });
            let parsed;
            try {
                parsed = JSON.parse(trimmed);
            }
            catch {
                debugLog({ event: 'parse_error', raw: trimmed });
                continue;
            }
            if (this.pendingResolve) {
                clearTimeout(this.responseTimer);
                const fn = this.pendingResolve;
                this.pendingResolve = null;
                this.pendingReject = null;
                fn(parsed);
            }
            else {
                // Unsolicited event (e.g. card inserted spontaneously)
                this.emit('unsolicited', parsed);
            }
        }
    }
    rejectPending(err) {
        if (this.pendingReject) {
            clearTimeout(this.responseTimer);
            const fn = this.pendingReject;
            this.pendingResolve = null;
            this.pendingReject = null;
            fn(err);
        }
    }
}
exports.CppWrapper = CppWrapper;
//# sourceMappingURL=cpp-wrapper.js.map