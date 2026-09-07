import type { Concern, EntityId, ItemType, KnowledgeItem, Person, WorldEvent } from '../../sim/core/types';
import type { World } from '../../sim/core/world';
import type { Simulation } from '../../sim/mind/agent';
import { runHeadless } from '../runner';
import { SECONDS_PER_HOUR } from '../../sim/core/time';
import { activeConcerns, describeConcern } from '../../sim/mind/concern';
import { causeBeliefs } from '../../sim/mind/inference';
import { shortfallBeliefs } from '../../sim/world/shortfall';
import { describeClaim } from '../../sim/mind/knowledge';
import { explainConcern, explainGoal, explainRelationship, traceLines } from '../../sim/history/causality';

/**
 * CAUSAL-SOCIETY ACCEPTANCE HARNESS.
 *
 * Same shape and same discipline as v0.9's `social:trace` and v0.10's `motive:trace`: boot the
 * REAL generated village that the browser client and every WorldLab scenario use, seed at most
 * one triggering event through a canonical `Simulation` method that an NPC would go through
 * anyway, and then only watch. No player is ever embodied; nothing about the outcome is scripted.
 *
 * Participants are chosen STRUCTURALLY — by occupation and by what the world happens to need —
 * never by name, so a report is evidence that the mechanisms are generic rather than tuned for
 * one authored pair of people.
 *
 * What it reports that the earlier harnesses cannot: whether an ECONOMIC fact ever became
 * something a mind held, whether it travelled with its provenance intact, whether anybody
 * concluded anything from it, and whether a decision taken days later can be walked back to the
 * event that caused it.
 */

export type CausalScenario = 'undisturbed' | 'producer_struck';

export interface CausalTraceOptions {
  scenario: CausalScenario;
  seed?: number;
  days?: number;
  /** World-time between observations. Fine enough to catch a goal that lasts one shift. */
  probeSeconds?: number;
}

export interface StoppageRecord { day: number; hour: number; place: string; need: string; making: string; worker: string; }
export interface HolderRecord { who: string; source: string; from?: string; hops: number; confidence: number; }
export interface BeliefSpread { key: string; what: string; holders: HolderRecord[]; maxHops: number; }
export interface ConclusionRecord {
  who: string; text: string; rule: string; confidence: number; hops: number;
  because: string; responsible?: string;
}
export interface DecisionRecord { day: number; hour: number; who: string; goal: string; utility: number; reason: string; carrying: string; }
export interface RelationshipShift { from: string; to: string; reason: string; trust: number; grudge: number; affection: number; day: number; }
export interface TraceChain { title: string; lines: string[]; }

export interface CausalAcceptance {
  relationshipConsequence: string[];
  informationWithProvenance: string[];
  economicDisruption: string[];
  injuryOrDeathDownstream: string[];
  decisionTracedToEarlierEvent: string[];
}

export interface CausalTraceReport {
  scenario: CausalScenario;
  seed: number;
  days: number;
  wallSeconds: number;
  population: number;
  deaths: string[];
  stoppages: StoppageRecord[];
  spread: BeliefSpread[];
  supplyConcerns: { who: string; what: string; intensity: number; reasons: string[] }[];
  conclusions: ConclusionRecord[];
  decisions: DecisionRecord[];
  relationshipShifts: RelationshipShift[];
  chains: TraceChain[];
  acceptance: CausalAcceptance;
}

const HOUR = SECONDS_PER_HOUR;

function firstBy(world: World, occupation: string): Person | undefined {
  return world.persons().filter(p => p.alive && !p.controlled && p.occupation === occupation).sort((a, b) => a.id.localeCompare(b.id))[0];
}

export function runCausalTrace(opts: CausalTraceOptions): CausalTraceReport {
  const seed = opts.seed ?? 918271;
  const days = opts.days ?? 30;
  const probeSeconds = opts.probeSeconds ?? 900;
  const startedAt = Date.now();

  const stoppages: StoppageRecord[] = [];
  const decisions: DecisionRecord[] = [];
  const relationshipShifts: RelationshipShift[] = [];
  const seenEvents = new Set<string>();
  const lastGoal = new Map<EntityId, string>();
  let struck = false;

  /** The one seeded happening, and only in the scenario that asks for it: a bandit strikes the
   * village's producer down, through `Simulation.applyHit` — the exact method every NPC fight and
   * every player swing already goes through. Held until the moment somebody is actually there to
   * SEE it, because a killing nobody witnessed is (correctly) a killing nobody can ever learn of,
   * and this harness exists to trace what happens when information does exist, not to prove that
   * the epistemics work — the focused tests do that. */
  const maybeStrike = (world: World, sim: Simulation): void => {
    if (struck || opts.scenario !== 'producer_struck') return;
    if (world.clock.day < 1 || world.clock.hourF < 8 || world.clock.hourF > 18) return;
    const producer = firstBy(world, 'miller');
    const raider = world.persons().filter(p => p.alive && p.hostile).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!producer || !raider) return;
    const pb = world.primaryBody(producer.id); const rb = world.primaryBody(raider.id);
    if (!pb || !rb || pb.dead) return;
    // Somebody who is not the raider has the producer in view right now.
    const witness = world.persons().some(q => q.alive && !q.controlled && q.id !== producer.id && q.id !== raider.id
      && q.mind.percepts.some(pc => pc.entityId === producer.id && pc.how === 'saw'));
    if (!witness) return;
    rb.pos = { x: pb.pos.x + 1, y: pb.pos.y, z: pb.pos.z };
    sim.applyHit(raider, rb, pb, 200, 'kill');
    struck = true;
  };

  const observe = (world: World, sim: Simulation): void => {
    maybeStrike(world, sim);
    const day = world.clock.day; const hour = Math.floor(world.clock.hourF);
    for (const e of world.events) {
      if (seenEvents.has(e.id)) continue;
      seenEvents.add(e.id);
      if (e.type === 'work_blocked') {
        stoppages.push({
          day, hour, place: world.nameOf(e.placeId ?? ''), need: String(e.data.need),
          making: String(e.data.making), worker: world.nameOf(e.actor ?? ''),
        });
      } else if (e.type === 'relationship_changed' && e.actor && e.target) {
        const after = e.data.after as { trust: number; grudge: number; affection: number } | undefined;
        if (!after) continue;
        relationshipShifts.push({
          from: world.nameOf(e.actor), to: world.nameOf(e.target), reason: String(e.data.reason ?? ''),
          trust: round(after.trust), grudge: round(after.grudge), affection: round(after.affection), day,
        });
      }
    }
    // A decision taken while carrying a supply worry — the behaviour half of the chain.
    for (const p of world.persons()) {
      if (!p.alive || p.controlled || !p.mind.goal) continue;
      const key = `${p.mind.goal.key}@${p.mind.goal.createdAt}`;
      if (lastGoal.get(p.id) === key) continue;
      lastGoal.set(p.id, key);
      const supply = activeConcerns(p).filter(c => c.kind === 'supply');
      if (!supply.length) continue;
      const g = p.mind.goal;
      if (g.type !== 'haul' && g.type !== 'work' && g.type !== 'shop') continue;
      decisions.push({
        day, hour, who: p.name, goal: `${g.type}${g.data?.resource ? ` (${g.data.resource})` : ''}`,
        utility: round(g.utility), reason: g.reasons.find(r => /concern|short/i.test(r)) ?? g.reasons[0] ?? '',
        carrying: supply.map(c => describeConcern(world, c)).join('; '),
      });
    }
  };

  const result = runHeadless({
    seed, days, stepSeconds: 0.15, maintenanceIntervalSeconds: HOUR,
    probeIntervalSeconds: probeSeconds,
    onProbe: (world, sim) => observe(world, sim),
  });
  const { world } = result;

  // ---- what people ended up believing, and how they came by it
  const spreadByKey = new Map<string, BeliefSpread>();
  for (const p of world.persons()) {
    if (p.controlled) continue;
    for (const k of Object.values(p.knowledge)) {
      if (k.kind !== 'event' || k.claim.type !== 'work_blocked') continue;
      let s = spreadByKey.get(k.key);
      if (!s) spreadByKey.set(k.key, s = { key: k.key, what: describeClaim(world, k), holders: [], maxHops: 0 });
      s.holders.push({
        who: p.name, source: k.source.type, from: k.source.from ? world.nameOf(k.source.from) : undefined,
        hops: k.hops, confidence: round(k.confidence),
      });
      s.maxHops = Math.max(s.maxHops, k.hops);
    }
  }
  const spread = [...spreadByKey.values()].filter(s => s.holders.length > 1).sort((a, b) => b.holders.length - a.holders.length);

  const supplyConcerns: CausalTraceReport['supplyConcerns'] = [];
  const conclusions: ConclusionRecord[] = [];
  for (const p of world.persons()) {
    if (p.controlled || !p.alive) continue;
    for (const c of activeConcerns(p)) {
      if (c.kind !== 'supply') continue;
      supplyConcerns.push({ who: p.name, what: describeConcern(world, c), intensity: round(c.intensity), reasons: c.reasons.slice(0, 3) });
    }
    for (const k of causeBeliefs(p)) {
      const premise = p.knowledge[k.claim.becauseKey as string];
      conclusions.push({
        who: p.name, text: String(k.claim.text ?? ''), rule: String(k.claim.rule ?? ''),
        confidence: round(k.confidence), hops: k.hops,
        because: premise ? `${describeClaim(world, premise)} (${premise.source.type}${premise.source.from ? ` by ${world.nameOf(premise.source.from)}` : ''}, ${premise.hops} hops, confidence ${round(premise.confidence)})` : '(the belief behind it has since been forgotten)',
        responsible: k.claim.responsibleId ? world.nameOf(k.claim.responsibleId as string) : undefined,
      });
    }
  }

  const chains = buildChains(world, conclusions);
  const deaths = world.persons().filter(p => !p.alive).map(p => p.name);

  return {
    scenario: opts.scenario, seed, days,
    wallSeconds: round((Date.now() - startedAt) / 1000),
    population: world.persons().filter(p => p.alive && !p.controlled).length,
    deaths, stoppages, spread, supplyConcerns, conclusions,
    decisions, relationshipShifts, chains,
    acceptance: assess(world, { stoppages, spread, supplyConcerns, conclusions, decisions, relationshipShifts, deaths, chains }),
  };
}

/** Rendered "X because Y because Z" walks for a handful of the most interesting states the run
 * actually produced. Chosen structurally: whoever concluded the most confident thing, whoever
 * carries the strongest supply worry, and whoever is currently acting on one. */
function buildChains(world: World, conclusions: ConclusionRecord[]): TraceChain[] {
  const out: TraceChain[] = [];
  const people = world.persons().filter(p => p.alive && !p.controlled);

  const withCause = people
    .map(p => ({ p, k: causeBeliefs(p).sort((a, b) => b.confidence - a.confidence)[0] }))
    .filter((x): x is { p: Person; k: KnowledgeItem } => !!x.k)
    .sort((a, b) => b.k.confidence - a.k.confidence)[0];
  if (withCause) {
    const supply = activeConcerns(withCause.p).find(c => c.kind === 'supply');
    if (supply) out.push({ title: `${withCause.p.name}: why they are short`, lines: traceLines(explainConcern(world, withCause.p, supply)) });
    const blamed = withCause.k.claim.responsibleId as EntityId | undefined;
    if (blamed) out.push({ title: `${withCause.p.name} → ${world.nameOf(blamed)}`, lines: traceLines(explainRelationship(world, withCause.p, blamed)) });
  }

  // Somebody whose CURRENT goal is one a supply worry can actually lift — otherwise the walk
  // honestly reports "no concern was responsible for this", which is true but uninteresting.
  const acting = people.find(p => p.mind.goal
    && (p.mind.goal.type === 'haul' || p.mind.goal.type === 'work' || p.mind.goal.type === 'shop')
    && activeConcerns(p).some(c => c.kind === 'supply'));
  if (acting?.mind.goal) out.push({ title: `${acting.name}: why they are doing what they are doing`, lines: traceLines(explainGoal(world, acting, acting.mind.goal)) });

  const strongestWorry = people
    .flatMap(p => activeConcerns(p).map(c => ({ p, c })))
    .sort((a, b) => b.c.intensity - a.c.intensity)[0];
  if (strongestWorry) out.push({ title: `${strongestWorry.p.name}: what weighs on them most`, lines: traceLines(explainConcern(world, strongestWorry.p, strongestWorry.c as Concern)) });

  void conclusions;
  return out;
}

/** The five things the milestone asks an unattended run to demonstrate, each answered with the
 * evidence from THIS run or left empty. Nothing here invents a chain the run did not produce. */
function assess(world: World, r: {
  stoppages: StoppageRecord[]; spread: BeliefSpread[]; supplyConcerns: CausalTraceReport['supplyConcerns'];
  conclusions: ConclusionRecord[]; decisions: DecisionRecord[]; relationshipShifts: RelationshipShift[];
  deaths: string[]; chains: TraceChain[];
}): CausalAcceptance {
  const relationshipConsequence = r.relationshipShifts
    .filter(s => /carried|saw |heard of|witnessed|learned of|I believe/.test(s.reason))
    .slice(0, 6)
    .map(s => `day ${s.day}: ${s.from} → ${s.to} (${s.reason}) — trust ${s.trust}, grudge ${s.grudge}, affection ${s.affection}`);

  const informationWithProvenance = r.spread
    .filter(s => s.holders.some(h => h.hops === 0) && s.holders.some(h => h.hops > 0))
    .slice(0, 4)
    .map(s => `${s.what}: ${s.holders.map(h => `${h.who} (${h.source}${h.from ? ` by ${h.from}` : ''}, ${h.hops} hops, confidence ${h.confidence})`).join('; ')}`);

  const economicDisruption = r.decisions.slice(0, 6)
    .map(d => `day ${d.day} ${String(d.hour).padStart(2, '0')}h: ${d.who} took up ${d.goal} at utility ${d.utility} while ${d.carrying}`);

  const producerConclusions = r.conclusions.filter(c => c.rule !== 'upstream_short');
  const injuryOrDeathDownstream = r.deaths.length && producerConclusions.length
    ? producerConclusions.slice(0, 4).map(c => `${c.who}: "${c.text}" (${c.rule}, confidence ${c.confidence}, ${c.hops} hops) because ${c.because}`)
    : [];

  const decisionTracedToEarlierEvent = r.chains.filter(c => c.lines.length > 1).slice(0, 3)
    .map(c => `${c.title}\n${c.lines.join('\n')}`);

  void world;
  return { relationshipConsequence, informationWithProvenance, economicDisruption, injuryOrDeathDownstream, decisionTracedToEarlierEvent };
}

function round(v: number): number { return Math.round(v * 100) / 100; }

export function formatCausalReport(r: CausalTraceReport): string {
  const L: string[] = [];
  L.push(`CAUSAL SOCIETY TRACE — scenario "${r.scenario}", seed ${r.seed}, ${r.days} world days, ${r.wallSeconds}s wall`);
  L.push(`population ${r.population} alive${r.deaths.length ? `, died: ${r.deaths.join(', ')}` : ''}`);
  L.push('');
  L.push(`STOPPAGES (${r.stoppages.length})`);
  for (const s of r.stoppages.slice(0, 12)) L.push(`  day ${s.day} ${String(s.hour).padStart(2, '0')}h  ${s.worker} could make no ${s.making} at ${s.place}: no ${s.need}`);
  if (r.stoppages.length > 12) L.push(`  ... and ${r.stoppages.length - 12} more`);
  L.push('');
  L.push(`WHAT TRAVELLED (${r.spread.length} beliefs held by more than one person)`);
  for (const s of r.spread.slice(0, 6)) {
    L.push(`  ${s.what}`);
    for (const h of s.holders.slice(0, 8)) L.push(`    ${h.who}: ${h.source}${h.from ? ` by ${h.from}` : ''}, ${h.hops} hop${h.hops === 1 ? '' : 's'}, confidence ${h.confidence}`);
  }
  L.push('');
  L.push(`SUPPLY WORRIES CARRIED (${r.supplyConcerns.length})`);
  for (const c of r.supplyConcerns.slice(0, 10)) L.push(`  ${c.who}: ${c.what} [${c.intensity}] — ${c.reasons.join('; ')}`);
  L.push('');
  L.push(`CONCLUSIONS DRAWN (${r.conclusions.length})`);
  for (const c of r.conclusions.slice(0, 10)) {
    L.push(`  ${c.who}: "${c.text}"  (${c.rule}, confidence ${c.confidence}, ${c.hops} hops${c.responsible ? `, holds ${c.responsible} responsible` : ', nobody named'})`);
    L.push(`      because ${c.because}`);
  }
  L.push('');
  L.push(`DECISIONS TAKEN WHILE SHORT (${r.decisions.length})`);
  for (const d of r.decisions.slice(0, 10)) L.push(`  day ${d.day} ${String(d.hour).padStart(2, '0')}h  ${d.who} → ${d.goal} [${d.utility}] while ${d.carrying}`);
  L.push('');
  L.push('TRACES');
  for (const c of r.chains) { L.push(`  ${c.title}`); for (const line of c.lines) L.push(`    ${line}`); L.push(''); }
  L.push('ACCEPTANCE');
  for (const [k, v] of Object.entries(r.acceptance)) {
    L.push(`  ${k}: ${v.length ? 'yes' : 'NOT OBSERVED'}`);
    for (const line of v) for (const sub of line.split('\n')) L.push(`      ${sub}`);
  }
  return L.join('\n');
}

/** Kept so a caller can narrow the event stream the same way this harness does. */
export function isCausalEvent(e: WorldEvent): boolean {
  return e.type === 'work_blocked' || e.type === 'concern_formed' || e.type === 'relationship_changed';
}

export type { ItemType };
