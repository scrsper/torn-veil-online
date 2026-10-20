import { Matrix, Quaternion, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import { tangentFrame, type V3 } from '../../sim/world/planet/planet';
import { SharedCharacters } from '../actors/sharedCast';
import type { BodyVisual } from '../actors/actorManager';
import type { BodyState } from '../net/messages';

const vector = (p: V3) => new Vector3(p.x, p.y, p.z);
const copy = (p: V3) => ({ x: p.x, y: p.y, z: p.z });

/** The shared hero faces local -Z. Retain an upright anatomical frame even
 * when the flight steering vector points straight up or down. */
export function avatarRotation(forward: V3, radial: V3): Quaternion {
  const up = vector(radial).normalize();
  const projected = vector(forward).subtract(up.scale(Vector3.Dot(vector(forward), up)));
  const tangent = projected.lengthSquared() > 1e-8 ? projected.normalize() : vector(tangentFrame(radial).north);
  // Babylon's helper aligns local +Z to the supplied vector even in an RH
  // scene. SharedVisual already adapts the authored hero to canonical -Z.
  return Quaternion.FromLookDirectionRH(tangent.scale(-1), up);
}

/** One approved shared character, below a spherical presentation parent.
 * This never changes the canonical body, movement, abilities or equipment. */
export class UniverseAvatar {
  private people: SharedCharacters;
  private parent: TransformNode;
  private visual: BodyVisual | null = null;
  private loading = false;
  private disposed = false;
  private error = '';
  private bodyId = '';
  private phase: 'ground' | 'flight' | 'hidden' = 'hidden';
  private position: V3 = { x: 0, y: 0, z: 0 };
  private inverse = Matrix.Identity();
  constructor(private scene: Scene) {
    this.people = new SharedCharacters(scene);
    this.parent = new TransformNode('astral-character-frame', scene);
    this.parent.setEnabled(false);
  }

  update(body: BodyState | null, position: V3, origin: V3, forward: V3, radial: V3,
    velocity: V3, flying: boolean, visible: boolean, dt: number) {
    if (this.disposed) return;
    this.phase = visible && body ? flying ? 'flight' : 'ground' : 'hidden';
    if (body && !this.loading && !this.people.ready && !this.error) {
      this.loading = true;
      // Ranger is the existing retarget reference. Wren is the existing female
      // hero; loading these two avoids loading the entire resident cast.
      void this.people.load(() => {}, ['ranger', 'wren']).then(() => {
        if (this.disposed) this.people.assets.dispose();
      }).catch(error => {
        this.error = String(error?.message ?? error).slice(0, 240);
        if (this.disposed) this.people.assets.dispose();
      }).finally(() => { this.loading = false; });
    }
    if (body && this.people.ready && (!this.visual || this.bodyId !== body.bodyId)) {
      this.visual?.dispose();
      this.visual = this.people.create(body, { addCaster() {}, removeCaster() {} }, { planarContacts: false }, 'player');
      this.bodyId = body.bodyId;
      if (this.visual) this.visual.root.parent = this.parent;
    }
    this.parent.setEnabled(this.phase !== 'hidden' && !!this.visual);
    if (!body || !this.visual) return;
    const up = vector(radial).normalize();
    // Travel's reference point is three metres above the feet, in both modes.
    const feet = vector(position).subtract(up.scale(3));
    this.position = copy(feet);
    this.parent.position.set(feet.x - origin.x, feet.y - origin.y, feet.z - origin.z);
    const rotation = avatarRotation(forward, radial);
    this.parent.rotationQuaternion = this.parent.rotationQuaternion
      ? Quaternion.Slerp(this.parent.rotationQuaternion, rotation, 1 - Math.exp(-Math.max(0, dt) * 12)) : rotation;
    this.parent.rotationQuaternion.toRotationMatrix(this.inverse);
    this.inverse.invert();
    const localVelocity = Vector3.TransformNormal(vector(velocity), this.inverse);
    // Airborne presentation uses the approved relaxed idle. Ground locomotion
    // keeps authored walking clips; a speed in space must never become foot gait.
    const speed = flying ? 0 : Math.hypot(localVelocity.x, localVelocity.z);
    this.visual.root.position.setAll(0); this.visual.root.rotation.setAll(0);
    this.visual.update(dt, { bodyId: body.bodyId, own: true, kind: 'person', body,
      speed, velocity: flying ? { x: 0, y: 0, z: 0 } : localVelocity,
      yaw: 0, crouch: 0, age: 0, lookAt: null, combat: null, guard: false });
  }

  stats() {
    const joints = this.visual?.root.getChildTransformNodes(false).filter(node =>
      /\.(pelvis|spine_03|upperarm_l|upperarm_r|calf_l|calf_r)$/.test(node.name)).map(node =>
      ({ name: node.name.slice(node.name.lastIndexOf('.') + 1), rotation: node.rotationQuaternion?.asArray() ?? null })) ?? [];
    return { ready: !!this.visual, loading: this.loading, error: this.error, bodyId: this.bodyId,
      phase: this.phase, visible: this.parent.isEnabled(), position: copy(this.position),
      assetPath: this.visual?.root.metadata?.assetPath ?? null,
      presentationRevision: this.visual?.root.metadata?.presentationRevision ?? null,
      motion: this.visual?.root.metadata?.motion ?? null, joints };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.visual?.dispose(); this.visual = null;
    this.parent.dispose();
    if (!this.loading) this.people.assets.dispose();
  }
}
