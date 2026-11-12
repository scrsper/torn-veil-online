import { describe, expect, it, vi } from 'vitest';
import { AssetContainer, Color3, MeshBuilder, NullEngine, PBRMaterial, Scene, SceneLoader, Texture } from '@babylonjs/core';
import { adaptStudioMaterials, composeStudioRig } from '../src/web/actors/studioBaseRig';
import { parseStudioManifest, StudioCharacterBases } from '../src/web/actors/studioBases';
import { readFileSync } from 'node:fs';
const manifestFixture = () => ({ ...JSON.parse(readFileSync('scripts/foundation/character-bases.pin.json', 'utf8')), kind: 'torn-veil-private-character-bases' });

describe('studio adapter ownership and failure handling', () => {
  it.each([false, true])('waits for actual DIRO texture completion and propagates errors (failure=%s)', async failure => {
    const engine = new NullEngine(), scene = new Scene(engine), container = new AssetContainer(scene);
    const material = new PBRMaterial('Hair', scene); material.metadata = { gltf: { extras: { textures: { DIRO: 'T_Hair_03_DIRO' } } } };
    container.materials.push(material);
    const create = engine.createTexture.bind(engine); let complete!: () => void;
    const transport = vi.spyOn(engine, 'createTexture').mockImplementation((...args) => {
      const onLoad = args[5], onError = args[6]; args[5] = null;
      const texture = create(...args);
      complete = () => failure ? onError?.('decode failed', null) : onLoad?.(texture);
      return texture;
    });
    try {
      let settled = false;
      const pending = adaptStudioMaterials(container, './textures/');
      pending.then(() => { settled = true; }, () => { settled = true; });
      await Promise.resolve(); expect(settled).toBe(false);
      complete();
      if (failure) await expect(pending).rejects.toThrow('DIRO texture failed');
      else {
        expect((await pending).hair).toBe(1);
        expect(material.albedoTexture?.gammaSpace).toBe(false);
        expect((material.albedoTexture as Texture).vScale).toBe(.5);
        expect(material.alphaCutOff).toBe(.18);
      }
    } finally { transport.mockRestore(); container.dispose(); scene.dispose(); engine.dispose(); }
  });

  it('owns mutable materials per actor and preserves other actors and source on disposal', () => {
    const engine = new NullEngine(), scene = new Scene(engine), container = new AssetContainer(scene);
    const mesh = MeshBuilder.CreateBox('body', {}, scene), material = new PBRMaterial('cloth', scene);
    const texture = new Texture(null, scene); material.albedoTexture = texture; container.textures.push(texture);
    const sourceDispose = vi.spyOn(texture, 'dispose');
    mesh.material = material; container.meshes.push(mesh); container.rootNodes.push(mesh); container.materials.push(material);
    container.removeAllFromScene();
    try {
      const a = composeStudioRig(scene, 'a', [{ part: 'body', container }]), b = composeStudioRig(scene, 'b', [{ part: 'body', container }]);
      const am = a.meshes[0].material as PBRMaterial, bm = b.meshes[0].material as PBRMaterial;
      const actorTextures = [am.albedoTexture!, bm.albedoTexture!];
      expect(am).not.toBe(bm); expect(am).not.toBe(material);
      am.albedoColor.copyFrom(Color3.Red()); am.alpha = .2;
      expect(bm.alpha).toBe(1); expect(bm.albedoColor).not.toEqual(am.albedoColor);
      a.dispose(); a.dispose();
      expect(scene.materials).not.toContain(am); expect(scene.materials).toContain(bm);
      expect(b.meshes[0].isDisposed()).toBe(false); expect(mesh.isDisposed()).toBe(false);
      b.dispose(); expect(scene.materials).not.toContain(bm);
      for (const actorTexture of actorTextures) expect(scene.textures).not.toContain(actorTexture);
      expect(sourceDispose).not.toHaveBeenCalled();
    } finally { container.dispose(); scene.dispose(); engine.dispose(); }
  });

  it('rejects malformed file lists instead of throwing or allowing arbitrary dependencies', () => {
    const valid = manifestFixture();
    expect(parseStudioManifest(valid).ok).toBe(true);
    for (const files of [{}, [null], [{ path: '../escape.png', bytes: 1, sha256: 'a'.repeat(64) }]]) {
      expect(parseStudioManifest({ ...valid, files }).ok).toBe(false);
    }
  });

  it('disposes partial loads and rejects rigs without required joints', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const manifest = manifestFixture();
    const created: AssetContainer[] = [], disposed: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => manifest })));
    const loader = vi.spyOn(SceneLoader, 'LoadAssetContainerAsync').mockImplementation(async (_root, file) => {
      if (String(file).includes('Female_BasePants')) throw Error('missing pants');
      const c = new AssetContainer(scene); created.push(c); vi.spyOn(c, 'dispose').mockImplementation(() => { disposed.push(String(file)); }); return c;
    });
    try {
      const bases = new StudioCharacterBases(scene), status = await bases.load();
      expect(status.available).toEqual([]);
      expect(status.reason).toMatch(/missing.*bones/i);
      expect(disposed).toHaveLength(created.length);
    } finally { loader.mockRestore(); vi.unstubAllGlobals(); scene.dispose(); engine.dispose(); }
  });
});
