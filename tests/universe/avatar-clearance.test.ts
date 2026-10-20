import { describe, expect, it, vi } from 'vitest';
import { MeshBuilder, NullEngine, PBRMaterial, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { UniverseAvatar, avatarCameraOccluded } from '../../src/web/universe/avatar';
import type { SharedCharacters } from '../../src/web/actors/sharedCast';
import type { BodyVisual } from '../../src/web/actors/actorManager';
import type { BodyState } from '../../src/web/net/messages';

describe('near-camera hero visibility', () => {
  it('hides at actual 1.25m clearance, restores at 1.6m and keeps normal 3m closeups visible', () => {
    expect(avatarCameraOccluded(false, 0)).toBe(true);
    expect(avatarCameraOccluded(false, 1.25)).toBe(true);
    expect(avatarCameraOccluded(false, 1.26)).toBe(false);
    expect(avatarCameraOccluded(true, 1.59)).toBe(true);
    expect(avatarCameraOccluded(true, 1.6)).toBe(false);
    expect(avatarCameraOccluded(true, 3)).toBe(false);
    expect(avatarCameraOccluded(true, Infinity)).toBe(false);
    expect(avatarCameraOccluded(false, NaN)).toBe(true);
  });

  it('keeps actual mesh materials, body placement and animation intact while hiding only its owned parent', () => {
    const engine = new NullEngine(), scene = new Scene(engine), avatar = new UniverseAvatar(scene);
    const root = new TransformNode('fixture-shared-character', scene);
    const mesh = MeshBuilder.CreateBox('fixture-character-body', {}, scene); mesh.parent = root;
    const sourceMaterial = new PBRMaterial('shared-source-material', scene);
    sourceMaterial.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE; sourceMaterial.alpha = 1; mesh.material = sourceMaterial;
    const sibling = MeshBuilder.CreateBox('other-character', {}, scene); sibling.material = sourceMaterial;
    const materialDisposed = vi.fn(); sourceMaterial.onDisposeObservable.add(materialDisposed);
    const animate = vi.fn(), release = vi.fn(() => root.dispose());
    const visual: BodyVisual = { root, headHeight: 1.8, update: animate, dispose: release };
    const internals = avatar as unknown as { people: SharedCharacters };
    internals.people.ready = true; vi.spyOn(internals.people, 'create').mockReturnValue(visual);
    const body = Object.freeze({ bodyId: 'retained-body' }) as BodyState;
    const position = Object.freeze({ x: 10, y: 100, z: 20 });
    const update = (clearance: number, flying = false, visible = true) => avatar.update(body, position, position,
      Vector3.Forward(true), Vector3.Up(), Vector3.Zero(), flying, visible, 1 / 60, Vector3.Forward(true), clearance);
    try {
      update(3); root.computeWorldMatrix(true);
      const before = root.getAbsolutePosition().clone();
      expect(mesh.isEnabled()).toBe(true);
      update(0);
      expect(mesh.isEnabled()).toBe(false); expect(sibling.isEnabled()).toBe(true);
      expect(avatar.stats()).toMatchObject({ phase: 'ground', visible: false, cameraOccluded: true, cameraClearance: 0 });
      expect(animate).toHaveBeenCalledTimes(2);
      root.computeWorldMatrix(true);
      expect(Vector3.Distance(before, root.getAbsolutePosition())).toBe(0);
      expect(position).toEqual({ x: 10, y: 100, z: 20 });
      expect(mesh.material).toBe(sourceMaterial); expect(sibling.material).toBe(sourceMaterial);
      expect(sourceMaterial.alpha).toBe(1); expect(sourceMaterial.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_OPAQUE);
      update(1.4, true);
      expect(avatar.stats()).toMatchObject({ phase: 'flight', visible: false, cameraOccluded: true });
      expect(animate).toHaveBeenCalledTimes(3);
      update(1.6, true);
      expect(mesh.isEnabled()).toBe(true);
      expect(avatar.stats()).toMatchObject({ phase: 'flight', visible: true, cameraOccluded: false });
      update(3, false, false);
      expect(avatar.stats()).toMatchObject({ phase: 'hidden', visible: false, cameraOccluded: false });
      update(3);
      expect(mesh.isEnabled()).toBe(true);
      avatar.dispose(); avatar.dispose();
      expect(release).toHaveBeenCalledTimes(1); expect(mesh.isDisposed()).toBe(true);
      expect(materialDisposed).not.toHaveBeenCalled();
      expect(sibling.material).toBe(sourceMaterial);
    } finally { avatar.dispose(); scene.dispose(); engine.dispose(); }
  });
});
