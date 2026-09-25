import { loadConfig, loadRelease } from './config';
import { LiveServer } from './live';
import { RefuseToStartError, WriterFenceError } from './store';

/**
 * Process entry for one environment's authoritative service.
 *   node server.mjs --config <root>\config.json
 * Exit codes (read by the supervisor):
 *   0  orderly shutdown with a committed final checkpoint
 *   70 runtime failure (tick exception, lost fence, failed durable write) — restart from last checkpoint
 *   71 orderly shutdown whose final checkpoint failed — restart
 *   78 refused to start (no loadable world, generator changed, writer fence held, bad config) —
 *      do NOT restart; an operator must act
 */
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const configPath = arg('--config') ?? process.env.TORN_VEIL_ALPHA_CONFIG;
function log(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, event, ...data }) + '\n');
}
if (!configPath) { log('error', 'usage', { message: 'missing --config <path>' }); process.exit(78); }

const config = loadConfig(configPath);
const release = loadRelease(process.argv[1]);
log('info', 'starting', { env: config.env, release: release.version, revision: release.revision, pid: process.pid, node: process.version, port: config.port, bind: config.bind });
const server = new LiveServer(config, release, log);
let shuttingDown = false;
const stop = (reason: string) => { if (shuttingDown) return; shuttingDown = true; void server.shutdown(reason); };
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGBREAK', () => stop('SIGBREAK'));
// The supervisor asks over IPC: on Windows a signal to a child is a hard kill, not a request.
process.on('message', (m: unknown) => { if (m && typeof m === 'object' && (m as { type?: string }).type === 'shutdown') stop('supervisor'); });
// A throw mid-tick can leave the World half-mutated; never checkpoint it. Recover from the last good one.
process.on('uncaughtException', e => { log('error', 'uncaught_exception', { error: String(e?.stack ?? e) }); process.exit(70); });
process.on('unhandledRejection', e => { log('error', 'unhandled_rejection', { error: String((e as Error)?.stack ?? e) }); process.exit(70); });

try {
  await server.open();
  await server.listen();
  process.send?.({ type: 'ready', port: config.port });
} catch (e) {
  const refused = e instanceof RefuseToStartError || e instanceof WriterFenceError;
  log('error', refused ? 'refused_to_start' : 'startup_failed', { error: String((e as Error)?.stack ?? e) });
  process.exit(refused ? 78 : 70);
}
