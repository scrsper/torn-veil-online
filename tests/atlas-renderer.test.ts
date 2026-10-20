import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AssetContainer, Matrix, MeshBuilder, NullEngine, Scene, StandardMaterial, Vector3, type AbstractMesh } from '@babylonjs/core';
import type { AtlasAsset } from '../src/sim/world/atlas/types';
import { AtlasWorldRenderer, atlasRotation, type AtlasRenderPlacement } from '../src/web/atlas/stream';
import { inspectAtlasGlb, loadVerifiedAtlasAsset } from '../src/web/atlas/verified';

function glb(json: unknown = { asset: { version: '2.0' } }): Uint8Array {
  const source = new TextEncoder().encode(JSON.stringify(json)), length = Math.ceil(source.length / 4) * 4;
  const bytes = new Uint8Array(20 + length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20); bytes.set(source, 20); return bytes;
}
const modelBytes = glb();
const asset = (id: string, bytes = modelBytes): AtlasAsset => ({
  id, name: id, source: 'local', sourceId: id, sourceProvenance: 'renderer test fixture', readiness: 'test-only',
  role: 'prop', eligible: true, exclusions: [], tags: [], biomes: [],
  path: `${id}.glb`, contentHash: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength,
  triangleCount: 12, nodeCount: 1, meshCount: 1, primitiveCount: 1, materialCount: 1, textureCount: 0,
  textureBytes: 0, nodeNames: [id], bounds: { min: { x: -.5, y: 0, z: -.5 }, max: { x: .5, y: 1, z: .5 } },
  footprintRadius: 1, height: 1, groundOffset: 0, proxy: { kind: 'bounds', boxes: [] },
});
const placement = (id: string, x = 0): AtlasRenderPlacement =>
  ({ id: `place:${id}`, assetId: id, position: { x, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, yaw: 0, scale: 1 });
const zero = { x: 0, y: 0, z: 0 };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const scene = () => new Scene(new NullEngine());
const fakeContainer = (target: Scene, id = 'source') => {
  const container = new AssetContainer(target), mesh = MeshBuilder.CreateBox(id, {}, target);
  const material = new StandardMaterial(`${id}:material`, target); mesh.material = material;
  container.meshes.push(mesh); container.materials.push(material); container.rootNodes.push(mesh);
  if (mesh.geometry) container.geometries.push(mesh.geometry);
  container.removeAllFromScene();
  return container;
};

describe('verified Atlas loading', () => {
  it('hashes decoded bytes before parsing and rejects modified bytes or external resources', async () => {
    const target = scene(), source = asset('model'), parse = vi.fn(async () => fakeContainer(target));
    const corrupt = modelBytes.slice(); corrupt[corrupt.length - 2] ^= 1;
    await expect(loadVerifiedAtlasAsset(source, target, new AbortController().signal,
      { fetch: vi.fn(async () => new Response(corrupt)) as typeof fetch, parse })).rejects.toThrow('hash');
    expect(parse).not.toHaveBeenCalled();
    const external = glb({ asset: { version: '2.0' }, images: [{ uri: 'https://outside.invalid/texture.png' }] });
    expect(() => inspectAtlasGlb(external.buffer)).toThrow('contain their resources');
    const valid = await loadVerifiedAtlasAsset(source, target, new AbortController().signal,
      { fetch: vi.fn(async () => new Response(modelBytes)) as typeof fetch, parse });
    expect(parse).toHaveBeenCalledTimes(1); valid.dispose(); target.dispose(); target.getEngine().dispose();
  });

  it('bounds decoded response size and blocks unstaged executable decoders', async () => {
    const target = scene(), source = asset('small');
    await expect(loadVerifiedAtlasAsset(source, target, new AbortController().signal,
      { fetch: vi.fn(async () => new Response(new Uint8Array(source.byteLength + 1))) as typeof fetch }))
      .rejects.toThrow('exceeds');
    expect(() => inspectAtlasGlb(glb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }).buffer))
      .toThrow('unstaged decoder');
    target.dispose(); target.getEngine().dispose();
  });
});

describe('bounded Atlas presentation', () => {
  it('keeps native handedness at the poles and equator without rescaling or recentering', () => {
    for (const up of [Vector3.Up(), Vector3.Down(), new Vector3(0, 0, 1), new Vector3(1, 1, 1).normalize()]) {
      const matrix = Matrix.Compose(Vector3.One(), atlasRotation(up, .71), Vector3.Zero());
      expect(matrix.determinant()).toBeCloseTo(1, 6);
      const transformed = Vector3.TransformNormal(Vector3.Up(), matrix);
      expect(Vector3.Distance(transformed, up)).toBeLessThan(1e-6);
    }
    const identity = Matrix.Compose(Vector3.One(), atlasRotation(Vector3.Up(), 0), Vector3.Zero());
    expect(Vector3.TransformCoordinates(new Vector3(2, 3, 4), identity).asArray()).toEqual([2, 3, 4]);
  });

  it('reserves cache budgets before loading, caps concurrency, evicts unused models and rebases instances', async () => {
    const target = scene(), assets = [asset('a'), asset('b'), asset('c')];
    const casters = new Set<AbstractMesh>();
    let active = 0, peak = 0, parsed = 0;
    const stream = new AtlasWorldRenderer(target, {
      asset: id => assets.find(a => a.id === id),
      shadows: { addCaster: mesh => { casters.add(mesh); }, removeCaster: mesh => { casters.delete(mesh); } },
      budgets: { models: 2, bytes: modelBytes.length * 2, triangles: 24, instances: 2, instanceTriangles: 24, meshInstances: 2 },
      loader: {
        fetch: vi.fn(async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return new Response(modelBytes); }) as typeof fetch,
        parse: async () => fakeContainer(target, `parsed:${parsed++}`),
      },
    });
    stream.update([placement('a'), placement('b', 2), placement('c', 4)], zero, zero);
    expect(stream.stats().pending).toBe(2); await flush();
    stream.update([placement('a'), placement('b', 2)], zero, new Vector3(10, 20, 30), .1);
    stream.update([placement('a'), placement('b', 2)], zero, new Vector3(10, 20, 30), .1);
    expect(peak).toBe(2); expect(parsed).toBe(2);
    expect(stream.stats().instances).toBe(2);
    expect(casters.size).toBe(2);
    expect(target.getTransformNodeByName('atlas:place:a')!.position.asArray()).toEqual([-10, -20, -30]);
    expect(stream.stats().cacheBytes).toBe(modelBytes.length * 2);
    for (let i = 0; i < 5; i++) stream.update([placement('c')], zero, zero, .1);
    await flush(); stream.update([placement('c')], zero, zero, .1);
    expect(stream.stats().instancedIds).toEqual(['a', 'b', 'c']);
    expect(stream.stats().cachedModels).toBeLessThanOrEqual(2);
    expect(stream.stats().cacheTriangles).toBeLessThanOrEqual(24);
    expect(stream.stats().instances).toBe(1);
    expect(casters.size).toBe(1); expect([...casters].every(mesh => !mesh.isDisposed())).toBe(true);
    stream.dispose(); expect(target.meshes.length).toBe(0); expect(target.transformNodes.length).toBe(0);
    expect(casters.size).toBe(0);
    target.dispose(); target.getEngine().dispose();
  });

  it('disposes late parse completions and never resurrects unloaded instances', async () => {
    const target = scene(), source = asset('late');
    let complete!: (container: AssetContainer) => void;
    const parse = vi.fn(() => new Promise<AssetContainer>(resolve => { complete = resolve; }));
    const stream = new AtlasWorldRenderer(target, { asset: () => source, loader: {
      fetch: vi.fn(async () => new Response(modelBytes)) as typeof fetch, parse,
    } });
    stream.update([placement('late')], zero, zero);
    await flush(); expect(parse).toHaveBeenCalledTimes(1);
    stream.dispose();
    const container = fakeContainer(target), disposed = vi.spyOn(container, 'dispose'); complete(container);
    await flush();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(stream.stats().instances).toBe(0); expect(stream.stats().cachedModels).toBe(0);
    expect(stream.stats().pending).toBe(0); expect(target.meshes.length).toBe(0);
    target.dispose(); target.getEngine().dispose();
  });

  it('refuses geometry with a higher cost than its cooked reservation and records the failure', async () => {
    const target = scene(), source = { ...asset('misreported'), triangleCount: 1 };
    const stream = new AtlasWorldRenderer(target, { asset: () => source, loader: {
      fetch: vi.fn(async () => new Response(modelBytes)) as typeof fetch,
      parse: async () => fakeContainer(target),
    } });
    stream.update([placement(source.id)], zero, zero); await flush();
    expect(stream.stats().loaded).toBe(0);
    expect(stream.stats().failures[0].error).toContain('cooked cost');
    expect(target.meshes.length).toBe(0); stream.dispose(); target.dispose(); target.getEngine().dispose();
  });
});
