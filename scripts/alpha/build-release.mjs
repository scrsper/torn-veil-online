// Build an immutable Living Alpha server release from a clean, committed revision.
//   node scripts/alpha/build-release.mjs [--version 0.1.0] [--out <dir>] [--allow-dirty]
// Output: <releases>/<version>+<rev>/{server.mjs,supervisor.mjs,ops.mjs,probe.mjs,release.json}
// The release directory is written once and marked read-only; environments reference it by path.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const sh = c => execSync(c, { encoding: 'utf8' }).trim();
const revision = sh('git rev-parse --short=12 HEAD');
const dirty = sh('git status --porcelain -- src scripts package.json package-lock.json').length > 0;
if (dirty && !process.argv.includes('--allow-dirty')) { console.error('Refusing to build a release from uncommitted changes (use --allow-dirty for a dev build).'); process.exit(1); }
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = `${arg('version') ?? pkg.version}+${revision}${dirty ? '.dirty' : ''}`;
// Not %LOCALAPPDATA%: packaged (MSIX) agent apps silently redirect AppData writes to a private store.
const home = process.env.TORN_VEIL_ALPHA_HOME ?? join(homedir(), 'TornVeilAlpha');
const out = resolve(arg('out') ?? join(home, 'releases', version));
if (existsSync(out) && readdirSync(out).length) { console.error(`${out} already exists; releases are immutable`); process.exit(1); }
mkdirSync(out, { recursive: true });

const entries = { server: 'src/server/main.ts', supervisor: 'src/server/supervisor.ts', ops: 'src/server/ops.ts', probe: 'src/server/probe.ts' };
await build({
  entryPoints: entries, outdir: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', outExtension: { '.js': '.mjs' },
  external: ['bufferutil', 'utf-8-validate'], sourcemap: 'linked', legalComments: 'none',
  // ESM bundles of CommonJS deps (ws) need require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
const saveSchema = Number(/SAVE_VERSION = (\d+)/.exec(readFileSync('src/sim/persist/save.ts', 'utf8'))[1]);
const protocol = Number(/ALPHA_PROTOCOL = (\d+)/.exec(readFileSync('src/server/protocol.ts', 'utf8'))[1]);
const generatorVersion = /GENERATOR_VERSION = '([^']+)'/.exec(readFileSync('src/server/fingerprint.ts', 'utf8'))[1];
const release = { version, revision, dirty, builtAtIso: new Date().toISOString(), protocol, saveSchema, generatorVersion, node: process.version };
writeFileSync(join(out, 'release.json'), JSON.stringify(release, null, 2));
for (const f of readdirSync(out)) chmodSync(join(out, f), 0o444);
console.log(JSON.stringify({ release: out, ...release }));
