import { Quaternion, Vector3, type TransformNode } from '@babylonjs/core';
import { armSwing, bodySway, legPose } from '../actors/gait';
import type { CharacterInstance } from './assets';

type Rest = { node: TransformNode; local: Quaternion; parent: Quaternion; model: Quaternion; pos: Vector3 };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const axis = (x: number, y: number, z: number, a: number) => Quaternion.RotationAxis(new Vector3(x, y, z), a);
const chain = (...qs: Quaternion[]) => qs.reduce((q, next) => next.multiply(q), Quaternion.Identity());
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
function fromTo(a: Vector3, b: Vector3) {
 const u = a.normalizeToNew(), v = b.normalizeToNew(), d = clamp(Vector3.Dot(u, v), -1, 1);
 if (d > .99999) return Quaternion.Identity();
 const cross = Vector3.Cross(u, v);
 if (cross.lengthSquared() < 1e-8) return axis(1, 0, 0, Math.PI);
 return Quaternion.RotationAxis(cross.normalize(), Math.acos(d));
}

/** PR65 curves on the active imported rig. One absolute locomotion pose replaces
 * clip joints after animation, before foot IK. The actor root is never written.
 * Combat/guard/directional layers immediately take ownership back. */
export class HumanGait {
 private rest = new Map<string, Rest>();
 private neutralArms = new Map<string, { upper: Quaternion; parent: Quaternion }>();
 private weight = 0; private target = 0; private rate = 0; private run = 0; private phase = 0;
 private speed = 0; private forward = 1; private crouch = 0; private yaw = 0; private lastYaw: number | null = null;
 private previousSpeed = 0; private lean = 0; private bank = 0; private arms = true; private lastFrame = -1;
 private lastPose = { speed: 0, crouch: 0 }; private height = 1; private floorAnkle = 0; private lift = 0; private dt = 0;
 private clipPhase: (() => number | null) | null = null;
 readonly supported: boolean;
 constructor(private inst: Pick<CharacterInstance, 'root' | 'bones'>) {
  const root = inst.root; root.computeWorldMatrix(true);
  const inv = root.getWorldMatrix().clone().invert(), rq = new Quaternion(); root.getWorldMatrix().decompose(undefined, rq);
  const modelQ = (node: TransformNode) => { node.computeWorldMatrix(true); const q = new Quaternion(); node.getWorldMatrix().decompose(undefined, q); return Quaternion.Inverse(rq).multiply(q).normalize(); };
  for (const [name, node] of inst.bones ?? []) {
   node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
   this.rest.set(name, { node, local: node.rotationQuaternion.clone(), parent: node.parent ? modelQ(node.parent as TransformNode) : Quaternion.Identity(), model: modelQ(node), pos: node.position.clone() });
  }
  this.supported = ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'].every(n => this.rest.has(n));
  const pelvis = this.rest.get('pelvis'), foot = this.rest.get('foot_l');
  if (pelvis && foot) { this.height = Math.max(.3, Vector3.TransformCoordinates(pelvis.node.getAbsolutePosition(), inv).y); this.floorAnkle = Vector3.TransformCoordinates(foot.node.getAbsolutePosition(), inv).y; }
  for (const side of ['l', 'r']) {
   const upper = this.rest.get(`upperarm_${side}`), lower = this.rest.get(`lowerarm_${side}`);
   if (!upper || !lower) continue;
   const direction = Vector3.TransformNormal(lower.node.getAbsolutePosition().subtract(upper.node.getAbsolutePosition()), inv);
   const hanging = fromTo(direction, Vector3.Down()).multiply(upper.model);
   this.neutralArms.set(side, { upper: Quaternion.Inverse(upper.parent).multiply(hanging), parent: hanging });
  }
 }
 motion(speed: number, forward: number, crouch: number, yaw: number) {
  this.speed = Math.max(0, speed); this.forward = forward; this.crouch = clamp(crouch, 0, 1); this.yaw = yaw;
 }
 locomotion(run: number, rate: number, arms: boolean, clipPhase: () => number | null) {
  this.target = this.supported && this.forward > -.25 ? 1 : 0;
  this.run = clamp(run, 0, 1); this.rate = Math.max(0, rate); this.arms = arms; this.clipPhase = clipPhase;
 }
 stop(immediate = false) { this.target = 0; if (immediate) { this.weight = 0; this.lift = 0; } }
 update(dt: number) {
  const safe = clamp(dt, 0, .1), k = 1 - Math.exp(-safe * 12);
  this.dt = safe;
  this.weight += (this.target - this.weight) * (1 - Math.exp(-safe * (this.target ? 14 : 18)));
  const acceleration = (this.speed - this.previousSpeed) / Math.max(.001, safe);
  const yawRate = this.lastYaw === null ? 0 : wrap(this.yaw - this.lastYaw) / Math.max(.001, safe);
  this.lean += (clamp(acceleration * .018, -.10, .12) - this.lean) * k;
  this.bank += (clamp(-yawRate * this.speed * .012, -.10, .10) - this.bank) * k;
  this.previousSpeed = this.speed; this.lastYaw = this.yaw;
  if (this.target) { this.phase = (this.phase + this.rate * safe) % 1; this.lastPose = { speed: this.speed, crouch: this.crouch }; }
 }
 private pose(name: string, delta: Quaternion, weight: number) {
  const r = this.rest.get(name); if (!r) return;
  const q = Quaternion.Inverse(r.parent).multiply(delta).multiply(r.parent).multiply(r.local).normalize();
  Quaternion.SlerpToRef(r.node.rotationQuaternion!, q, weight, r.node.rotationQuaternion!);
 }
 /** Called once after Babylon animates. No root motion, timers, contacts or game actions. */
 apply() {
  const frame = this.inst.root.getScene().getFrameId(); if (frame === this.lastFrame) return; this.lastFrame = frame;
  const w = this.weight; if (!this.supported || w < .001) return;
  // The playing authored blend owns cycle time, including time magic. Sample it
  // after Babylon animates so retained armed upper-body tracks stay in phase.
  const clipPhase = this.target ? this.clipPhase?.() : null;
  if (clipPhase != null) this.phase = ((clipPhase % 1) + 1) % 1;
  const u = this.phase, scale = this.height / .9, amp = clamp(this.lastPose.speed / 1.3, .15, 1), crouch = this.lastPose.crouch;
  const sway = bodySway(u, this.run, amp), pelvisLean = .06 + .05 * this.run + crouch * .28 + this.lean * .5;
  this.pose('pelvis', chain(axis(0,1,0,sway.pelvisTurn), axis(0,0,1,-sway.pelvisList + this.bank * .4), axis(1,0,0,pelvisLean)), w);
  const pelvis = this.rest.get('pelvis')!, offset = new Vector3(sway.x * scale, sway.y * scale - crouch * .30 * scale, 0);
  const localOffset = new Vector3(); offset.rotateByQuaternionToRef(Quaternion.Inverse(pelvis.parent), localOffset);
  Vector3.LerpToRef(pelvis.node.position, pelvis.pos.add(localOffset), w, pelvis.node.position);
  for (const [side, p] of [['l', u], ['r', (u + .5) % 1]] as const) {
   const leg = legPose(p, this.run, amp), hip = leg.hip + crouch * .79, knee = leg.knee + crouch * 1.42;
   this.pose(`thigh_${side}`, axis(1,0,0,-hip), w);
   this.pose(`calf_${side}`, axis(1,0,0,knee), w);
   this.pose(`foot_${side}`, axis(1,0,0,leg.foot - (pelvisLean - hip + knee)), w);
   this.pose(`ball_${side}`, axis(1,0,0,leg.ball), w);
   if (this.arms) {
    const arm = armSwing(p, this.run, amp), neutral = this.neutralArms.get(side), upper = this.rest.get(`upperarm_${side}`), lower = this.rest.get(`lowerarm_${side}`);
    if (neutral && upper && lower) {
     const q = Quaternion.Inverse(upper.parent).multiply(axis(1,0,0,-arm.shoulder)).multiply(upper.parent).multiply(neutral.upper).normalize();
     Quaternion.SlerpToRef(upper.node.rotationQuaternion!, q, w, upper.node.rotationQuaternion!);
     const bend = Quaternion.Inverse(neutral.parent).multiply(axis(1,0,0,-arm.elbow)).multiply(neutral.parent).multiply(lower.local).normalize();
     Quaternion.SlerpToRef(lower.node.rotationQuaternion!, bend, w, lower.node.rotationQuaternion!);
    }
   }
  }
  const torsoLean = .05 + .18 * this.run + this.lean * .5;
  for (const [name, share] of [['spine_01', .25], ['spine_02', .4], ['spine_03', .35]] as const)
   this.pose(name, chain(axis(0,1,0,sway.thoraxTurn * share), axis(0,0,1,sway.pelvisList * share + this.bank * share), axis(1,0,0,(torsoLean - pelvisLean * .35) * share)), w);
  this.pose('neck_01', axis(0,1,0,-(sway.pelvisTurn + sway.thoraxTurn) * .34), w);
  this.pose('head', chain(axis(0,1,0,-(sway.pelvisTurn + sway.thoraxTurn) * .51),axis(0,0,1,-this.bank * .7),axis(1,0,0,-(pelvisLean * .65 + torsoLean) * .85)), w);
  // Keep stance ankles at their authored rest height. This adjusts only the visual
  // pelvis, never the actor root/capsule. Flight keeps the authored run bob.
  const standing = ([['l',u],['r',(u+.5)%1]] as const).filter(([,p]) => this.contact(p));
  if (standing.length && crouch < .1) {
   const inv = this.inst.root.computeWorldMatrix(true).clone().invert(); let error = Infinity;
   for (const [side] of standing) { const foot = this.rest.get(`foot_${side}`)!.node; foot.computeWorldMatrix(true); error = Math.min(error, Vector3.TransformCoordinates(foot.getAbsolutePosition(), inv).y - this.floorAnkle); }
   this.lift += (clamp(-error, -.22 * scale, .22 * scale) - this.lift) * (1 - Math.exp(-this.dt * 26));
  } else this.lift *= Math.exp(-this.dt * 22);
  const lift = new Vector3(0, this.lift * w, 0), localLift = new Vector3(); lift.rotateByQuaternionToRef(Quaternion.Inverse(pelvis.parent), localLift);
  pelvis.node.position.addInPlace(localLift);
 }
 private contact(p: number) { return p < .60 * (1 - this.run) + .38 * this.run; }
 get contacts(): [boolean, boolean] | undefined { return this.weight > .5 ? [this.contact(this.phase), this.contact((this.phase + .5) % 1)] : undefined; }
 inspect() { return { supported: this.supported, weight: this.weight, phase: this.phase, run: this.run, arms: this.arms, speed: this.speed, lift: this.lift }; }
}
