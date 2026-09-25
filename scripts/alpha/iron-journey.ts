// Accelerated Normal→Iron journey through ordinary mechanics (Living Alpha acceptance D).
//   node --import tsx scripts/alpha/iron-journey.ts --seed 918271 --path veil --days 30 --out .debug/iron-journey-veil-918271
// A "player" person acts only through the intents a client sends (move, talk, dialogue choices,
// hush, person_action meditate/advance) while online, and is released to ordinary autonomy while
// offline — the same policy the live server applies after a disconnect. No teleport, no state edits,
// no synthetic history: every foundation point comes from the canonical development hooks.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BridgeSession } from '../../src/bridge/session';
import type { Body, Person, Vec3 } from '../../src/sim/core/types';
import { knowsVeil, veilStrain, HUSH_RANGE_M } from '../../src/sim/physical/veil';
import { assessAdvancement } from '../../src/sim/core/advancement';
import { ATTRIBUTE_IDS } from '../../src/sim/core/human';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const seed = Number(arg('seed', '918271')), days = Number(arg('days', '30')), path = arg('path', 'veil');
const out = arg('out', `.debug/iron-journey-${path}-${seed}`);
mkdirSync(out, { recursive: true });
const DT = 0.1, started = performance.now();
const s = new BridgeSession(seed, { playable: true }), w = s.world, p = w.person(w.playerId!)!, body = w.primaryBody(p.id)!;
const worldStart = w.now, DAY = 86400;
let seq = 0;
const say = (m: Record<string, unknown>) => s.intent({ version: 1, sequence: ++seq, ...m }).result;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const log: Record<string, unknown>[] = [], daily: Record<string, unknown>[] = [];
const note = (event: string, data: Record<string, unknown> = {}) => { const r = { event, day: +((w.now - worldStart) / DAY).toFixed(3), ...data }; log.push(r); console.log(JSON.stringify(r)); };

let online = true;
/** Connect/disconnect the local controller exactly as a client session would (GameSim attach/detach). */
function setOnline(on: boolean) {
  if (on === online) return; online = on;
  if (on) { s.game.attach('local', p.id); p.mind.plan = []; p.mind.goal = null; } else s.game.detach('local');
}
function tick(x = 0, z = 0, sprint = false) {
  if (online && (x || z)) say({ type: 'move', x, z, sprint });
  s.step(DT);
}
/** Walk along a canonical path using move intents. Gives up (returns false) rather than inventing movement. */
function go(target: Vec3, within = 1.2, budgetSeconds = 900): boolean {
  let pts = w.nav.findPath(body.pos, target, 400);
  if (!pts) return false;
  const t0 = w.physicalTime;
  for (const pt of pts) {
    let stuck = 0;
    while (dist(body.pos, pt) > 0.3) {
      if (w.physicalTime - t0 > budgetSeconds || body.pose === 'downed' || body.pose === 'sleep') return false;
      const dx = pt.x - body.pos.x, dz = pt.z - body.pos.z, l = Math.hypot(dx, dz), old = { ...body.pos };
      tick(dx / l, dz / l, l > 4);
      if (dist(old, body.pos) < 0.001) { if (++stuck > 30) return false; } else stuck = 0;
      if (dist(body.pos, target) <= within) return true;
    }
  }
  return dist(body.pos, target) <= within + 1;
}
function wait(seconds: number) { for (let t = 0; t < seconds; t += DT) tick(); }
function talkChoose(npc: Person, pick: (label: string) => boolean): string[] | null {
  const nb = w.primaryBody(npc.id)!;
  if (say({ type: 'talk', targetBodyId: nb.id }) !== 'accepted') return null;
  const menu = s.snapshot(false).dialogue; const o = menu?.options.find(x => pick(x.label));
  if (!o) { say({ type: 'dialogue_close' }); return null; }
  say({ type: 'dialogue_option', optionId: o.id });
  const lines = s.snapshot(false).dialogue?.lines ?? [];
  say({ type: 'dialogue_close' });
  return lines;
}

// 1. Learn the veil from someone who keeps it, paying their fee.
function learnVeil(): boolean {
  const keepers = w.livingPersons().filter(q => q.id !== p.id && knowsVeil(q)).sort((a, b) => dist(w.positionOf(a.id)!, body.pos) - dist(w.positionOf(b.id)!, body.pos));
  for (const keeper of keepers.slice(0, 3)) for (let attempt = 0; attempt < 6; attempt++) {
    const kb = w.primaryBody(keeper.id)!;
    if (kb.pose === 'sleep') { wait(120); continue; }
    if (!go(kb.pos, 1.5)) { wait(30); continue; }
    wait(0.6);
    const lines = talkChoose(keeper, l => l.startsWith('Teach me the hush'));
    note('lesson_attempt', { keeper: keeper.id, lines });
    if (knowsVeil(p)) return true;
  }
  return false;
}

/** Nearest non-sleeping creature or person within hush range with a clear line of sight. */
function hushTarget(): Body | undefined {
  const eye = { ...body.pos, y: body.pos.y + 1.6 };
  return w.nearbyPhysicalBodies(body.pos, HUSH_RANGE_M).filter(b => b.id !== body.id && !b.dead && b.present && b.pose !== 'sleep'
    && (w.get(b.ownerId)?.kind === 'creature' || !!w.person(b.ownerId)?.alive)
    && dist(b.pos, body.pos) <= HUSH_RANGE_M - 0.5 && w.grid.lineOfSight(eye, { ...b.pos, y: b.pos.y + 0.8 }, HUSH_RANGE_M + 1))
    .sort((a, b) => (w.get(a.ownerId)?.kind === 'creature' ? 0 : 1) - (w.get(b.ownerId)?.kind === 'creature' ? 0 : 1) || dist(a.pos, body.pos) - dist(b.pos, body.pos))[0];
}
/** Somewhere people or animals are about: the settlement square nearest to where we are. */
function gatheringPlace(): Vec3 {
  const squares = w.places().filter(pl => pl.type === 'square').sort((a, b) => dist(a.inside, body.pos) - dist(b.inside, body.pos));
  return squares[0]?.inside ?? body.pos;
}

let hushes = 0, calmed = 0, meditations = 0, refusals = 0, restCycles = 0, spars = 0, drills = 0, advanced = false;
/** Ask a nearby, awake adult to spar through ordinary dialogue; runs the agreed rounds. */
function spar(): boolean {
  const partner = w.livingPersons().filter(q => q.id !== p.id && q.age >= 16 && q.age < 55 && !q.hostile && w.primaryBody(q.id)?.pose !== 'sleep'
    && dist(w.positionOf(q.id)!, body.pos) < 40).sort((a, b) => dist(w.positionOf(a.id)!, body.pos) - dist(w.positionOf(b.id)!, body.pos))[0];
  if (!partner || !go(w.positionOf(partner.id)!, 1.4, 120)) return false;
  wait(0.6);
  const lines = talkChoose(partner, l => l === 'Spar with me a few rounds');
  if (!lines?.length) return false;
  spars++; wait(330);
  return true;
}
function practiceSession(physicalSeconds: number) {
  const end = w.physicalTime + physicalSeconds;
  while (w.physicalTime < end && !advanced) {
    if (!p.alive) return;
    if (body.pose === 'downed' || body.pose === 'sleep') { wait(10); continue; }
    const a = assessAdvancement(w, p);
    if (a.eligible) { const r = say({ type: 'person_action', intent: { kind: 'advance' } }); note('advance_intent', { result: r, path: a.path }); wait(120); if (p.ontology.stage === 'Iron') { advanced = true; return; } continue; }
    // Recovery: too tired or parched to practise — hand back to ordinary life for a while.
    if (p.physiology.fatigue > 0.7 || p.physiology.energy < 0.2 || p.physiology.hydration < 0.2) return;
    const strain = veilStrain(w, p);
    const target = strain < 0.7 ? hushTarget() : undefined;
    if (target) {
      const r = say({ type: 'hush', targetBodyId: target.id });
      if (r === 'calmed' || r === 'resisted') { hushes++; if (r === 'calmed') calmed++; }
      wait(r === 'cooldown' ? 6 : 7);
      continue;
    }
    // Round out the body: while the veil is strained, spar with a willing villager every other time.
    if (strain >= 0.5 && ++restCycles % 2 === 0) {
      if (spar()) continue;
      // No willing partner about: drill alone (the same session mechanic, a lower ceiling).
      if (say({ type: 'person_action', intent: { kind: 'train' } }) === 'accepted') { drills++; wait(330); continue; }
    }
    if (strain >= 0.5 || !hushTarget()) {
      // Meditate while strained, or while no one is about; move toward people afterwards.
      const r = say({ type: 'person_action', intent: { kind: 'meditate' } });
      if (r === 'accepted') { meditations++; wait(310); }
      else if (refusals++ < 5) note('meditate_refused', { result: r, pose: body.pose, plan: p.mind.plan.map(a => a.type) });
      if (!hushTarget()) go(gatheringPlace(), 6, 300);
    }
    // Time always advances, whatever was or was not possible just now.
    wait(5);
  }
}

note('start', { seed, path, person: p.id, wealth: p.wealth, attributes: { ...p.attributes }, potential: { ...p.attributePotential } });
if (!learnVeil()) { note('failed', { reason: 'could not learn the veil' }); }
let lastDay = -1, loops = 0;
while ((w.now - worldStart) / DAY < days && p.alive && !advanced && knowsVeil(p)) {
  const hour = w.clock.hourF;
  // Online for a daytime play window (08:00–18:00 world time), offline otherwise.
  const wantOnline = hour >= 8 && hour < 18;
  setOnline(wantOnline);
  const before = w.physicalTime;
  if (wantOnline) practiceSession(300);
  if (!wantOnline || w.physicalTime - before < 1) {
    // Offline, or too tired/hungry/thirsty to practise: ordinary autonomous life looks after the
    // body (eating, drinking, sleeping) for half an hour of play time before trying again.
    setOnline(false);
    for (let i = 0; i < (wantOnline ? 18000 : 600); i++) s.step(DT);
  }
  if (++loops % 60 === 0) console.log(JSON.stringify({ progress: +((w.now - worldStart) / DAY).toFixed(3), hushes, meditations, hour: +w.clock.hourF.toFixed(2), online, pose: body.pose, strain: +veilStrain(w, p).toFixed(2), will: p.attributes.will, elapsedMin: +((performance.now() - started) / 60000).toFixed(1) }));
  const day = Math.floor((w.now - worldStart) / DAY);
  if (day !== lastDay) {
    lastDay = day;
    const a = assessAdvancement(w, p);
    const row = { day, attributes: { ...p.attributes }, veilcraft: +(p.skills.veilcraft ?? 0).toFixed(3), capabilityHours: +((p.capability?.bySkill.veilcraft?.effectiveSeconds ?? 0) / 3600).toFixed(2),
      hushes, calmed, meditations, spars, drills, strain: +veilStrain(w, p).toFixed(2), wealth: p.wealth, energy: +p.physiology.energy.toFixed(2), hydration: +p.physiology.hydration.toFixed(2),
      blockers: a.reasons, physicalHours: +((w.physicalTime) / 3600).toFixed(1), elapsedMinutes: +((performance.now() - started) / 60000).toFixed(1) };
    daily.push(row); console.log(JSON.stringify({ daily: row }));
    writeFileSync(join(out, 'report.json'), JSON.stringify({ seed, path, days, person: p.id, advanced, daily, log }, null, 2));
  }
}
setOnline(true);
const iron = w.events.find(e => e.type === 'ontological_advancement' && e.actor === p.id);
const result = { seed, path, person: p.id, advanced: p.ontology.stage === 'Iron', ironEvent: iron && { id: iron.id, tick: iron.tick, causes: iron.causes, data: iron.data },
  worldDays: +((w.now - worldStart) / DAY).toFixed(3), physicalHours: +(w.physicalTime / 3600).toFixed(2), hushes, calmed, meditations,
  final: { attributes: { ...p.attributes }, potential: { ...p.attributePotential }, skills: { ...p.skills }, wealth: p.wealth, alive: p.alive },
  socialConsequences: w.livingPersons().filter(q => q.relationships[p.id]).map(q => ({ id: q.id, fear: +q.relationships[p.id].fear.toFixed(2), trust: +q.relationships[p.id].trust.toFixed(2) })).sort((a, b) => b.fear - a.fear).slice(0, 10),
  attributeIds: ATTRIBUTE_IDS, elapsedMinutes: +((performance.now() - started) / 60000).toFixed(1) };
writeFileSync(join(out, 'report.json'), JSON.stringify({ ...result, daily, log }, null, 2));
writeFileSync(join(out, 'final.save.json'), s.save());
console.log(JSON.stringify(result));
