import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { FOUNDATION_BUILD_KIND, FOUNDATION_MANIFEST, FOUNDATION_PUBLIC_ALLOWLIST, foundationOutputIdentity, foundationRuntimeIdentity, foundationSourceIdentity, isWithin, verifyFoundationBuild } from '../scripts/foundation/identity.mjs';
import { acquireFoundationSession, selectFoundationLaunch, validateFoundationSave } from '../scripts/foundation/configuration.mjs';

const scratch = resolve('.debug'), fixtures: string[] = [];
function fixture() {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'foundation-tests-')); fixtures.push(root); return root;
}
function write(root: string, path: string, text = path) {
  const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text);
}
function buildFixture(root: string) {
  for (const path of ['src/server.ts', 'scripts/foundation/example.mjs', 'web/index.html', 'web/main.ts', 'vite.web.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'scripts/web/cook-focused-assets.mjs', 'scripts/web/stage-human-motion.mjs', 'tools/ontology/public/assets/library/quaternius-ual/model.glb']) write(root, path);
  for (const path of FOUNDATION_PUBLIC_ALLOWLIST) write(root, 'web/public/' + path + (path.includes('.') ? '' : '/asset.glb'));
  write(root, 'dist-foundation/index.html', 'compiled foundation');
  const manifest = { kind: FOUNDATION_BUILD_KIND, version: 1 as const, ...foundationSourceIdentity(root), outputs: foundationOutputIdentity(join(root, 'dist-foundation')), publicAllowlist: FOUNDATION_PUBLIC_ALLOWLIST, builtAt: 'test', entry: '/?realms&foundation' };
  write(root, 'dist-foundation/' + FOUNDATION_MANIFEST, JSON.stringify(manifest)); return manifest;
}
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    if (!isWithin(scratch, root) || !basename(root).startsWith('foundation-tests-')) throw Error('Unsafe test cleanup path.');
    rmSync(root, { recursive: true, force: true });
  }
});

describe('isolated foundation launch', () => {
  it('ignores ordinary campaign save/port variables and clearly selects its separate new save', () => {
    const root = fixture(), result = selectFoundationLaunch(root, { TV_REALMS_SAVE: 'old-campaign.json', TV_REALMS_PORT: '7533' }, []);
    expect(result).toMatchObject({ save: resolve(root, '.debug/foundation-player/world.json'), port: 7541, continuing: false, acceptance: false });
    expect(existsSync(result.save)).toBe(false);
  });
  it('creates unique acceptance selections and permits only an explicitly selected acceptance continuation', () => {
    const root = fixture();
    expect(selectFoundationLaunch(root, {}, ['--acceptance'], 'run-a').save).not.toBe(selectFoundationLaunch(root, {}, ['--acceptance'], 'run-b').save);
    const save = resolve(root, '.debug/foundation-acceptance/existing/world.json'); write(root, '.debug/foundation-acceptance/existing/world.json', 'existing');
    expect(selectFoundationLaunch(root, { TV_FOUNDATION_SAVE: save }, ['--continue', '--no-open'])).toMatchObject({ save, continuing: true, acceptance: true, noOpen: true });
    expect(() => selectFoundationLaunch(root, { TV_FOUNDATION_SAVE: resolve(root, '.debug/foundation-player/world.json') }, [])).toThrow('only an isolated');
    expect(() => selectFoundationLaunch(root, { TV_FOUNDATION_SAVE: resolve(root, '../old/world.json') }, [])).toThrow('Foundation saves');
  });
  it('refuses absent Continue and malformed ports without writing a save', () => {
    const root = fixture();
    expect(() => selectFoundationLaunch(root, {}, ['--continue'])).toThrow('does not exist');
    for (const port of ['7533other', '0', '65536', '1.5']) expect(() => selectFoundationLaunch(root, { TV_FOUNDATION_PORT: port }, [])).toThrow('integer');
    expect(existsSync(join(root, '.debug'))).toBe(false);
  });
  it('refuses redirected save directories', () => {
    const root = fixture(), outside = fixture(); mkdirSync(join(root, '.debug'), { recursive: true });
    symlinkSync(outside, join(root, '.debug/foundation-acceptance'), 'junction');
    expect(() => selectFoundationLaunch(root, { TV_FOUNDATION_SAVE: join(root, '.debug/foundation-acceptance/world.json') }, [])).toThrow('redirected');
  });
  it('never adopts an unidentified old save or rewrites an incompatible identity', () => {
    const root = fixture(), save = join(root, '.debug/foundation-player/world.json');
    const identity = { sourceSha256: 'first-source', runtime: foundationRuntimeIdentity() };
    validateFoundationSave(root, save, identity, { create: true });
    const before = readFileSync(save + '.foundation.json', 'utf8');
    expect(() => validateFoundationSave(root, save, { ...identity, sourceSha256: 'changed-source' }, { create: true })).toThrow('different source');
    expect(readFileSync(save + '.foundation.json', 'utf8')).toBe(before);
    const oldSave = join(root, '.debug/foundation-acceptance/old/world.json'); write(root, '.debug/foundation-acceptance/old/world.json', 'retained');
    expect(() => validateFoundationSave(root, oldSave, identity, { create: true })).toThrow('no foundation identity');
    expect(readFileSync(oldSave, 'utf8')).toBe('retained');
  });
  it('keeps build/host ownership exclusive and releases only its own lock', () => {
    const root = fixture(), release = acquireFoundationSession(root, 'test-build');
    expect(() => acquireFoundationSession(root, 'test-play')).toThrow('owns');
    release(); const second = acquireFoundationSession(root, 'test-play'); release();
    expect(existsSync(join(root, '.debug/foundation-session.lock'))).toBe(true); second();
    expect(existsSync(join(root, '.debug/foundation-session.lock'))).toBe(false);
  });
});

describe('foundation build identity', () => {
  it('accepts exact source/assets/runtime and rejects changed source without relying on HEAD', () => {
    const root = fixture(), manifest = buildFixture(root);
    expect(verifyFoundationBuild(root).sourceSha256).toBe(manifest.sourceSha256);
    write(root, 'src/server.ts', 'changed canonical source');
    expect(() => verifyFoundationBuild(root)).toThrow('source/assets/runtime changed');
  });
  it('detects changed asset bytes, output tampering and runtime differences', () => {
    const assetRoot = fixture(); buildFixture(assetRoot); write(assetRoot, 'web/public/arena/motion/ual-standard.glb', 'different bytes');
    expect(() => verifyFoundationBuild(assetRoot)).toThrow('source/assets/runtime changed');
    const outputRoot = fixture(); buildFixture(outputRoot); write(outputRoot, 'dist-foundation/index.html', 'tampered');
    expect(() => verifyFoundationBuild(outputRoot)).toThrow('bundle is incomplete or changed');
    const runtimeRoot = fixture(), manifest = buildFixture(runtimeRoot); manifest.runtime = { ...manifest.runtime, arch: 'different' };
    write(runtimeRoot, 'dist-foundation/' + FOUNDATION_MANIFEST, JSON.stringify(manifest));
    expect(() => verifyFoundationBuild(runtimeRoot)).toThrow('source/assets/runtime changed');
  });
});
