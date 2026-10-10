import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { Observatory } from '../../src/observatory/runtime';
import { canonicalDigest } from '../../src/observatory/fingerprint';
import { setExternalControl } from '../../src/sim/runtime/controllers';

// No persistence API or save directory: both test worlds are disposable, separately owned.
const town = new Observatory(), gym = new Observatory();
gym.reset('combat-gym', 918271);
const worlds = { town, gym };
let fixtureDigest = canonicalDigest(gym.world);
let current: keyof typeof worlds = 'gym';
for (const r of Object.values(worlds)) r.startLoop();
const root = resolve(process.env.TV_GYM_STATIC ?? 'dist-web'), port = Number(process.env.TV_GYM_PORT ?? 7505);
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) throw new Error('Same-origin control required');
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('Request too large'); }
      const body = raw ? JSON.parse(raw) : {};
      let r = worlds[current], result: unknown;
      const path = url.pathname;
      if (path === '/api/health') result = { ok: true, upstream: { health: { state: 'ready', env: 'dev' } }, isolation: 'Disposable town and gym; no save access', projectRoot: process.cwd(), fixtureDigest };
      else if (path === '/api/gym/state') result = { scenario: current, fixtureDigest, canonicalDigest: canonicalDigest(r.world), bodies: r.world.bodies().map(b => ({ id: b.id, pos: b.pos, health: b.health, hitSeq: b.hitSeq })), events: r.world.events.slice(-20).map(e => ({ type: e.type, data: e.data })), paused: r.paused };
      else if (path === '/api/gym/control' && req.method === 'POST') {
        if (body.action === 'pause') { r.control(!!body.paused, 1); res.end(JSON.stringify({ scenario: current, seed: r.world.seed })); return; }
        if (body.action !== 'ai') { r.control(true, 1); r.viewport.reset(); }
        if (body.action === 'switch') { if (!['town', 'gym'].includes(body.scenario)) throw new Error('Unknown scenario'); current = body.scenario; }
        else if (body.action === 'reset') { if (current !== 'gym') throw new Error('Only gym resets'); gym.reset('combat-gym', Number(body.seed ?? gym.world.seed)); fixtureDigest = canonicalDigest(gym.world); }
        else if (body.action === 'ai') { for (const p of gym.world.persons().slice(2, 5)) setExternalControl(p, !body.enabled); }
        else if (body.action !== 'pause') throw new Error('Unknown control');
        result = { scenario: current, seed: worlds[current].world.seed };
      } else if (path === '/api/viewport/connect') {
        const person = r.world.playerId ?? r.world.persons().find(p => p.age >= 18 && p.alive)?.id;
        result = r.viewport.connect(person!); r.control(false, 1);
        // control rebinds the epoch; the first frame publishes the new binding.
      } else if (path === '/api/viewport/frame') result = r.viewport.frame(url.searchParams.get('lease') ?? '');
      else if (path === '/api/viewport/region') result = r.viewport.region(url.searchParams.get('lease') ?? '', url.searchParams.get('id') ?? '');
      else if (path === '/api/viewport/command') result = r.viewport.command(body.lease, body.command);
      else if (path === '/api/viewport/intent') result = body.intent?.type === 'save' ? { sequence: body.intent.sequence, result: 'disposable_world_no_save' } : r.viewport.intent(body.lease, body.intent);
      else if (path === '/api/viewport/disconnect') { r.viewport.disconnect(body.lease); r.control(true, 1); result = {}; }
      else { res.statusCode = 404; result = { error: 'Unknown endpoint' }; }
      res.end(JSON.stringify(result)); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep) || !existsSync(path)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream');
    createReadStream(path).pipe(res);
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: String(error) })); }
});
server.listen(port, '127.0.0.1', () => console.log(`Combat Gym: http://127.0.0.1:${port}/?gym=1&autoplay=1&view=orbit`));
process.on('SIGINT', () => { for (const r of Object.values(worlds)) r.close(); server.close(); });

