import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from './config';
import { WriterLock } from './store';

/**
 * Keeps one environment's authoritative service running, independent of any terminal, editor,
 * client or agent session:
 *  - restarts after a crash with backoff (1 s … 60 s); halts after 6 crashes in 10 minutes;
 *  - never restarts a refused start (exit 78: missing/unloadable world, changed generator, fence);
 *  - kills and restarts a service whose /health stops answering for 60 s (a hung loop);
 *  - asks for an orderly shutdown over IPC and waits up to 90 s before a hard stop;
 *  - writes bounded, rotating logs (10 MB × 5 per stream).
 * Stop it by creating `<root>/supervisor.stop` (the ops tool does) or with Ctrl+C.
 */
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const configPath = resolve(arg('--config') ?? process.env.TORN_VEIL_ALPHA_CONFIG ?? '');
const serverEntry = resolve(arg('--server') ?? join(dirname(process.argv[1]), 'server.mjs'));
const config = loadConfig(configPath);
mkdirSync(config.logDir, { recursive: true });

class RotatingLog {
  private fd: number; private size: number;
  constructor(private readonly path: string, private readonly maxBytes = 10 * 1024 * 1024, private readonly keep = 5) {
    this.fd = openSync(path, 'a'); this.size = existsSync(path) ? statSync(path).size : 0;
  }
  write(text: string): void {
    if (this.size + text.length > this.maxBytes) this.rotate();
    writeSync(this.fd, text); this.size += Buffer.byteLength(text);
  }
  private rotate(): void {
    fsyncSync(this.fd); closeSync(this.fd);
    for (let i = this.keep - 1; i >= 1; i--) { const from = `${this.path}.${i}`; if (existsSync(from)) renameSync(from, `${this.path}.${i + 1}`); }
    renameSync(this.path, `${this.path}.1`);
    const last = `${this.path}.${this.keep + 1}`; if (existsSync(last)) unlinkSync(last);
    this.fd = openSync(this.path, 'a'); this.size = 0;
  }
}
const serverLog = new RotatingLog(join(config.logDir, 'server.log'));
const supLog = new RotatingLog(join(config.logDir, 'supervisor.log'), 2 * 1024 * 1024, 3);
function log(event: string, data: Record<string, unknown> = {}): void { supLog.write(JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n'); }

const lockPath = join(config.root, 'supervisor.lock'), stopPath = join(config.root, 'supervisor.stop'), statusPath = join(config.root, 'supervisor.json');
try {
  const other = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (other.pid !== process.pid && WriterLock.alive(other.pid)) { log('refused_second_supervisor', { other: other.pid }); process.exit(78); }
} catch { /* no lock */ }
writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAtIso: new Date().toISOString(), server: serverEntry }));
if (existsSync(stopPath)) unlinkSync(stopPath);

let child: ChildProcess | null = null, childReady = false, stopping = false, healthFailures = 0, restarts = 0;
const crashes: number[] = [];
const status = (state: string, extra: Record<string, unknown> = {}) => {
  const data = JSON.stringify({ pid: process.pid, childPid: child?.pid ?? null, state, restarts, env: config.env, port: config.port, server: serverEntry, since: new Date().toISOString(), ...extra });
  const fd = openSync(statusPath + '.tmp', 'w'); try { writeSync(fd, data); } finally { closeSync(fd); } renameSync(statusPath + '.tmp', statusPath);
};

function start(): void {
  childReady = false; healthFailures = 0;
  child = spawn(process.execPath, ['--max-old-space-size=4096', serverEntry, '--config', configPath], { cwd: dirname(serverEntry), stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  log('started', { childPid: child.pid, server: serverEntry });
  status('starting');
  child.stdout!.on('data', d => serverLog.write(d.toString()));
  child.stderr!.on('data', d => serverLog.write(JSON.stringify({ t: new Date().toISOString(), level: 'error', event: 'stderr', text: d.toString() }) + '\n'));
  child.on('message', (m: any) => { if (m?.type === 'ready') { childReady = true; log('ready', { childPid: child?.pid }); status('running'); } });
  child.on('exit', (code, signal) => {
    log('exited', { code, signal }); child = null;
    if (stopping) { status('stopped', { lastExit: code }); cleanup(0); return; }
    if (code === 78) { status('halted', { lastExit: code, reason: 'service refused to start; operator action required (see server.log)' }); log('halted_refused_start'); cleanup(78); return; }
    const now = Date.now(); crashes.push(now); while (crashes.length && now - crashes[0] > 600_000) crashes.shift();
    if (crashes.length > 6) { status('halted', { lastExit: code, reason: 'crash loop: >6 exits in 10 minutes' }); log('halted_crash_loop'); cleanup(70); return; }
    const delay = [1, 2, 5, 10, 30, 60][Math.min(5, crashes.length - 1)] * 1000;
    restarts++; status('restarting', { lastExit: code, delayMs: delay }); log('restart_scheduled', { delayMs: delay });
    setTimeout(() => { if (!stopping) start(); }, delay);
  });
}

async function health(): Promise<boolean> {
  try { const r = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; }
}
setInterval(async () => {
  if (existsSync(stopPath) && !stopping) requestStop('stop file');
  if (!child || !childReady || stopping) return;
  if (await health()) { healthFailures = 0; return; }
  if (++healthFailures >= 6) { log('hung_service_killed', { childPid: child.pid }); child.kill('SIGKILL'); }
}, 10_000).unref();
setInterval(() => { if (existsSync(stopPath) && !stopping) requestStop('stop file'); }, 2000);

function requestStop(reason: string): void {
  stopping = true; log('stop_requested', { reason }); status('stopping');
  if (!child) { cleanup(0); return; }
  child.send?.({ type: 'shutdown' });
  const hard = setTimeout(() => { if (child) { log('hard_stop_after_timeout'); child.kill('SIGKILL'); } }, 90_000); hard.unref();
}
function cleanup(code: number): void {
  try { unlinkSync(lockPath); } catch { /* gone */ }
  try { if (existsSync(stopPath)) unlinkSync(stopPath); } catch { /* gone */ }
  setTimeout(() => process.exit(code), 50);
}
process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));
log('supervisor_started', { pid: process.pid, env: config.env, config: configPath });
start();
