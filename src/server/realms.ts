import { RealmJournal } from './realmJournal';
import type { RealmOperation } from './realmRuntime';
import { TowerController } from './towerController';
import { FixedScheduler } from '../bridge/scheduler';
/** Loopback development host for the canonical realm world and the existing Babylon client.
 * One controller, fixed server time, bounded inputs and no path-selected save API. */
import { randomUUID } from 'node:crypto';
import {execFileSync} from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, createReadStream, statSync,readFileSync } from 'node:fs';
import { resolve, extname,sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createVite } from 'vite';
import {launchHome,liveObservatoryScript} from './launchHome';
import {inspectPerson,eventRow} from '../observatory/readers';
import {arcaneProgress} from '../sim/physical/arcana/growth';
import {recogniseClass} from '../sim/mind/vocation';

const port = Number(process.env.TV_REALMS_PORT ?? 7510);
// A verified portable upgrade can be installed without overwriting the original
// import or replaying its old-code journal under different mechanics.
const currentSave='.debug/realms/world-current.json';
const savePath = resolve(process.env.TV_REALMS_SAVE ?? (existsSync(currentSave)||existsSync(currentSave+'.store')?currentSave:'.debug/realms/world.json'));
const assetRoot = process.env.TV_REALMS_ASSETS ? resolve(process.env.TV_REALMS_ASSETS) : null;
const staticRoot=process.env.TV_REALMS_STATIC?resolve(process.env.TV_REALMS_STATIC):null;
const clientBuild=staticRoot?JSON.parse(readFileSync(resolve(staticRoot,'current-build.json'),'utf8')):null;
const serverCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(clientBuild&&clientBuild.commit!==execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim())throw Error('Compiled client belongs to a different commit. Run npm run play:build.');
const journal = new RealmJournal(savePath, Number(process.env.TV_REALMS_SEED ?? 918271));
await journal.ready;
let session = journal.runtime.session;
let saveError = '', updateError = '';
let towerController: TowerController | null = journal.runtime.tower, towerSignature = '', towerView = false;
function apply(op: RealmOperation): any {
  const result = journal.apply(op); session = journal.runtime.session; towerController = journal.runtime.tower; return result;
}
// A restored socket cannot retain authorization or held input from an old process.
apply({ type: 'disconnect' }); await journal.flush();
function rebindTower() {
  towerController = journal.runtime.tower; towerSignature = '';
  if (owner && !session.world.realmExpedition?.active) owner.send(JSON.stringify({ type: 'binding', interaction: apply({ type: 'bind', id: ownerToken, epoch: randomUUID() }) }));
}
function failPersistence(e: unknown) {
  saveError = String(e); updateError = saveError; console.error('Realm persistence failed:', e);
  owner?.close(1011, 'Saving failed. World paused; restart to recover its last durable journal.');
}
async function persist(required = false) {
  if (updateError) { if (required) throw Error(updateError); return; }
  try { await journal.flush(); saveError = ''; }
  catch (e) { failPersistence(e); if (required) throw e; }
}
let checkpointBusy = false;
async function checkpoint() {
  if (checkpointBusy || updateError) return; checkpointBusy = true;
  try { await journal.checkpoint(); } catch (e) { failPersistence(e); } finally { checkpointBusy = false; }
}
const vite = staticRoot?null:await createVite({ configFile: resolve('vite.web.config.ts'), server: { middlewareMode: true, hmr: false } });
const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) { res.writeHead(403).end(); return; }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(req.method==='GET'&&((url.pathname==='/'&&!url.search)||['/observatory','/history'].includes(url.pathname))){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(launchHome(url.pathname));return;}
  if(req.method==='GET'&&url.pathname==='/observatory-live.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(liveObservatoryScript);return;}
  if(req.method==='GET'&&url.pathname==='/realms/inspection'){
    const w=session.world,id=url.searchParams.get('person')||session.person.id,p=w.person(id),b=p&&w.primaryBody(p.id);
    if(!p||!b){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({ready:!updateError,build:{commit:serverCommit,clientMode:staticRoot?'compiled':'development',client:clientBuild,engine:journal.store.engine},save:{path:savePath,store:journal.store.dir,persistent:true},
      world:{seed:w.seed,personId:session.person.id,bodyId:session.body.id,physicalTime:w.physicalTime,worldTime:w.now,people:w.persons().length,events:w.events.length},
      people:w.persons().filter(n=>n.id===id||w.primaryBody(n.id)?.present).slice(0,64).map(n=>({id:n.id,name:n.name})),person:inspectPerson(w,id),recognisedClass:recogniseClass(w,p),growth:arcaneProgress(w,p,b),
      towerTiming:{runId:w.canonicalTower?.id,floor:w.canonicalTower?.floor,status:w.canonicalTower?.status,receipts:w.events.filter(e=>e.type==='tower_floor_cleared'&&e.actor===session.person.id).map(e=>({id:e.id,floor:e.data.floor,seconds:e.data.seconds,causes:e.causes})),measurement:'Canonical elapsed seconds at floor-clear receipts, including time away. Human climb duration and Gold frequency are unmeasured.'},events:w.events.slice(-80).reverse().map(e=>({...eventRow(e),causes:e.causes}))}));return;
  }
  if (url.pathname === '/realms/health') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ kind: 'torn-veil-realms', root: resolve('.'), clientBuild, buildRoot:staticRoot, savePath, ready: !updateError, seed: session.world.seed, saveError, updateError, persistence: journal.metrics, memory: process.memoryUsage() })); return; }
  if (url.pathname === '/realms/expedition') {
    const respond = (code: number, value: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (!owner || req.headers['x-realms-controller'] !== ownerToken || updateError) { respond(409, { error: 'This tab does not hold the world controller. Reload to reconnect.' }); return; }
    if (req.method === 'GET') { respond(200, { expedition: session.world.realmExpedition ?? null, person: session.snapshot().person }); return; }
    if (req.method !== 'POST' || ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin ?? '') || req.headers['content-type'] !== 'application/json') { respond(403, { error: 'Same-origin JSON command required.' }); return; }
    try {
      const parts: Buffer[] = []; let bytes = 0;
      for await (const part of req) { const b = Buffer.from(part); bytes += b.length; if (bytes > 600000) { respond(413, { error: 'Checkpoint exceeds supported size.' }); return; } parts.push(b); }
      if (!owner || req.headers['x-realms-controller'] !== ownerToken) { respond(409, { error: 'Controller changed.' }); return; }
      const command = JSON.parse(Buffer.concat(parts).toString('utf8'));
      const result = apply({ type: 'expedition', command });
      rebindTower(); await persist(true);
      if (result.error) { signature = ''; respond(saveError ? 503 : 409, { error: saveError ? 'Saving failed. World paused for durable recovery.' : result.error }); }
      else respond(200, { expedition: result.value });
    } catch { respond(saveError ? 503 : 400, { error: saveError ? 'Saving failed. World paused for durable recovery.' : 'Invalid or interrupted expedition command.' }); }
    return;
  }
  if (url.pathname === '/realms/ascent') {
    const respond = (code: number, value: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (!owner || req.headers['x-realms-controller'] !== ownerToken || updateError) { respond(409, { error: 'This tab does not hold the world controller.' }); return; }
    if (req.method === 'GET') { respond(200, { tower: session.snapshot().canonicalTower }); return; }
    if (req.method !== 'POST' || ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin ?? '') || req.headers['content-type'] !== 'application/json') { respond(403, { error: 'Same-origin JSON command required.' }); return; }
    try {
      const parts: Buffer[] = []; let bytes = 0;
      for await (const part of req) { const b = Buffer.from(part); bytes += b.length; if (bytes > 4096) { respond(413, { error: 'Tower command too large.' }); return; } parts.push(b); }
      if (!owner || req.headers['x-realms-controller'] !== ownerToken) { respond(409, { error: 'Controller changed.' }); return; }
      const result = apply({ type: 'tower', command: JSON.parse(Buffer.concat(parts).toString('utf8')) });
      rebindTower(); signature = ''; await persist(true);
      if (result.error) respond(saveError ? 503 : 409, { error: saveError ? 'Saving failed. World paused for durable recovery.' : result.error });
      else respond(200, { tower: result.value });
    } catch { respond(saveError ? 503 : 400, { error: saveError ? 'Saving failed. World paused for durable recovery.' : 'Invalid or interrupted Tower command.' }); }
    return;
  }
  // Optional read-only local assets. Only public model/texture subtrees, never an arbitrary path.
  if (assetRoot && /^\/(models|textures|arena)\//.test(url.pathname) && !existsSync(resolve('web/public', '.' + url.pathname))) {
    const file = resolve(assetRoot, '.' + decodeURIComponent(url.pathname));
    if (file.startsWith(assetRoot + '\\') && existsSync(file) && statSync(file).isFile()) {
      const mime: Record<string, string> = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
      res.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream'); createReadStream(file).pipe(res); return;
    }
  }
  if(staticRoot){
    let file:string;try{file=resolve(staticRoot,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}catch{res.writeHead(400).end();return;}
    if(!file.startsWith(staticRoot+sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404).end();return;}
    const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
    res.setHeader('content-type',mime[extname(file)]??'application/octet-stream');res.setHeader('cache-control','no-store');createReadStream(file).pipe(res);return;
  }
  vite!.middlewares(req, res);
});
const ws = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  const validOrigin = [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin ?? '');
  if (!['/realms/socket', '/realms/expedition/socket', '/realms/ascent/socket'].includes(req.url ?? '') || !validOrigin) { socket.destroy(); return; }
  ws.handleUpgrade(req, socket, head, client => ws.emit('connection', client, req));
});
let owner: WebSocket | null = null, ownerToken = '', signature = '', stepMs: number[] = [];
ws.on('connection', (client, req) => {
  if (updateError) { client.close(1011, 'World paused after an update error. Restart the host to restore its last good save.'); return; }
  if (owner) { client.close(4001, 'This world already has a controller. Close its tab first.'); return; }
  owner = client; ownerToken = randomUUID(); signature = ''; towerView = req.url === '/realms/ascent/socket'; scheduler = new FixedScheduler(1000 / 60, performance.now());
  rebindTower();
  client.send(JSON.stringify({ type: 'controller', token: ownerToken })); let budget = 0, budgetAt = Date.now();
  client.on('message', async data => {
    if (updateError) return;
    if (Date.now() - budgetAt > 1000) { budget = 0; budgetAt = Date.now(); }
    if (++budget > 180) return;
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'command' && !session.world.realmExpedition?.active) {
        const receipt = apply({ type: 'command', input: m, now: performance.now() }); if (receipt) client.send(JSON.stringify(receipt));
      }
      else if (m.type === 'move') apply({ type: 'move', input: m.input });
      else if (m.type === 'interact') { client.send(JSON.stringify({ type: 'notice', message: apply({ type: 'interact' }) })); await persist(); }
      else if (m.type === 'confirm') { if (apply({ type: 'confirm', id: m.id })) { signature = ''; await persist(); } }
      else if (m.type === 'cancel') apply({ type: 'cancel' });
      else if (m.type === 'navigate' && ['portal', 'tower'].includes(m.target)) apply({ type: 'navigate', target: m.target });
      else if (m.type === 'save') { await persist(); client.send(JSON.stringify({ type: 'notice', message: saveError ? 'Save failed; world paused for durable recovery.' : 'World saved.' })); }
    } catch (e) { client.send(JSON.stringify({ type: 'notice', message: 'Invalid command was rejected.' })); }
  });
  client.on('close', () => { if (owner === client) { if (!updateError && !closing) { apply({ type: 'disconnect' }); void persist(); } owner = null; ownerToken = ''; } });
});
let tick = 0;
let scheduler = new FixedScheduler(1000 / 60, performance.now());
const timer = setInterval(() => {
  if (updateError || !owner || owner.readyState !== WebSocket.OPEN) return;
  try { scheduler.run(performance.now(), () => {
    const start = performance.now();
    if (session.world.canonicalTower?.active) {
      if (!towerController) rebindTower();
      for (const receipt of apply({ type: 'step', now: performance.now() })) if (towerView) owner!.send(JSON.stringify(receipt));
    } else { for(const receipt of apply({ type: 'step', now: performance.now() })) owner!.send(JSON.stringify(receipt)); } stepMs.push(performance.now() - start); if (stepMs.length > 600) stepMs.shift();
    if (++tick % 6) return;
    if (tick % 300 === 0) void persist(); if (tick % 1800 === 0) void checkpoint();
    if (session.world.canonicalTower?.active && towerView && towerController) {
      const geometry = towerController.geometry();
      if (geometry?.id !== towerSignature) { towerSignature = geometry?.id ?? ''; owner!.send(JSON.stringify({ type: 'tower_geometry', plan: geometry })); }
      owner!.send(JSON.stringify({ ...apply({ type: 'frame' }), saveError, serverMs: stepMs.at(-1) }));
      return;
    }
    if (towerView) { owner!.send(JSON.stringify({ type: 'tower_returned' })); return; }
    if (session.world.realmExpedition?.active) { owner!.send(JSON.stringify({ type: 'state', state: session.snapshot(), saveError, serverMs: stepMs[stepMs.length - 1] })); return; }
    const plan = session.regionPlan(), next = plan.map(p => `${p.realm}:${p.cx},${p.cz}:${p.lod}`).join('|');
    if (signature !== next) {
      const previous = new Set(signature.split('|')); signature = next;
      owner!.send(JSON.stringify({ type: 'regions', wanted: plan.map(p => `${p.realm}:${p.cx},${p.cz}:${p.lod}`),
        chunks: plan.filter(p => !previous.has(`${p.realm}:${p.cx},${p.cz}:${p.lod}`)).map(p => { const c = session.grid.chunk(p.realm, p.cx, p.cz); return { key: `${p.realm}:${p.cx},${p.cz}:${p.lod}`, lod: p.lod, chunk: { ...c, buildings: c.buildings.map(b => ({ ...b, windows: p.lod === 2 ? [] : b.windows })) } }; }) }));
    }
    owner!.send(JSON.stringify({ type: 'state', state: session.snapshot(), saveError, serverMs: stepMs[stepMs.length - 1] }));
  }); } catch (e) {
    updateError = String(e); console.error(e); session.stop();
    owner.close(1011, 'World update failed. Restart the host to restore its last good save.');
  }
}, 4);
server.listen(port, '127.0.0.1', () => console.log(`Torn Veil connected realms: http://127.0.0.1:${port}/?realms\nActive save: ${journal.store.dir}\nOriginal JSON import (retained): ${savePath}`));
let closing = false;
async function close() { if (closing) return; closing = true; clearInterval(timer);
  if (!updateError) { apply({ type: 'disconnect' }); await persist(); }
  ws.close(); server.close(); await vite?.close();
  try { if (updateError) await journal.abort(); else await journal.close(); } catch (e) { console.error(e); }
  process.exit(updateError ? 1 : 0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
