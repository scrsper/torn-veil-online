import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetContainer, MeshBuilder, NullEngine, Scene, type TransformNode } from '@babylonjs/core';
import { FocusedAssets } from '../src/web/realms/focusedAssets';
import type { Atmosphere } from '../src/web/world/atmosphere';
import type { AssetPlacement } from '../src/sim/world/assets/focused';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine), container = new AssetContainer(scene);
  const source = MeshBuilder.CreateBox('source-forest-mesh', {}, scene);
  container.meshes.push(source); container.rootNodes.push(source);
  if (source.geometry) container.geometries.push(source.geometry);
  container.removeAllFromScene();
  const atmosphere = { addCaster: vi.fn(), removeCaster: vi.fn() };
  const assets = new FocusedAssets(scene, atmosphere as unknown as Atmosphere);
  // Inject the dependency boundary while preserving real Babylon hierarchy
  // creation/disposal. The failure occurs after the model itself has loaded.
  const internals = assets as unknown as {
    container(id: string): Promise<AssetContainer>;
    routes(id: string): Promise<never[]>;
    forestKit(): { decorate(root: TransformNode, routes: never[]): void };
  };
  vi.spyOn(internals, 'container').mockResolvedValue(container);
  const decorate = vi.fn();
  vi.spyOn(internals, 'forestKit').mockReturnValue({ decorate });
  const placement: AssetPlacement = {
    id: 'fixture:forest', assetId: 'tv_47_01_pine_forest', position: [10, 1, 20], yaw: .4, floorId: 'fixture:floor',
  };
  cleanups.push(() => { assets.dispose(); container.dispose(); scene.dispose(); engine.dispose(); });
  return { assets, internals, scene, source, placement, atmosphere, decorate };
}

describe('focused asset hierarchy ownership', () => {
  it('releases created meshes and shadow registration when forest metadata rejects', async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    vi.spyOn(f.internals, 'routes').mockImplementation(() => new Promise((_, failed) => { reject = failed; }));
    const pending = f.assets.instantiate(f.placement), failure = expect(pending).rejects.toThrow('metadata hash differs');
    await Promise.resolve();
    expect(f.scene.getTransformNodeByName(f.placement.id)).not.toBeNull();
    expect(f.atmosphere.addCaster).toHaveBeenCalledTimes(1);
    reject(Error('metadata hash differs'));
    await failure;
    expect(f.scene.getTransformNodeByName(f.placement.id)).toBeNull();
    expect(f.scene.meshes).toHaveLength(0);
    expect(f.atmosphere.removeCaster).toHaveBeenCalledTimes(1);
    expect(f.decorate).not.toHaveBeenCalled();
    expect(f.source.isDisposed()).toBe(false);
  });

  it('rejects a late metadata completion after owner disposal without decorating or leaking', async () => {
    const f = fixture();
    let complete!: (value: never[]) => void;
    vi.spyOn(f.internals, 'routes').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = f.assets.instantiate(f.placement), failure = expect(pending).rejects.toThrow('cancelled');
    await Promise.resolve();
    expect(f.scene.getTransformNodeByName(f.placement.id)).not.toBeNull();
    f.assets.dispose(); complete([]);
    await failure;
    expect(f.decorate).not.toHaveBeenCalled();
    expect(f.scene.meshes).toHaveLength(0);
    expect(f.scene.getTransformNodeByName(f.placement.id)).toBeNull();
    expect(f.atmosphere.removeCaster).toHaveBeenCalledTimes(1);
  });

  it('retains successful instance ownership and idempotent disposal without disposing the shared source', async () => {
    const f = fixture();
    vi.spyOn(f.internals, 'routes').mockResolvedValue([]);
    const instance = await f.assets.instantiate(f.placement);
    expect(f.decorate).toHaveBeenCalledTimes(1);
    expect(f.scene.meshes).toHaveLength(1);
    instance.dispose(); instance.dispose();
    expect(f.scene.meshes).toHaveLength(0);
    expect(f.scene.getTransformNodeByName(f.placement.id)).toBeNull();
    expect(f.atmosphere.removeCaster).toHaveBeenCalledTimes(1);
    expect(f.source.isDisposed()).toBe(false);
  });
});
