import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageHumanMotion } from '../web/stage-human-motion.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = process.env.TV_REALMS_PORT || '7530';
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw Error('TV_REALMS_PORT must be an integer from 1024 to 65535.');
if (!existsSync(resolve(root, 'node_modules/tsx'))) throw Error('Run npm ci before launching.');
// This uses the ordinary realm host's save selection, not the standalone explorer
// save. An explicit TV_REALMS_SAVE can select an existing checkpointed campaign.
const current = resolve(root, '.debug/realms/world-current.json');
const save = resolve(process.env.TV_REALMS_SAVE || (existsSync(current) || existsSync(current + '.store') ? current : resolve(root, '.debug/realms/world.json')));
await new Promise((done, reject) => {
  const probe = createServer(); probe.once('error', () => reject(Error(`Port ${port} is already occupied. Choose TV_REALMS_PORT or stop its owning host.`)));
  probe.listen(+port, '127.0.0.1', () => probe.close(done));
});
stageHumanMotion();
console.log(`Torn Veil — saved character and Astral Sea\nCampaign: ${save}\nDevelopment client; shared CC0 character motion verified.\nPress Ctrl+C to checkpoint and stop.`);
const host = spawn(process.execPath, ['--import', 'tsx', 'src/server/realms.ts'], {
  cwd: root, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, TV_REALMS_PORT: port, TV_REALMS_SAVE: save, TV_REALMS_STATIC: '', TV_REALMS_MANAGED: '1' },
});
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true; process.stdin.pause();
  if (host.stdin.writable) host.stdin.end('shutdown\n');
  // Journal checkpoints can be large. Do not force-kill a writer or remove its lock.
  console.log('Checkpointing the campaign. Waiting for the host to close…');
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.stdin.setEncoding('utf8'); let input = '';
process.stdin.on('data', chunk => { input += chunk; if (input.split(/\r?\n/).includes('shutdown')) stop(); });
host.on('error', error => { console.error(error.message); process.exitCode = 1; process.stdin.pause(); });
host.on('exit', code => { process.exitCode = code ?? 1; process.stdin.pause(); });
const url = `http://127.0.0.1:${port}/?universe&campaign`;
for (let i = 0; i < 240; i++) {
  if (host.exitCode !== null || stopping) break;
  try {
    const health = await fetch(`http://127.0.0.1:${port}/realms/health`, { signal: AbortSignal.timeout(1000) });
    if (health.ok && (await health.json()).ready) {
      console.log(`Ready: ${url}`);
      if (!process.argv.includes('--no-open')) {
        if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' }).unref();
        else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }).unref();
      }
      break;
    }
  } catch {}
  if (i === 239) { console.error('Startup did not become ready. The host log above contains the reason.'); stop(); }
  await new Promise(done => setTimeout(done, 250));
}
