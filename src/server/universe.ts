/** Loopback transport. The host owns the 20 Hz simulation; clients submit intent. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { UniverseRuntime } from './universeRuntime';

export function createUniverseServer(runtime: UniverseRuntime, options: { port?: number; origins?: string[] } = {}) {
  const port = options.port ?? 7526;
  const origins = new Set(options.origins ?? [
    'http://127.0.0.1:7525', 'http://localhost:7525', `http://127.0.0.1:${port}`, `http://localhost:${port}`,
  ]);
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  async function body(req: IncomingMessage): Promise<unknown> {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Error('Content-Type must be application/json');
    let data = '';
    for await (const chunk of req) {
      data += chunk.toString('utf8');
      if (Buffer.byteLength(data) > 8192) throw Error('Command body too large');
    }
    return JSON.parse(data);
  }
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host?.split(':')[0];
      if (host !== '127.0.0.1' && host !== 'localhost') return json(res, 403, { error: 'Loopback host required' });
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) return json(res, 403, { error: 'Origin is not allowed' });
      if (runtime.failureReason) return json(res, 503, { error: runtime.failureReason });
      const path = req.url?.split('?')[0];
      if (req.method === 'GET' && path === '/api/universe') return json(res, 200, runtime.snapshot());
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'torn-veil-universe', tick: runtime.state.tick });
      if (req.method === 'POST' && path === '/api/universe/command') {
        const result = runtime.command(await body(req));
        return json(res, result.ok ? 200 : 409, result);
      }
      json(res, 404, { error: 'Unknown route' });
    } catch (error) { json(res, runtime.failureReason ? 503 : 400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  return server;
}

export function startUniverseHost() {
  const directory = process.env.TORN_VEIL_UNIVERSE_HOME;
  if (!directory) throw Error('Set TORN_VEIL_UNIVERSE_HOME to an explicit isolated save directory');
  const port = Number(process.env.TORN_VEIL_UNIVERSE_PORT ?? 7526);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid universe port');
  const configuredSeed = process.env.TORN_VEIL_UNIVERSE_SEED;
  const runtime = new UniverseRuntime({ directory, seed: configuredSeed === undefined ? undefined : Number(configuredSeed) });
  const origins = process.env.TORN_VEIL_UNIVERSE_ORIGINS?.split(',').map(s => s.trim());
  const server = createUniverseServer(runtime, { port, origins });
  const managed = process.env.TORN_VEIL_UNIVERSE_MANAGED === '1';
  let timer: ReturnType<typeof setInterval> | undefined, stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (timer) clearInterval(timer);
    // The launcher intentionally keeps stdin open. Fatal bind/write errors must
    // release that handle too, or the failed child remains alive indefinitely.
    if (managed) process.stdin.pause();
    server.close();
    try { runtime.close(); } catch (error) { console.error('Universe save failed during shutdown:', error); process.exitCode = 1; }
  };
  server.on('error', error => { console.error(error); process.exitCode = 1; stop(); });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Torn Veil universe host: http://127.0.0.1:${port} · save: ${runtime.directory}`);
    timer = setInterval(() => {
      try { runtime.step(); }
      catch (error) { console.error('Universe host stopped after simulation/save error:', error); process.exitCode = 1; stop(); }
    }, 50);
  });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  if (managed) {
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    let pending = '';
    process.stdin.on('data', chunk => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      if (lines.some(line => line.trim() === 'shutdown')) { stop(); process.stdin.pause(); }
    });
    process.stdin.once('end', () => { stop(); process.stdin.pause(); });
  }
  return { runtime, server, stop };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { startUniverseHost(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
