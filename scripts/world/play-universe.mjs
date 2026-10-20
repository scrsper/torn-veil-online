import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hostPort = process.env.TORN_VEIL_UNIVERSE_PORT || '7526';
const webPort = process.env.TORN_VEIL_UNIVERSE_WEB_PORT || '7525';
for (const port of [hostPort, webPort]) if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw Error('Universe ports must be integers from 1024 to 65535.');
if (hostPort === webPort) throw Error('Host and browser ports must differ.');
const stateHome = resolve(process.env.TORN_VEIL_UNIVERSE_HOME || resolve(homedir(), 'TornVeilAlpha/universe-expedition'));
const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs');
const vite = resolve(root, 'node_modules/vite/bin/vite.js');
if (!existsSync(tsx) || !existsSync(vite)) throw Error('Run npm ci in this checkout before launching the expedition.');
const env = { ...process.env, TORN_VEIL_UNIVERSE_HOME: stateHome, TORN_VEIL_UNIVERSE_PORT: hostPort, TORN_VEIL_UNIVERSE_SEED: process.env.TORN_VEIL_UNIVERSE_SEED || '20261017', TORN_VEIL_UNIVERSE_MANAGED: '1', TORN_VEIL_UNIVERSE_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort},http://127.0.0.1:${hostPort}` };
const children = []; let stopping = false;
function child(args) { const process = spawn(globalThis.process.execPath, args, { cwd: root, env, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true }); children.push(process); process.on('error', e => { console.error(e.message); stop(1); }); process.on('exit', code => { if (!stopping) stop(code || 0); }); return process; }
let host, web;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  if (host?.stdin.writable) host.stdin.end('shutdown\n');
  if (web && web.exitCode === null) web.kill();
  const timeout = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill(); process.exit(code); }, 4000);
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(done => child.once('exit', done)))).then(() => { clearTimeout(timeout); process.exit(code); });
}
async function waitFor(url, process) {
  for (let i = 0; i < 120; i++) { if (stopping || process.exitCode !== null) throw Error('A universe service stopped during startup.'); try { const r = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch {} await new Promise(done => setTimeout(done, 250)); }
  throw Error(`Startup timed out: ${url}`);
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { if (chunk.trim() === 'shutdown') stop(); });
// Do not attach to another process already using either port.
const { createServer } = await import('node:net');
for (const port of [hostPort, webPort]) await new Promise((done, reject) => { const test = createServer(); test.once('error', () => reject(Error(`Port ${port} is already in use. Close the existing expedition or choose another port.`))); test.listen(+port, '127.0.0.1', () => test.close(done)); });
try {
  console.log(`Torn Veil — The Astral Sea\nSave: ${stateHome}\nPress Ctrl+C here to save and stop.`);
  host = child([tsx, 'src/server/universe.ts']);
  await waitFor(`http://127.0.0.1:${hostPort}/api/universe`, host);
  web = child([vite, '--config', 'vite.web.config.ts', '--host', '127.0.0.1', '--port', webPort, '--strictPort']);
  const url = `http://127.0.0.1:${webPort}/?universe`;
  await waitFor(url, web);
  console.log(`\nReady: ${url}`);
  if (!process.argv.includes('--no-open')) {
    if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }).unref();
  }
} catch (error) { console.error(error.message); stop(1); }
