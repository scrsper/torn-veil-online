// Stage town character models into <out>/town-characters/ (default web/public for the dev server; ignored by git).
//   npm run town:characters -- [out] [--dist] [--fixtures] [--only id,id] [--default id]
// Every entry comes from the committed catalog (src/sim/town/characterCatalog.json) and is checked before copying:
//  - catalog schema (exact <id>.glb names, contained source paths, licence, attribution, studio commit pin);
//  - studio characters: TV_CHARACTER_STUDIO_DIR (default ../veil-character-studio) must be checked out at the
//    pinned scrsper/veil-character-studio commit; bytes and attribution companions must match their sha256;
//  - test fixtures are staged only with --fixtures, from this repository, and keep their "test fixture" label;
//  - --dist refuses local-only models.
// Sources are read, never modified. Binaries go into the staging output only, never into git.
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkBytes, stageAllowed, validateManifest, STUDIO_REPO, type CharacterEntry, type CharacterManifest } from '../../src/sim/town/characterModel';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), flag = (f: string) => argv.includes(f), opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const dist = flag('--dist'), positional = argv.filter((a, i) => !a.startsWith('--') && !['--only', '--default', '--catalog'].includes(argv[i - 1] ?? ''));
const outRoot = resolve(repo, positional[0] ?? (dist ? 'dist-town' : 'web/public')), out = resolve(outRoot, 'town-characters');
const studioDir = resolve(process.env.TV_CHARACTER_STUDIO_DIR ?? resolve(repo, '../veil-character-studio'));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const catalogPath = resolve(repo, opt('--catalog') ?? 'src/sim/town/characterCatalog.json');
const checked = validateManifest(JSON.parse(await readFile(catalogPath, 'utf8')));
if (!checked.ok) throw Error(`catalog rejected:\n  ${checked.errors.join('\n  ')}`);
const only = opt('--only')?.split(',').filter(Boolean);
let wanted = checked.manifest!.characters.filter(e => !only || only.includes(e.id));
for (const id of only ?? []) if (!wanted.some(e => e.id === id)) throw Error(`${id}: not in the catalog`);
if (!flag('--fixtures')) wanted = wanted.filter(e => e.kind !== 'test-fixture');

function studioHead(): string {
  if (!existsSync(studioDir)) throw Error(`studio source missing: ${studioDir} (set TV_CHARACTER_STUDIO_DIR)`);
  const r = spawnSync('git', ['-C', studioDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`studio source is not a git checkout: ${studioDir}`);
  return r.stdout.trim();
}
const sourceRoot = (e: CharacterEntry) => {
  if (e.kind === 'test-fixture') { if (e.source.repo !== 'scrsper/torn-veil-online') throw Error(`${e.id}: fixtures must come from this repository`); return repo; }
  const head = studioHead();
  if (e.source.repo !== STUDIO_REPO || head !== e.source.commit) throw Error(`${e.id}: studio checkout is at ${head}, catalog pins ${e.source.commit}`);
  return studioDir;
};

await rm(out, { recursive: true, force: true });
const staged: CharacterEntry[] = [], credits: string[] = [];
for (const e of wanted) {
  if (!stageAllowed(e, dist ? 'dist' : 'local')) throw Error(`${e.id}: redistribution is local-only; refusing a distributable build`);
  const root = sourceRoot(e), bytes = await readFile(resolve(root, e.source.path));
  const bad = checkBytes(e, bytes.length, sha(bytes)); if (bad) throw Error(bad);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw Error(`${e.id}: not a glTF 2.0 binary`);
  await mkdir(out, { recursive: true }); await copyFile(resolve(root, e.source.path), resolve(out, e.file));
  let entry = e;
  const c = e.attribution.companion;
  if (c) {
    const cb = await readFile(resolve(root, c.path)); if (sha(cb) !== c.sha256) throw Error(`${e.id}: attribution companion hash mismatch (${c.path})`);
    const name = `${e.id}.attribution${extname(c.path)}`; await copyFile(resolve(root, c.path), resolve(out, name));
    entry = { ...e, attribution: { ...e.attribution, companion: { path: name, sha256: c.sha256 } } };
  }
  staged.push(entry);
  credits.push(`${e.file} — ${e.label}\n  ${e.license}; ${e.attribution.text}\n  source ${e.source.repo}${e.source.commit ? '@' + e.source.commit : ''}:${e.source.path} sha256 ${e.sha256}${e.redistribution === 'local-only' ? '\n  LOCAL ONLY: not for redistribution' : ''}`);
}
const def = opt('--default') ?? null;
if (def && !staged.some(e => e.id === def)) throw Error(`--default ${def} is not among the staged characters`);
const manifest: CharacterManifest = { version: 1, default: def, characters: staged }, again = validateManifest(manifest);
if (!again.ok) throw Error(`staged manifest invalid:\n  ${again.errors.join('\n  ')}`);
if (staged.length) {
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  await writeFile(resolve(out, 'CREDITS.txt'), credits.join('\n\n') + '\n');
}
const studioCount = staged.filter(e => e.kind === 'studio-character').length;
console.log(`staged ${staged.length} character model(s) (${studioCount} studio, ${staged.length - studioCount} test fixture) into ${out}${def ? `; default ${def}` : ''}`);
if (!checked.manifest!.characters.some(e => e.kind === 'studio-character')) console.log(`note: the catalog has no ${STUDIO_REPO} character yet; the town shows the capsule unless a fixture is requested`);
