import { Matrix, Quaternion, TransformNode, Vector3, type Scene, type AbstractMesh } from '@babylonjs/core';
import { tangentFrame, type V3 } from '../../sim/world/planet/planet';
import { SharedCharacters } from '../actors/sharedCast';
import type { BodyVisual } from '../actors/actorManager';
import type { BodyState } from '../net/messages';
import type { FootContactFrame } from '../arena/footPlant';

const vector = (p: V3) => new Vector3(p.x, p.y, p.z);
const copy = (p: V3) => ({ x: p.x, y: p.y, z: p.z });

/** Actual constrained eye-to-pivot distance; preferred zoom never determines
 * this visibility. Hysteresis prevents repeated toggles beside a close wall. */
export function avatarCameraOccluded(previous: boolean, clearance: number): boolean {
  if (clearance === Infinity) return false; // Existing callers without a camera constraint.
  if (!Number.isFinite(clearance)) return true;
  return previous ? clearance < 1.6 : clearance <= 1.25;
}

/** The shared hero faces local -Z. Retain an upright anatomical frame even
 * when the flight steering vector points straight up or down. */
export function avatarRotation(forward: V3, radial: V3, stableHeading?: V3): Quaternion {
  const up = vector(radial).normalize();
  const projected = vector(forward).subtract(up.scale(Vector3.Dot(vector(forward), up)));
  const retained = stableHeading ? vector(stableHeading).subtract(up.scale(Vector3.Dot(vector(stableHeading), up))) : Vector3.Zero();
  // Match the orbit camera's vertical cone so tiny steering noise cannot flip
  // the body while the camera correctly retains its transported heading.
  const tangent = projected.lengthSquared() > (stableHeading ? .15 ** 2 : 1e-8)
    ? projected.normalize() : retained.lengthSquared() > 1e-8 ? retained.normalize() : vector(tangentFrame(radial).north);
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
  private cameraOccluded = false;
  private cameraClearance = Infinity;
  private position: V3 = { x: 0, y: 0, z: 0 };
  private inverse = Matrix.Identity();
  private contactFrame: FootContactFrame | null = null;
  constructor(private scene: Scene, private lighting: { addCaster(mesh: AbstractMesh): void; removeCaster(mesh: AbstractMesh): void } = { addCaster() {}, removeCaster() {} }) {
    this.people = new SharedCharacters(scene);
    this.parent = new TransformNode('astral-character-frame', scene);
    this.parent.setEnabled(false);
  }

  update(body: BodyState | null, position: V3, origin: V3, forward: V3, radial: V3,
    velocity: V3, flying: boolean, visible: boolean, dt: number, stableHeading?: V3, cameraClearance = Infinity,
    contactFrame: FootContactFrame | null = null) {
    if (this.disposed) return;
    this.contactFrame = !flying && visible ? contactFrame : null;
    this.phase = visible && body ? flying ? 'flight' : 'ground' : 'hidden';
    this.cameraClearance = cameraClearance;
    this.cameraOccluded = avatarCameraOccluded(this.cameraOccluded, cameraClearance);
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
      this.visual = this.people.create(body, this.lighting, { planarContacts: false, radialContacts: () => this.contactFrame }, 'player');
      this.bodyId = body.bodyId;
      if (this.visual) this.visual.root.parent = this.parent;
    }
    // Hide only this owned presentation hierarchy when the lens reaches its
    // interior. Shared materials, body transforms and animation keep their
    // normal ownership/update paths; clear space restores it immediately.
    this.parent.setEnabled(this.phase !== 'hidden' && !!this.visual && !this.cameraOccluded);
    if (!body || !this.visual) return;
    const up = vector(radial).normalize();
    // Travel's reference point is three metres above the feet, in both modes.
    const feet = vector(position).subtract(up.scale(3));
    this.position = copy(feet);
    this.parent.position.set(feet.x - origin.x, feet.y - origin.y, feet.z - origin.z);
    const rotation = avatarRotation(forward, radial, stableHeading);
    this.parent.rotationQuaternion = this.parent.rotationQuaternion
      ? Quaternion.Slerp(this.parent.rotationQuaternion, rotation, 1 - Math.exp(-Math.max(0, dt) * 12)) : rotation;
    this.parent.rotationQuaternion.toRotationMatrix(this.inverse);
    this.inverse.invert();
    const localVelocity = Vector3.TransformNormal(vector(velocity), this.inverse);
    // Flight layers a bounded local pose over idle, never a high-speed foot gait.
    const speed = flying ? 0 : Math.hypot(localVelocity.x, localVelocity.z);
    this.visual.root.position.setAll(0); this.visual.root.rotation.setAll(0);
    this.visual.update(dt, { bodyId: body.bodyId, own: true, kind: 'person', body,
      speed, velocity: flying ? { x: 0, y: 0, z: 0 } : localVelocity,
      yaw: 0, crouch: 0, age: 0, lookAt: null, combat: null, guard: false,
      flightPresentation: { airborne: flying, velocity: copy(localVelocity) } });
  }

  stats() {
    const nodes = this.visual?.root.getChildTransformNodes(false) ?? [];
    const joints = nodes.filter(node =>
      /\.(pelvis|spine_03|upperarm_l|upperarm_r|calf_l|calf_r)$/.test(node.name)).map(node =>
      ({ name: node.name.slice(node.name.lastIndexOf('.') + 1), rotation: node.rotationQuaternion?.asArray() ?? null }));
    const landmarks = Object.fromEntries(nodes.filter(node => /\.(hand_l|hand_r|foot_l|foot_r|head|pelvis)$/.test(node.name))
      .map(node => { node.computeWorldMatrix(true); return [node.name.slice(node.name.lastIndexOf('.') + 1), copy(node.getAbsolutePosition())]; }));
    return { ready: !!this.visual, loading: this.loading, error: this.error, bodyId: this.bodyId,
      phase: this.phase, visible: this.parent.isEnabled(), position: copy(this.position),
      cameraOccluded: this.cameraOccluded, cameraClearance: Number.isFinite(this.cameraClearance) ? this.cameraClearance : null,
      assetPath: this.visual?.root.metadata?.assetPath ?? null,
      presentationRevision: this.visual?.root.metadata?.presentationRevision ?? null,
      motion: this.visual?.root.metadata?.motion ?? null,
      motionAvailability: this.people.assets.motionStatus, joints, landmarks };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.visual?.dispose(); this.visual = null;
    this.parent.dispose();
    if (!this.loading) this.people.assets.dispose();
  }
}
