import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { acquireFoundationSession, selectFoundationLaunch, validateFoundationSave } from './configuration.mjs';
import { verifyFoundationBuild } from './identity.mjs';

const root = resolve(import.meta.dirname, '../..');
const options = selectFoundationLaunch(root);
if (options.help) {
  console.log('Torn Veil town foundation\n  npm run foundation:build\n  npm run foundation:play -- [--continue] [--no-open]\n  npm run foundation:play -- --acceptance [--no-open]\nTV_FOUNDATION_PORT selects a free loopback port (default 7541).\nTV_FOUNDATION_SAVE selects only a save under this checkout\'s .debug/foundation-acceptance.\nOrdinary play uses .debug/foundation-player/world.json. No existing save is reset.');
} else {
  if (!existsSync(resolve(root, 'node_modules/tsx'))) throw Error('Run npm ci in this checkout before launching.');
  const release = acquireFoundationSession(root, 'play');
  let host;
  try {
    const manifest = verifyFoundationBuild(root);
    await new Promise((done, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(Error('Port ' + options.port + ' is occupied. Choose TV_FOUNDATION_PORT; no existing host was changed.')));
      probe.listen(options.port, '127.0.0.1', () => probe.close(done));
    });
    validateFoundationSave(root, options.save, manifest, { create: true });
    console.log('TORN VEIL — PLAYABLE TOWN FOUNDATION\n' + (options.acceptance ? 'QA ACCEPTANCE FIXTURE' : 'YOUR SEPARATE FOUNDATION SAVE') + '\n' + (options.continuing ? 'Continue: ' : 'Creating NEW foundation: ') + options.save + '\nBuild: ' + manifest.sourceSha256 + '\nSave-and-Quit in the game or type shutdown here. Ctrl+C also requests graceful checkpoint/shutdown. Closing the browser alone does not stop the host.');
    host = spawn(process.execPath, ['--import', 'tsx', 'src/server/realms.ts'], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, TV_REALMS_PORT: String(options.port), TV_REALMS_SAVE: options.save,
        TV_REALMS_STATIC: resolve(root, 'dist-foundation'), TV_REALMS_ASSETS: '', TV_REALMS_SEED: '918271', TV_REALMS_MANAGED: '1', TV_FOCUSED_WORLD: '1', TV_FOUNDATION_MODE: '1' },
    });
    let stopping = false, input = '', exited = false;
    const stop = () => {
      if (stopping || exited) return; stopping = true; process.stdin.pause();
      if (host.stdin.writable) host.stdin.end('shutdown\n');
      console.log('Checkpointing this foundation. Waiting for the owned host to finish; no force termination.');
    };
    const finished = new Promise(done => {
      host.once('error', error => { console.error(error.message); process.exitCode = 1; exited = true; process.stdin.pause(); release(); done(); });
      host.once('exit', code => { process.exitCode = process.exitCode || (code ?? 1); exited = true; process.stdin.pause(); release(); done(); });
    });
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input = (input + chunk).slice(-1024); if (input.split(/\r?\n/).includes('shutdown')) stop(); });
    process.stdin.on('end', stop);
    const url = 'http://127.0.0.1:' + options.port + '/?realms&foundation';
    for (let attempt = 0; attempt < 240 && !stopping && !exited; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:' + options.port + '/realms/health', { signal: AbortSignal.timeout(1000) });
        const health = response.ok ? await response.json() : null;
        if (health?.ready) {
          if (resolve(health.root) !== root || resolve(health.savePath) !== options.save || health.clientBuild?.sourceSha256 !== manifest.sourceSha256) throw Error('Ready host does not match this foundation build/save.');
          console.log('Ready: ' + url);
          if (!options.noOpen) {
            const opener = process.platform === 'win32'
              ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' })
              : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
            opener.on('error', error => console.error('Open the Ready URL manually: ' + error.message)); opener.unref();
          }
          break;
        }
      } catch (error) {
        if (String(error).includes('does not match')) { console.error(error.message); process.exitCode = 1; stop(); break; }
      }
      if (attempt === 239) { console.error('Foundation startup did not become ready; requesting owned graceful shutdown.'); process.exitCode = 1; stop(); break; }
      await new Promise(done => setTimeout(done, 250));
    }
    await finished;
  } catch (error) { if (!host) release(); throw error; }
}
