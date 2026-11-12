import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stageHumanMotion } from '../web/stage-human-motion.mjs';
import { acquireFoundationSession } from './configuration.mjs';
import { CHARACTER_BASE_DIR, CHARACTER_BASE_URL_DIR, readCharacterBasePin, stagedCharacterBaseFiles } from './character-bases.mjs';
import { FOUNDATION_BUILD_KIND, FOUNDATION_MANIFEST, FOUNDATION_PUBLIC_ALLOWLIST, foundationOutputIdentity, foundationPublicFiles, foundationSourceIdentity, verifyFoundationBuild } from './identity.mjs';

const root = resolve(import.meta.dirname, '../..');
if (!existsSync(resolve(root, 'node_modules/vite'))) throw Error('Run npm ci in this checkout before building the foundation.');
const release = acquireFoundationSession(root, 'build');
try {
  const buildRoot = resolve(root, 'dist-foundation');
  if (existsSync(buildRoot)) foundationOutputIdentity(buildRoot); // Refuses redirected paths before Vite replaces generated output.
  const stagingRoot = resolve(root, '.debug/foundation-build');
  if (existsSync(stagingRoot) && lstatSync(stagingRoot).isSymbolicLink()) throw Error('Foundation build staging directory must not be redirected.');
  const run = (args, env = {}) => {
    const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error('Foundation build step failed (' + (result.status ?? result.signal) + '): ' + args.join(' '));
  };
  run(['scripts/web/cook-focused-assets.mjs']);
  stageHumanMotion({ sources: [resolve(root, 'tools/ontology/public/assets/library/quaternius-ual/model.glb')] });
  const source = foundationSourceIdentity(root);
  const publicRoot = resolve(stagingRoot, randomUUID(), 'public');
  // Copy only the explicit local allowlist. Private optional motion/creator assets never enter this bundle.
  for (const path of foundationPublicFiles(root)) {
    const bytes = readFileSync(resolve(root, 'web/public', path));
    const expected = source.files.find(file => file.path === 'web/public/' + path);
    if (!expected || expected.bytes !== bytes.length || expected.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('Foundation asset changed during staging: ' + path);
    const target = resolve(publicRoot, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
  }
  // Pinned private character bases, when staged, go only into this local bundle.
  const characterBases = stagedCharacterBaseFiles(root);
  for (const path of characterBases) {
    const bytes = readFileSync(resolve(root, CHARACTER_BASE_DIR, path));
    const expected = source.files.find(file => file.path === CHARACTER_BASE_DIR + '/' + path);
    if (!expected || expected.bytes !== bytes.length || expected.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('Character base changed during staging: ' + path);
    const target = resolve(publicRoot, CHARACTER_BASE_URL_DIR, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
  }
  run(['node_modules/typescript/bin/tsc', '--noEmit']);
  run(['node_modules/vite/bin/vite.js', 'build', '--config', 'scripts/foundation/vite.config.mjs'], { TV_FOUNDATION_PUBLIC: publicRoot });
  if (foundationSourceIdentity(root).sourceSha256 !== source.sourceSha256) throw Error('Foundation source changed while building. No matching manifest was written.');
  const manifest = { kind: FOUNDATION_BUILD_KIND, version: 1, ...source, outputs: foundationOutputIdentity(buildRoot), publicAllowlist: FOUNDATION_PUBLIC_ALLOWLIST,
    privateCharacterBases: characterBases.length ? { files: characterBases.length, provenance: readCharacterBasePin(root).provenance } : null, builtAt: new Date().toISOString(), entry: '/?realms&foundation' };
  writeFileSync(resolve(buildRoot, FOUNDATION_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  verifyFoundationBuild(root, buildRoot);
  console.log('Foundation build verified: ' + manifest.sourceSha256 + '\nRun Play Torn Veil Foundation.cmd. This local build uses tracked CC0 motion and ' + (characterBases.length
    ? 'pinned private studio character bases (user-attested original work; licence history not audited) with credited fallbacks.'
    : 'existing credited characters (no private character bases staged).'));
} finally { release(); }
