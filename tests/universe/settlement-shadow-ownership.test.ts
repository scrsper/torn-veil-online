import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetContainer, InstancedMesh, Matrix, Mesh, MeshBuilder, NullEngine, Scene, TransformNode, Vector3, type AbstractMesh } from '@babylonjs/core';
import { UniverseSettlements, settlementCameraClearance } from '../../src/web/universe/settlements';
import { FocusedAssets } from '../../src/web/realms/focusedAssets';
import { bendPoint } from '../../src/web/planet/bend';
import { planetSpec, type PlanetSpec } from '../../src/sim/world/planet/planet';
import { settlementPatches, type SettlementPatch } from '../../src/sim/world/universe/settlements';
import type { RenderContext } from '../../src/web/render/engine';
import type { Atmosphere } from '../../src/web/world/atmosphere';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine), spec = planetSpec(20261017), patch = settlementPatches()[0];
  const registered = new Set<AbstractMesh>();
  const shadows = { addCaster: vi.fn((mesh: AbstractMesh) => registered.add(mesh)),
    removeCaster: vi.fn((mesh: AbstractMesh) => registered.delete(mesh)) };
  const owner = new UniverseSettlements({ engine, scene } as unknown as RenderContext, shadows);
  // Exercise actual Babylon ownership/bending while injecting only loaded
  // projection/container dependencies; no network, renderer or source GLB edits.
  const internals = owner as unknown as {
    spec: PlanetSpec; root: TransformNode; assets: FocusedAssets; lighting: Atmosphere;
    bend(root: TransformNode, patch: SettlementPatch): Mesh[];
  };
  internals.spec = spec; internals.root.setEnabled(true);
  cleanups.push(() => { owner.dispose(); scene.dispose(); engine.dispose(); });
  return { owner, internals, registered, shadows, scene, spec, patch };
}

describe('bent settlement shadow ownership', () => {
  for (const casts of [true, false]) it(`preserves caster=${casts} through real instance replacement and original-owner disposal`, async () => {
    const f = fixture(), container = new AssetContainer(f.scene), source = MeshBuilder.CreateBox('statue', {}, f.scene);
    container.meshes.push(source); container.rootNodes.push(source);
    if (source.geometry) container.geometries.push(source.geometry);
    container.removeAllFromScene();
    const assets = f.internals.assets as unknown as { container(id: string): Promise<AssetContainer> };
    vi.spyOn(assets, 'container').mockResolvedValue(container);
    const instance = await f.internals.assets.instantiate({ id: 'fixture:statue', assetId: 'statue',
      position: [f.patch.chart.origin.x, 1, f.patch.chart.origin.z], yaw: 0, floorId: 'fixture' });
    const original = instance.root.getChildMeshes()[0];
    expect(original).toBeInstanceOf(InstancedMesh);
    original.metadata = { ...original.metadata, settlementDoorIndex: 12345 };
    if (!casts) f.internals.lighting.removeCaster(original);
    const [bent] = f.internals.bend(instance.root, f.patch);
    expect(bent).toBeInstanceOf(Mesh); expect(bent).not.toBe(original);
    expect(original.isDisposed()).toBe(true);
    expect(f.registered.has(original)).toBe(false);
    expect(f.registered.has(bent)).toBe(casts);
    expect(bent.metadata).toMatchObject({ settlementDoorIndex: 12345, placementId: 'fixture:statue', canonicalSettlement: f.patch.id });
    expect(source.isDisposed()).toBe(false);
    // The original FocusedAssets disposer knows only its original instances.
    instance.dispose(); instance.dispose();
    expect(bent.isDisposed()).toBe(true);
    expect(f.registered.size).toBe(0);
    expect(source.isDisposed()).toBe(false);
    container.dispose();
  });

  it('picks the placed thin wall after bending, not the far-away prototype, and releases its caster', () => {
    const f = fixture(), root = new TransformNode('thin-wall-root', f.scene);
    const wall = MeshBuilder.CreateBox('batched wall', { width: 2, height: 2, depth: .3 }, f.scene); wall.parent = root;
    wall.thinInstanceSetBuffer('matrix', new Float32Array(Matrix.Translation(f.patch.chart.origin.x, 3, f.patch.chart.origin.z).asArray()), 16, true);
    f.internals.lighting.addCaster(wall);
    f.internals.bend(root, f.patch);
    expect(wall.thinInstanceEnablePicking).toBe(true);
    const pivot = bendPoint(f.spec, f.patch.chart, new Vector3(f.patch.chart.origin.x, 3, f.patch.chart.origin.z + 6));
    const eye = bendPoint(f.spec, f.patch.chart, new Vector3(f.patch.chart.origin.x, 3, f.patch.chart.origin.z - 6));
    const clear = Vector3.Distance(pivot, settlementCameraClearance(f.scene, pivot, eye));
    expect(clear).toBeGreaterThan(5.4); expect(clear).toBeLessThan(5.7);
    wall.thinInstanceEnablePicking = false;
    expect(Vector3.Distance(pivot, settlementCameraClearance(f.scene, pivot, eye))).toBeGreaterThan(11.9);
    root.dispose();
    expect(f.registered.size).toBe(0); expect(wall.isDisposed()).toBe(true);
  });
});
