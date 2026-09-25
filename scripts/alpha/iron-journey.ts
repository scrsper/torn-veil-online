import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
// Accelerated Normal→Iron journey through ordinary mechanics (Living Alpha acceptance D).
//   node --import tsx scripts/alpha/iron-journey.ts --seed 918271 --path veil --days 30 --out .debug/iron-journey-veil-918271
// A "player" person acts only through the intents a client sends (move, talk, dialogue choices,
// hush, person_action meditate/advance) while online, and is released to ordinary autonomy while
// offline — the same policy the live server applies after a disconnect. No teleport, no state edits,
// no synthetic history: every foundation point comes from the canonical development hooks.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BridgeSession } from '../../src/bridge/session';
import type { Body, Person, Vec3 } from '../../src/sim/core/types';
import { knowsVeil, veilStrain, HUSH_RANGE_M } from '../../src/sim/physical/veil';
import { assessAdvancement } from '../../src/sim/core/advancement';
import { ATTRIBUTE_IDS } from '../../src/sim/core/human';
import { handInteractions } from '../../src/sim/physical/hand';
import { foodForSaleBy } from '../../src/sim/logistics/participation';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const seed = Number(arg('seed', '918271')), days = Number(arg('days', '30')), path = arg('path', 'veil');
const out = arg('out', `.debug/iron-journey-${path}-${seed}`);
assert(!existsSync(out), 'Evidence directory must be new');
mkdirSync(out, { recursive: true });
const resumeFrom = arg('resume', '');
const prior = resumeFrom ? JSON.parse(readFileSync(join(resumeFrom, 'report.json'), 'utf8')) : null;
if (prior) assert(prior.seed === seed && prior.path === path && !prior.advanced, 'Resume identity/path must match an unfinished journey');
const priorDay = prior?.daily.at(-1), priorTotals = prior?.final ? prior : priorDay;
const resumeSave = prior ? readFileSync(join(resumeFrom, prior.finalSaveSha256 ? 'final.save.json' : 'day-' + priorDay.day + '.save.json'), 'utf8') : undefined;
if (prior?.finalSaveSha256) assert(createHash('sha256').update(resumeSave!).digest('hex') === prior.finalSaveSha256, 'Final checkpoint hash mismatch');
const DT = 0.1, started = performance.now(), startedAtIso = new Date().toISOString();
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sourceFiles = [...new Set((git('ls-files', '--', 'src', 'scripts/alpha/iron-journey.ts') + '\n' + git('ls-files', '--others', '--exclude-standard', '--', 'src')).split('\n').filter(Boolean))].sort();
const sourceHash = createHash('sha256');for (const f of sourceFiles) sourceHash.update(f).update(readFileSync(f));
const provenance = { revision: git('rev-parse', 'HEAD'), sourceSha256: sourceHash.digest('hex'), runtime: process.version, startedAtIso,
  resumedFrom: resumeFrom || null, checkpointSha256: resumeSave ? createHash('sha256').update(resumeSave).digest('hex') : null };
const priorElapsed = prior?.elapsedSeconds ?? (priorDay?.elapsedMinutes ?? 0) * 60;
const elapsedPrecisionSeconds = prior?.elapsedPrecisionSeconds ?? (prior && prior.elapsedSeconds === undefined ? 6 : 0.001);
let steps = 0, lastHeartbeat = started;
const elapsedSeconds = () => priorElapsed + (performance.now() - started) / 1000;

let s = new BridgeSession(seed, { playable: true, ...(resumeSave ? { save: resumeSave } : {}) }), w = s.world, p = w.person(w.playerId!)!, body = w.primaryBody(p.id)!;
const worldStart = prior?.worldStart ?? (resumeSave ? w.now - w.physicalTime * w.clock.state().timeScale : w.now), DAY = 86400;
if(prior)assert(p.id === prior.person, 'The original generated trainee must continue');
let seq = 0;
const say = (m: Record<string, unknown>) => s.intent({ version: 1, sequence: ++seq, ...m }).result;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const log: Record<string, unknown>[] = prior?.log ?? [], daily: Record<string, unknown>[] = prior?.daily ?? [];
let eligibilityBeforeBreakthrough: unknown = null;
const note = (event: string, data: Record<string, unknown> = {}) => { const r = { event, day: +((w.now - worldStart) / DAY).toFixed(3), ...data }; log.push(r); console.log(JSON.stringify(r)); };

let online = true;
/** Connect/disconnect the local controller exactly as a client session would (GameSim attach/detach). */
function setOnline(on: boolean) {
  if (on === online) return; online = on;
  if (on) {
    s.game.attach('local', p.id);
    if (body.pose === 'sleep') say({ type: 'person_action', intent: { kind: 'wake' } });
  } else s.game.detach('local');
}
function tick(x = 0, z = 0, sprint = false) {
  if (online && (x || z)) say({ type: 'move', x, z, sprint });
  s.step(DT);
  if(++steps % 600 === 0 && performance.now()-lastHeartbeat > 60_000){lastHeartbeat=performance.now();console.log(JSON.stringify({heartbeat:true,worldDays:(w.now-worldStart)/DAY,elapsedSeconds:elapsedSeconds(),pose:body.pose,wealth:p.wealth,attributes:p.attributes}));}
}
/** Walk along a canonical path using move intents. Gives up (returns false) rather than inventing movement. */
function go(target: Vec3, within = 1.2, budgetSeconds = 900): boolean {
  let pts = w.nav.findPath(body.pos, target, 4000);
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
/** Food and water through the same dialogue/hand surfaces used by a normal player. */
function provision(): boolean {
  if (p.physiology.hydration < 0.75) {
    const wells = w.places().filter(pl => pl.type === 'well').sort((a, b) => dist(a.inside, body.pos) - dist(b.inside, body.pos));
    for (const well of wells.slice(0, 2)) {
      if (!go(well.inside, 1.5)) continue;
      const drink = handInteractions(s.sim, p).find(i => i.kind === 'drink');
      if (drink) { say({ type: 'interact', interactionId: drink.id }); break; }
    }
  }
  for (let meals = 0; meals < 4 && p.physiology.energy < 0.85; meals++) {
    let food = handInteractions(s.sim, p).find(i => i.kind === 'eat');
    if (!food) {
      const sellers = w.livingPersons().filter(q => q.id !== p.id && foodForSaleBy(w, q, p).length)
        .sort((a, b) => dist(w.positionOf(a.id)!, body.pos) - dist(w.positionOf(b.id)!, body.pos));
      for (const seller of sellers.slice(0, 3)) {
        if (dist(w.positionOf(seller.id)!, body.pos) > 250 || !go(w.positionOf(seller.id)!, 1.4)) continue;
        talkChoose(seller, label => label.startsWith('Buy a meal'));
        food = handInteractions(s.sim, p).find(i => i.kind === 'eat');
        if (food) break;
      }
    }
    if (!food) break;
    say({ type: 'interact', interactionId: food.id }); wait(1);
  }
  return p.physiology.energy >= 0.65 && p.physiology.hydration >= 0.65;
}
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

/** Earn provision money through visible resource interactions and ordinary trade. No wages or
 * items are injected. Small, spaced batches avoid treating the legacy gather button as a spam loop. */
function earnProvisions(): boolean {
  const before = p.wealth;
  const sellOwnGoods = () => {
    const traders = w.livingPersons().filter(q => q.id !== p.id && q.wealth > 0 && w.primaryBody(q.id)?.pose !== 'sleep'
      && dist(w.positionOf(q.id)!, body.pos) < 250 && s.sim.tradeOffers(q, p).length)
      .sort((a,b) => dist(w.positionOf(a.id)!,body.pos)-dist(w.positionOf(b.id)!,body.pos));
    for(const trader of traders.slice(0,3)) {
      if(!go(w.positionOf(trader.id)!,1.4,180))continue;
      for(let sale=0;sale<4&&p.wealth<8;sale++) {
        if(say({type:'talk',targetBodyId:w.primaryBody(trader.id)!.id})!=='accepted')break;
        const trade=s.snapshot(false).dialogue?.options.find(o=>o.label==='Trade');
        if(trade)say({type:'dialogue_option',optionId:trade.id});
        const offer=s.snapshot(false).dialogue?.options.find(o=>o.label.startsWith('Sell ')&&/log|stone|stick/.test(o.label));
        const buyerBefore=trader.wealth, sellerBefore=p.wealth;
        if(offer)say({type:'dialogue_option',optionId:offer.id});
        say({type:'dialogue_close'});
        if(!offer||p.wealth<=sellerBefore)break;
        assert.equal(p.wealth-sellerBefore,buyerBefore-trader.wealth,'Trade conserves provision money');
        note('earned_provisions',{buyer:trader.id,offer:offer.label,paid:p.wealth-sellerBefore,wealth:p.wealth});
        wait(10);
      }
      if(p.wealth>=8)return;
    }
  };
  sellOwnGoods();
  if(p.wealth>=8)return true;
  const nodes=w.resourceNodes.filter(n=>(n.kind==='tree'||n.kind==='stone')&&n.state==='available'&&n.remaining>0&&dist(n.pos,body.pos)<250)
    .sort((a,b)=>dist(a.pos,body.pos)-dist(b.pos,body.pos)).slice(0,3);
  for(const node of nodes) {
    if(!go(node.pos,1.2,180))continue;
    for(let batch=0;batch<3;batch++) {
      const action=handInteractions(s.sim,p).find(a=>a.kind==='gather'&&a.id==='gather:'+node.id);
      if(!action)break;
      const result=say({type:'interact',interactionId:action.id});
      note('resource_work',{node:node.id,result,yield:node.yield});
      wait(60);
      const goods=w.items().filter(i=>i.ownerId===p.id&&!i.holderId&&i.pos&&i.quantity>0&&['log','stone','stick'].includes(i.type)&&dist(i.pos,body.pos)<250);
      for(const good of goods.slice(0,4)) {
        if(!go(good.pos!,1.2,180))continue;
        const take=handInteractions(s.sim,p).find(a=>a.kind==='take'&&a.id==='take:'+good.id);
        if(take)say({type:'interact',interactionId:take.id});
      }
      if(!go(node.pos,1.2,180))break;
    }
    sellOwnGoods();
    if(p.wealth>=8)break;
  }
  return p.wealth>before;
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

let hushes = priorTotals?.hushes ?? 0, calmed = priorTotals?.calmed ?? 0, meditations = priorTotals?.meditations ?? 0, refusals = 0, restCycles = 0, spars = priorTotals?.spars ?? 0, drills = priorTotals?.drills ?? 0, advanced = false;
/** Ask a nearby, awake adult to spar through ordinary dialogue; runs the agreed rounds. */
function spar(): boolean {
  const partners = w.livingPersons().filter(q => q.id !== p.id && q.age >= 16 && q.age < 55 && !q.hostile && w.primaryBody(q.id)?.pose !== 'sleep'
    && dist(w.positionOf(q.id)!, body.pos) < 40).sort((a, b) => dist(w.positionOf(a.id)!, body.pos) - dist(w.positionOf(b.id)!, body.pos)).slice(0, 3);
  for (const partner of partners) {
  if (!go(w.positionOf(partner.id)!, 1.4, 120)) continue;
  wait(0.6);
  const lines = talkChoose(partner, l => l === 'Spar with me a few rounds');
  if (!lines?.length) continue;
  spars++; wait(330);
  return true;
  }
  return false;
}
function practiceSession(physicalSeconds: number) {
  const end = w.physicalTime + physicalSeconds;
  while (w.physicalTime < end && !advanced) {
    if (!p.alive) return;
    if (body.pose === 'downed' || body.pose === 'sleep') { wait(10); continue; }
    const a = assessAdvancement(w, p);
    if (a.eligible) { eligibilityBeforeBreakthrough = { assessment: a, foundations: {...p.attributes}, physiology: {...p.physiology}, capability: structuredClone(p.capability), at: w.now }; const r = say({ type: 'person_action', intent: { kind: 'advance' } }); note('advance_intent', { result: r, path: a.path }); wait(120); if (p.ontology.stage === 'Iron') { advanced = true; return; } continue; }
    // Recovery: too tired or parched to practise — hand back to ordinary life for a while.
    // Practice itself refuses a body below 0.3 energy or water, so hand back before that point.
    if (p.physiology.energy < 0.65 || p.physiology.hydration < 0.65) {
      if (p.wealth < 4 && p.physiology.energy > 0.35 && p.physiology.hydration > 0.4) earnProvisions();
      if (!provision()) return;
    }
    if (p.physiology.fatigue > 0.5) return;
    const strain = veilStrain(w, p);
    // A balanced day: the veil in the morning, the body in the afternoon. Iron asks every other
    // foundation to be sound, and the veil alone never exercises strength, dexterity or endurance.
    if (path === 'martial' || w.clock.hourF >= 16) {
      if (spar()) continue;
      if (say({ type: 'person_action', intent: { kind: 'train' } }) === 'accepted') { drills++; wait(330); continue; }
    }
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

note('start', { seed, path, person: p.id, wealth: p.wealth, attributes: { ...p.attributes }, potential: { ...p.attributePotential }, skills: { ...p.skills }, physiology: { ...p.physiology } });
if (!knowsVeil(p) && !learnVeil()) { note('failed', { reason: 'could not learn the veil' }); }
let lastDay = priorDay?.day ?? -1, loops = 0;
while ((w.now - worldStart) / DAY < days && p.alive && !advanced && knowsVeil(p)) {
  if (existsSync(join(out, 'STOP'))) break;
  const hour = w.clock.hourF;
  // Online for a daytime play window (13:00–19:00 world time), offline otherwise.
  const wantOnline = hour >= 13 && hour < 19;
  setOnline(wantOnline);
  const before = w.physicalTime;
  if (wantOnline) practiceSession(300);
  if (!wantOnline || w.physicalTime - before < 1) {
    // Offline, or too tired/hungry/thirsty to practise: ordinary autonomous life looks after the
    // body (eating, drinking, sleeping) for half an hour of play time before trying again.
    setOnline(false);
    for (let i = 0; i < (wantOnline ? 18000 : 600); i++) tick();
  }
  if (++loops % 60 === 0) console.log(JSON.stringify({ progress: +((w.now - worldStart) / DAY).toFixed(3), hushes, meditations, hour: +w.clock.hourF.toFixed(2), online, pose: body.pose, strain: +veilStrain(w, p).toFixed(2), will: p.attributes.will, elapsedMin: +((performance.now() - started) / 60000).toFixed(1) }));
  const day = Math.floor((w.now - worldStart) / DAY);
  if (day !== lastDay) {
    lastDay = day;
    const a = assessAdvancement(w, p);
    const row = { day, attributes: { ...p.attributes }, veilcraft: +(p.skills.veilcraft ?? 0).toFixed(3), capabilityHours: +((p.capability?.bySkill.veilcraft?.effectiveSeconds ?? 0) / 3600).toFixed(2),
      hushes, calmed, meditations, spars, drills, strain: +veilStrain(w, p).toFixed(2), wealth: p.wealth, energy: +p.physiology.energy.toFixed(2), hydration: +p.physiology.hydration.toFixed(2),
      blockers: a.reasons, needs: {...p.needs}, physiology: {...p.physiology}, injuries: structuredClone(body.injuries), skills: {...p.skills}, development: structuredClone(p.development), capability: structuredClone(p.capability), physicalHours: +((w.physicalTime) / 3600).toFixed(1), elapsedMinutes: +((performance.now() - started) / 60000).toFixed(1) };
    daily.push(row); console.log(JSON.stringify({ daily: row }));
    const saved = s.save();
    writeFileSync(join(out, `day-${day}.save.json`), saved);
    const continuity = JSON.stringify({ person: p, body, clock: w.clock.state() });
    s = new BridgeSession(seed, { playable: true, save: saved }); w = s.world;
    p = w.person(p.id)!; body = w.body(body.id)!;
    assert.equal(JSON.stringify({ person: p, body, clock: w.clock.state() }), continuity, 'Daily reload preserves the trainee, body and clock');
    if (!online) s.game.detach('local');
    writeFileSync(join(out, 'report.json'), JSON.stringify({ provenance, seed, path, days, worldStart, elapsedPrecisionSeconds, elapsedSeconds: elapsedSeconds(), person: p.id, advanced, daily, log }, null, 2));
  }
}
setOnline(true);
const iron = w.events.find(e => e.type === 'ontological_advancement' && e.actor === p.id);
const result = { provenance, worldStart, elapsedPrecisionSeconds, elapsedSeconds: elapsedSeconds(), eligibilityBeforeBreakthrough, seed, path, person: p.id, advanced: p.ontology.stage === 'Iron', ironEvent: iron && { id: iron.id, tick: iron.tick, causes: iron.causes, data: iron.data },
  status: advanced ? 'advanced' : existsSync(join(out, 'STOP')) ? 'paused' : 'limit-reached',
  worldSecondsElapsed: w.now - worldStart, worldDays: +((w.now - worldStart) / DAY).toFixed(3), physicalHours: +(w.physicalTime / 3600).toFixed(2), hushes, calmed, meditations, spars, drills,
  final: { attributes: { ...p.attributes }, potential: { ...p.attributePotential }, skills: { ...p.skills }, wealth: p.wealth, alive: p.alive, needs: p.needs, physiology: p.physiology, injuries: body.injuries, development: p.development, capability: p.capability, techniques: Object.values(p.knowledge).filter(k => k.kind === 'technique') },
  socialConsequences: w.livingPersons().filter(q => q.relationships[p.id]).map(q => ({ id: q.id, fear: +q.relationships[p.id].fear.toFixed(2), trust: +q.relationships[p.id].trust.toFixed(2) })).sort((a, b) => b.fear - a.fear).slice(0, 10),
  attributeIds: ATTRIBUTE_IDS, elapsedMinutes: +((performance.now() - started) / 60000).toFixed(1) };
const finalSave = s.save();
writeFileSync(join(out, 'final.save.json'), finalSave);
writeFileSync(join(out, 'report.json'), JSON.stringify({ ...result, finalSaveSha256: createHash('sha256').update(finalSave).digest('hex'), daily, log }, null, 2));
if (!advanced && result.status !== 'paused') process.exitCode = 1;
console.log(JSON.stringify(result));
