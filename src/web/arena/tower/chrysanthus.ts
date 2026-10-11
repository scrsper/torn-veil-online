import { Color3, MeshBuilder, TransformNode, Vector3, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { ArenaAssets } from '../assets';
import type { ArenaHud } from '../hud';
import type { ArenaWorld, Fighter } from '../world';
import { ELEMENT_INFO } from '../magic';
import type { Element } from './capability';
import type { Handle } from '../vfx';

/**
 * Chrysanthus, god of the tower (Constitution §42: gods are entities; this is one of his manifestations).
 *
 * Floor 10 meets his avatar: he descends, speaks (he reads the climber: their class, kills, essences, gear, magic),
 * then puts them through a trial he cannot lose. He floats, never touching the ground; sword in one hand, an orb of
 * shifting element in the other, a staff strapped to his back that he draws after a minute.
 *   Phase 1: teleporting sword strikes (blockable), orb volleys of every element, soak-then-shock combinations,
 *            gravity wells, a time slow, and VERDICT: a golden mark, then an unblockable blow (dodge it).
 *   Phase 2: he draws the staff: starfall, stasis (the climber's time stops), and an unblockable sweep.
 * Damage barely touches him. The trial ends when he has seen enough (30 blows landed, or 90 seconds), or when the
 * climber would fall (he catches them). Then he grants a boon. At the summit (floor 100) the same god fights for real.
 */
export interface TrialContext {
  cls: string | null; tier: string; kills: number; essences: string[]; legendary: string | null; elements: string[]; achievements: number; fistsOnly: boolean; floor: number;
}
export interface TrialResult { blows: number; dodged: number; spared: boolean; seconds: number }
type Act = 'glide' | 'strike' | 'volley' | 'soakShock' | 'well' | 'verdict' | 'slow' | 'draw' | 'starfall' | 'stasis' | 'sweep';

const ORB_CYCLE: Element[] = ['flame', 'frost', 'storm', 'water', 'gravity', 'swift', 'shadow', 'iron', 'time'];

export class ChrysanthusTrial {
  f!: Fighter;
  phase: 'descend' | 'talk' | 'fight' | 'yield' | 'gone' = 'descend';
  t = 0; private actT = 0; private act: Act = 'glide'; private actCd = 1.6; private orbI = 0; private staff = false;
  blows = 0; dodged = 0; spared = false;
  private orb: AbstractMesh | null = null; private orbFx: Handle | null = null; private aura: Handle | null = null; private staffMesh: AbstractMesh | null = null;
  private pending: { at: number; run: () => void }[] = [];
  onDone: ((r: TrialResult) => void) | null = null;

  constructor(private readonly scene: Scene, private readonly world: ArenaWorld, private readonly hud: ArenaHud, private readonly assets: ArenaAssets, readonly trueForm = false) {}

  /** Bring the god into the room (descending from above the centre), or adopt an existing body (summit). */
  begin(at: Vector3, body?: Fighter): void {
    const w = this.world;
    this.f = body ?? w.spawnAt('chrysanthus', at.x, at.z);
    const f = this.f;
    f.god = true; f.godArmor = this.trueForm ? .35 : .025; f.boss = { name: this.trueForm ? 'Chrysanthus, God of the Tower' : 'Chrysanthus, Avatar of the Tower' };
    f.hover = this.trueForm ? 1 : 7; f.target = w.hero; f.state = 'idle';
    f.yaw = Math.atan2(w.hero.pos.x - f.pos.x, w.hero.pos.z - f.pos.z);
    f.anim.play('sword_and_shield/sword and shield idle', { loop: true, fade: 0 });
    // The orb in the off hand, a golden aura, the staff across his back.
    this.orb = MeshBuilder.CreateSphere('god-orb', { diameter: .26, segments: 16 }, this.scene); this.orb.parent = f.inst.slotL; this.orb.isPickable = false;
    this.orb.position.set(0, .06, .05); this.orb.scaling.setAll(1 / f.inst.root.scaling.x);
    this.setOrb('time');
    this.aura = w.vfx.aura('time', f.inst.chest ?? f.inst.root, { rate: 26, size: 1.6, radius: .5, height: 1.4 });
    const staffSrc = this.assets.sources.get('W_elderroot');
    const back = f.inst.bones?.get('spine_03');
    if (staffSrc && back) {
      const s = staffSrc.createInstance('god-staff'); s.parent = back; s.isPickable = false;
      s.position.set(0, .12, -.2); s.rotation.set(0, 0, Math.PI * .15); s.scaling.setAll(1.15);
      this.staffMesh = s;
    }
    w.customAI.set(f, (b, dt) => this.step(b, dt));
    w.vfx.burst('time', new Vector3(at.x, 6, at.z), 2.2);
    this.phase = this.trueForm ? 'fight' : 'descend';
  }

  private setOrb(e: Element): void {
    if (!this.orb) return;
    const c = Color3.FromHexString(ELEMENT_INFO[e].color);
    this.orb.material = this.world.vfx.mat(c.scale(1.4), 1);
    this.orbFx?.dispose(); this.orbFx = this.world.vfx.aura(e, this.orb, { rate: 70, size: 1.2, radius: .12 });
  }

  /** Spoken lines, read from the climber's actual run. */
  async converse(ctx: TrialContext): Promise<void> {
    const H = this.hud, who = 'CHRYSANTHUS';
    const what = ctx.cls ? `You come as a ${ctx.cls}` : 'You come without a name for what you are yet';
    const a = await H.dialogue(who, `So. Another climber reaches my tenth floor. ${what}, ${ctx.tier} by the measure of my halls, with ${ctx.kills} lives ended on the way. Look at me when I speak to you.`,
      ['Who are you?', 'Stand aside. I am climbing.', 'What is this tower?']);
    const reply = [
      'I am Chrysanthus. This tower is my body, and its floors are my memories. You have been walking through me since the cellar door.',
      'Bold. I like bold. Many have said that to my face. Fewer kept saying it.',
      'A question whose answer changes as you climb. For now: a sieve. You are the grain, and I am the shaking.',
    ][a];
    const notes: string[] = [];
    if (ctx.essences.length) notes.push(`You carry ${ctx.essences.join(' and ')} in your blood. You took that from something that did not want to give it.`);
    if (ctx.elements.length) notes.push(`You have begun to shape ${ctx.elements.slice(0, 3).join(', ')}. Crude. But it is a beginning, and beginnings are where I live.`);
    if (ctx.fistsOnly) notes.push('Bare hands, still. Either you are a fool or you are becoming something. I will find out which.');
    if (ctx.legendary) notes.push(`That ${ctx.legendary} remembers who made it. Use it well or it will choose someone else.`);
    if (ctx.achievements >= 8) notes.push('The tower has been talking about you. It does not talk about many.');
    if (!notes.length) notes.push('You carry nothing of note yet. Good. Empty vessels hold the most.');
    const b = await H.dialogue(who, `${reply} ${notes.slice(0, 2).join(' ')}`, ['Then let me pass.', 'Show me what a god can do.', '(Draw your weapon in silence.)']);
    await H.dialogue(who, [
      'Pass? No. Prove. Survive me for a little while, or make me bleed if you can, and I will give you something worth the climb.',
      'A small part of it. This body is a courtesy. Survive it and I will give you something worth the climb.',
      'Silence. Yes. That is the right answer. Come, then.',
    ][b], ['(Fight)']);
    this.phase = 'fight'; this.t = 0; this.actCd = 1;
    H.announce('THE TRIAL OF CHRYSANTHUS', 'Survive · land blows · dodge what you cannot block');
  }

  async farewell(): Promise<void> {
    const r = this.result();
    const lines = [
      r.spared ? 'You fell. I caught you. Remember that I did; I will not always.' : 'Enough.',
      r.blows ? `You landed ${r.blows} blows on a god. Most climbers die believing that cannot be done.` : 'Not one blow landed. And yet you are still standing, which is its own kind of answer.',
      r.dodged ? `You saw my verdict coming ${r.dodged} time${r.dodged > 1 ? 's' : ''}. Most never see it once.` : '',
      'Take this. Climb. I will be waiting at the top, all of me.',
    ].filter(Boolean).join(' ');
    await this.hud.dialogue('CHRYSANTHUS', lines, ['(Accept)']);
  }

  result(): TrialResult { return { blows: this.blows, dodged: this.dodged, spared: this.spared, seconds: Math.round(this.t) }; }

  /** A hero blow landed on him (the tower forwards its hit hook). */
  onHeroHit(t: Fighter): void { if (t === this.f && this.phase === 'fight') { this.blows++; if (this.blows % 5 === 0) this.world.ev_word(this.f.pos.add(new Vector3(0, 3.2, 0)), `${this.blows} BLOWS`, '#ffd76a'); } }

  /** The climber would have fallen: he catches them and ends the trial. */
  spare(): void { if (this.phase !== 'fight' || this.trueForm) return; this.spared = true; this.world.hero.hp = Math.max(1, this.world.hero.maxHp * .15); this.end(); }

  private end(): void {
    this.phase = 'yield'; this.pending = [];
    const w = this.world; w.hero.frozenT = 0; w.hero.timeT = 0;
    if (this.f.state === 'tell' || this.f.state === 'attack') this.f.state = 'idle';
    this.f.anim.play('sword_and_shield/sword and shield idle', { loop: true, fade: .3 });
    w.vfx.burst('time', this.f.pos.add(new Vector3(0, 2, 0)), 1.8);
    void this.farewell().then(() => { this.phase = 'gone'; this.onDone?.(this.result()); });
  }

  /** Leave: rise and vanish in light. */
  depart(): void {
    const f = this.f, w = this.world;
    this.pending.push({ at: this.t + 1.6, run: () => { w.vfx.burst('time', f.pos.add(new Vector3(0, f.hover + 1.2, 0)), 2.5); this.dispose(); } });
    this.phase = 'gone';
  }

  dispose(): void {
    const w = this.world; this.orbFx?.dispose(); this.aura?.dispose(); this.orb?.dispose(); this.staffMesh?.dispose();
    w.customAI.delete(this.f); w.removeBody(this.f);
  }

  // ------------------------------------------------------------------ frame
  private step(f: Fighter, dt: number): boolean | void {
    const w = this.world, h = w.hero;
    this.t += dt;
    for (const p of this.pending.filter(p => p.at <= this.t)) p.run();
    this.pending = this.pending.filter(p => p.at > this.t);
    // Floating: a slow bob, a little higher when he glides.
    const hoverWant = this.phase === 'descend' ? 1 : this.phase === 'gone' ? 9 : this.trueForm ? 1.1 : 1;
    f.hover += (hoverWant - f.hover) * Math.min(1, dt * (this.phase === 'descend' ? 1.2 : this.phase === 'gone' ? .9 : 4));
    f.inst.root.position.y = f.y + f.hover + Math.sin(this.t * 1.7) * .12;
    if (this.phase === 'descend') { f.yaw = Math.atan2(h.pos.x - f.pos.x, h.pos.z - f.pos.z); if (f.hover < 1.25) this.phase = 'talk'; return true; }
    if (this.phase !== 'fight') { f.yaw = Math.atan2(h.pos.x - f.pos.x, h.pos.z - f.pos.z); return true; }
    if (!this.trueForm && (this.blows >= 30 || this.t > 90)) { this.end(); return true; }
    if (!h.alive) return true;
    // Melee wind-ups and blows run through the normal foe attack (telegraph, hit, parry).
    if (f.state === 'tell' || f.state === 'attack') return false;
    if (f.state === 'hit') f.state = 'idle';
    this.actT += dt; this.actCd -= dt;
    const toH = h.pos.subtract(f.pos); toH.y = 0; const dist = toH.length(), dir = dist > 1e-3 ? toH.scale(1 / dist) : new Vector3(0, 0, 1);
    f.yaw = Math.atan2(dir.x, dir.z);
    // Glide: hold a ring around the climber, drifting sideways; quick, never walking.
    if (this.act === 'glide') {
      const want = this.staff ? 6.5 : 5;
      const side = new Vector3(dir.z, 0, -dir.x).scale(Math.sin(this.t * .7) > 0 ? 1 : -1);
      const mv = dir.scale(dist > want + .8 ? 1 : dist < want - 1 ? -1 : 0).add(side.scale(.55));
      f.pos.addInPlace(mv.scale((this.trueForm ? 7 : 6) * dt));
      if (f.anim.current !== 'sword_and_shield/sword and shield idle') f.anim.play('sword_and_shield/sword and shield idle', { loop: true, fade: .25 });
      if (this.actCd <= 0) this.choose(dist);
    }
    return true;
  }

  private choose(dist: number): void {
    const p2 = this.staff, t = this.t;
    if (!p2 && t > 60) { this.drawStaff(); return; }
    const pool: Act[] = p2 ? ['strike', 'starfall', 'stasis', 'sweep', 'volley', 'verdict', 'soakShock'] : ['strike', 'strike', 'volley', 'soakShock', 'well', 'verdict', ...(t > 25 ? ['slow' as Act] : [])];
    let a = pool[Math.floor(Math.random() * pool.length)];
    if (dist < 3 && Math.random() < .5) a = p2 ? 'sweep' : 'strike';
    this.run(a);
  }

  private run(a: Act): void {
    const w = this.world, f = this.f, h = w.hero, vfx = w.vfx;
    this.act = a; this.actT = 0;
    const back = (cd: number) => { this.pending.push({ at: this.t + cd, run: () => { this.act = 'glide'; this.actCd = (this.staff ? .8 : 1.2) + Math.random() * .8; } }); };
    const cast = (clip = 'sword_and_shield/sword and shield casting (2)') => f.anim.play(clip, { speed: 1.5, fade: .1, restart: true });
    const chest = () => f.pos.add(new Vector3(0, f.hover + 1.4, 0));
    const blink = (to: Vector3) => { vfx.burst('time', chest(), 1); f.pos.copyFrom(to); vfx.burst('time', chest(), 1.2); w.sound('whoosh'); };
    switch (a) {
      case 'strike': {   // teleport beside/behind and cut (blockable)
        const side = Math.random() < .5 ? 1 : -1, d = h.pos.subtract(f.pos).normalize();
        blink(h.pos.add(new Vector3(-d.z * side, 0, d.x * side).scale(2.1)).add(d.scale(.6)));
        f.target = h; w.foeStrike(f, Math.floor(Math.random() * 2), this.staff ? .4 : .55);
        back(1.4); break;
      }
      case 'volley': {   // three orbs of one element
        const e = ORB_CYCLE[this.orbI++ % ORB_CYCLE.length]; this.setOrb(e); cast();
        for (let k = 0; k < 3; k++) this.pending.push({ at: this.t + .35 + k * .22, run: () => {
          const from = chest(), to = h.pos.add(new Vector3((Math.random() - .5) * 2, 1.1, (Math.random() - .5) * 2)), dir = to.subtract(from); dir.y *= .2;
          w.launch(f, e, from, dir.normalize(), 1, 45, 22);
        } });
        back(1.4); break;
      }
      case 'soakShock': {   // a wave of water, then lightning from above: he plays the reactions too
        this.setOrb('water'); cast();
        this.pending.push({ at: this.t + .4, run: () => { const c = h.pos.clone(); vfx.burst('water', c.add(new Vector3(0, .8, 0)), 2); vfx.ring('water', new Vector3(c.x, .06, c.z), 3, .8); if (Math.hypot(h.pos.x - c.x, h.pos.z - c.z) < 3) { h.wetT = 6; w.ev_word(h.pos.add(new Vector3(0, 2.3, 0)), 'SOAKED', ELEMENT_INFO.water.color); } } });
        this.pending.push({ at: this.t + .9, run: () => { this.setOrb('storm'); const c = h.pos.clone(); vfx.marker(c, 2.4, .9, new Color3(.7, .6, 1));
          this.pending.push({ at: this.t + .9, run: () => { vfx.bolt(c.add(new Vector3(0, 12, 0)), c.add(new Vector3(0, .3, 0)), new Color3(.85, .8, 1), .12); vfx.burst('storm', c.add(new Vector3(0, .6, 0)), 1.8);
            if (Math.hypot(h.pos.x - c.x, h.pos.z - c.z) < 2.4) { const wet = h.wetT > 0; w.hitUnblockable(h, wet ? 120 : 60, new Vector3(0, 0, 0), 2, f); if (wet) { h.wetT = 0; h.shockT = .8; w.ev_word(h.pos.add(new Vector3(0, 2.6, 0)), 'ELECTROCUTED', ELEMENT_INFO.storm.color); } } } });
        } });
        back(2.4); break;
      }
      case 'well': {   // a gravity well under the climber
        this.setOrb('gravity'); cast();
        this.pending.push({ at: this.t + .4, run: () => w.fields.push({ x: h.pos.x, z: h.pos.z, r: 4, t: 4, p: 1.2, e: 'gravity', tick: .3, owner: f, fx: vfx.field('gravity', h.pos, 4) }) });
        back(1.2); break;
      }
      case 'verdict': {   // a golden mark, then an unblockable blow: dodge
        const c = h.pos.clone(); vfx.marker(c, 2.6, 1.15, new Color3(1, .55, .12));
        w.ev_word(c.add(new Vector3(0, 2.6, 0)), 'UNBLOCKABLE', '#ff8c2e'); f.anim.play('sword_and_shield/sword and shield casting (2)', { speed: 1.1, fade: .1, restart: true });
        this.pending.push({ at: this.t + 1.1, run: () => {
          blink(c.add(new Vector3(0, 0, -.6)));
          f.anim.play('sword_and_shield/sword and shield slash', { speed: 2.2, fade: .05, restart: true });
          vfx.burst('time', c.add(new Vector3(0, .5, 0)), 2.2); vfx.ring('flame', new Vector3(c.x, .06, c.z), 3, .5); w.shake(.6);
          if (Math.hypot(h.pos.x - c.x, h.pos.z - c.z) < 2.6) { if (!w.hitUnblockable(h, 150, h.pos.subtract(c).normalize(), 9, f)) this.dodged++; } else this.dodged++;
        } });
        back(2); break;
      }
      case 'slow': {   // the climber's time slows
        this.setOrb('time'); cast();
        this.pending.push({ at: this.t + .35, run: () => { h.timeT = 2.6; vfx.clockRing(h.pos.add(new Vector3(0, .1, 0)), 2.2, 1.2); w.ev_word(h.pos.add(new Vector3(0, 2.3, 0)), 'TIME SLOWS', ELEMENT_INFO.time.color); } });
        this.pending.push({ at: this.t + .9, run: () => { this.act = 'glide'; this.run('strike'); } });
        break;
      }
      case 'starfall': {   // the staff calls stars down around the climber
        cast('great_sword/spell cast');
        for (let k = 0; k < 6; k++) {
          const c = h.pos.add(new Vector3((Math.random() - .5) * 8, 0, (Math.random() - .5) * 8)); if (k === 0) c.copyFrom(h.pos);
          this.pending.push({ at: this.t + .2 + k * .18, run: () => vfx.marker(c, 1.8, .9) });
          this.pending.push({ at: this.t + 1.1 + k * .18, run: () => { vfx.bolt(c.add(new Vector3(2, 14, 1)), c, new Color3(1, .8, .4), .1); vfx.burst('flame', c.add(new Vector3(0, .4, 0)), 1.5); vfx.burst('time', c.add(new Vector3(0, .4, 0)), .8); w.shake(.3);
            if (Math.hypot(h.pos.x - c.x, h.pos.z - c.z) < 1.8) w.hitUnblockable(h, 70, h.pos.subtract(c).normalize(), 5, f); } });
        }
        back(2.4); break;
      }
      case 'stasis': {   // time stops for the climber; he walks up and cuts
        cast('great_sword/spell cast'); vfx.clockRing(h.pos.add(new Vector3(0, .1, 0)), 3, 1.4);
        this.pending.push({ at: this.t + .45, run: () => { h.frozenT = 1.2; w.ev_word(h.pos.add(new Vector3(0, 2.4, 0)), 'TIME STOPS', ELEMENT_INFO.time.color); } });
        this.pending.push({ at: this.t + 1.3, run: () => { this.act = 'glide'; this.run('strike'); } });
        break;
      }
      case 'sweep': {   // an unblockable staff sweep around him: get out of the ring
        const c = f.pos.clone(); vfx.marker(c, 4.2, .85, new Color3(1, .5, .1)); f.anim.play('great_sword/great sword casting', { speed: 1.4, fade: .1, restart: true });
        this.pending.push({ at: this.t + .9, run: () => { vfx.burst('time', c.add(new Vector3(0, 1, 0)), 2.5); vfx.ring('time', new Vector3(c.x, .1, c.z), 4.2, .5); w.shake(.5);
          if (Math.hypot(h.pos.x - c.x, h.pos.z - c.z) < 4.2) { if (!w.hitUnblockable(h, 110, h.pos.subtract(c).normalize(), 12, f)) this.dodged++; } else this.dodged++; } });
        back(1.6); break;
      }
    }
  }

  /** One minute in: the staff comes off his back. */
  private drawStaff(): void {
    const w = this.world, f = this.f;
    this.act = 'draw'; this.staff = true;
    this.hud.announce('CHRYSANTHUS DRAWS HIS STAFF', 'The trial deepens');
    f.anim.play('great_sword/great sword casting', { speed: 1, fade: .2, restart: true });
    w.vfx.burst('time', f.pos.add(new Vector3(0, f.hover + 1.6, 0)), 2.6);
    this.pending.push({ at: this.t + .7, run: () => {
      // The sword goes to his back; the staff comes to his hand.
      const sword = f.extra[0], back = f.inst.bones?.get('spine_03');
      if (this.staffMesh) { this.staffMesh.parent = f.inst.slotR; this.staffMesh.position.set(0, 0, 0); this.staffMesh.rotation.set(0, 0, 0); this.staffMesh.scaling.setAll(1.15); }
      if (sword && back) { sword.parent = back as unknown as TransformNode; sword.position.set(0, .12, -.22); sword.rotation.set(0, 0, -Math.PI * .15); }
      this.setOrb('time');
    } });
    this.pending.push({ at: this.t + 1.6, run: () => { this.act = 'glide'; this.actCd = .5; } });
  }
}
