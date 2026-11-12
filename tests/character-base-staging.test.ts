import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTER_BASE_DIR, CHARACTER_BASE_PARTS, CHARACTER_BASE_PIN, deriveCharacterBaseGlb, glbExternalUris, planCharacterBases, readCharacterBasePin, resolveCharacterBaseUri, stageCharacterBases, stagedCharacterBaseFiles } from '../scripts/foundation/character-bases.mjs';
import { FOUNDATION_PUBLIC_ALLOWLIST, foundationSourceIdentity } from '../scripts/foundation/identity.mjs';
import { parseStudioManifest } from '../src/web/actors/studioBases';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/1cAAAAASUVORK5CYII=', 'base64');

const glb = (uris: string[]) => {
  const text = JSON.stringify({ asset: { version: '2.0' }, images: uris.map(uri => ({ uri })) }), json = Buffer.from(text.padEnd(4 * Math.ceil(text.length / 4)));
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, json]);
};
const temps: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'tv-bases-')); temps.push(dir); return dir; };
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function source(extra: Record<string, string[]> = {}) {
  const dir = temp();
  for (const sex of Object.values(CHARACTER_BASE_PARTS)) for (const path of Object.values(sex)) {
    const uris = extra[path] ?? (path.startsWith('hair/') ? ['../textures/HairPreview.png'] : [`textures/${path.replace('.glb', '_D.png')}`]);
    mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), glb(uris));
    // A malicious URI is fixture data, never permission to create the escaped file.
    for (const uri of uris) { const t = resolve(dirname(join(dir, path)), uri); if (!t.startsWith(dir + '/')) { if (!t.startsWith(dir + '\\')) continue; } mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, png); }
  }
  return dir;
}
const checkout = () => { const root = temp(); mkdirSync(join(root, 'scripts/foundation'), { recursive: true }); return root; };

describe('private character base staging', () => {
  it('pins exactly the covered parts and their resolved textures, never preview bodies', () => {
    const plan = planCharacterBases(source());
    expect(plan.filter(f => f.path.endsWith('.glb'))).toHaveLength(10);
    expect(plan.map(f => f.path)).toContain('textures/HairPreview.png');
    expect(plan.some(f => /OriginalSkin|Underwear|SkinFull/.test(f.path))).toBe(false);
    expect(plan.every(f => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0)).toBe(true);
    expect(() => planCharacterBases(source(), { female: { body: 'Veil_Female_OriginalSkin.glb' } } as never)).toThrow(/Preview-only/);
    expect(() => planCharacterBases(source({ 'Veil_Male_BaseBody.glb': ['../../outside.png'] }))).toThrow(/escapes/);
    expect(glbExternalUris(glb(['a.png', 'data:image/png;base64,AA']))).toEqual(['a.png']);
  });

  it('records a pin once, then fails closed on changed source, tampering or extra files', () => {
    const root = checkout(), src = source();
    expect(() => stageCharacterBases(root, src)).toThrow(/--record/);
    expect(stagedCharacterBaseFiles(root)).toEqual([]);
    stageCharacterBases(root, src, { record: true });
    const pin = readCharacterBasePin(root)!, files = stagedCharacterBaseFiles(root);
    expect(pin.provenance).toMatchObject({ attestation: 'user-attested-original-work', publish: false, use: 'private-local-foundation-only' });
    expect(pin.provenance.audit).toMatch(/not independently audited/);
    const manifest = JSON.parse(readFileSync(join(root, CHARACTER_BASE_DIR, 'manifest.json'), 'utf8'));
    expect(parseStudioManifest(manifest).ok).toBe(true);
    expect(files).toEqual([...pin.files.map((f: { path: string }) => f.path), ...manifest.derivations.map((f: { path: string }) => f.path), 'manifest.json'].sort());
    expect(manifest.derivations).toHaveLength(2);
    for (const sex of ['female', 'male'] as const) {
      const original = pin.parts[sex].hair, derived = 'derived/' + original;
      expect(manifest.parts[sex].hair).toBe(derived);
      const bytes = readFileSync(join(root, CHARACTER_BASE_DIR, derived));
      expect(bytes.readUInt32LE(8)).toBe(bytes.length);
      expect(glbExternalUris(bytes)).toEqual([]);
      expect(readFileSync(join(root, CHARACTER_BASE_DIR, original))).toEqual(readFileSync(join(src, original)));
    }
    expect(parseStudioManifest({ ...manifest, derivations: [] }).ok).toBe(false);
    const badReceipt = structuredClone(manifest); badReceipt.derivations[0].source.sha256 = '0'.repeat(64);
    expect(parseStudioManifest(badReceipt).ok).toBe(false);
    const derivedPath = join(root, CHARACTER_BASE_DIR, manifest.derivations[0].path), derivedBytes = readFileSync(derivedPath);
    writeFileSync(derivedPath, 'tampered');
    expect(() => stagedCharacterBaseFiles(root)).toThrow(/Derived character base changed/);
    writeFileSync(derivedPath, derivedBytes);
    expect(readFileSync(join(root, CHARACTER_BASE_DIR, '.gitignore'), 'utf8')).toBe('*\n');
    // The tracked pin is never rewritten by a later staging.
    const pinBytes = readFileSync(join(root, CHARACTER_BASE_PIN), 'utf8');
    writeFileSync(join(src, 'textures/HairPreview.png'), 'changed');
    expect(() => stageCharacterBases(root, src, { record: true })).toThrow(/differs from the tracked pin: textures\/HairPreview.png/);
    expect(readFileSync(join(root, CHARACTER_BASE_PIN), 'utf8')).toBe(pinBytes);
    writeFileSync(join(root, CHARACTER_BASE_DIR, 'textures/HairPreview.png'), 'tampered');
    expect(() => stagedCharacterBaseFiles(root)).toThrow(/changed: textures\/HairPreview.png/);
    writeFileSync(join(root, CHARACTER_BASE_DIR, 'textures/HairPreview.png'), png);
    writeFileSync(join(root, CHARACTER_BASE_DIR, 'Veil_Female_OriginalSkin.glb'), 'x');
    expect(() => stagedCharacterBaseFiles(root)).toThrow(/unpinned/);
  });

  it('normalizes in-root parent references but rejects absolute, network, drive and encoded escapes', () => {
    expect(resolveCharacterBaseUri('hair/base.glb', '../textures/ok.png')).toBe('textures/ok.png');
    expect(resolveCharacterBaseUri('hair/base.glb', '%2e%2e/textures/ok.png')).toBe('textures/ok.png');
    for (const uri of ['../../out.png', '%2e%2e/%2e%2e/out.png', '..%5c..%5cout.png', '../textures/..%20/out.png',
      '/out.png', '//host/out.png', 'C:/out.png', 'D:out.png', 'https://host/out.png', 'file:///C:/out.png',
      '%252e%252e/out.png', '../textures/ok.png?x', '../textures/ok.png#x', '../textures/NUL.png', '../textures/ok.png.', '%00.png']) {
      expect(() => resolveCharacterBaseUri('hair/base.glb', uri), uri).toThrow(/escapes|unsafe/);
    }
    for (const path of ['../base.glb', 'C:/base.glb', '/base.glb', 'hair\\base.glb']) {
      expect(() => resolveCharacterBaseUri(path, 'ok.png'), path).toThrow(/escapes|unsafe/);
    }
    expect(() => deriveCharacterBaseGlb('hair/base.glb', glb(['../textures/unpinned.png']), () => { throw Error('not pinned'); })).toThrow(/not pinned/);
  });

  it('refuses redirected source and destination ancestors before copying', () => {
    const src = source(), outside = temp();
    // Junctions do not require Windows symlink privilege. Neither target is deleted through the link.
    symlinkSync(outside, join(src, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => planCharacterBases(src, { female: { body: 'redirect/base.glb' } } as never)).toThrow(/redirected/);
    const root = checkout(); mkdirSync(join(root, CHARACTER_BASE_DIR), { recursive: true });
    symlinkSync(outside, join(root, CHARACTER_BASE_DIR, 'textures'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => stageCharacterBases(root, src, { record: true })).toThrow(/redirected/);
    expect(existsSync(join(outside, 'HairPreview.png'))).toBe(false);
  });

  it('keeps the public allowlist unchanged and fingerprints staged bases in this checkout', () => {
    expect(FOUNDATION_PUBLIC_ALLOWLIST.some((p: string) => /private|character-bases|creator/.test(p))).toBe(false);
    const root = resolve('.'), staged = existsSync(resolve(root, CHARACTER_BASE_DIR));
    const paths = foundationSourceIdentity(root).files.map((f: { path: string }) => f.path);
    expect(paths.filter((p: string) => p.startsWith(CHARACTER_BASE_DIR + '/')).length).toBe(staged ? stagedCharacterBaseFiles(root).length : 0);
    expect(paths.some((p: string) => p.startsWith('web/public/') && /private-character-bases|Veil_/.test(p))).toBe(false);
  });
});
