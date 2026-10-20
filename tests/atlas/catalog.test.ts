import { describe, expect, it } from 'vitest';
import { inspectGlb, deduplicateAssets, sha256 } from '../../scripts/world/cook-atlas.mjs';
import { ATLAS_ASSETS, ATLAS_CATALOG, ATLAS_REVISION, eligibleAtlasAssets, getAtlasAsset } from '../../src/sim/world/atlas';

/** A complete indexed box, encoded as a real GLB rather than trusting accessor
 * min/max metadata. Every test stays independent of the user's local Atlas path. */
function boxGlb(edit?: (json: any, binary: Buffer) => void, low = [0, 0, 0], high = [2, 3, 4]) {
  const vertices = [low, [high[0], low[1], low[2]], [high[0], high[1], low[2]], [low[0], high[1], low[2]],
    [low[0], low[1], high[2]], [high[0], low[1], high[2]], high, [low[0], high[1], high[2]]].flat();
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  const binary = Buffer.alloc(vertices.length * 4 + indices.length * 2);
  vertices.forEach((v, i) => binary.writeFloatLE(v, i * 4));
  indices.forEach((v, i) => binary.writeUInt16LE(v, vertices.length * 4 + i * 2));
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'box', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ name: 'stone' }],
    buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: vertices.length * 4 },
      { buffer: 0, byteOffset: vertices.length * 4, byteLength: indices.length * 2 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-999, -999, -999], max: [999, 999, 999] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }],
  };
  edit?.(json, binary);
  const encoded = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32); encoded.copy(padded);
  const bytes = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
  bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); padded.copy(bytes, 20);
  const at = 20 + padded.length; bytes.writeUInt32LE(binary.length, at); bytes.writeUInt32LE(0x004e4942, at + 4); binary.copy(bytes, at + 8);
  return bytes;
}

describe('offline Atlas cook', () => {
  it('measures actual vertices in the full Y-up scene transform and preserves native off-center origins', () => {
    const result = inspectGlb(boxGlb(json => {
      json.nodes = [{ name: 'translated-parent', translation: [10, 20, 30], children: [1] },
        { name: 'Blender-source', mesh: 0, scale: [2, 1, 1], rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }];
    }));
    expect(result.bounds.min.x).toBeCloseTo(10, 4); expect(result.bounds.max.x).toBeCloseTo(14, 4);
    expect(result.bounds.min.y).toBeCloseTo(20, 4); expect(result.bounds.max.y).toBeCloseTo(24, 4);
    expect(result.bounds.min.z).toBeCloseTo(27, 4); expect(result.bounds.max.z).toBeCloseTo(30, 4);
    expect(result.footprintRadius).toBeCloseTo(Math.hypot(14, 30), 4);
    expect(result.groundOffset).toBeCloseTo(-20, 4); expect(result.nodeNames).toEqual(['translated-parent', 'Blender-source']);
    expect(result.triangleCount).toBe(12);
  });
  it('charges repeated mesh nodes for every rendered instance and ignores inactive scene nodes', () => {
    const result = inspectGlb(boxGlb(json => {
      json.nodes = [{ name: 'first', mesh: 0 }, { name: 'second', mesh: 0, translation: [5, 0, 0] }, { name: 'unused', mesh: 0 }];
      json.scenes[0].nodes = [0, 1];
    }));
    expect(result).toMatchObject({ meshCount: 1, nodeCount: 2, triangleCount: 24, primitiveCount: 2, materialCount: 1 });
    expect(result.bounds.max.x).toBe(7);
  });
  it('retains distinct post/lintel proxies and thin floor heights without sealing the doorway gap', () => {
    const result = inspectGlb(boxGlb(json => {
      json.nodes = [
        { name: 'left-post', mesh: 0, translation: [-1.25, 0, 0], scale: [.5, 3, .5] },
        { name: 'right-post', mesh: 0, translation: [1.25, 0, 0], scale: [.5, 3, .5] },
        { name: 'lintel', mesh: 0, translation: [0, 2.6, 0], scale: [3, .4, .5] },
        { name: 'floor', mesh: 0, translation: [0, -.1, 0], scale: [3, .1, 3] },
      ]; json.scenes[0].nodes = [0, 1, 2, 3];
    }, [-.5, 0, -.5], [.5, 1, .5]));
    expect(result.proxy.kind).toBe('boxes'); expect(result.proxy.boxes).toHaveLength(4);
    expect(result.proxy.boxes.some(b => b.min.x < .3 && b.max.x > -.3 && b.min.z < .3 && b.max.z > -.3
      && b.min.y < 1.8 && b.max.y > .05)).toBe(false);
    expect(result.proxy.boxes[3].max.y).toBe(0);
  });
  it('rejects external dependencies and decoder extensions even when extension lists are incomplete', () => {
    expect(() => inspectGlb(boxGlb(json => { json.images = [{ uri: 'https://example.invalid/image.png' }]; }))).toThrow(/external-resource/);
    expect(() => inspectGlb(boxGlb(json => { json.images = [{ uri: '../shared/stone.png' }]; }))).toThrow(/external-resource/);
    expect(() => inspectGlb(boxGlb(json => { json.extensionsRequired = ['KHR_draco_mesh_compression']; }))).toThrow(/unsupported-compression/);
    expect(() => inspectGlb(boxGlb(json => { json.bufferViews[0].extensions = { EXT_meshopt_compression: {} }; }))).toThrow(/unsupported-compression/);
    expect(() => inspectGlb(boxGlb(json => { json.extensionsRequired = ['UNKNOWN_geometry_decoder']; }))).toThrow(/unsupported-required-extension/);
  });
  it('rejects out-of-range geometry and forbidden source metadata before accepting bounds', () => {
    expect(() => inspectGlb(boxGlb((_, binary) => binary.writeUInt16LE(999, 96)))).toThrow(/index-outside/);
    expect(() => inspectGlb(boxGlb(json => { json.accessors[0].count = 10000; }))).toThrow(/invalid-accessor/);
    expect(() => inspectGlb(boxGlb(json => { json.asset.extras = { source: 'NCSoft native_buffers' }; }))).toThrow(/excluded-source/);
  });
  it('deduplicates decoded content without treating filenames or source aliases as new geometry', () => {
    const first = { ...ATLAS_ASSETS[0], id: 'canonical-first' }, same = { ...first, id: 'second-alias', path: 'different/path.glb.gz' };
    const different = { ...first, id: 'different-content', contentHash: 'f'.repeat(64) };
    const result = deduplicateAssets([first, same, different]);
    expect(result.assets.map(a => a.id)).toEqual(['canonical-first', 'different-content']);
    expect(result.excluded).toMatchObject([{ id: 'second-alias', role: 'duplicate', duplicateOf: 'canonical-first' }]);
  });
});

describe('cooked Atlas registry', () => {
  it('pins all canonical costs/proxies/content to a reproducible immutable revision', () => {
    const { revision, ...body } = ATLAS_CATALOG;
    expect(sha256(JSON.stringify(body))).toBe(ATLAS_REVISION); expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(ATLAS_ASSETS.length).toBeGreaterThan(1000); expect(eligibleAtlasAssets.length).toBeGreaterThan(1000);
    expect(new Set(ATLAS_ASSETS.map(a => a.id)).size).toBe(ATLAS_ASSETS.length);
    expect(new Set(ATLAS_ASSETS.map(a => a.contentHash)).size).toBe(ATLAS_ASSETS.length);
    expect(getAtlasAsset(ATLAS_ASSETS[0].id)).toBe(ATLAS_ASSETS[0]); expect(Object.isFrozen(ATLAS_ASSETS[0].proxy.boxes)).toBe(true);
  });
  it('keeps drafts, still-only records and duplicates outside selectable world content', () => {
    expect(eligibleAtlasAssets.every(a => a.role !== 'mob-draft' && a.exclusions.length === 0)).toBe(true);
    expect(ATLAS_CATALOG.excluded.some(a => a.role === 'still-only')).toBe(true);
    expect(ATLAS_CATALOG.excluded.some(a => a.role === 'duplicate')).toBe(true);
    expect(ATLAS_CATALOG.excluded.filter(a => a.source === 'rebuild' && a.reason === 'external-resource-uri')).toHaveLength(51);
    for (const a of ATLAS_ASSETS) {
      expect(a.contentHash).toMatch(/^[a-f0-9]{64}$/); expect(a.path).not.toMatch(/https?:|^\//);
      expect(a.height).toBeGreaterThan(0); expect(a.proxy.boxes.length).toBeLessThanOrEqual(64);
      expect(a.footprintRadius + 1e-5).toBeGreaterThanOrEqual(Math.hypot(a.bounds.max.x, a.bounds.max.z));
    }
  });
});
