import { Quaternion, Vector3, type TransformNode } from '@babylonjs/core';

/**
 * Secondary motion for coat tails and hair: each chain of unanimated bones (coat_fl_1..3, hair_1..2)
 * is simulated as verlet particles at the bone tips, pulled back toward the animated pose, dragged by
 * inertia and gravity, kept at bone length, and pushed out of leg/hip capsules so tails swing around
 * the body instead of through it. Runs after animation each frame; presentation only.
 */
interface Link { node: TransformNode; rest: Quaternion; tipLocal: Vector3; len: number; p: Vector3; prev: Vector3 }
interface Chain { links: Link[]; stiffness: number; drag: number; gravity: number }
interface Capsule { a: TransformNode; b: TransformNode; r: number }

const tmpQ = new Quaternion();
const fromTo = (a: Vector3, b: Vector3, out: Quaternion): Quaternion => {
  const u = a.normalizeToNew(), v = b.normalizeToNew(), d = Vector3.Dot(u, v);
  if (d > .99999) return out.copyFromFloats(0, 0, 0, 1);
  const ax = Vector3.Cross(u, v); if (ax.lengthSquared() < 1e-12) return out.copyFromFloats(0, 0, 0, 1);
  return Quaternion.RotationAxisToRef(ax.normalize(), Math.acos(Math.max(-1, Math.min(1, d))), out);
};

export class SpringBones {
  private chains: Chain[] = [];
  private colliders: Capsule[] = [];
  private fresh = true;
  private accumulator = 0;
  private static readonly STEP = 1 / 120;

  constructor(nodes: Map<string, TransformNode>, private readonly scale: number) {
    const chain = (prefix: string, n: number, stiffness: number, drag: number, gravity: number) => {
      const bones = Array.from({ length: n }, (_, i) => nodes.get(`${prefix}_${i + 1}`)).filter((b): b is TransformNode => !!b);
      if (bones.length !== n) return;
      const links: Link[] = bones.map((node, i) => {
        node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
        // Bones point along local +Y (Blender export); the last tip reuses the previous bone length.
        const child = bones[i + 1], prevLen = i > 0 ? bones[i].position.length() : .15;
        const tipLocal = child ? child.position.clone() : new Vector3(0, Math.max(.05, prevLen), 0);
        return { node, rest: node.rotationQuaternion.clone(), tipLocal, len: 0, p: new Vector3(), prev: new Vector3() };
      });
      this.chains.push({ links, stiffness, drag, gravity });
    };
    for (const k of ['fl', 'fr', 'bl', 'br']) chain(`coat_${k}`, 3, 10, 3, 9);
    chain('hair', 2, 14, 3, 4);
    const cap = (a: string, b: string, r: number) => { const na = nodes.get(a), nb = nodes.get(b); if (na && nb) this.colliders.push({ a: na, b: nb, r: r * scale }); };
    cap('thigh_l', 'calf_l', .085); cap('thigh_r', 'calf_r', .085); cap('calf_l', 'foot_l', .06); cap('calf_r', 'foot_r', .06);
    cap('pelvis', 'spine_01', .14); cap('spine_02', 'neck_01', .15);
  }

  get active(): boolean { return this.chains.length > 0; }
  /** Snap particles to the animated pose (after spawning or teleporting). */
  reset(): void { this.fresh = true; this.accumulator = 0; }

  update(dt: number): void {
    if (!this.chains.length || dt <= 0) return;
    // Verlet velocity is stored as a displacement, so integrating once with a
    // variable frame delta makes the result depend on render rate. Accumulate
    // bounded fixed steps instead; the animated pose is sampled by each step.
    this.accumulator = Math.min(0.25, this.accumulator + Math.min(dt, 0.25));
    let steps = 0;
    while (this.accumulator >= SpringBones.STEP && steps < 8) {
      this.step(SpringBones.STEP);
      this.accumulator -= SpringBones.STEP;
      steps++;
    }
    // A paused tab or a hitch must not create a burst of stale spring motion.
    if (steps === 8 && this.accumulator >= SpringBones.STEP) this.accumulator = 0;
  }

  private step(h: number): void {
    for (const c of this.chains) {
      const pull = 1 - Math.exp(-c.stiffness * h), keep = Math.exp(-c.drag * h);
      for (const l of c.links) {
        // Start from the animated (rest) local pose, then bend toward the simulated tip.
        l.node.rotationQuaternion!.copyFrom(l.rest);
        const parent = l.node.parent as TransformNode;
        parent.computeWorldMatrix(true); l.node.computeWorldMatrix(true);
        const head = l.node.getAbsolutePosition().clone();
        const target = Vector3.TransformCoordinates(l.tipLocal, l.node.getWorldMatrix());
        l.len = Vector3.Distance(head, target);
        // Large target jumps are teleports/respawns rather than physical
        // motion. Snap both Verlet points so the chain cannot explode across
        // the scene before the next fixed step.
        const teleported = !this.fresh && Vector3.Distance(l.p, target) > Math.max(.35 * this.scale, l.len * 4);
        if (this.fresh || teleported) { l.p.copyFrom(target); l.prev.copyFrom(target); }
        else {
          const v = l.p.subtract(l.prev).scaleInPlace(keep);
          l.prev.copyFrom(l.p);
          l.p.addInPlace(v); l.p.y -= c.gravity * this.scale * h * h;
          l.p.addInPlace(target.subtract(l.p).scaleInPlace(pull));
        }
        for (const col of this.colliders) this.push(l.p, col);
        const dir = l.p.subtract(head); const d = dir.length();
        if (d > 1e-6) l.p.copyFrom(head.add(dir.scaleInPlace(l.len / d)));
        // Rotate the bone in world space so its tip points at the particle.
        fromTo(target.subtract(head), l.p.subtract(head), tmpQ);
        const pw = parent.absoluteRotationQuaternion;
        const world = tmpQ.multiply(l.node.absoluteRotationQuaternion);
        l.node.rotationQuaternion = Quaternion.Inverse(pw).multiply(world).normalize();
        l.node.computeWorldMatrix(true);
      }
    }
    this.fresh = false;
  }

  private push(p: Vector3, c: Capsule): void {
    const a = c.a.getAbsolutePosition(), b = c.b.getAbsolutePosition();
    const ab = b.subtract(a), t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / Math.max(1e-6, ab.lengthSquared())));
    const q = a.add(ab.scale(t)), d = p.subtract(q), len = d.length();
    if (len < c.r && len > 1e-6) p.copyFrom(q.add(d.scaleInPlace(c.r / len)));
  }
}
