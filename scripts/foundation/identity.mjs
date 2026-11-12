import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CHARACTER_BASE_DIR, stagedCharacterBaseFiles } from './character-bases.mjs';

export const FOUNDATION_BUILD_KIND = 'torn-veil-foundation';
export const FOUNDATION_MANIFEST = 'foundation-build.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(sep).join('/');

/** Local foundation assets only. Optional private motion and creator bodies are excluded. */
export const FOUNDATION_PUBLIC_ALLOWLIST = Object.freeze([
  'focused', 'items', 'textures', 'arena/people', 'arena/people_flat', 'arena/arsenal',
  'arena/props.glb', 'arena/weapons.glb', 'arena/skeleton_warrior.glb',
  'arena/motion/ual-standard.glb', 'arena/motion/provenance.json',
  'models/kit_m.glb', 'models/kit_f.glb', 'models/kit_c.glb',
  'models/creature_field_hare.glb', 'models/creature_roe_deer.glb', 'models/creature_woodland_boar.glb',
  'models/runtime-receipt.json',
]);

function collect(root, entries) {
  const files = [];
  function visit(path) {
    const absolute = resolve(root, path), info = lstatSync(absolute);
    if (info.isSymbolicLink()) throw Error('Foundation inputs must be ordinary local files: ' + path);
    if (info.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(join(path, name));
    } else if (info.isFile()) files.push(slash(path));
    else throw Error('Unsupported foundation input: ' + path);
  }
  for (const entry of entries) visit(entry);
  return [...new Set(files)].sort();
}

export function foundationRuntimeIdentity() {
  return { versions: Object.fromEntries(Object.entries(process.versions).sort(([a], [b]) => a.localeCompare(b))), platform: process.platform, arch: process.arch };
}

export function foundationPublicFiles(root) {
  return collect(resolve(root, 'web/public'), FOUNDATION_PUBLIC_ALLOWLIST);
}

/** Exact bytes, including allowed local art and every canonical/browser source file. */
export function foundationSourceIdentity(root) {
  const paths = collect(root, ['src', 'scripts/foundation', 'web/index.html', 'web/main.ts',
    'vite.web.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json',
    'scripts/web/cook-focused-assets.mjs', 'scripts/web/stage-human-motion.mjs',
    'tools/ontology/public/assets/library/quaternius-ual/model.glb']);
  paths.push(...foundationPublicFiles(root).map(path => 'web/public/' + path));
  // Optional private character bases are pinned bytes inside this same fingerprint, never a bypass.
  paths.push(...stagedCharacterBaseFiles(root).map(path => CHARACTER_BASE_DIR + '/' + path));
  const files = [...new Set(paths)].sort().map(path => {
    const bytes = readFileSync(resolve(root, path));
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  });
  const runtime = foundationRuntimeIdentity();
  return { sourceSha256: sha(JSON.stringify({ files, runtime })), files, runtime };
}

export function foundationOutputIdentity(buildRoot) {
  return collect(buildRoot, ['.']).filter(path => path !== FOUNDATION_MANIFEST).map(path => {
    const bytes = readFileSync(resolve(buildRoot, path));
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  });
}

export function verifyFoundationBuild(root, buildRoot = resolve(root, 'dist-foundation')) {
  const expected = resolve(root, 'dist-foundation');
  if (resolve(buildRoot) !== expected || realpathSync(buildRoot) !== realpathSync(expected)) throw Error('Foundation build must use this checkout\'s dist-foundation directory.');
  const manifestPath = resolve(buildRoot, FOUNDATION_MANIFEST);
  if (!existsSync(manifestPath)) throw Error('Foundation build missing. Stop the host and run npm run foundation:build.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.kind !== FOUNDATION_BUILD_KIND || manifest.version !== 1) throw Error('Not a supported foundation build.');
  const source = foundationSourceIdentity(root);
  if (manifest.sourceSha256 !== source.sourceSha256 || JSON.stringify(manifest.runtime) !== JSON.stringify(source.runtime)) throw Error('Foundation source/assets/runtime changed. Stop the host and run npm run foundation:build; keep existing saves untouched.');
  if (JSON.stringify(manifest.files) !== JSON.stringify(source.files)) throw Error('Foundation source manifest differs from the current files.');
  if (JSON.stringify(manifest.outputs) !== JSON.stringify(foundationOutputIdentity(buildRoot))) throw Error('Foundation bundle is incomplete or changed. Stop the host and run npm run foundation:build.');
  return manifest;
}

export function isWithin(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate));
  return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}
