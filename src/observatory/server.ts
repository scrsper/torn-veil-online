import {Tooling} from './tooling';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { Observatory } from './runtime';
import { SCENARIOS } from './scenarios';
import { EVENT_FILTERS, eventGroups, eventRow, inspectEvent, inspectPerson, settlementMetrics } from './readers';
import { validationEvidence, validationFinding, validationSave } from './validationArchive';

export function createObservatoryServer(runtime = new Observatory()) {
  const tooling = new Tooling(fileURLToPath(new URL('../../', import.meta.url)));
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number } | null)?.port;
    const origin = `http://127.0.0.1:${port}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'" };
    const send = (value: unknown, code = 200) => { res.writeHead(code, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== `127.0.0.1:${port}`) return send({ error: 'Loopback host required' }, 403);
      if (req.headers.origin && req.headers.origin !== origin) return send({ error: 'Foreign origin rejected' }, 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') return send({ error: 'Cross-site request rejected' }, 403);
      const url = new URL(req.url ?? '/', origin), path = url.pathname;
      if (req.method === 'GET' && await tooling.serve(path,res,headers)) return;
      if (req.method === 'GET' && path === '/health') return send({ service: 'torn-veil-observatory', isolated: true, diagnosticVersion: 3, toolingVersion: 3 });
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204, headers); res.end(); return; }
      if (req.method === 'GET' && (path.startsWith('/game/') || path.startsWith('/textures/'))) {
        const root = fileURLToPath(new URL('../../dist-web/', import.meta.url));
        const relative = decodeURIComponent(path.startsWith('/game/') ? path.slice(6) : path.slice(1)) || 'index.html';
        const file = resolve(root, relative);
        if (!file.startsWith(resolve(root) + sep)) return send({ error: 'Invalid asset path' }, 403);
        const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
        try { const body = await readFile(file); res.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(extname(file) === '.html' ? body.toString('utf8').replace('</head>', '<link rel="stylesheet" href="/viewport.css"></head>') : body); }
        catch { send({ error: 'Viewport asset missing. Run npm run web:build and check local model assets.' }, 404); }
        return;
      }
      if (req.method === 'GET' && ['/', '/app.js', '/style.css', '/workbench.js', '/workbench.css', '/viewport.css', '/tooling.js', '/tooling.css'].includes(path)) {
        const file = path === '/' ? 'index.html' : path.slice(1);
        const body = (await readFile(new URL(`./public/${file}`, import.meta.url), 'utf8')).replace('__SESSION_TOKEN__', token);
        res.writeHead(200, { ...headers, 'Content-Type': file.endsWith('html') ? 'text/html; charset=utf-8' : file.endsWith('js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(body); return;
      }
      if (req.headers['x-observatory-token'] !== token) return send({ error: 'Observatory session required' }, 403);
      const id = url.searchParams.get('id') ?? '';
      if (req.method === 'GET') {
        if (path === '/api/viewport/frame') return send(runtime.viewport.frame(url.searchParams.get('lease') ?? ''));
        if (path === '/api/viewport/region') return send(runtime.viewport.region(url.searchParams.get('lease') ?? '', id));
        if (path === '/api/tooling/status') return send(await tooling.status());
        if (path === '/api/state') return send(runtime.snapshot());
        if (path === '/api/diagnostics') return send(id ? runtime.diagnostics.person(id) : runtime.diagnostics.summary());
        if (path === '/api/validation') return send(await validationEvidence(url.searchParams.get('run') ?? 'repaired'));
        if (path === '/api/validation-finding') return send(await validationFinding(url.searchParams.get('run') ?? 'repaired', (url.searchParams.get('key') ?? '').slice(0, 512)));
        if (path === '/api/catalogue') return send({ scenarios: SCENARIOS, filters: EVENT_FILTERS });
        if (path === '/api/person') return send(inspectPerson(runtime.world, id));
        if (path === '/api/event') return send(inspectEvent(runtime.world, id));
        if (path === '/api/entity') return send(runtime.world.get(id) ?? runtime.world.resourceNodes.find(n => n.id === id) ?? null);
        if (path === '/api/metric') { const metric = settlementMetrics(runtime.world).find(m => m.key === id); return send(metric ?? null); }
        if (path === '/api/language') return send(runtime.latestLanguage);
        if (path === '/api/events') {
          const group = url.searchParams.get('group'), q = (url.searchParams.get('q') ?? '').slice(0, 100).toLowerCase();
          const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0));
          const events = runtime.world.events.filter(e => (!group || eventGroups(e).includes(group)) && (!q || e.summary.toLowerCase().includes(q) || e.type.includes(q) || e.id === q));
          return send({ total: events.length, offset, events: events.slice().reverse().slice(offset, offset + 80).map(eventRow) });
        }
      }
      if (req.method === 'POST' && req.headers['content-type']?.startsWith('application/json')) {
        let raw = ''; for await (const part of req) { raw += part.toString(); if (Buffer.byteLength(raw) > 8192) return send({ error: 'Request too large' }, 413); }
        const body = JSON.parse(raw || '{}');
        if (path === '/api/tooling/run') return send(tooling.run(body.action));
        if (path === '/api/viewport/connect') return send(runtime.viewport.connect(body.personId));
        if (path === '/api/viewport/disconnect') { runtime.viewport.disconnect(body.lease); return send({ ok: true }); }
        if (path === '/api/viewport/command') return send(runtime.viewport.command(body.lease, body.command));
        if (path === '/api/viewport/intent') return send(runtime.viewport.intent(body.lease, body.intent));
        if (path === '/api/reproduce') { runtime.reset('ordinary', 918271); void runtime.advance(2592000, true).catch(console.error); return send({ ok: true }); }
        if (path === '/api/validation-load') { runtime.requireIdle(); const rawSave = await validationSave(body.run); runtime.openValidationSave(rawSave); return send({ ok: true }); }
        if (path === '/api/control') { runtime.control(body.paused, body.speed); return send({ ok: true }); }
        if (path === '/api/reset') { runtime.reset(body.scenario, body.seed); return send({ ok: true }); }
        if (path === '/api/advance') { runtime.requireIdle(); if (![3600, 86400, 604800, 2592000].includes(body.seconds)) throw new Error('Unsupported horizon'); void runtime.advance(body.seconds, body.noPlayer === true).catch(console.error); return send({ ok: true }); }
        if (path === '/api/cancel') { runtime.cancel(); return send({ ok: true }); }
        if (path === '/api/verify') return send(runtime.verify());
        if (path === '/api/checkpoint') return send(runtime.saveCheckpoint());
        if (path === '/api/restore') { runtime.loadCheckpoint(); return send({ ok: true }); }
        if (path === '/api/ask') return send(await runtime.ask(body.npcId, body.speakerId, body.text));
        if (path === '/api/thought') return send(await runtime.thought(body.npcId));
      }
      send({ error: 'Not found' }, 404);
    } catch (e) { send({ error: e instanceof Error ? e.message : String(e) }, 400); }
  });
  server.on('close', () => runtime.close());
  server.requestTimeout = 150000; server.headersTimeout = 5000;
  return { server, runtime };
}
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const port = Number(process.env.TORN_VEIL_OBSERVATORY_PORT ?? 7480);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid Observatory port');
  const { server, runtime } = createObservatoryServer();
  server.listen(port, '127.0.0.1', () => { runtime.startLoop(); console.log(`Torn Veil Observatory: http://127.0.0.1:${port} — disposable in-memory development world`); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { runtime.close(); server.close(); });
}
