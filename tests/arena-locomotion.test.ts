import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, TransformNode, Animation, AnimationGroup, Quaternion, Vector3, FreeCamera } from '@babylonjs/core';
import { Animator } from '../src/web/arena/anim';
import { FootPlant } from '../src/web/arena/footPlant';
import type { CharacterInstance } from '../src/web/arena/assets';

// Deterministic animation clock: every render advances animations by a constant positive 16 ms.
const scene = () => { const s = new Scene(new NullEngine()); s.useConstantAnimationDeltaTime = true; new FreeCamera('c', new Vector3(0, 1, -5), s); return s; };
const step = (s: Scene) => s.render();
const ang = (q: Quaternion, r: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(q, r))));

describe('Animator.loco keeps the rendered pose', () => {
  it('does not stamp a retired, zero-weight gait over the blended pose (the walk-under-a-running-body bug)', () => {
    const s = scene(), bone = new TransformNode('thigh', s); bone.rotationQuaternion = Quaternion.Identity();
    const walkQ = Quaternion.RotationAxis(Vector3.Right(), 1.2), runQ = Quaternion.RotationAxis(Vector3.Right(), -.6);
    const clip = (name: string, q: Quaternion) => {
      const a = new Animation(`${name}.thigh`, 'rotationQuaternion', 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
      a.setKeys([{ frame: 0, value: q.clone() }, { frame: 30, value: q.clone() }]);
      const g = new AnimationGroup(name, s); g.addTargetedAnimation(a, bone); g.normalize(0, 30); return g;
    };
    const anim = new Animator(new Map([['walk', clip('walk', walkQ)], ['run', clip('run', runQ)]]));
    // Full run: the walk fades out and is retired by update().
    for (let i = 0; i < 60; i++) { anim.loco('walk', 'run', 1, 1); anim.update(1 / 60); step(s); }
    expect(Math.abs(Quaternion.Dot(bone.rotationQuaternion!, runQ))).toBeGreaterThan(.9999);
    // The game calls loco again in onBeforeRender, AFTER Babylon animated: the bone must still show the run.
    anim.loco('walk', 'run', 1, 1); anim.update(1 / 60);
    expect(Math.abs(Quaternion.Dot(bone.rotationQuaternion!, runQ))).toBeGreaterThan(.9999);
    s.dispose();
  });
  it('re-enters a retired gait at its blend weight, even when the rate is set in the same frame', () => {
    const s = scene(), bone = new TransformNode('thigh', s); bone.rotationQuaternion = Quaternion.Identity();
    const walkQ = Quaternion.RotationAxis(Vector3.Right(), 1.2), runQ = Quaternion.RotationAxis(Vector3.Right(), -.6);
    const mk = (name: string, q: Quaternion) => { const a = new Animation(name, 'rotationQuaternion', 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE); a.setKeys([{ frame: 0, value: q.clone() }, { frame: 30, value: q.clone() }]); const g = new AnimationGroup(name, s); g.addTargetedAnimation(a, bone); g.normalize(0, 30); return g; };
    const anim = new Animator(new Map([['walk', mk('walk', walkQ)], ['run', mk('run', runQ)]]));
    for (let i = 0; i < 60; i++) { anim.loco('walk', 'run', 1, 1); anim.update(1 / 60); step(s); }
    // Slow down: the retired walk re-enters with a weighted seek in onBeforeRender, then update() (rate) runs in the same
    // frame. Babylon's speedRatio setter replays a pending seek unweighted when the rate changes, so this frame must still
    // show the run.
    // The game's gait rate follows ground speed, so it changes on this frame too (1 -> 1.3 cycles/s).
    anim.loco('walk', 'run', 0, 1.3); anim.update(1 / 60);
    expect(Math.abs(Quaternion.Dot(bone.rotationQuaternion!, runQ))).toBeGreaterThan(.9999);
    // Then the walk fades in over 0.25 s: every rendered frame moves only as far as the fade allows (a full-weight
    // stamp would jump the whole 1.8 rad at once), and it ends on the walk.
    let prev = bone.rotationQuaternion!.clone(), maxStep = 0;
    for (let i = 0; i < 40; i++) {
      step(s); maxStep = Math.max(maxStep, ang(prev, bone.rotationQuaternion!)); prev = bone.rotationQuaternion!.clone();
      anim.loco('walk', 'run', 0, 1); anim.update(1 / 60); maxStep = Math.max(maxStep, ang(prev, bone.rotationQuaternion!));
    }
    expect(maxStep).toBeLessThan(.4);
    expect(Math.abs(Quaternion.Dot(bone.rotationQuaternion!, walkQ))).toBeGreaterThan(.999);
    s.dispose();
  });
});

/** A two-bone leg pair under a root: thigh (hip) -> calf (knee) -> foot (ankle), standing 0.95 m tall. */
function legs(s: Scene) {
  const root = new TransformNode('root', s), pelvis = new TransformNode('pelvis', s); pelvis.parent = root; pelvis.position.y = .95; pelvis.rotationQuaternion = Quaternion.Identity();
  const bones = new Map<string, TransformNode>();
  for (const [side, x] of [['l', .12], ['r', -.12]] as const) {
    const thigh = new TransformNode('thigh_' + side, s), calf = new TransformNode('calf_' + side, s), foot = new TransformNode('foot_' + side, s);
    thigh.parent = pelvis; thigh.position.set(x, 0, 0); calf.parent = thigh; calf.position.set(0, -.44, .02); foot.parent = calf; foot.position.set(0, -.42, -.02);
    for (const n of [thigh, calf, foot]) { n.rotationQuaternion = Quaternion.Identity(); bones.set(n.name, n); }
  }
  bones.set('pelvis', pelvis);
  const rest = new Map([...bones].map(([k, n]) => [k, n.rotationQuaternion!.clone()]));
  const inst = { root, bones, meshes: [], dispose() {} } as unknown as CharacterInstance;
  // Each frame the "animation" restores the leg pose before the solver runs (as Babylon does).
  const animate = () => { for (const [k, q] of rest) bones.get(k)!.rotationQuaternion!.copyFrom(q); root.computeWorldMatrix(true); for (const n of bones.values()) n.computeWorldMatrix(true); };
  const feet = () => ['l', 'r'].map(sd => { const f = bones.get('foot_' + sd)!; f.computeWorldMatrix(true); return f.getAbsolutePosition().clone(); });
  return { root, inst, animate, feet };
}

describe('FootPlant transitions', () => {
  it('turning in place on planted feet steps the feet over, one at a time, with no per-frame jump', () => {
    const s = scene(), L = legs(s), plant = new FootPlant(L.inst); let prev: Vector3[] | null = null, maxJump = 0, both = 0;
    // 2.4 rad turn at 3 rad/s (the guard turn that used to teleport the locks every 0.6 rad), 120 fps.
    for (let i = 0; i < 160; i++) {
      const yaw = Math.min(2.4, i * 3 / 120); L.root.rotation.y = yaw; L.animate();
      plant.update(1 / 120, 0, yaw, true, [true, true]);
      const f = L.feet(); if (prev) maxJump = Math.max(maxJump, ...f.map((p, k) => Vector3.Distance(p, prev![k])));
      prev = f;
      const modes = (plant as unknown as { feet: { mode: string }[] }).feet.map(x => x.mode); if (modes[0] === 'step' && modes[1] === 'step') both++;
    }
    expect(both).toBe(0);
    expect(maxJump).toBeLessThan(.05);   // the old re-plant jumped ~0.2-0.3 m in one frame for this rig
    // Settled: both feet end back under the turned body.
    const end = L.feet(); L.animate(); const anim = L.feet();
    for (const k of [0, 1]) expect(Math.hypot(end[k].x - anim[k].x, end[k].z - anim[k].z)).toBeLessThan(.25);
    s.dispose();
  });
  it('lifting a foot or switching the solver off (dodge) eases the pin back instead of snapping', () => {
    const s = scene(), L = legs(s), plant = new FootPlant(L.inst); let prev: Vector3[] | null = null, maxJump = 0;
    // Plant, then walk the body 0.3 m away over the foot (pin stretches the leg), then release both ways.
    for (let i = 0; i < 40; i++) { L.root.position.z = Math.min(.3, i * .01); L.animate(); plant.update(1 / 120, 0, 0, true, [true, true]); }
    for (let i = 0; i < 60; i++) {
      L.animate(); plant.update(1 / 120, 0, 0, i < 30, [false, i >= 30 ? true : false]);
      const f = L.feet(); if (prev) maxJump = Math.max(maxJump, ...f.map((p, k) => Vector3.Distance(p, prev![k]))); prev = f;
    }
    expect(maxJump).toBeLessThan(.06);
    s.dispose();
  });
});

describe('Animator leg layers', () => {
  const leftQ = Quaternion.RotationAxis(Vector3.Up(), .8), rightQ = Quaternion.RotationAxis(Vector3.Up(), -.8);
  const setup = () => {
    const s = scene(), bone = new TransformNode('thigh', s); bone.rotationQuaternion = Quaternion.Identity();
    const mk = (name: string, q: Quaternion) => { const a = new Animation(name, 'rotationQuaternion', 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE); a.setKeys([{ frame: 0, value: q.clone() }, { frame: 30, value: q.clone() }]); const g = new AnimationGroup(name, s); g.addTargetedAnimation(a, bone); g.normalize(0, 30); return g; };
    const groups = new Map([['idle', mk('idle', Quaternion.Identity())], ['legs:left', mk('legs:left', leftQ)], ['legs:right', mk('legs:right', rightQ)]]);
    const anim = new Animator(groups); anim.play('idle', { loop: true, fade: 0 });
    // As the game runs it: Babylon animates (render), then the layer blends the legs on top.
    let prev = bone.rotationQuaternion!.clone(), maxStep = 0;
    const tick = (n: number, name: string | null) => { for (let i = 0; i < n; i++) { anim.legLayer(name); anim.update(1 / 60); step(s); anim.applyLegs(); maxStep = Math.max(maxStep, ang(prev, bone.rotationQuaternion!)); prev = bone.rotationQuaternion!.clone(); } };
    const near = (q: Quaternion) => Math.abs(Quaternion.Dot(bone.rotationQuaternion!, q));
    return { s, groups, anim, tick, near, maxStep: () => maxStep };
  };
  it('a full layer drives the legs outright (Babylon clamps group weights to 1, so a weighted group could only average 50/50)', () => {
    const { s, tick, near } = setup();
    tick(40, 'left');
    expect(near(leftQ)).toBeGreaterThan(.9999);
    s.dispose();
  });
  it('left -> right -> exit is continuous, ends on the main pose and leaves no leg group playing or layered', () => {
    const { s, groups, anim, tick, near, maxStep } = setup();
    tick(40, 'left'); tick(40, 'right');
    expect(near(rightQ)).toBeGreaterThan(.9999);
    tick(40, null);
    expect(near(Quaternion.Identity())).toBeGreaterThan(.9999);
    expect(anim.legLayered).toBe(false);
    for (const n of ['legs:left', 'legs:right']) expect(!!groups.get(n)!.isPlaying).toBe(false);
    // 1.6 rad left-to-right swing over the fades: no single frame jumps (a snap would be the whole 1.6 rad).
    expect(maxStep()).toBeLessThan(.25);
    s.dispose();
  });
  it('a layer that returns while still fading resumes from its weight instead of restarting at zero', () => {
    const { s, anim, tick } = setup();
    tick(40, 'left'); tick(3, 'right');
    const out = (anim as unknown as { legsOut: { name: string; w: number }[] }).legsOut.find(o => o.name === 'left')!;
    const fading = out.w; expect(fading).toBeGreaterThan(0); expect(fading).toBeLessThan(1);
    tick(1, 'left');
    expect((anim as unknown as { legs: { name: string; w: number } }).legs.w).toBeGreaterThanOrEqual(fading);
    s.dispose();
  });
});
