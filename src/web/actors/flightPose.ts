import { Matrix, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { CharacterInstance } from '../arena/assets';
import { setWorldRotation } from './twoBoneIK';

export interface FlightPresentationInput { airborne: boolean; velocity: { x: number; y: number; z: number } }
export interface FlightPresentation {
  phase: 'ground' | 'launch' | 'hover' | 'ascent' | 'cruise' | 'brake' | 'descent' | 'landing';
  weight: number; pitch: number; bank: number; reach: number;
  /** Horizontal component drives the lean; invariant total speed detects braking. */
  speed: number; totalSpeed: number;
}
const limit = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const groundedFlightPresentation = (): FlightPresentation =>
  ({ phase: 'ground', weight: 0, pitch: 0, bank: 0, reach: 0, speed: 0, totalSpeed: 0 });

/** Authored presentation pacing, not a physics or ability model. All offsets are
 * bounded and ease back to the unmodified clip when the body touches down. */
export function flightPresentation(previous: FlightPresentation, input: FlightPresentationInput | undefined, dt: number): FlightPresentation {
  const v = input?.velocity, airborne = !!input?.airborne && !!v && [v.x, v.y, v.z].every(Number.isFinite);
  const step = Number.isFinite(dt) ? limit(dt, 0, .1) : 0, ease = 1 - Math.exp(-step * 7);
  const speed = airborne ? Math.hypot(v!.x, v!.z) : 0;
  const totalSpeed = airborne ? Math.hypot(v!.x, v!.y, v!.z) : 0;
  // The upright frame rotates as we move between worlds. A shrinking tangent
  // component does not mean the body slowed; magnitude is rotation invariant.
  const brake = airborne && previous.totalSpeed > 12 && step > 0 && (previous.totalSpeed - totalSpeed) / step > 18;
  // Reach follows travel in front of/above the torso, including a genuinely
  // vertical launch. Lateral/backward motion and feet-first descent retain the
  // open hover silhouette rather than reaching opposite their velocity.
  const reachSpeed = airborne ? Math.hypot(Math.max(0, -v!.z), Math.max(0, v!.y)) : 0;
  const reach = airborne && !brake ? limit((reachSpeed - 5) / 28, 0, 1) : 0;
  const weight = previous.weight + ((airborne ? 1 : 0) - previous.weight) * ease;
  const forwardShare = airborne ? limit(-v!.z / Math.max(1, speed), -.25, 1) : 0;
  const travelLean = airborne ? Math.atan2(speed, Math.max(0, v!.y)) * speed / (speed + 12) : 0;
  const targetPitch = airborne ? (brake ? -.18 : limit(travelLean * forwardShare, -.18, 1.3)) : 0;
  const targetBank = airborne ? limit(-v!.x / Math.max(10, speed), -.24, .24) : 0;
  const phase = !airborne ? (weight > .01 ? 'landing' : 'ground') :
    previous.weight < .3 ? 'launch' : brake ? 'brake' :
    v!.y > Math.max(2, speed * .5) ? 'ascent' : v!.y < -Math.max(2, speed * .5) ? 'descent' : speed > 5 ? 'cruise' : 'hover';
  return { phase, weight: weight < .0001 ? 0 : weight,
    pitch: previous.pitch + (targetPitch - previous.pitch) * ease,
    bank: previous.bank + (targetBank - previous.bank) * ease,
    reach: previous.reach + (reach - previous.reach) * ease, speed, totalSpeed };
}

/** Bounded presentation overlay on the fresh authored idle. The pivot is the
 * pelvis region; it does not move the body's authoritative feet or capsule.
 * World-space aiming handles each rig's different local bone axes. */
export class FlightPose {
  state = groundedFlightPresentation();
  private applied: { node: TransformNode; base: Quaternion; post: Quaternion }[] = [];
  private pivot: TransformNode;
  private armSigns = new Map<string, number>();
  constructor(private instance: CharacterInstance, parent: TransformNode, height: number) {
    this.pivot = new TransformNode('character-flight-presentation', parent.getScene());
    this.pivot.parent = parent; this.pivot.position.y = height * .53;
    instance.root.parent = this.pivot; instance.root.position.y -= this.pivot.position.y;
    const inverse = Matrix.Invert(instance.root.computeWorldMatrix(true));
    for (const side of ['l', 'r']) {
      const node = instance.bones?.get(`upperarm_${side}`); node?.computeWorldMatrix(true);
      const x = node ? Vector3.TransformCoordinates(node.getAbsolutePosition(), inverse).x : side === 'l' ? 1 : -1;
      this.armSigns.set(side, Math.sign(x) || 1);
    }
  }
  restore() {
    for (const { node, base } of this.applied) { node.rotationQuaternion = base; node.computeWorldMatrix(true); }
    this.applied = [];
  }
  update(input: FlightPresentationInput | undefined, dt: number) {
    this.state = flightPresentation(this.state, input, dt);
    // Canonical actors face -Z; a negative X pitch brings the torso forward.
    this.pivot.rotationQuaternion = Quaternion.FromEulerAngles(-this.state.pitch * this.state.weight, 0, this.state.bank * this.state.weight);
  }
  apply() {
    for (const { node, base, post } of this.applied) {
      if (node.rotationQuaternion && Math.abs(Quaternion.Dot(node.rotationQuaternion, post)) > .999999) {
        node.rotationQuaternion = base.clone(); node.computeWorldMatrix(true);
      }
    }
    this.applied = [];
    if (this.state.weight < .001 || !this.instance.bones) return;
    const { reach, weight } = this.state;
    for (const side of ['l', 'r']) {
      const sign = this.armSigns.get(side)!;
      // Imported rigs face +Z. The existing root adapter makes that canonical
      // -Z; aiming in the imported frame keeps both rigs and radial parents
      // consistent. A bounded 140-degree shoulder swing can reach beyond the
      // head, where the previous 100-degree cap left the elbows at shoulder level.
      this.aim(`upperarm_${side}`, `lowerarm_${side}`, new Vector3(sign * (.32 - reach * .18), -.86 + reach * 1.82, .25 + reach * .03), weight * .98, 2.44346);
      this.aim(`lowerarm_${side}`, `hand_${side}`, new Vector3(sign * .05, -.6 + reach * 1.52, .72 - reach * .34), weight * .94);
      // A small knee flex breaks the rigid standing silhouette during hover;
      // streamline the legs as the arms reach into forward cruise.
      this.aim(`calf_${side}`, `foot_${side}`, new Vector3(sign * .015, -1, -.18 * (1 - reach)), weight * .6);
    }
  }
  private aim(name: string, childName: string, localDirection: Vector3, weight: number, maxAngle = 1.75) {
    const node = this.instance.bones?.get(name), child = this.instance.bones?.get(childName);
    if (!node || !child) return;
    node.computeWorldMatrix(true); child.computeWorldMatrix(true); this.instance.root.computeWorldMatrix(true);
    const current = child.getAbsolutePosition().subtract(node.getAbsolutePosition()).normalize();
    const wanted = Vector3.TransformNormal(localDirection, this.instance.root.getWorldMatrix()).normalize();
    const dot = limit(Vector3.Dot(current, wanted), -1, 1), cross = Vector3.Cross(current, wanted);
    if (cross.lengthSquared() < 1e-10) return;
    const delta = Quaternion.RotationAxis(cross.normalize(), Math.min(maxAngle, Math.acos(dot)) * weight);
    const base = node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(node.rotation);
    setWorldRotation(node, delta.multiply(node.absoluteRotationQuaternion));
    this.applied.push({ node, base, post: node.rotationQuaternion!.clone() });
  }
}
