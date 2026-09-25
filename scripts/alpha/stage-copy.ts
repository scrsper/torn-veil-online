// Create an isolated, disposable environment from a verified checkpoint of another environment.
//   npx tsx scripts/alpha/stage-copy.ts --from <env root> --to <new env root> --port <n>
//     [--account <id> --profile <client profile name>]
// Reads only verified checkpoints of the source (asking a running source to checkpoint first);
// never writes to the source. The copy keeps the world identity, ownership and generator; it gets
// its own port, credentials, state, logs and backups. With --account it (re)issues that account in
// the copy only and writes a matching per-user client profile, so the same person can be observed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { AccountRegistry } from '../../src/server/accounts';
import { loadConfig } from '../../src/server/config';
import { WorldStore, WriterLock } from '../../src/server/store';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const from = resolve(arg('from') ?? ''), to = resolve(arg('to') ?? ''), port = Number(arg('port'));
if (!existsSync(join(from, 'config.json')) || !Number.isInteger(port)) throw new Error('usage: --from <env root> --to <new env root> --port <n>');
if (existsSync(join(to, 'config.json'))) throw new Error(`${to} already exists; copies are never overwritten`);
const source = loadConfig(join(from, 'config.json'));
const token = readFileSync(join(source.credentialsDir, 'admin.token'), 'utf8').trim();
try {
  const r = await fetch(`http://127.0.0.1:${source.port}/admin/checkpoint?reason=staged-copy`, { method: 'POST', headers: { 'x-torn-veil-admin': token }, signal: AbortSignal.timeout(60_000) });
  console.log(JSON.stringify({ sourceCheckpoint: await r.json() }));
} catch { console.log(JSON.stringify({ sourceCheckpoint: 'source not running; using its latest verified checkpoint' })); }
const store = new WorldStore(source.stateDir);
const latest = store.candidates().next().value;
if (!latest) throw new Error('no verified source checkpoint');
mkdirSync(join(to, 'credentials'), { recursive: true }); mkdirSync(join(to, 'content'), { recursive: true });
const cfg = JSON.parse(readFileSync(join(from, 'config.json'), 'utf8'));
if (source.characterCatalogue) copyFileSync(source.characterCatalogue, join(to, 'content', 'character-catalogue.json'));
writeFileSync(join(to, 'config.json'), JSON.stringify({ env: 'dev', port, bind: ['127.0.0.1'], seed: cfg.seed ?? 918271, backupDir: join(to, 'backups'),
  checkpointSeconds: 60, backupMinutes: 600, disconnectGraceSeconds: 120, createWorldIfMissing: false,
  ...(source.characterCatalogue ? { characterCatalogue: 'content/character-catalogue.json' } : {}) }, null, 2));
writeFileSync(join(to, 'credentials', 'admin.token'), randomBytes(32).toString('base64url'));
const copy = loadConfig(join(to, 'config.json'));
const target = new WorldStore(copy.stateDir);
writeFileSync(join(target.worldDir, 'WORLD.json'), JSON.stringify(store.identity(), null, 2));
const lock = new WriterLock(copy.stateDir, { release: 'stage-copy', env: 'dev' }); lock.acquire();
let generation: number;
try { generation = target.installFrom(latest.dir, lock, `staged copy of ${from} generation ${latest.meta.generation}`).generation; } finally { lock.release(); }
const account = arg('account'), profile = arg('profile');
if (account) {
  const registry = new AccountRegistry(join(copy.credentialsDir, 'accounts.json'));
  const secret = registry.add(account, account);
  if (profile) {
    const dir = join(process.env.LOCALAPPDATA ?? '.', 'TornVeil', 'Client'); mkdirSync(dir, { recursive: true });
    const file = join(dir, `${profile}.json`);
    if (existsSync(file)) throw new Error(`client profile ${profile} already exists`);
    writeFileSync(file, JSON.stringify({ server: `127.0.0.1:${port}`, account, token: secret, character: 'auto', name: '', sex: 'f' }, null, 2));
  }
}
const owned = latest.meta.ownership[account ?? ''] ?? [];
console.log(JSON.stringify({ copied: from, into: to, port, sourceGeneration: latest.meta.generation, sourcePhysicalTime: latest.meta.physicalTime, installedGeneration: generation!, worldId: latest.meta.worldId, account: account ?? null, ownedCharacters: owned }));
