import { Quaternion, Vector3 } from '@babylonjs/core';
import type { ActorState } from './actorManager';
import { CharacterRig, Q } from './characterRig';

/**
 * Procedural animation for the wildlife quadrupeds, driven by what the projection says the animal is
 * doing (activity, defence state, speed): idle with breathing and ear flicks, walk / trot / gallop with the
 * matching footfall order, grazing, eating, drinking, resting, sleeping, fleeing, and the boar's warning
 * scrape, charge, strike and recovery. Rotations are character-space deltas from rest (see CharacterRig);
 * model space is +Y up, +Z forward, +X the animal's left.
 */
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a || 1), 0, 1); return t * t * (3 - 2 * t); };
const chain = Q.chain;
const fwd = (a: number) => Q.x(-a);
const pitchDown = (a: number) => Q.x(a); // pitch a forward-pointing segment down
const turn = (a: number) => Q.y(a);
const roll = (a: number) => Q.z(a);

const LEGS = ['fl', 'fr', 'bl', 'br'] as const;
type Leg = typeof LEGS[number];
const PHASE_WALK: Record<Leg, number> = { fl: 0, br: 0.25, fr: 0.5, bl: 0.75 };
const PHASE_TROT: Record<Leg, number> = { fl: 0, br: 0, fr: 0.5, bl: 0.5 };
const PHASE_GALLOP: Record<Leg, number> = { fl: 0, fr: 0.06, bl: 0.5, br: 0.56 };

export class QuadrupedAnimator {
  private t = Math.random() * 20;
  private phase = 0;
  private moveW = 0;
  private lieW = 0; private deadW = 0;
  private headDown = 0; private chew = 0;
  private earFlick = 0; private nextFlick = 1 + Math.random() * 3;
  private lookYaw = 0; private nextLook = 2 + Math.random() * 4; private lookTarget = 0;
  private scrape = 0;
  private lastYaw = 0; private yawRate = 0;
  private tailSwing = 0;
  private readonly S: number;
  private readonly k: { walk: number; trot: number; gallop: number };
  private prevDefense: string | null = null; private defT = 0;
  private readonly cur = new Map<string, Quaternion>();
  constructor(private readonly rig: CharacterRig, private readonly species: string, scale: number) {
    this.S = scale;
    this.k = species === 'field_hare' ? { walk: 0.7, trot: 1.6, gallop: 3.0 } : species === 'woodland_boar' ? { walk: 1.3, trot: 3.2, gallop: 5.0 } : { walk: 1.4, trot: 3.6, gallop: 6.0 };
  }

  update(dt: number, s: ActorState): void {
    dt = Math.min(dt, 0.1); this.t += dt;
    const w = s.wildlife; if (!w) return;
    const rig = this.rig, S = this.S, k = (r: number) => 1 - Math.exp(-r * dt);
    const speed = Math.hypot(s.velocity.x, s.velocity.z), act = w.activity, dead = act === 'dead' || w.dead, defense = w.defense;
    const moving = speed > 0.12 && !dead && act !== 'sleep' && act !== 'rest';
    this.moveW += ((moving ? 1 : 0) - this.moveW) * k(9);
    this.lieW += (((act === 'rest' || act === 'sleep') ? 1 : 0) - this.lieW) * k(2.4);
    this.deadW += ((dead ? 1 : 0) - this.deadW) * k(dead ? 3.5 : 20);
    this.yawRate += (Math.atan2(Math.sin(s.yaw - this.lastYaw), Math.cos(s.yaw - this.lastYaw)) / Math.max(dt, 1e-3) - this.yawRate) * k(8); this.lastYaw = s.yaw;
    const gait = speed < this.k.walk + 0.4 ? 'walk' : speed < this.k.gallop * 0.75 ? 'trot' : 'gallop';
    const stride = (gait === 'walk' ? 0.85 : gait === 'trot' ? 1.5 : 2.6) * S;
    if (moving) this.phase = (this.phase + (speed / stride) * dt) % 1;
    const P = gait === 'walk' ? PHASE_WALK : gait === 'trot' ? PHASE_TROT : PHASE_GALLOP;
    const amp = gait === 'walk' ? 0.42 : gait === 'trot' ? 0.6 : 0.95, lift = gait === 'walk' ? 0.65 : gait === 'trot' ? 0.95 : 1.25;
    const mw = this.moveW * (1 - this.lieW);
    const set = (bone: string, q: Quaternion) => { if (!rig.has(bone)) return; let c = this.cur.get(bone); if (!c) { c = q.clone(); this.cur.set(bone, c); } Quaternion.SlerpToRef(c, q, 1 - Math.exp(-28 * dt), c); rig.setBone(bone, c); };

    const front = (leg: 'fl' | 'fr') => {
      const ph = (this.phase + P[leg]) % 1, sw = Math.sin(ph * TAU) * amp * mw, fl = Math.max(0, Math.cos(ph * TAU)) * lift * mw;
      let drink = 0, graze = this.headDown;
      if (act === 'drink') drink = 0.18; if (leg === 'fl' && (act === 'forage' || act === 'eat') && this.scrape > 0) drink = 0;
      set(`${leg}_upper`, fwd(sw * 0.9 + graze * 0.10 + drink * (leg === 'fl' ? 1 : -0.6)));
      set(`${leg}_lower`, Q.x(fl * 1.15 + 0.06 + this.lieW * 2.5 + (defense === 'warn' && leg === 'fl' ? -0.6 * Math.max(0, Math.sin(this.t * 7)) : 0)));
      set(`${leg}_paw`, Q.x(-fl * 0.5 + this.lieW * 0.4 - (leg === 'fl' && defense === 'warn' ? 0.5 * Math.max(0, Math.sin(this.t * 7)) : 0)));
      set(`${leg}_scapula`, fwd(sw * 0.15));
    };
    const back = (leg: 'bl' | 'br') => {
      const ph = (this.phase + P[leg]) % 1, sw = Math.sin(ph * TAU) * amp * 0.9 * mw, fl = Math.max(0, Math.cos(ph * TAU)) * lift * mw;
      set(`${leg}_thigh`, fwd(sw + this.lieW * 1.0));
      set(`${leg}_lower`, Q.x(-(fl * 0.9) - 0.08 - this.lieW * 2.0));
      set(`${leg}_cannon`, Q.x(fl * 1.1 + 0.06 + this.lieW * 2.2));
      set(`${leg}_paw`, Q.x(-fl * 0.5));
    };
    front('fl'); front('fr'); back('bl'); back('br');

    // Spine and body: bob, flex, gallop bound, lying and dying.
    const bound = gait === 'gallop' ? Math.sin(this.phase * TAU) * 0.10 * mw : 0;
    const breath = Math.sin(this.t * 1.9) * 0.012 * (1 - mw);
    const charge = defense === 'charge' ? 1 : 0, strike = defense === 'strike' ? 1 : 0, warn = defense === 'warn' ? 1 : 0;
    const bodyLean = charge * 0.14 + warn * 0.06;
    set('pelvis', chain(pitchDown(-bound * 0.6 + bodyLean * 0.5), roll(Math.sin(this.phase * TAU) * 0.03 * mw)));
    set('spine_01', chain(pitchDown(bound * 0.7 + breath), turn(Math.sin(this.phase * TAU * (gait === 'gallop' ? 1 : 1)) * 0.07 * mw * (gait === 'gallop' ? 0.2 : 1))));
    set('spine_02', chain(pitchDown(bound * 0.5 + bodyLean * 0.5), turn(-Math.sin(this.phase * TAU) * 0.05 * mw)));
    const bobY = (Math.abs(Math.sin(this.phase * TAU * (gait === 'walk' ? 1 : 2))) * 0.02 * S * mw) - this.lieW * 0.42 * S;
    rig.offsetBone('root', new Vector3(0, bobY, 0));

    // Head, neck: graze/drink/look/charge/strike/flee.
    const grazing = act === 'forage' || act === 'eat', drinking = act === 'drink';
    const targetDown = drinking ? 1.0 : grazing ? 0.82 : warn ? 0.6 : charge ? 0.7 : 0;
    this.headDown += (targetDown * (grazing ? (0.85 + 0.15 * Math.sin(this.t * 0.4)) : 1) - this.headDown) * k(4);
    if (grazing && Math.sin(this.t * 0.35) > 0.85) this.headDown *= 0.3;         // lift the head now and then to look around
    this.nextLook -= dt; if (this.nextLook <= 0) { this.lookTarget = (Math.random() - 0.5) * 1.2; this.nextLook = 2.5 + Math.random() * 4; }
    this.lookYaw += (this.lookTarget * (1 - mw) - this.lookYaw) * k(2.4);
    const hd = this.headDown, upStrike = strike * -0.6 + this.defT * 0;
    const alert = act === 'flee' ? 1 : moving ? 0.5 : 0.25;
    set('neck_01', chain(pitchDown(hd * 0.5 + (species(this) === 'field_hare' ? 0.1 : -0.12 * (1 - hd)) + upStrike + bound * 0.4), turn(this.lookYaw * 0.4 + strike * 0.5 * Math.sin(this.t * 14))));
    set('neck_02', chain(pitchDown(hd * 0.45 + 0.06 * alert + upStrike * 0.5), turn(this.lookYaw * 0.4)));
    set('head', chain(pitchDown(hd * 0.25 - 0.08 * (1 - hd) + (charge ? 0.1 : 0)), turn(this.lookYaw * 0.3), roll(this.lookYaw * -0.1)));
    this.chew += dt * (act === 'eat' ? 9 : grazing ? 4.5 : 0);
    set('jaw', pitchDown(Math.max(0, Math.sin(this.chew)) * 0.22 * (grazing ? 1 : 0)));

    this.nextFlick -= dt; if (this.nextFlick <= 0) { this.earFlick = 1; this.nextFlick = 1.5 + Math.random() * 4; }
    this.earFlick *= Math.exp(-6 * dt);
    const back_ = act === 'flee' || charge ? 0.9 : warn ? 0.4 : 0;
    for (const sd of ['l', 'r'] as const) {
      const sg = sd === 'l' ? 1 : -1, fl = (sd === 'l' ? this.earFlick : this.earFlick * 0.3);
      set(`ear_${sd}_01`, chain(roll(sg * (0.15 + fl * 0.5 + back_ * 0.4)), pitchDown(back_ * 0.9 + Math.sin(this.t * 0.7 + sg) * 0.03)));
      set(`ear_${sd}_02`, chain(roll(sg * fl * 0.3), pitchDown(back_ * 0.4)));
    }
    this.tailSwing += ((moving ? 0.3 : 0.1) - this.tailSwing) * k(2);
    const up = act === 'flee' || warn ? 0.9 : 0;
    for (let i = 1; i <= 3; i++) set(`tail_0${i}`, chain(pitchDown(-up * 0.4 + Math.sin(this.t * 3 + i) * 0.06), roll(Math.sin(this.t * (moving ? 6 : 1.4) + i * 0.8) * this.tailSwing)));

    // Lying and death rotate the whole model.
    const m = rig.model, yaw = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
    if (this.deadW > 0.01) {
      const side = (this.species === 'roe_deer' ? 1 : -1);
      m.rotationQuaternion = Quaternion.Slerp(yaw, yaw.multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), side * Math.PI / 2 * 0.98)), this.deadW);
      m.position.y = 0.30 * S * this.deadW; m.position.x = -0.05 * S * this.deadW * side;
    } else { m.rotationQuaternion = yaw; m.position.set(0, 0, 0); }
    void turn; void lerp; void sstep;
  }
}
const species = (a: QuadrupedAnimator) => (a as unknown as { species: string }).species;
