import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STUDIO_REPO, checkBytes, fitTransform, locomotionWeights, resolveRequest, safeRelPath, stageAllowed, validateManifest,
  type CharacterEntry, type CharacterManifest,
} from '../../src/sim/town/characterModel';
import { RUN, WALK } from '../../src/sim/town/movement';
import catalog from '../../src/sim/town/characterCatalog.json';

const repo = resolve(__dirname, '../..');
const fixture = (): CharacterEntry => ({
  id: 'fixture-kaykit-skeleton-warrior', kind: 'test-fixture', label: 'KayKit Skeleton Warrior (CC0 test fixture)',
  source: { repo: 'scrsper/torn-veil-online', commit: null, path: 'web/public/arena/skeleton_warrior.glb' },
  file: 'fixture-kaykit-skeleton-warrior.glb', sha256: 'a'.repeat(64), bytes: 4096,
  license: 'CC0-1.0', attribution: { text: 'KayKit Character Pack: Skeletons, Kay Lousberg (CC0)' }, redistribution: 'permitted',
  fit: { height: 1.8, yaw: 0 }, clips: { idle: 'Idle', walk: 'Walking_A', run: 'Running_A' },
});
const studio = (): CharacterEntry => ({
  ...fixture(), id: 'studio-wanderer', kind: 'studio-character', label: 'Wanderer',
  source: { repo: STUDIO_REPO, commit: 'd05e112e5a6d646301cb6472ee5caefef95cf8a0', path: 'models/wanderer.glb' }, file: 'studio-wanderer.glb',
  attribution: { text: 'Owner-authored', companion: { path: 'models/wanderer.attribution.json', sha256: 'b'.repeat(64) } },
});
const manifest = (...characters: CharacterEntry[]): CharacterManifest => ({ version: 1, default: characters[0]?.id ?? null, characters });
const errorsOf = (e: CharacterEntry) => validateManifest(manifest(e)).errors.join('\n');

describe('town character manifest', () => {
  it('accepts a well-formed fixture and studio entry', () => {
    const r = validateManifest(manifest(fixture(), studio()));
    expect(r.errors).toEqual([]); expect(r.ok).toBe(true);
  });
  it('requires exact, contained relative paths', () => {
    for (const p of ['../x.glb', '/abs.glb', 'C:/x.glb', 'a\\b.glb', 'a/../b.glb', '', 'a//b.glb']) expect(safeRelPath(p), p).toBe(false);
    expect(safeRelPath('models/wanderer.glb')).toBe(true);
    expect(errorsOf({ ...studio(), source: { ...studio().source, path: '../vrm-characters/x.glb' } })).toMatch(/source\.path/);
    expect(errorsOf({ ...fixture(), file: 'other.glb' })).toMatch(/file/);
  });
  it('pins hashes, sizes, licences and attribution', () => {
    expect(errorsOf({ ...fixture(), sha256: 'abc' })).toMatch(/sha256/);
    expect(errorsOf({ ...fixture(), bytes: 0 })).toMatch(/bytes/);
    expect(errorsOf({ ...fixture(), license: 'proprietary' })).toMatch(/license/);
    expect(errorsOf({ ...fixture(), attribution: { text: '' } })).toMatch(/attribution/);
    expect(errorsOf({ ...studio(), attribution: { text: 'x', companion: { path: 'a.json', sha256: 'nope' } } })).toMatch(/companion/);
  });
  it('binds studio characters to the exact studio repository revision', () => {
    expect(errorsOf({ ...studio(), source: { ...studio().source, commit: null } })).toMatch(/commit/);
    expect(errorsOf({ ...studio(), source: { ...studio().source, commit: 'd05e112' } })).toMatch(/commit/);
    expect(errorsOf({ ...studio(), source: { ...studio().source, repo: 'scrsper/veil-media-studio' } })).toMatch(/repo/);
    expect(errorsOf({ ...studio(), id: 'fixture-wanderer', file: 'fixture-wanderer.glb' })).toMatch(/fixture/);
  });
  it('keeps test fixtures visibly labelled as fixtures', () => {
    expect(errorsOf({ ...fixture(), id: 'kaykit-skeleton', file: 'kaykit-skeleton.glb' })).toMatch(/fixture-/);
    expect(errorsOf({ ...fixture(), label: 'Skeleton hero' })).toMatch(/test fixture/);
  });
  it('refuses excluded sources', () => {
    expect(errorsOf({ ...studio(), label: 'Aion Elyos ranger' })).toMatch(/excluded/);
    expect(errorsOf({ ...studio(), source: { ...studio().source, path: 'ncsoft/rip.glb' } })).toMatch(/excluded/);
  });
  it('rejects malformed manifests, duplicate ids and unknown defaults', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest({ version: 2, default: null, characters: [] }).ok).toBe(false);
    expect(validateManifest(manifest(fixture(), fixture())).errors.join()).toMatch(/duplicate/);
    expect(validateManifest({ ...manifest(fixture()), default: 'nobody' }).errors.join()).toMatch(/default/);
    expect(errorsOf({ ...fixture(), clips: { idle: '' } })).toMatch(/clips\.idle/);
    expect(errorsOf({ ...fixture(), fit: { height: 9, yaw: 0 } })).toMatch(/fit\.height/);
  });
  it('only lets redistributable models into a distributable build', () => {
    expect(stageAllowed(fixture(), 'dist')).toBe(true);
    expect(stageAllowed({ ...studio(), redistribution: 'local-only' }, 'dist')).toBe(false);
    expect(stageAllowed({ ...studio(), redistribution: 'local-only' }, 'local')).toBe(true);
  });
  it('checks bytes against the pinned size and hash', () => {
    const bytes = Buffer.from('glTF test bytes'), sha = createHash('sha256').update(bytes).digest('hex');
    const e = { ...fixture(), sha256: sha, bytes: bytes.length };
    expect(checkBytes(e, bytes.length, sha)).toBeNull();
    expect(checkBytes(e, bytes.length + 1, sha)).toMatch(/size/);
    expect(checkBytes(e, bytes.length, 'f'.repeat(64))).toMatch(/hash/);
  });
});

describe('town character request', () => {
  const m = manifest(fixture());
  it('uses the staged default, or the capsule when nothing is staged', () => {
    expect(resolveRequest(null, m)).toEqual({ id: fixture().id });
    expect(resolveRequest(null, null)).toEqual({ id: null, reason: 'no character manifest staged' });
    expect(resolveRequest(null, { ...m, default: null })).toEqual({ id: null, reason: 'no default character' });
  });
  it('honours ?character=none and reports unknown ids instead of guessing', () => {
    expect(resolveRequest('none', m)).toEqual({ id: null, reason: 'capsule requested (?character=none)' });
    expect(resolveRequest('studio-missing', m)).toEqual({ id: null, reason: 'character "studio-missing" is not staged', failed: true });
  });
});

describe('town character presentation', () => {
  const clips = { idle: 'Idle', walk: 'Walking_A', run: 'Running_A' };
  const sum = (w: ReturnType<typeof locomotionWeights>) => w.idle + w.walk + w.run;
  it('blends idle, walk and run from the simulated speed', () => {
    const still = locomotionWeights(0, clips), walk = locomotionWeights(WALK, clips), run = locomotionWeights(RUN, clips);
    expect(still.idle).toBe(1); expect(walk.walk).toBeCloseTo(1, 6); expect(run.run).toBeCloseTo(1, 6);
    for (let s = 0; s <= RUN + 1; s += .37) expect(sum(locomotionWeights(s, clips))).toBeCloseTo(1, 6);
    expect(walk.walkRate).toBeCloseTo(1, 6);
  });
  it('falls back to a faster walk when there is no run clip, and to idle when there is no walk', () => {
    const w = locomotionWeights(RUN, { idle: 'Idle', walk: 'Walk' });
    expect(w.run).toBe(0); expect(w.walk).toBeCloseTo(1, 6); expect(w.walkRate).toBeGreaterThan(1);
    const i = locomotionWeights(RUN, { idle: 'Idle' });
    expect(i.idle).toBe(1);
  });
  it('fits model height and puts the soles on the floor', () => {
    const f = fitTransform({ minY: -.1, maxY: 2.07 }, 1.8);
    expect(f.scale).toBeCloseTo(1.8 / 2.17, 6); expect(-.1 * f.scale + f.offsetY).toBeCloseTo(0, 9);
    expect(() => fitTransform({ minY: 0, maxY: 0 }, 1.8)).toThrow(/degenerate/);
    expect(() => fitTransform({ minY: 0, maxY: 1e-4 }, 1.8)).toThrow(/scale/);
  });
});

describe('committed character catalog', () => {
  it('validates, and contains no studio character until the studio source is actually present', () => {
    const r = validateManifest(catalog);
    expect(r.errors).toEqual([]);
    expect(catalog.characters.filter(c => c.kind === 'studio-character')).toEqual([]);
  });
  it('pins the CC0 fixture to the exact tracked bytes and its declared rig clips', () => {
    const e = (catalog as CharacterManifest).characters.find(c => c.kind === 'test-fixture')!;
    const bytes = readFileSync(resolve(repo, e.source.path));
    expect(checkBytes(e, bytes.length, createHash('sha256').update(bytes).digest('hex'))).toBeNull();
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    expect(json.skins?.length).toBeGreaterThan(0);
    const names = new Set((json.animations ?? []).map((a: { name: string }) => a.name));
    for (const c of Object.values(e.clips)) expect(names.has(c), c).toBe(true);
  });
});
