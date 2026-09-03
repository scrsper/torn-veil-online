import type { Person, Body, Vec3, Goal, GoalType, Action, Percept, WorldEvent, EntityId, KnowledgeItem, Creature, Place, Anchor, ConflictIntent } from '../core/types';
import { World } from '../core/world';
import { getRel, adjustRel, disposition, isClose, isFamily, relOrNull } from './relationships';
import { remember } from './memory';
import { learn, eventClaim, describeClaim, isCrime, crimeSeverity, locationKnowledge } from './knowledge';
import { currentScheduleEntry } from './schedule';
import { SECONDS_PER_HOUR } from '../core/time';
import { B } from '../physical/blocks';
import { makeItem } from '../world/factory';
import { banditResourcePressure } from './economy';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const dist2 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * The Simulation runs minds and bodies at their own cadences:
 *  - bodies move every physical step (continuous)
 *  - perception samples the world at ~5Hz per mind
 *  - deliberate thinking happens per mind when its subjective think-budget fills (timeRate-scaled),
 *    or immediately when something alarming is perceived
 *  - strategic upkeep (needs, moods, weather) runs once per world minute
 */
export class Simulation {
  perceptionAccum = 0; strategicAccum = 0; onSpeech: ((p: Person, text: string) => void) | null = null; onHit: ((b: Body, pos: Vec3) => void) | null = null;
  constructor(public world: World) {}

  // ------------------------------------------------------------------ main step
  step(physDt: number, worldDt: number): void {
    const w = this.world;
    // 1. perception (stimuli + surroundings) at 5Hz
    this.perceptionAccum += physDt;
    const doPerceive = this.perceptionAccum >= 0.2;
    if (doPerceive) this.perceptionAccum = 0;
    const stimuli = doPerceive ? w.pendingStimuli.splice(0) : [];
    for (const p of w.persons()) {
      if (!p.alive || p.controlled) { if (p.controlled && doPerceive) this.perceive(p, stimuli); continue; }
      const body = w.primaryBody(p.id); if (!body) continue;
      if (doPerceive) this.perceive(p, stimuli);
      // 2. subjective cognition budget
      p.mind.thinkBudget += physDt * p.timeRate;
      const urgent = p.mind.alarm > 0.5;
      if (urgent || p.mind.thinkBudget >= p.mind.thinkInterval) { p.mind.thinkBudget = 0; this.think(p, body); p.mind.alarm = 0; }
      // 3. act on the current plan (continuous)
      this.act(p, body, physDt, worldDt);
      if (p.speech && p.speech.until < w.physicalTime) p.speech = null;
    }
    for (const c of w.creatures()) this.creatureStep(c, physDt);
    // 4. body physics for all non-player bodies
    for (const b of w.bodies()) { const owner = w.get(b.ownerId) as Person | undefined; if (owner?.controlled) continue; this.bodyPhysics(b, physDt); }
    // 5. strategic upkeep once per world minute
    this.strategicAccum += worldDt;
    if (this.strategicAccum >= 60) { const minutes = Math.floor(this.strategicAccum / 60); this.strategicAccum -= minutes * 60; this.strategic(minutes); }
  }

  // ------------------------------------------------------------------ perception
  private perceive(p: Person, stimuli: WorldEvent[]): void {
    const w = this.world; const body = w.primaryBody(p.id); if (!body) return;
    const eye = { x: body.pos.x, y: body.pos.y + 1.5, z: body.pos.z };
    const asleep = body.pose === 'sleep';
    const facing = { x: -Math.sin(body.yaw), z: -Math.cos(body.yaw) };
    const percepts: Percept[] = [];
    const seeRange = asleep ? 0 : (w.weather.kind === 'fog' ? 14 : 28) * (this.lightAt() * 0.5 + 0.5);
    for (const other of w.bodies()) {
      if (other.id === body.id || !other.present) continue;
      const d = Math.hypot(other.pos.x - eye.x, other.pos.z - eye.z); if (d > 30) continue;
      let how: 'saw' | 'heard' | null = null;
      if (d <= seeRange) {
        const dx = (other.pos.x - eye.x) / (d + 1e-5), dz = (other.pos.z - eye.z) / (d + 1e-5); const dot = dx * facing.x + dz * facing.z;
        if (d < 2.5 || dot > -0.1) { if (w.grid.lineOfSight(eye, { x: other.pos.x, y: other.pos.y + 1.2, z: other.pos.z }, 32)) how = 'saw'; }
      }
      if (!how && !asleep && d < 6 && Math.hypot(other.vel.x, other.vel.z) > 1) how = 'heard';
      if (how) { percepts.push({ entityId: other.ownerId, bodyId: other.id, how, tick: w.now, pos: { ...other.pos }, distance: d }); if (how === 'saw' && !p.controlled) locationKnowledge(w, p, other.ownerId, other.pos, { type: 'witnessed' }); }
    }
    p.mind.percepts = percepts;
    // stimuli: events with visibility/loudness
    for (const e of stimuli) {
      if (!e.pos || e.actor === p.id && e.type !== 'told') { if (e.actor === p.id) continue; }
      if (!e.pos) continue;
      const d = Math.hypot(e.pos.x - eye.x, e.pos.z - eye.z);
      let how: 'saw' | 'heard' | null = null;
      if (!asleep && e.visibility && d <= Math.min(e.visibility, seeRange + 4)) { const dx = (e.pos.x - eye.x) / (d + 1e-5), dz = (e.pos.z - eye.z) / (d + 1e-5); const dot = dx * facing.x + dz * facing.z; if ((d < 3 || dot > -0.2) && w.grid.lineOfSight(eye, { x: e.pos.x, y: e.pos.y + 1, z: e.pos.z }, 40)) how = 'saw'; }
      if (!how && e.loudness && d <= e.loudness * (asleep ? 0.35 : 1)) { how = 'heard'; }
      if (!how) continue;
      if (e.target === p.id && e.type !== 'told') how = 'saw';
      this.onPerceived(p, body, e, how);
    }
  }
  lightAt(): number { const h = this.world.clock.hourF; return h > 6 && h < 19 ? 1 : (h > 5 && h <= 6) || (h >= 19 && h < 20) ? 0.6 : 0.3; }

  /** A mind registers an event: perception → knowledge → memory → feelings → (maybe) urgent rethink. */
  private onPerceived(p: Person, body: Body, e: WorldEvent, how: 'saw' | 'heard'): void {
    const w = this.world;
    if (e.perceivedBy.some(x => x.who === p.id)) return;
    e.perceivedBy.push({ who: p.id, how, tick: w.now });
    if (e.type === 'told') { if (e.target !== p.id) return; return; } // handled directly in tell()
    const saw = how === 'saw';
    const claim = eventClaim(w, e, saw);
    const claimSummary = describeClaim(w, { kind: 'event', claim } as KnowledgeItem);
    const perc = w.emit('perceived', { actor: p.id, target: saw ? claim.actor : undefined, causes: [e.id], significance: e.significance * 0.5, data: { how, eventType: e.type, eventId: e.id, actorKnown: !!claim.actor }, summary: `${p.name} ${how} ${claimSummary}` });
    const k = learn(w, p, { key: `ev:${e.id}`, kind: 'event', claim, confidence: saw ? 1 : 0.6, source: { type: saw ? 'witnessed' : 'heard', viaEvent: perc.id }, cause: perc.id, summary: claimSummary });
    const isVictim = claim.target === p.id;
    const victimClose = claim.target ? isClose(p, claim.target) : false;
    const sig = e.significance * (isVictim ? 1.4 : victimClose ? 1.2 : 1) * (saw ? 1 : 0.7);
    const valence = isCrime(e.type, e.data?.intent) ? -0.8 : e.type === 'gift' || e.type === 'returned_item' || e.type === 'heal' ? 0.6 : 0;
    remember(w, p, { type: e.type, summary: saw ? `I saw: ${claimSummary}` : `I heard: ${claimSummary}`, eventId: e.id, entities: [claim.actor, claim.target, claim.item].filter(Boolean) as string[], significance: clamp(sig), valence, source: { type: saw ? 'witnessed' : 'heard', viaEvent: perc.id }, placeId: claim.placeId });
    if (p.controlled) return;
    this.reactTo(p, body, e, perc.id, saw, isVictim, victimClose, k);
  }

  private reactTo(p: Person, body: Body, e: WorldEvent, cause: string, saw: boolean, isVictim: boolean, victimClose: boolean, k: KnowledgeItem | null): void {
    const w = this.world; const claim = k?.claim ?? eventClaim(w, e, saw); const actor = claim.actor as EntityId | undefined;
    if (isCrime(claim.type, claim.intent) && actor !== p.id) {
      const sev = crimeSeverity(claim.type); const actorP = w.person(actor);
      const victimDisp = claim.target ? disposition(p, claim.target) : 0;
      // fear rises with severity, proximity and low courage; grudge with closeness to the victim
      const fear = sev * (1.2 - p.traits.courage) * (isVictim ? 1.5 : 1) * (saw ? 1 : 0.6);
      const grudge = sev * (isVictim ? 1.2 : victimClose ? 1 : 0.35 + Math.max(0, victimDisp) * 0.6);
      if (actor) adjustRel(w, p, actor, { fear: fear * 0.7, trust: -sev * (isVictim ? 0.9 : 0.6), affection: -sev * (isVictim ? 0.7 : 0.4), grudge: grudge * 0.6, respect: -sev * 0.3 }, `${saw ? 'witnessed' : 'learned of'} ${claim.type}${isVictim ? ' on me' : claim.target ? ` on ${w.nameOf(claim.target)}` : ''}`, cause);
      if (actor && actorP && !actorP.hostile && claim.type !== 'theft') { for (const q of w.persons()) if (q !== p && q.id !== actor && isFamily(p, q.id)) {/* family shares outrage later through telling */} }
      const emo = p.emotions; const before = { ...emo };
      emo.fear = clamp(emo.fear + fear * 0.6); emo.stress = clamp(emo.stress + sev * 0.5); emo.anger = clamp(emo.anger + grudge * 0.5 * (p.traits.aggression + 0.3));
      if (Math.abs(emo.fear - before.fear) + Math.abs(emo.anger - before.anger) > 0.1) w.emit('emotion_changed', { actor: p.id, causes: [cause], significance: 0.25, data: { fear: emo.fear, anger: emo.anger, stress: emo.stress }, summary: `${p.name} feels ${emo.fear > emo.anger ? `afraid (fear ${emo.fear.toFixed(2)})` : `angry (anger ${emo.anger.toFixed(2)})`}` });
      p.mind.alarm = 1; p.mind.attention = actor ?? null;
      const line = this.reactionLine(p, claim.type, actorP, claim.target, isVictim, victimClose);
      if (line) this.say(p, line);
    } else if (e.type === 'gift' || e.type === 'returned_item' || e.type === 'apology' || e.type === 'debt_paid') {
      if (actor) adjustRel(w, p, actor, { trust: 0.1 * (isVictim ? 3 : 1), affection: 0.1 * (isVictim ? 3 : 1), respect: 0.05 }, `saw ${e.type}`, cause);
      if (isVictim) p.emotions.joy = clamp(p.emotions.joy + 0.3);
    } else if (e.type === 'death') { p.emotions.sadness = clamp(p.emotions.sadness + (victimClose ? 0.7 : 0.2)); p.mind.alarm = 0.6; }
    void k;
  }
  private reactionLine(p: Person, type: string, actor: Person | undefined, target: EntityId | undefined, isVictim: boolean, victimClose: boolean): string {
    const w = this.world; const an = actor?.name ?? 'someone'; const vn = target ? w.nameOf(target) : 'someone';
    if (type === 'theft') { if (isVictim) return `Thief! That's mine!`; return p.traits.honesty > 0.5 ? `${an}, that's not yours!` : `Hm. Not my business.`; }
    if (isVictim) return p.traits.courage > 0.6 ? `You'll regret that!` : `Help! Help me!`;
    if (victimClose) return p.traits.courage > 0.6 ? `Get away from ${vn.split(' ')[0]}!` : `${vn.split(' ')[0]}! No!`;
    return p.traits.courage > 0.7 ? `Hey! Stop that!` : p.traits.sociability > 0.5 ? `Guards! Somebody get the guards!` : `...`;
  }

  // ------------------------------------------------------------------ decision
  private think(p: Person, body: Body): void {
    const w = this.world; const m = p.mind; const now = w.now; const hour = w.clock.hourF;
    const cands: Goal[] = [];
    const G = (type: GoalType, utility: number, reasons: string[], o: Partial<Goal> = {}) => { const key = `${type}:${o.targetEntity ?? o.targetPlace ?? ''}`; cands.push({ type, utility, reasons, createdAt: now, key, ...o }); };
    const pos = body.pos; const sched = currentScheduleEntry(p, hour);
    const downed = body.pose === 'downed';
    if (downed) { const g: Goal = { type: 'idle', utility: 1, reasons: ['incapacitated'], createdAt: now, key: 'idle:downed' }; this.setGoal(p, g, [{ type: 'wait', duration: 30, status: 'pending' }], 'incapacitated'); return; }
    // ---- threat assessment from perception + relationships
    let threat: { id: EntityId; d: number; fear: number; body: Body } | null = null;
    for (const pc of m.percepts) {
      const other = w.person(pc.entityId); if (!other || !other.alive) continue; const ob = w.body(pc.bodyId)!; if (ob.dead) continue;
      // A downed body is already incapacitated (Constitution §11: 'subdue'/'arrest' must be a
      // real terminal outcome, not merely non-lethal-and-repeatable). Without this, a subdued
      // target kept registering as an active threat every think() tick, so the subduer (or
      // anyone else nearby) would immediately re-attack them — resetting their downed timer
      // forward on every hit and producing an endless attack/arrest loop between the same two
      // actors instead of the fight actually ending. See docs/V0_2_WORLD_ENGINE.md.
      if (ob.pose === 'downed') continue;
      const r = relOrNull(p, other.id); const hostileFaction = other.hostile !== p.hostile;
      const fear = (r?.fear ?? 0) + (hostileFaction ? 0.5 : 0) + (r && r.grudge > 0.5 ? 0.1 : 0);
      const attackingMe = ob.pose === 'attack' && dist2(ob.pos, pos) < 3;
      const knownCriminal = (p.occupation === 'guard' || p.occupation === 'captain') && !other.hostile && this.knownCrimesBy(p, other.id).length > 0;
      if (fear > 0.25 || attackingMe || (hostileFaction && pc.distance < 14) || knownCriminal) { const f = fear + (attackingMe ? 0.8 : 0); if (!threat || f / (pc.distance + 1) > threat.fear / (threat.d + 1)) threat = { id: other.id, d: pc.distance, fear: f, body: ob }; }
    }
    const isGuard = p.occupation === 'guard' || p.occupation === 'captain';
    const brave = p.traits.courage + p.traits.aggression * 0.5 + (isGuard ? 0.5 : 0) + (p.hostile ? 0.4 : 0);
    if (threat) {
      const t = w.person(threat.id)!; const r = getRel(p, threat.id);
      const armed = this.weaponOf(p) > 0; const healthy = body.health / body.maxHealth;
      const fightU = clamp(0.3 + brave * 0.5 + (armed ? 0.15 : -0.15) + healthy * 0.2 - threat.fear * 0.3 + r.grudge * 0.4 + (t.hostile !== p.hostile ? 0.25 : 0) - (isGuard ? 0 : 0.2));
      const fleeU = clamp(0.35 + threat.fear * 0.8 - brave * 0.4 - (armed ? 0.1 : 0) + (1 - healthy) * 0.3 - threat.d * 0.01);
      const crimeKnown = this.knownCrimesBy(p, threat.id);
      if (isGuard && crimeKnown.length && !t.hostile) G('confront', clamp(0.8 + crimeSeverity(crimeKnown[0].claim.type) * 0.2), [`${t.name} is known to have committed ${crimeKnown[0].claim.type}`, `source: ${crimeKnown[0].source.type}${crimeKnown[0].source.from ? ' by ' + w.nameOf(crimeKnown[0].source.from) : ''}`], { targetEntity: t.id, data: { crime: crimeKnown[0].key } });
      else if (t.hostile !== p.hostile && (isGuard || p.hostile) ) {
        // Constitution §11: hostile faction membership is never itself lethal intent.
        // A guard apprehends; a bandit wants resources from an ordinary victim and only
        // treats an armed defender of the law as a real, non-automatically-fatal fight.
        const intent: ConflictIntent = isGuard ? 'subdue' : (t.occupation === 'guard' || t.occupation === 'captain') ? 'injure' : 'rob';
        // Constitution §12/§39: robbery utility rises with the bandit faction's own resource
        // pressure, not merely because the target exists — a real causal loop rather than a
        // hardcoded "bandits attack" activity.
        const pressure = intent === 'rob' ? banditResourcePressure(w, p) : 0;
        G('attack', clamp(fightU + 0.2 + pressure * 0.3), [`${t.name} is an enemy`, `courage ${p.traits.courage.toFixed(2)}`, `intent: ${intent}`, pressure ? `resource pressure ${pressure.toFixed(2)}` : ''], { targetEntity: t.id, data: { intent } });
      }
      else if (threat.body.pose === 'attack' || r.fear > 0.35 || t.hostile) {
        if (fightU > fleeU && (armed || brave > 0.9)) G('attack', fightU, [`${t.name} is a threat (fear ${threat.fear.toFixed(2)})`, `I am ${armed ? 'armed' : 'unarmed'}, courage ${p.traits.courage.toFixed(2)}`, 'intent: defend'], { targetEntity: t.id, data: { intent: 'defend' as ConflictIntent } });
        else G('flee', fleeU, [`${t.name} is a threat (fear ${threat.fear.toFixed(2)}, dist ${threat.d.toFixed(1)})`, `courage ${p.traits.courage.toFixed(2)}${armed ? '' : ', unarmed'}`], { targetEntity: t.id });
      }
    }
    // ---- knowledge-driven goals: report crimes, investigate, recover items
    const crimes = Object.values(p.knowledge).filter(k => k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && !k.handled && now - k.learnedAt < 86400 * 3);
    for (const k of crimes) {
      const sev = crimeSeverity(k.claim.type); const victimClose = k.claim.target ? isClose(p, k.claim.target) : false; const victimIsMe = k.claim.target === p.id;
      const actorIsMe = k.claim.actor === p.id; if (actorIsMe) continue;
      const actorP = w.person(k.claim.actor);
      if (actorP?.hostile && k.claim.type !== 'kill' && !isGuard) continue; // bandit crimes are old news
      if (isGuard) {
        if (!m.investigated.includes(k.key) && k.claim.pos) G('investigate', clamp(0.55 + sev * 0.4 + (k.hops === 0 ? 0.1 : 0)), [`I know of a ${k.claim.type} (${k.source.type}${k.source.from ? ' by ' + w.nameOf(k.source.from) : ''}, confidence ${k.confidence.toFixed(2)})`, 'my duty is to investigate'], { targetPos: k.claim.pos, targetPlace: k.claim.placeId, data: { key: k.key, suspect: k.claim.actor }, causeEvent: k.source.viaEvent });
      } else if (!p.hostile) {
        const guards = w.persons().filter(g => (g.occupation === 'guard' || g.occupation === 'captain') && g.alive && !k.sharedWith.includes(g.id));
        const already = w.persons().some(g => (g.occupation === 'guard' || g.occupation === 'captain') && k.sharedWith.includes(g.id));
        if (guards.length && !already && p.occupation !== 'child' || (p.occupation === 'child' && guards.length && !already && victimClose)) {
          const g = this.nearestKnownGuard(p, pos, guards);
          if (g) G('report', clamp(0.45 + sev * 0.5 + p.traits.honesty * 0.2 + (victimClose ? 0.15 : 0) + (victimIsMe ? 0.1 : 0) - (threat ? 0.15 : 0)), [`I know ${describeClaim(w, k)} (${k.source.type})`, `the watch should hear of it`, `honesty ${p.traits.honesty.toFixed(2)}`], { targetEntity: g.id, data: { key: k.key } });
        }
      }
    }
    // help injured close ones
    for (const pc of m.percepts) { const o = w.person(pc.entityId); const ob = w.body(pc.bodyId); if (!o || !ob || !o.alive) continue; if ((ob.pose === 'downed' || ob.health < ob.maxHealth * 0.5) && isClose(p, o.id) && !threat) G('help', 0.7, [`${o.name} is hurt and dear to me`], { targetEntity: o.id }); }
    // desires
    for (const d of p.desires) if (!d.fulfilled && d.type === 'recover_item') { const loc = p.knowledge[`loc:${d.targetId}`]; const it = w.item(d.targetId); if (loc && it && !it.holderId && it.pos && !threat) G('recover_item', 0.6, [`I know where ${it.name} is (${loc.source.type})`], { targetEntity: it.id, targetPos: it.pos }); }
    // ---- needs
    const n = p.needs; const night = hour >= 22 || hour < 5;
    G('sleep', clamp(n.energy * 0.9 + (sched?.activity === 'sleep' ? 0.35 : 0) + (night ? 0.15 : -0.1)), [`energy need ${n.energy.toFixed(2)}`, sched?.activity === 'sleep' ? 'it is my time to sleep' : ''], { targetPlace: p.homeId ?? undefined });
    let ateRecently = false;
    for (let i = w.events.length - 1; i >= 0; i--) {
      const event = w.events[i]; if (now - event.tick >= 45 * 60) break;
      if (event.type === 'meal' && event.actor === p.id) { ateRecently = true; break; }
    }
    const mealTime = sched?.activity === 'eat' && !ateRecently;
    const satiatedPenalty = ateRecently && n.hunger < 0.2 ? 0.35 : 0;
    G('eat', clamp(n.hunger * 0.9 + (mealTime ? 0.3 : -0.1) - satiatedPenalty), [`hunger ${n.hunger.toFixed(2)}`, mealTime ? 'meal time' : ateRecently ? 'recently ate' : ''], { targetPlace: (sched?.activity === 'eat' && sched.placeId) ? sched.placeId : (p.homeId ?? undefined) });
    // ---- schedule
    if (sched && !['sleep', 'eat'].includes(sched.activity)) {
      const rainingNow = w.weather.kind === 'rain' || w.weather.kind === 'storm';
      const outdoorTask = !sched.placeId || !(w.place(sched.placeId)?.indoor);
      const rainPenalty = rainingNow && outdoorTask && !isGuard && !p.hostile ? 0.2 + w.weather.intensity * 0.15 : 0;
      const base = 0.45 + (sched.activity === 'work' ? 0.1 : 0) + (sched.activity === 'patrol' || sched.activity === 'guard_post' ? 0.15 : 0) - rainPenalty;
      G(sched.activity, clamp(base + (p.traits.loyalty - 0.5) * 0.1), [`schedule: ${sched.label} (${sched.start}:00–${sched.end}:00)`, rainPenalty ? 'but it is raining out there' : ''], { targetPlace: sched.placeId, data: { label: sched.label } });
    }
    // rain shelter (and keep sheltering while it rains)
    const raining = w.weather.kind === 'rain' || w.weather.kind === 'storm';
    if (raining && (!w.isIndoors(pos) || m.goal?.type === 'shelter') && !isGuard && !p.hostile) G('shelter', clamp(0.5 + w.weather.intensity * 0.3 - p.traits.courage * 0.15), [`it is ${w.weather.kind}ing and I am outside`], { targetPlace: dist2(pos, w.place(p.homeId!)?.inside ?? pos) < dist2(pos, w.place(this.tavernId())?.inside ?? pos) ? p.homeId ?? undefined : this.tavernId() });
    // socialising when the need is high
    G('socialize', clamp(n.social * 0.7 * (0.5 + p.traits.sociability * 0.8) - (night ? 0.3 : 0)), [`social need ${n.social.toFixed(2)}`, `sociability ${p.traits.sociability.toFixed(2)}`], { targetPlace: hour > 16 ? this.tavernId() : this.squareId() });
    // mourning
    if (p.emotions.sadness > 0.4 && hour >= 17 && hour < 20 && p.homeId) { const gy = w.places().find(pl => pl.type === 'graveyard'); if (gy) G('mourn', clamp(0.4 + p.emotions.sadness * 0.4), [`sadness ${p.emotions.sadness.toFixed(2)}`, 'the graveyard, at evening'], { targetPlace: gy.id }); }
    // worship for the pious at service times
    if (p.traits.piety > 0.55 && ((hour >= 7 && hour < 8) || (hour >= 18 && hour < 19)) && p.occupation !== 'priest' && p.occupation !== 'acolyte' && !isGuard) G('worship', clamp(0.35 + p.traits.piety * 0.35), [`piety ${p.traits.piety.toFixed(2)}`, 'service is being held'], { targetPlace: this.chapelId() });
    G('idle', 0.1, ['nothing better to do']);
    // ---- choose with hysteresis
    cands.sort((a, b) => b.utility - a.utility);
    const best = cands[0]; const cur = m.goal;
    let chosen = best; let switched = false; let note = '';
    if (cur && cur.key !== best.key) {
      const curCand = cands.find(c => c.key === cur.key); const curU = curCand?.utility ?? 0;
      const done = m.plan.length === 0 || m.plan.every(a => a.status === 'done' || a.status === 'failed');
      if (!done && best.utility < curU + 0.12 && !(best.type === 'flee' || best.type === 'attack' || best.type === 'confront')) { chosen = { ...cur, utility: curU }; note = `kept ${cur.type} (hysteresis)`; }
      else { switched = true; note = `switched from ${cur.type} to ${best.type}`; }
    } else if (!cur) { switched = true; note = `adopted ${best.type}`; }
    else { chosen = cur; note = `continuing ${cur.type}`; }
    m.decision = { tick: now, candidates: cands.slice(0, 8).map(c => ({ type: c.type, key: c.key, utility: c.utility, reasons: c.reasons.filter(Boolean) })), chosen: chosen.key, switched, note };
    if (switched) { this.setGoal(p, chosen, this.plan(p, body, chosen), note); }
    else if (m.plan.length === 0 || m.plan.every(a => a.status === 'done' || a.status === 'failed')) { m.plan = this.plan(p, body, chosen); }
  }
  private setGoal(p: Person, g: Goal, plan: Action[], note: string): void {
    const w = this.world; const prev = p.mind.goal; p.mind.goal = g; p.mind.plan = plan;
    const causes: string[] = []; if (g.causeEvent) causes.push(g.causeEvent);
    // link to the most recent knowledge/relationship change that motivated it
    if (g.type === 'flee' || g.type === 'attack' || g.type === 'confront' || g.type === 'report' || g.type === 'investigate' || g.type === 'help') {
      const recent = [...w.events].reverse().find(e => e.actor === p.id && (e.type === 'knowledge_gained' || e.type === 'relationship_changed' || e.type === 'perceived') && w.now - e.tick < 600);
      if (recent && !causes.includes(recent.id)) causes.push(recent.id);
    }
    const target = g.targetEntity ? ` → ${w.nameOf(g.targetEntity)}` : g.targetPlace ? ` @ ${w.nameOf(g.targetPlace)}` : '';
    w.emit('goal_changed', { actor: p.id, target: g.targetEntity, placeId: g.targetPlace, causes, significance: g.type === 'flee' || g.type === 'attack' || g.type === 'report' || g.type === 'investigate' || g.type === 'confront' ? 0.45 : 0.12, data: { from: prev?.type, to: g.type, utility: g.utility, reasons: g.reasons }, summary: `${p.name}: goal ${prev ? prev.type + ' → ' : ''}${g.type}${target} (u=${g.utility.toFixed(2)})` });
  }
  private knownCrimesBy(p: Person, actor: EntityId): KnowledgeItem[] { return Object.values(p.knowledge).filter(k => k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && k.claim.actor === actor && !k.handled).sort((a, b) => crimeSeverity(b.claim.type) - crimeSeverity(a.claim.type)); }
  private nearestKnownGuard(p: Person, pos: Vec3, guards: Person[]): Person | null {
    const w = this.world; let best: Person | null = null; let bd = Infinity;
    for (const g of guards) { const loc = p.knowledge[`loc:${g.id}`]?.claim.pos ?? w.place(g.workId)?.inside ?? w.primaryBody(g.id)?.pos; if (!loc) continue; const d = dist2(pos, loc); if (d < bd) { bd = d; best = g; } }
    return best;
  }
  tavernId(): string { return this.world.places().find(p => p.type === 'tavern')!.id; }
  squareId(): string { return this.world.places().find(p => p.type === 'square')!.id; }
  chapelId(): string { return this.world.places().find(p => p.type === 'chapel')!.id; }
  weaponOf(p: Person): number { let best = 0; for (const id of p.inventory) { const it = this.world.item(id); if (it && it.damage > best) best = it.damage; } return best; }

  // ------------------------------------------------------------------ planning
  private plan(p: Person, body: Body, g: Goal): Action[] {
    const w = this.world; const A = (a: Partial<Action> & { type: Action['type'] }): Action => ({ status: 'pending', ...a });
    const place = w.place(g.targetPlace);
    const anchorIn = (pl: Place | undefined, kinds: Anchor['kind'][], ownedOnly = false): Vec3 | null => {
      if (!pl) return null;
      for (const k of kinds) { const list = pl.anchors.filter(a => a.kind === k && (!ownedOnly || a.ownerId === p.id)); if (list.length) { const free = list.filter(a => !this.anchorTaken(a.pos, body.id)); const pick = (free.length ? free : list)[Math.floor(w.rng.next() * (free.length ? free : list).length)]; return pick.pos; } }
      return null;
    };
    switch (g.type) {
      case 'sleep': { const home = w.place(p.homeId); const bed = anchorIn(home, ['bed'], true) ?? anchorIn(home, ['bed']) ?? home?.inside ?? body.pos; return [A({ type: 'goto', pos: bed, placeId: home?.id }), A({ type: 'sleep', pos: bed, duration: 3 * SECONDS_PER_HOUR })]; }
      case 'eat': { const pl = place ?? w.place(p.homeId); const seat = anchorIn(pl, ['seat']) ?? anchorIn(pl, ['fire', 'inside']) ?? pl?.inside ?? body.pos; return [A({ type: 'goto', pos: seat, placeId: pl?.id }), A({ type: 'eat', pos: seat, duration: 25 * 60 })]; }
      case 'work': { const pl = place; const spot = anchorIn(pl, ['work']) ?? pl?.inside ?? body.pos; return [A({ type: 'goto', pos: spot, placeId: pl?.id }), A({ type: 'work', pos: spot, duration: 40 * 60 + w.rng.next() * 30 * 60, placeId: pl?.id })]; }
      case 'worship': { const pl = place ?? w.place(this.chapelId()); const spot = (p.occupation === 'priest' || p.occupation === 'acolyte') ? anchorIn(pl, ['altar']) : anchorIn(pl, ['seat']); return [A({ type: 'goto', pos: spot ?? pl!.inside, placeId: pl?.id }), A({ type: 'pray', pos: spot ?? pl!.inside, duration: 40 * 60 })]; }
      case 'socialize': case 'drink': case 'play': case 'idle': { const pl = place ?? w.place(this.squareId()); const spot = anchorIn(pl, g.type === 'drink' ? ['seat', 'inside'] : ['seat', 'inside', 'work']) ?? pl?.inside ?? body.pos; return [A({ type: 'goto', pos: spot, placeId: pl?.id }), A({ type: g.type === 'play' ? 'wait' : 'sit', pos: spot, duration: (g.type === 'play' ? 8 : 25) * 60 + w.rng.next() * 15 * 60, data: { social: true } })]; }
      case 'wander': { const pl = w.place(this.squareId())!; return [A({ type: 'goto', pos: { x: pl.inside.x + (w.rng.next() - 0.5) * 16, y: pl.inside.y, z: pl.inside.z + (w.rng.next() - 0.5) * 16 } }), A({ type: 'wait', duration: 5 * 60 })]; }
      case 'go_home': case 'shelter': case 'return_home_safe': { const pl = place ?? w.place(p.homeId); return [A({ type: 'goto', pos: anchorIn(pl, ['seat', 'fire', 'inside']) ?? pl?.inside ?? body.pos, placeId: pl?.id }), A({ type: 'wait', duration: 30 * 60 })]; }
      case 'patrol': { const pts = p.patrol ?? []; const start = Math.floor(w.rng.next() * pts.length); const acts: Action[] = []; for (let i = 0; i < pts.length; i++) { const pt = pts[(start + i) % pts.length]; acts.push(A({ type: 'goto', pos: pt }), A({ type: 'look', duration: 40, pos: pt })); } return acts.length ? acts : [A({ type: 'wait', duration: 60 })]; }
      case 'guard_post': { const pl = place ?? w.place(p.workId); const post = p.occupation === 'guard' ? (w.places().find(x => x.type === 'gate' && x.name.includes('east'))?.anchors[0].pos ?? pl?.inside) : anchorIn(pl, ['post', 'work', 'inside']); return [A({ type: 'goto', pos: post ?? body.pos }), A({ type: 'look', duration: 20 * 60, pos: post ?? body.pos })]; }
      case 'flee': { const threatPos = w.primaryBody(g.targetEntity!)?.pos ?? body.pos; const guards = w.persons().filter(q => (q.occupation === 'guard' || q.occupation === 'captain') && q.alive && q.id !== g.targetEntity); const gd = p.traits.sociability > 0.3 && !p.hostile ? this.nearestKnownGuard(p, body.pos, guards) : null; let dest: Vec3; if (gd) { dest = p.knowledge[`loc:${gd.id}`]?.claim.pos ?? w.place(gd.workId)?.inside ?? w.primaryBody(gd.id)!.pos; } else { const home = w.place(p.homeId); dest = home?.inside ?? this.awayFrom(body.pos, threatPos, 18); } if (dist2(dest, threatPos) < 8) dest = this.awayFrom(body.pos, threatPos, 20); return [A({ type: 'goto', pos: dest, run: true, data: { flee: true } }), A({ type: 'wait', duration: 3 * 60, data: { hide: true } })]; }
      case 'report': { const g2 = w.person(g.targetEntity!)!; return [A({ type: 'goto', targetEntity: g2.id, run: true }), A({ type: 'tell', targetEntity: g2.id, data: { key: g.data?.key } })]; }
      case 'investigate': { return [A({ type: 'goto', pos: g.targetPos!, run: p.occupation === 'captain' }), A({ type: 'look', duration: 3 * 60, pos: g.targetPos!, data: { key: g.data?.key, investigate: true } })]; }
      case 'confront': case 'attack': return [A({ type: 'goto', targetEntity: g.targetEntity, run: true }), A({ type: g.type === 'confront' ? 'talk' : 'attack', targetEntity: g.targetEntity, data: g.data })];
      case 'help': return [A({ type: 'goto', targetEntity: g.targetEntity, run: true }), A({ type: 'use', targetEntity: g.targetEntity, duration: 60, data: { heal: true } })];
      case 'recover_item': return [A({ type: 'goto', pos: g.targetPos! }), A({ type: 'pickup', targetEntity: g.targetEntity })];
      case 'mourn': { const gy = place!; const grave = gy.anchors.find(a => a.kind === 'grave' && a.label?.startsWith('Anna')) ?? gy.anchors[0]; return [A({ type: 'goto', pos: grave.pos }), A({ type: 'pray', pos: grave.pos, duration: 40 * 60 })]; }
      default: return [A({ type: 'wait', duration: 60 })];
    }
  }
  private anchorTaken(pos: Vec3, selfBody: string): boolean { for (const b of this.world.bodies()) if (b.id !== selfBody && b.present && b.sitAnchor && b.sitAnchor.x === pos.x && b.sitAnchor.z === pos.z) return true; return false; }
  private awayFrom(from: Vec3, threat: Vec3, d: number): Vec3 {
    const w = this.world; let dx = from.x - threat.x, dz = from.z - threat.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    for (let tries = 0; tries < 8; tries++) { const ang = (tries / 8) * Math.PI * 2 * (tries % 2 ? 1 : -1) * 0.25; const cx = Math.cos(ang) * dx - Math.sin(ang) * dz, cz = Math.sin(ang) * dx + Math.cos(ang) * dz; const x = Math.round(from.x + cx * d), z = Math.round(from.z + cz * d); const n = w.nav.nearestWalkable(x, z, 4); if (n) return { x: n.x + 0.5, y: w.nav.floorY(n.x, n.z), z: n.z + 0.5 }; }
    return from;
  }

  // ------------------------------------------------------------------ acting
  private act(p: Person, body: Body, physDt: number, worldDt: number): void {
    const w = this.world; const m = p.mind;
    if (body.dead) return;
    const a = m.plan.find(x => x.status === 'pending' || x.status === 'active'); if (!a) { if (body.pose !== 'stand' && body.pose !== 'walk' && body.poseUntil < w.physicalTime) body.pose = 'stand'; return; }
    if (a.status === 'pending') { a.status = 'active'; a.startedAt = w.now; this.beginAction(p, body, a); }
    switch (a.type) {
      case 'goto': {
        // Observational only (Constitution §53): records that pathing failed, for headless
        // telemetry/anomaly detection. Never changes canonical decisions itself.
        const failGoto = (reason: string) => { a.status = 'failed'; w.emit('path_failure', { actor: p.id, pos: body.pos, significance: 0, data: { reason, goal: m.goal?.type }, summary: `${p.name} could not path (${reason})` }); };
        let dest = a.pos ?? null;
        if (a.targetEntity) { const tb = w.primaryBody(a.targetEntity); if (!tb) { failGoto('target has no body'); break; } dest = tb.pos; if (dist2(body.pos, dest) < 1.8) { body.path = null; a.status = 'done'; body.pose = 'stand'; body.yaw = Math.atan2(-(dest.x - body.pos.x), -(dest.z - body.pos.z)); break; } if (!body.path || !body.pathGoal || dist2(body.pathGoal, dest) > 2.5) this.pathTo(body, dest, a); }
        if (!dest) { failGoto('no destination'); break; }
        if (!body.path) { if (dist2(body.pos, dest) < 1.2) { a.status = 'done'; break; } this.pathTo(body, dest, a); if (!body.path) { failGoto('no path found'); break; } }
        body.speed = a.run ? 5.6 : (p.occupation === 'child' ? 3.6 : 3.2 + (p.age > 60 ? -0.8 : 0));
        body.pose = a.run ? 'run' : 'walk';
        const arrived = this.followPath(body, physDt);
        if (arrived) { a.status = 'done'; body.path = null; if (!a.targetEntity && dist2(body.pos, dest) > 3) { /* couldn't reach */ } if (a.data?.flee) w.emit('fled', { actor: p.id, pos: body.pos, significance: 0.3, summary: `${p.name} fled to ${w.placeAt(body.pos)?.name ?? 'safety'}` }); else if (a.placeId) w.emit('arrived', { actor: p.id, placeId: a.placeId, pos: body.pos, significance: 0.05, summary: `${p.name} arrived at ${w.nameOf(a.placeId)}` }); }
        break;
      }
      case 'sleep': body.pose = 'sleep'; body.sitAnchor = a.pos ?? null; if (a.pos) { body.pos.x = Math.floor(a.pos.x) + 0.5; body.pos.z = Math.floor(a.pos.z) + 0.5; } p.needs.energy = clamp(p.needs.energy - worldDt / (7 * SECONDS_PER_HOUR)); if (p.needs.energy <= 0.02 && w.now - (a.startedAt ?? 0) > (a.duration ?? 0) * 0.5) a.status = 'done'; if (w.now - (a.startedAt ?? 0) > 9 * SECONDS_PER_HOUR) a.status = 'done'; break;
      case 'sit': body.pose = 'sit'; body.sitAnchor = a.pos ?? null; if (a.pos) { body.pos.x = Math.floor(a.pos.x) + 0.5; body.pos.z = Math.floor(a.pos.z) + 0.5; } p.needs.social = clamp(p.needs.social - worldDt / (3 * SECONDS_PER_HOUR)); this.maybeChat(p, body); if (this.elapsed(a)) a.status = 'done'; break;
      case 'eat': body.pose = 'sit'; body.sitAnchor = a.pos ?? null; p.needs.hunger = clamp(p.needs.hunger - worldDt / (20 * 60)); if (this.elapsed(a) || p.needs.hunger <= 0.02) { a.status = 'done'; w.emit('meal', { actor: p.id, pos: body.pos, significance: 0.05, summary: `${p.name} ate at ${w.placeAt(body.pos)?.name ?? 'home'}` }); } break;
      case 'work': body.pose = 'work'; body.sitAnchor = a.pos ?? null; this.maybeChat(p, body); if (a.pos && w.rng.next() < physDt * 0.15) { body.yaw += (w.rng.next() - 0.5) * 0.6; } if (this.elapsed(a)) a.status = 'done'; break;
      case 'pray': body.pose = 'pray'; body.sitAnchor = a.pos ?? null; if (this.elapsed(a)) a.status = 'done'; break;
      case 'wait': body.pose = a.data?.hide ? 'stand' : 'stand'; if (a.data?.social) this.maybeChat(p, body); if (this.elapsed(a)) a.status = 'done'; break;
      case 'look': { body.pose = 'stand'; body.yaw += physDt * 0.5; if (a.data?.investigate) { const key = a.data.key as string; const k = p.knowledge[key]; const suspect = k?.claim.actor as string | undefined; const seen = suspect ? m.percepts.find(pc => pc.entityId === suspect) : null; if (seen) { a.status = 'done'; m.investigated.push(key); m.alarm = 1; break; } if (this.elapsed(a)) { a.status = 'done'; m.investigated.push(key); if (k) k.handled = true; w.emit('investigation', { actor: p.id, pos: body.pos, placeId: k?.claim.placeId, causes: k?.source.viaEvent ? [k.source.viaEvent] : [], significance: 0.4, data: { key, outcome: 'suspect not found' }, summary: `${p.name} investigated ${k ? describeClaim(w, k) : 'a report'} but found no one` }); this.say(p, suspect ? `${w.nameOf(suspect).split(' ')[0]}... where did they go?` : 'Nothing here now.'); } } else if (this.elapsed(a)) a.status = 'done'; break; }
      case 'tell': { const t = w.person(a.targetEntity!); const tb = w.primaryBody(a.targetEntity!); if (!t || !tb || dist2(body.pos, tb.pos) > 3.5) { a.status = 'failed'; break; } const k = p.knowledge[a.data?.key]; if (k) this.tell(p, t, k); body.pose = 'talk'; body.poseUntil = w.physicalTime + 2; a.status = 'done'; break; }
      case 'talk': { const t = w.person(a.targetEntity!); const tb = w.primaryBody(a.targetEntity!); if (!t || !tb) { a.status = 'failed'; break; } if (dist2(body.pos, tb.pos) > 3) { a.status = 'failed'; break; } this.confront(p, body, t, a); a.status = 'done'; break; }
      case 'attack': { const tb = w.primaryBody(a.targetEntity!); if (!tb || tb.dead) { a.status = 'done'; break; } const d = dist2(body.pos, tb.pos); body.yaw = Math.atan2(-(tb.pos.x - body.pos.x), -(tb.pos.z - body.pos.z)); if (d > 2.2) { a.status = 'pending'; m.plan.unshift({ type: 'goto', targetEntity: a.targetEntity, run: true, status: 'pending' }); break; } if (w.physicalTime - body.lastAttackAt > 1.1) { this.attack(p, body, tb, a.data?.intent as ConflictIntent | undefined); } if (tb.pose === 'downed' || tb.dead) a.status = 'done'; break; }
      case 'use': { if (a.data?.heal) { const tb = w.primaryBody(a.targetEntity!); if (tb && dist2(body.pos, tb.pos) < 3) { body.pose = 'work'; tb.health = Math.min(tb.maxHealth, tb.health + worldDt * 0.02); if (this.elapsed(a)) { a.status = 'done'; if (tb.pose === 'downed') tb.pose = 'stand'; w.emit('heal', { actor: p.id, target: a.targetEntity, pos: body.pos, significance: 0.4, visibility: 12, summary: `${p.name} tended to ${w.nameOf(a.targetEntity)}'s wounds` }); this.say(p, `There. You'll live.`); } } else a.status = 'failed'; } else a.status = 'done'; break; }
      case 'pickup': { const it = w.item(a.targetEntity!); if (it && it.pos && !it.holderId && dist2(body.pos, it.pos) < 2.5) { this.takeItem(p, it, 'recovered'); } a.status = 'done'; break; }
      default: a.status = 'done';
    }
    if (a.status === 'done' && m.plan.every(x => x.status === 'done' || x.status === 'failed')) { const g = m.goal; if (g) { w.emit('goal_completed', { actor: p.id, significance: 0.05, summary: `${p.name} finished ${g.type}` }); } m.thinkBudget = m.thinkInterval; body.sitAnchor = null; }
    if (a.status === 'failed') { m.thinkBudget = m.thinkInterval; body.sitAnchor = null; body.path = null; }
  }
  private elapsed(a: Action): boolean { return this.world.now - (a.startedAt ?? 0) >= (a.duration ?? 0); }
  private beginAction(p: Person, body: Body, a: Action): void { if (a.type === 'goto') { body.path = null; body.sitAnchor = null; } }
  private pathTo(body: Body, dest: Vec3, a: Action): void {
    const path = this.world.nav.findPath(body.pos, dest, 9000);
    if (path) { body.path = path; body.pathIndex = 0; body.pathGoal = { ...dest }; } else { body.path = null; body.pathGoal = null; }
  }
  /** Move along the path; returns true on arrival. */
  private followPath(body: Body, dt: number): boolean {
    const path = body.path; if (!path) return true;
    if (body.pathIndex >= path.length) return true;
    const t = path[body.pathIndex]; const dx = t.x - body.pos.x, dz = t.z - body.pos.z; const d = Math.hypot(dx, dz);
    if (d < 0.25) { body.pathIndex++; if (body.pathIndex >= path.length) { body.vel.x = 0; body.vel.z = 0; return true; } return false; }
    const step = Math.min(d, body.speed * dt); const nx = body.pos.x + dx / d * step, nz = body.pos.z + dz / d * step;
    const doorX = Math.floor(nx), doorZ = Math.floor(nz), doorY = this.world.nav.floorY(doorX, doorZ);
    if (doorY >= 0 && this.world.grid.get(doorX, doorY, doorZ) === B.Door && !this.world.grid.isDoorOpen(doorX, doorY, doorZ)) this.world.setDoorOpen({ x: doorX, y: doorY, z: doorZ }, true, body.ownerId);
    // separation from other bodies
    let sx = 0, sz = 0; for (const o of this.world.bodies()) { if (o === body || !o.present || o.dead) continue; const ox = body.pos.x - o.pos.x, oz = body.pos.z - o.pos.z; const od = Math.hypot(ox, oz); if (od < 0.7 && od > 1e-3) { sx += ox / od * (0.7 - od); sz += oz / od * (0.7 - od); } }
    body.pos.x = nx + sx * dt * 2; body.pos.z = nz + sz * dt * 2;
    const targetYaw = Math.atan2(-dx, -dz); let dy = targetYaw - body.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; body.yaw += dy * Math.min(1, dt * 10);
    body.vel.x = dx / d * body.speed; body.vel.z = dz / d * body.speed;
    return false;
  }
  private bodyPhysics(b: Body, dt: number): void {
    const g = this.world.grid;
    // ground snap: NPC bodies walk on the nav surface; fall if in the air
    const floorY = this.world.nav.floorY(Math.floor(b.pos.x), Math.floor(b.pos.z));
    const ground = floorY >= 0 ? floorY : g.surfaceY(b.pos.x, b.pos.z);
    if (b.pos.y > ground + 0.05) { b.vel.y -= 20 * dt; b.pos.y += b.vel.y * dt; if (b.pos.y <= ground) { b.pos.y = ground; b.vel.y = 0; } } else { b.pos.y = ground; b.vel.y = 0; }
    if (b.pose !== 'walk' && b.pose !== 'run') { b.vel.x *= Math.max(0, 1 - dt * 8); b.vel.z *= Math.max(0, 1 - dt * 8); }
    // knockback carries the body
    if (b.pose === 'hit' || b.pose === 'downed' || b.pose === 'dead') { const nx = b.pos.x + b.vel.x * dt, nz = b.pos.z + b.vel.z * dt; if (!g.isSolidAt(nx, b.pos.y + 0.5, nz)) { b.pos.x = nx; b.pos.z = nz; } b.vel.x *= Math.max(0, 1 - dt * 4); b.vel.z *= Math.max(0, 1 - dt * 4); }
    if (b.pose === 'hit' && b.poseUntil < this.world.physicalTime) b.pose = 'stand';
    if (b.pose === 'attack' && b.poseUntil < this.world.physicalTime) b.pose = 'stand';
    if (b.pose === 'downed' && b.poseUntil < this.world.physicalTime) { b.pose = 'stand'; b.health = Math.max(b.health, b.maxHealth * 0.3); }
  }
  private creatureStep(c: Creature, dt: number): void {
    const w = this.world; const b = w.primaryBody(c.id); if (!b || b.dead) return;
    c.wanderTimer -= dt;
    if (c.wanderTimer <= 0) { c.wanderTimer = 2 + w.rng.next() * 6; if (w.rng.next() < 0.6) { const home = w.place(c.homeId)?.inside ?? b.pos; const tx = home.x + (w.rng.next() - 0.5) * 14, tz = home.z + (w.rng.next() - 0.5) * 10; const n = w.nav.nearestWalkable(Math.floor(tx), Math.floor(tz), 3); if (n && w.nav.walkCost(n.x, n.z) < 3) { b.path = [{ x: n.x + 0.5, y: w.nav.floorY(n.x, n.z), z: n.z + 0.5 }]; b.pathIndex = 0; b.pose = 'walk'; } } else { b.path = null; b.pose = 'stand'; } }
    // flee from nearby humans
    for (const o of w.bodies()) { if (o.shape !== 'humanoid' || !o.present) continue; const d = dist2(o.pos, b.pos); if (d < 2.2 && Math.hypot(o.vel.x, o.vel.z) > 1.5) { const away = this.awayFrom(b.pos, o.pos, 4); b.path = [away]; b.pathIndex = 0; b.pose = 'walk'; c.wanderTimer = 1.5; break; } }
    if (b.path) { b.speed = 2.2; if (this.followPath(b, dt)) { b.path = null; b.pose = 'stand'; } }
  }

  // ------------------------------------------------------------------ social
  private maybeChat(p: Person, body: Body): void {
    const w = this.world; if (w.physicalTime - p.mind.lastSpokeAt < 6 + (1 - p.traits.sociability) * 14) return;
    const near = p.mind.percepts.filter(pc => pc.distance < 4 && pc.how === 'saw').map(pc => w.person(pc.entityId)).filter((q): q is Person => !!q && q.alive && !q.controlled && (w.primaryBody(q.id)?.pose !== 'sleep'));
    if (!near.length) return;
    const other = near[Math.floor(w.rng.next() * near.length)];
    if (w.physicalTime - (p.mind.lastToldAt[other.id] ?? -99) < 25) return;
    p.mind.lastSpokeAt = w.physicalTime; p.mind.lastToldAt[other.id] = w.physicalTime;
    // share the most significant thing I know that they don't seem to know
    const share = this.pickGossip(p, other);
    if (share) this.tell(p, other, share); else { const lines = this.smallTalk(p, other); this.say(p, lines); adjustRel(w, p, other.id, { familiarity: 0.02, affection: 0.01 }, 'chatted', undefined, true); adjustRel(w, other, p.id, { familiarity: 0.02 }, 'chatted', undefined, true); p.needs.social = clamp(p.needs.social - 0.05); other.needs.social = clamp(other.needs.social - 0.03); }
  }
  private pickGossip(p: Person, other: Person): KnowledgeItem | null {
    const w = this.world; const r = getRel(p, other.id); if (r.trust < -0.3) return null;
    const cands = Object.values(p.knowledge).filter(k => k.kind === 'event' && ((k.claim.significance ?? 0.3) >= 0.2 || isCrime(k.claim.type, k.claim.intent)) && !k.sharedWith.includes(other.id) && k.claim.actor !== other.id && k.source.from !== other.id && (w.now - k.learnedAt < 86400 * 4 || isCrime(k.claim.type, k.claim.intent)) && !other.knowledge[k.key]);
    if (!cands.length) return null;
    cands.sort((a, b) => (b.claim.significance ?? 0.3) * (isCrime(b.claim.type, b.claim.intent) ? 1.5 : 1) - (a.claim.significance ?? 0.3) * (isCrime(a.claim.type, a.claim.intent) ? 1.5 : 1));
    const best = cands[0]; if ((best.claim.significance ?? 0.3) < 0.2 && p.traits.sociability < 0.6) return null; return best;
  }
  private smallTalk(p: Person, other: Person): string {
    const w = this.world; const r = getRel(p, other.id); const first = other.name.split(' ')[0]; const h = w.clock.hourF; const wk = w.weather.kind;
    const pool = [`Fine ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}, ${first}.`, wk === 'rain' ? `This rain will rot the wheat.` : wk === 'clear' ? `Good weather for it.` : `Looks like weather coming.`, `How's the family, ${first}?`, `Busy day.`, `Have you eaten?`];
    if (r.tags.includes('spouse')) pool.push(`Don't forget the firewood.`, `You look tired, love.`);
    if (r.tags.includes('rival')) pool.push(`Hmph. ${first}.`, `Still owe me for that timber.`);
    if (p.occupation === 'merchant') pool.push(`Candles are two coppers now. Don't look at me like that.`);
    if (p.occupation === 'child') pool.push(`Race you to the well!`, `Did you see the traveler?`);
    if (p.emotions.sadness > 0.4) pool.push(`...`, `It's quiet without her.`);
    return pool[Math.floor(w.rng.next() * pool.length)];
  }
  /** One mind tells another something it knows. Knowledge travels with provenance. */
  tell(speaker: Person, listener: Person, k: KnowledgeItem): void {
    const w = this.world; const sb = w.primaryBody(speaker.id);
    const text = this.tellLine(speaker, listener, k);
    const ev = w.emit('told', { actor: speaker.id, target: listener.id, pos: sb?.pos, causes: k.source.viaEvent ? [k.source.viaEvent] : [], significance: 0.3 + (k.claim.significance ?? 0.3) * 0.4, data: { key: k.key, text, hops: k.hops + 1 }, summary: `${speaker.name} told ${listener.name}: "${describeClaim(w, k)}"`, loudness: 4 });
    k.sharedWith.push(listener.id);
    this.say(speaker, text); speaker.mind.lastSpokeAt = w.physicalTime; speaker.mind.lastToldAt[listener.id] = w.physicalTime;
    if (sb) { sb.pose = 'talk'; sb.poseUntil = w.physicalTime + 2.5; }
    if (listener.controlled) return;
    const trust = getRel(listener, speaker.id).trust; const conf = clamp(k.confidence * (0.55 + 0.35 * clamp(trust + 0.5)) * (speaker.traits.honesty * 0.3 + 0.7));
    const learned = learn(w, listener, { key: k.key, kind: k.kind, claim: { ...k.claim }, confidence: conf, source: { type: 'told', from: speaker.id, viaEvent: ev.id }, hops: k.hops + 1, cause: ev.id, summary: describeClaim(w, k) });
    remember(w, listener, { type: 'told', summary: `${speaker.name} told me ${describeClaim(w, k)}`, eventId: k.claim.eventId, entities: [speaker.id, k.claim.actor, k.claim.target].filter(Boolean) as string[], significance: clamp((k.claim.significance ?? 0.3) * 0.7), valence: isCrime(k.claim.type, k.claim.intent) ? -0.4 : 0, source: { type: 'told', from: speaker.id, viaEvent: ev.id } });
    ev.perceivedBy.push({ who: listener.id, how: 'heard', tick: w.now });
    adjustRel(w, listener, speaker.id, { familiarity: 0.03, affection: 0.02 }, 'talked', undefined, true);
    if (learned && isCrime(k.claim.type, k.claim.intent) && k.claim.actor) {
      const sev = crimeSeverity(k.claim.type); const victimClose = k.claim.target ? isClose(listener, k.claim.target) : false;
      adjustRel(w, listener, k.claim.actor, { fear: sev * 0.3 * conf * (1.2 - listener.traits.courage), trust: -sev * 0.4 * conf, grudge: sev * conf * (victimClose ? 0.6 : 0.2), affection: -sev * 0.3 * conf }, `was told by ${speaker.name}`, ev.id);
      listener.mind.alarm = 1;
      const lb = w.primaryBody(listener.id); if (lb) { lb.pose = 'talk'; lb.poseUntil = w.physicalTime + 1.5; }
      const isGuard = listener.occupation === 'guard' || listener.occupation === 'captain';
      this.sayLater(listener, isGuard ? `${k.claim.type === 'kill' ? 'Murder?!' : 'An assault?'} Where? I'll see to it.` : listener.traits.courage > 0.6 ? `That so? Someone should do something.` : `Gods. I'll keep my door barred.`, 1.2);
    } else if (learned) { this.sayLater(listener, ['Is that so.', 'I hadn\'t heard.', 'Well, well.', 'Hm.', 'Really?'][Math.floor(w.rng.next() * 5)], 1.5); }
  }
  private tellLine(sp: Person, li: Person, k: KnowledgeItem): string {
    const w = this.world; const c = k.claim; const first = li.name.split(' ')[0]; const src = k.source.type === 'witnessed' ? 'I saw it myself' : k.source.type === 'heard' ? 'I heard it happen' : k.source.from ? `${w.nameOf(k.source.from).split(' ')[0]} told me` : 'they say';
    const who = (id: string | undefined, unk?: boolean) => unk ? 'someone' : id ? (id === li.id ? 'you' : w.nameOf(id)) : 'someone';
    switch (c.type) {
      case 'attack': return `${first}! ${who(c.actor, c.actorUnknown)} attacked ${who(c.target)}${c.placeId ? ' at ' + w.nameOf(c.placeId) : ''}. ${src}!`;
      case 'kill': return `${first}, ${who(c.target)} is dead. ${who(c.actor, c.actorUnknown)} killed ${li.gender === 'f' ? 'him' : 'them'}. ${src}.`;
      case 'theft': return `${who(c.actor, c.actorUnknown)} took ${c.item ? w.nameOf(c.item) : 'something'} from ${who(c.target)}. ${src}.`;
      case 'gift': return `Did you hear? ${who(c.actor)} gave ${who(c.target)} ${c.item ? w.nameOf(c.item) : 'a gift'}.`;
      case 'returned_item': return `${who(c.actor)} brought ${c.item ? w.nameOf(c.item) : 'it'} back to ${who(c.target)}. ${src}.`;
      case 'rumor': return `${src}: ${c.text}.`;
      case 'debt': return `${who(c.actor)} still owes ${who(c.target)} ${c.amount} silver, ${src}.`;
      case 'dispute': return `${who(c.actor)} and ${who(c.target)} had words${c.about ? ' over ' + c.about : ''}. ${src}.`;
      case 'heal': return `${who(c.actor)} patched up ${who(c.target)}, ${src}.`;
      default: return `${src}: ${describeClaim(w, k)}.`;
    }
  }
  say(p: Person, text: string): void { p.speech = { text, until: this.world.physicalTime + 3 + text.length * 0.05 }; this.onSpeech?.(p, text); }
  private pendingSpeech: { p: Person; text: string; at: number }[] = [];
  sayLater(p: Person, text: string, delay: number): void { this.pendingSpeech.push({ p, text, at: this.world.physicalTime + delay }); }
  flushSpeech(): void { const t = this.world.physicalTime; for (let i = this.pendingSpeech.length - 1; i >= 0; i--) if (this.pendingSpeech[i].at <= t) { const s = this.pendingSpeech.splice(i, 1)[0]; this.say(s.p, s.text); } }

  private confront(p: Person, body: Body, t: Person, a: Action): void {
    const w = this.world; const tb = w.primaryBody(t.id)!; const key = a.data?.crime as string | undefined; const k = key ? p.knowledge[key] : undefined;
    body.pose = 'talk'; body.poseUntil = w.physicalTime + 2; body.yaw = Math.atan2(-(tb.pos.x - body.pos.x), -(tb.pos.z - body.pos.z));
    const sev = k ? crimeSeverity(k.claim.type) : 0.3;
    const ev = w.emit(sev >= 0.6 ? 'arrest_attempt' : 'confrontation', { actor: p.id, target: t.id, pos: body.pos, causes: k?.source.viaEvent ? [k.source.viaEvent] : [], significance: 0.5, visibility: 16, loudness: 10, data: { crime: key, source: k?.source }, summary: `${p.name} confronted ${t.name} about ${k ? describeClaim(w, k) : 'their conduct'}` });
    if (k) { k.handled = true; p.mind.investigated.push(k.key); }
    const src = k ? (k.source.type === 'told' ? `${w.nameOf(k.source.from).split(' ')[0]} told me` : 'I know') : '';
    if (sev >= 0.6) { this.say(p, `${t.name}! ${src} you attacked ${k?.claim.target ? w.nameOf(k.claim.target) : 'someone'}. You're coming with me.`); // escalate to force
      p.mind.plan.push({ type: 'attack', targetEntity: t.id, status: 'pending', data: { arrest: true, intent: 'arrest' as ConflictIntent } }); }
    else if (k?.claim.type === 'theft') { this.say(p, `${t.name}. ${src} you took ${k.claim.item ? w.nameOf(k.claim.item) : 'what isn\'t yours'}. Give it back, or answer for it.`); p.desires.push({ type: 'recover_item', targetId: k.claim.item, note: `Recover ${w.nameOf(k.claim.item)} from ${t.name}`, reward: 0, fulfilled: false }); }
    else this.say(p, `${t.name}. I've heard things about you. Mind yourself.`);
    void ev;
  }

  // ------------------------------------------------------------------ combat
  attack(attacker: Person, ab: Body, tb: Body, intent?: ConflictIntent): void {
    const w = this.world; ab.lastAttackAt = w.physicalTime; ab.pose = 'attack'; ab.poseUntil = w.physicalTime + 0.45;
    const dmg = Math.max(6, this.weaponOf(attacker) || 7) * (0.8 + w.rng.next() * 0.4);
    this.applyHit(attacker, ab, tb, dmg, intent);
  }
  /**
   * Canonical hit application, used by player and NPC attacks alike. Emits perceivable events.
   *
   * Lethality (Constitution §11, "hostile must not automatically mean lethal"): death is
   * reached only through an explicit `intent: 'kill'`, or a player's own deliberate choice to
   * press an attack (a finishing blow on an already-downed target, or a heavy hit) — never
   * merely because the attacker belongs to a hostile faction. Every other intent ('rob',
   * 'subdue', 'arrest', 'defend', 'injure', 'threaten', 'drive_off', 'avoid') downs the
   * target instead. `intent` is optional so existing direct callers (and tests) keep their
   * previous non-hostile-driven behavior unchanged.
   */
  applyHit(attacker: Person, ab: Body, tb: Body, dmg: number, intent?: ConflictIntent): WorldEvent | null {
    const w = this.world; if (tb.dead) return null; const victim = w.get(tb.ownerId) as Person | Creature;
    const wasDowned = tb.pose === 'downed';
    tb.health -= dmg; tb.lastHitAt = w.physicalTime;
    const dx = tb.pos.x - ab.pos.x, dz = tb.pos.z - ab.pos.z; const d = Math.hypot(dx, dz) || 1; tb.vel.x += dx / d * 4; tb.vel.z += dz / d * 4;
    this.onHit?.(tb, { x: tb.pos.x, y: tb.pos.y + 1.2, z: tb.pos.z });
    const place = w.placeAt(tb.pos);
    const ev = w.emit('attack', { actor: attacker.id, target: victim.id, pos: { ...tb.pos }, placeId: place?.id, significance: 0.7, visibility: 26, loudness: 14, data: { damage: Math.round(dmg), weapon: this.weaponName(attacker), health: Math.round(tb.health), intent }, summary: `${attacker.name} attacked ${victim.name}${place ? ' at ' + place.name : ''} (${Math.round(dmg)} dmg)` });
    if (tb.health <= 0) {
      const lethal = intent === 'kill' || victim.kind === 'creature' || (attacker.controlled && (wasDowned || (intent === undefined && dmg > 20 && w.rng.next() < 0.5)));
      if (lethal) { tb.dead = true; tb.pose = 'dead'; tb.health = 0; if (victim.kind === 'person') { victim.alive = false; victim.deathTick = w.now; victim.mind.goal = null; victim.mind.plan = []; }
        const de = w.emit('kill', { actor: attacker.id, target: victim.id, pos: { ...tb.pos }, placeId: place?.id, causes: [ev.id], significance: 1, visibility: 26, loudness: 14, summary: `${attacker.name} killed ${victim.name}${place ? ' at ' + place.name : ''}` }); w.emit('death', { target: victim.id, pos: { ...tb.pos }, placeId: place?.id, causes: [de.id], significance: 1, summary: `${victim.name} died` }); }
      else { tb.pose = 'downed'; tb.poseUntil = w.physicalTime + 45; tb.health = 1; if (victim.kind === 'person') { victim.mind.plan = []; victim.mind.goal = null; } }
    } else { tb.pose = 'hit'; tb.poseUntil = w.physicalTime + 0.4; if (victim.kind === 'person' && !victim.controlled) { victim.mind.alarm = 1; victim.mind.attention = attacker.id; const cur = victim.mind.plan.find(x => x.status === 'active'); if (cur && cur.type !== 'attack') cur.status = 'failed'; } }
    // the victim always knows who hit them (unless asleep and it was dark... keep simple: they know)
    if (victim.kind === 'person' && !victim.controlled) {
      const vp = victim as Person; if (!ev.perceivedBy.some(x => x.who === vp.id)) { ev.perceivedBy.push({ who: vp.id, how: 'saw', tick: w.now }); const perc = w.emit('perceived', { actor: vp.id, target: attacker.id, causes: [ev.id], significance: 0.4, data: { how: 'saw', eventType: 'attack', eventId: ev.id }, summary: `${vp.name} was attacked by ${attacker.name}` }); learn(w, vp, { key: `ev:${ev.id}`, kind: 'event', claim: eventClaim(w, ev, true), confidence: 1, source: { type: 'witnessed', viaEvent: perc.id }, cause: perc.id, summary: ev.summary }); remember(w, vp, { type: 'attack', summary: `${attacker.name} attacked me${place ? ' at ' + place.name : ''}`, eventId: ev.id, entities: [attacker.id], significance: 0.9, valence: -0.9, source: { type: 'witnessed', viaEvent: perc.id }, placeId: place?.id }); this.reactTo(vp, tb, ev, perc.id, true, true, false, null); }
    }
    return ev;
  }
  weaponName(p: Person): string { let best: string = 'fists'; let bd = 0; for (const id of p.inventory) { const it = this.world.item(id); if (it && it.damage > bd) { bd = it.damage; best = it.name; } } return best; }

  // ------------------------------------------------------------------ items
  takeItem(p: Person, it: import('../core/types').Item, how: 'pickup' | 'theft' | 'recovered' | 'bought' | 'given', from?: EntityId): WorldEvent {
    const w = this.world; const pos = it.pos ? { ...it.pos } : w.primaryBody(p.id)?.pos; const place = it.placeId ? w.place(it.placeId) : pos ? w.placeAt(pos) : undefined;
    const prevHolder = it.holderId; if (prevHolder) { const h = w.person(prevHolder); if (h) h.inventory = h.inventory.filter(x => x !== it.id); }
    it.holderId = p.id; it.pos = null; it.placeId = null; if (!p.inventory.includes(it.id)) p.inventory.push(it.id);
    const stolen = how === 'theft' || (how === 'pickup' && it.ownerId && it.ownerId !== p.id);
    const type = stolen ? 'theft' : how === 'recovered' ? 'recovered' : how === 'given' ? 'give' : how === 'bought' ? 'trade' : 'pickup';
    it.provenance.push({ tick: w.now, from: from ?? prevHolder ?? it.ownerId ?? null, to: p.id, how: stolen ? 'stolen' : how });
    const ev = w.emit(type, { actor: p.id, target: stolen ? it.ownerId! : (from ?? it.ownerId ?? undefined), item: it.id, pos, placeId: place?.id, significance: stolen ? 0.5 : 0.15, visibility: stolen ? 16 : 8, data: { how }, summary: stolen ? `${p.name} stole ${it.name} from ${w.nameOf(it.ownerId)}${place ? ' at ' + place.name : ''}` : `${p.name} ${how === 'recovered' ? 'recovered' : how === 'bought' ? 'bought' : 'picked up'} ${it.name}${place ? ' at ' + place.name : ''}` });
    it.provenance[it.provenance.length - 1].eventId = ev.id;
    if (how === 'bought') it.ownerId = p.id;
    else if (!stolen && how !== 'given') it.ownerId = it.ownerId ?? p.id;
    return ev;
  }
  dropItem(p: Person, it: import('../core/types').Item, pos: Vec3): void {
    const w = this.world; p.inventory = p.inventory.filter(x => x !== it.id); it.holderId = null; it.pos = { ...pos }; it.placeId = w.placeAt(pos)?.id ?? null;
    const ev = w.emit('drop', { actor: p.id, item: it.id, pos, significance: 0.1, visibility: 8, summary: `${p.name} dropped ${it.name}` });
    it.provenance.push({ tick: w.now, eventId: ev.id, from: p.id, to: null, how: 'dropped' });
  }
  giveItem(from: Person, to: Person, it: import('../core/types').Item): WorldEvent {
    const w = this.world; from.inventory = from.inventory.filter(x => x !== it.id); to.inventory.push(it.id); it.holderId = to.id;
    const returned = it.ownerId === to.id; if (!returned) it.ownerId = to.id;
    it.provenance.push({ tick: w.now, from: from.id, to: to.id, how: returned ? 'returned' : 'gift' });
    const pos = w.primaryBody(to.id)?.pos;
    const ev = w.emit(returned ? 'returned_item' : 'gift', { actor: from.id, target: to.id, item: it.id, pos, significance: returned ? 0.6 : 0.4, visibility: 14, loudness: 6, summary: `${from.name} ${returned ? 'returned' : 'gave'} ${it.name} to ${to.name}` });
    it.provenance[it.provenance.length - 1].eventId = ev.id;
    for (const d of to.desires) if (!d.fulfilled && d.type === 'recover_item' && d.targetId === it.id) { d.fulfilled = true; adjustRel(w, to, from.id, { affection: 0.6, trust: 0.5, respect: 0.3 }, `returned ${it.name}`, ev.id); to.emotions.joy = 1; to.emotions.sadness *= 0.5; this.say(to, `You... you found it. I don't know what to say. Thank you, stranger.`); }
    return ev;
  }

  /** Canonical purchase path used by dialogue and available to any future actor intent. */
  buyItem(buyer: Person, seller: Person, it: import('../core/types').Item, price: number): WorldEvent | null {
    const w = this.world; const coins = buyer.inventory.map(id => w.item(id)).find(item => item?.type === 'coins');
    if (!coins || coins.quantity < price || it.holderId || it.ownerId !== seller.id) return null;
    coins.quantity -= price; seller.wealth += price;
    const ev = this.takeItem(buyer, it, 'bought', seller.id);
    ev.data.price = price; ev.data.buyer = buyer.id; ev.data.seller = seller.id;
    ev.summary = `${buyer.name} bought ${it.name} from ${seller.name} for ${price} silver`;
    coins.provenance.push({ tick: w.now, eventId: ev.id, from: buyer.id, to: seller.id, how: 'trade payment' });
    return ev;
  }

  /** Canonical sale path. Payment becomes a real carried coin entity when needed. */
  sellItem(seller: Person, buyer: Person, it: import('../core/types').Item, price: number, displayPos?: Vec3, placeId?: EntityId): WorldEvent | null {
    const w = this.world;
    if (buyer.wealth < price || it.holderId !== seller.id || !seller.inventory.includes(it.id)) return null;
    buyer.wealth -= price;
    let coins = seller.inventory.map(id => w.item(id)).find(item => item?.type === 'coins');
    if (coins) coins.quantity += price;
    else coins = makeItem(w, 'coins', 'silver coins', { owner: seller.id, holder: seller.id, quantity: price });
    seller.inventory = seller.inventory.filter(id => id !== it.id);
    it.holderId = null; it.ownerId = buyer.id;
    const pos = displayPos ?? w.primaryBody(buyer.id)?.pos ?? w.primaryBody(seller.id)?.pos ?? null;
    it.pos = pos ? { ...pos } : null; it.placeId = placeId ?? (pos ? w.placeAt(pos)?.id ?? null : null);
    const ev = w.emit('trade', { actor: seller.id, target: buyer.id, item: it.id, pos: pos ?? undefined, placeId: it.placeId ?? undefined, significance: 0.2, visibility: 10, data: { price, buyer: buyer.id, seller: seller.id }, summary: `${seller.name} sold ${it.name} to ${buyer.name} for ${price} silver` });
    it.provenance.push({ tick: w.now, eventId: ev.id, from: seller.id, to: buyer.id, how: 'sold' });
    coins.provenance.push({ tick: w.now, eventId: ev.id, from: buyer.id, to: seller.id, how: 'trade payment' });
    return ev;
  }

  // ------------------------------------------------------------------ strategic (per world minute)
  private strategic(minutes: number): void {
    const w = this.world; const h = minutes / 60;
    for (const p of w.persons()) {
      if (!p.alive) continue; const b = w.primaryBody(p.id); const asleep = b?.pose === 'sleep';
      p.needs.hunger = clamp(p.needs.hunger + h / 14); if (!asleep) p.needs.energy = clamp(p.needs.energy + h / 18); p.needs.social = clamp(p.needs.social + h / 10 * p.traits.sociability);
      const e = p.emotions; e.fear *= Math.pow(0.5, h / 1.5); e.anger *= Math.pow(0.5, h / 3); e.stress *= Math.pow(0.5, h / 4); e.joy = e.joy * Math.pow(0.5, h / 2) + 0.3 * (1 - Math.pow(0.5, h / 2)); e.sadness *= Math.pow(0.5, h / 48);
      if (b && !b.dead && b.health < b.maxHealth) b.health = Math.min(b.maxHealth, b.health + minutes * 0.15);
      // grudges and fear fade slowly
      for (const r of Object.values(p.relationships)) { r.fear *= Math.pow(0.5, h / 36); r.grudge *= Math.pow(0.5, h / 120); }
      // notice missing possessions when at work: inference without a witness
      if (b && p.workId && w.placeAt(b.pos)?.id === p.workId && w.rng.next() < 0.3 * minutes) {
        for (const it of w.items()) if (it.ownerId === p.id && it.holderId && it.holderId !== p.id && !p.knowledge[`missing:${it.id}`]) {
          const knownTheft = Object.values(p.knowledge).find(k => k.kind === 'event' && k.claim.type === 'theft' && k.claim.item === it.id);
          if (knownTheft) continue;
          const ev = w.emit('item_missing', { actor: p.id, item: it.id, pos: b.pos, placeId: p.workId, significance: 0.45, summary: `${p.name} noticed ${it.name} is missing` });
          learn(w, p, { key: `missing:${it.id}`, kind: 'event', claim: { eventId: ev.id, type: 'item_missing', item: it.id, placeId: p.workId, tick: w.now, actorUnknown: true, significance: 0.45 }, confidence: 0.9, source: { type: 'inferred', viaEvent: ev.id }, cause: ev.id, summary: `${it.name} is missing` });
          remember(w, p, { type: 'item_missing', summary: `${it.name} is gone from its place. Someone took it.`, eventId: ev.id, entities: [it.id], significance: 0.6, valence: -0.5, source: { type: 'inferred', viaEvent: ev.id } });
          p.emotions.anger = clamp(p.emotions.anger + 0.4); p.desires.push({ type: 'recover_item', targetId: it.id, note: `${it.name} was taken from ${w.nameOf(p.workId)}. I want it back.`, reward: 15, fulfilled: false }); this.say(p, `Where is ${it.name}?! It was right here!`);
        }
      }
    }
    // weather
    const wt = w.weather;
    if (w.now >= wt.nextChangeAt) {
      const r = w.rng.next(); const kinds: import('../core/types').WeatherKind[] = wt.kind === 'clear' ? ['clear', 'cloudy', 'cloudy', 'fog'] : wt.kind === 'cloudy' ? ['clear', 'rain', 'cloudy', 'storm'] : wt.kind === 'rain' ? ['cloudy', 'rain', 'storm', 'clear'] : wt.kind === 'storm' ? ['rain', 'cloudy'] : ['clear', 'cloudy'];
      const kind = kinds[Math.floor(r * kinds.length)]; const prev = wt.kind; wt.kind = kind; wt.intensity = kind === 'storm' ? 1 : kind === 'rain' ? 0.5 + w.rng.next() * 0.4 : kind === 'fog' ? 0.7 : 0; wt.wind = 0.1 + w.rng.next() * (kind === 'storm' ? 1 : 0.5); wt.nextChangeAt = w.now + (1.5 + w.rng.next() * 4) * SECONDS_PER_HOUR;
      if (prev !== kind) w.emit('weather', { significance: 0.2, data: { kind }, summary: `The weather turned to ${kind}` });
    }
    w.compactEvents();
  }
}
