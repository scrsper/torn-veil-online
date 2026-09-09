import type { EntityId, Person, WorkStint } from '../../sim/core/types';
import type { World } from '../../sim/core/world';
import type { Simulation } from '../../sim/mind/agent';
import { runHeadless } from '../runner';
import { skillOf } from '../../sim/core/skills';
import { activeConcerns, describeConcern } from '../../sim/mind/concern';
import { shortfallBeliefs } from '../../sim/world/shortfall';
import { stockAt } from '../../sim/world/stock';
import { tradePostAt, underServedPosts, type TradePost } from '../../sim/world/labor';
import { plausibleRespondersTo } from '../../sim/mind/succession';
import { instructionsHeld } from '../../sim/mind/apprenticeship';
import { explainConcern, explainGoal, traceLines } from '../../sim/history/causality';

/**
 * ADAPTIVE-SOCIETY ACCEPTANCE HARNESS.
 *
 * Same shape and same discipline as v0.9's `social:trace`, v0.10's `motive:trace` and Causal
 * Society's `causal:trace`: boot the REAL generated village the browser client and every WorldLab
 * scenario use, seed at most ONE happening through a canonical `Simulation` method an NPC would
 * go through anyway, and then only watch. No player is embodied. Nothing about the outcome is
 * scripted, and — the point of this milestone — nothing anywhere decides who the successor is.
 *
 * The one seeded happening is the same one Causal Society used, for a reason: it is already known
 * to produce a real economic catastrophe, and this milestone's whole claim is about what happens
 * AFTER that. Where the causal harness stopped at "somebody believed something and did something
 * about it", this one keeps watching for whether the work itself ever gets done again.
 *
 * Participants are identified STRUCTURALLY — by occupation, by which place has work going undone,
 * by who actually got output out of it — never by name. A report is evidence that the mechanism
 * is general, not that one authored pair of people were tuned to each other.
 */

export type AdaptiveScenario = 'producer_lost' | 'undisturbed';

export interface AdaptiveTraceOptions {
  scenario: AdaptiveScenario;
  seed?: number;
  days?: number;
  probeSeconds?: number;
}

export interface VacancyRecord { day: number; hour: number; place: string; makes: string; why: string; demand: number; }
export interface CandidateRecord { day: number; place: string; who: string; score: number; reasons: string[]; }
export interface StandInRecord {
  who: string; place: string; resource: string; day: number;
  batches: number; skillAtStart: number; skillNow: number; teacher?: string; reason: string; ended?: string;
}
export interface LessonRecord { day: number; teacher: string; student: string; skill: string; teacherSkillThen: number; studentSkillThen: number; studentSkillNow: number; }
export interface OutputRecord { day: number; hour: number; at: number; place: string; resource: string; by: string; quantity: number; }
export interface StoppageRecord { day: number; hour: number; place: string; need: string; making: string; worker: string; }
export interface TraceChain { title: string; lines: string[]; }

export interface AdaptiveAcceptance {
  producerLost: string[];
  outputFell: string[];
  shortageDownstream: string[];
  concernFormed: string[];
  plausibleCandidates: string[];
  responderPerformedTheWork: string[];
  capabilityRoseThroughWork: string[];
  productionResumed: string[];
  shortageEased: string[];
  decisionTracedToTheLoss: string[];
}

export interface AdaptiveTraceReport {
  scenario: AdaptiveScenario;
  seed: number;
  days: number;
  wallSeconds: number;
  population: number;
  deaths: string[];
  /** The person whose loss the run is about, and when the world lost them. */
  lostProducer?: { name: string; occupation: string; day: number; at: number };
  vacancies: VacancyRecord[];
  candidates: CandidateRecord[];
  standIns: StandInRecord[];
  lessons: LessonRecord[];
  stoppages: StoppageRecord[];
  /** Every batch of the lost trade's output, before and after the loss. */
  output: OutputRecord[];
  /** Downstream stock at the consuming place, sampled daily — the shortage's actual severity. */
  downstream: { day: number; resource: string; place: string; stock: number; flourAtMill: number; flourAtBakery: number; worriedPeople: number }[];
  chains: TraceChain[];
  acceptance: AdaptiveAcceptance;
}

const HOUR = 3600;

function firstBy(world: World, occupation: string): Person | undefined {
  return world.persons().filter(p => p.alive && !p.controlled && p.occupation === occupation).sort((a, b) => a.id.localeCompare(b.id))[0];
}
function round(v: number): number { return Math.round(v * 1000) / 1000; }

export function runAdaptiveTrace(opts: AdaptiveTraceOptions): AdaptiveTraceReport {
  const seed = opts.seed ?? 918271;
  const days = opts.days ?? 24;
  const probeSeconds = opts.probeSeconds ?? 900;
  const startedAt = Date.now();

  const vacancies: VacancyRecord[] = [];
  const candidates: CandidateRecord[] = [];
  const lessons: LessonRecord[] = [];
  const stoppages: StoppageRecord[] = [];
  const output: OutputRecord[] = [];
  const downstream: AdaptiveTraceReport['downstream'] = [];
  const seenEvents = new Set<string>();
  const seenVacancy = new Set<string>();
  const skillAtLesson = new Map<string, number>();
  /** The chain caught live: whoever was working a post they do not own, at the moment they were. */
  const liveChains: TraceChain[] = [];
  let struck = false;
  let lostProducer: AdaptiveTraceReport['lostProducer'];
  let lastDownstreamDay = -1;

  /**
   * The one seeded happening: a bandit strikes the village's producer down, through
   * `Simulation.applyHit` — the same method every NPC fight and every player swing goes through.
   * Held until somebody is actually there to SEE it, because a killing nobody witnessed is
   * correctly a killing nobody can learn of, and this harness exists to watch what a village does
   * with information it has, not to re-prove the epistemics.
   */
  const maybeStrike = (world: World, sim: Simulation): void => {
    if (struck || opts.scenario !== 'producer_lost') return;
    if (world.clock.day < 1 || world.clock.hourF < 8 || world.clock.hourF > 18) return;
    const producer = firstBy(world, 'miller');
    const raider = world.persons().filter(p => p.alive && p.hostile).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!producer || !raider) return;
    const pb = world.primaryBody(producer.id); const rb = world.primaryBody(raider.id);
    if (!pb || !rb || pb.dead) return;
    const witness = world.persons().some(q => q.alive && !q.controlled && q.id !== producer.id && q.id !== raider.id
      && q.mind.percepts.some(pc => pc.entityId === producer.id && pc.how === 'saw'));
    if (!witness) return;
    rb.pos = { x: pb.pos.x + 1, y: pb.pos.y, z: pb.pos.z };
    sim.applyHit(raider, rb, pb, 200, 'kill');
    struck = true;
    lostProducer = { name: producer.name, occupation: producer.occupation, day: world.clock.day, at: world.now };
  };

  const observe = (world: World, sim: Simulation): void => {
    maybeStrike(world, sim);
    const day = world.clock.day; const hour = Math.floor(world.clock.hourF);

    for (const e of world.events) {
      if (seenEvents.has(e.id)) continue;
      seenEvents.add(e.id);
      if (e.type === 'work_blocked') {
        stoppages.push({ day, hour, place: world.nameOf(e.placeId ?? ''), need: String(e.data.need), making: String(e.data.making), worker: world.nameOf(e.actor ?? '') });
      } else if (e.type === 'resource_transformed' && (e.data.to === 'flour' || e.data.to === 'bread')) {
        output.push({ day, hour, at: e.tick, place: world.nameOf(e.placeId ?? ''), resource: String(e.data.to), by: world.nameOf(e.actor ?? ''), quantity: Number(e.data.toQty ?? 0) });
      } else if (e.type === 'work_taught') {
        const student = world.person(e.target ?? '');
        const skill = String(e.data.skill);
        lessons.push({ day, teacher: world.nameOf(e.actor ?? ''), student: world.nameOf(e.target ?? ''), skill, teacherSkillThen: round(Number(e.data.teacherSkill ?? 0)), studentSkillThen: round(Number(e.data.studentSkill ?? 0)), studentSkillNow: 0 });
        if (student) skillAtLesson.set(`${student.id}:${skill}`, Number(e.data.studentSkill ?? 0));
      }
    }

    // Work nobody is doing, recorded the first time each distinct reason appears — the derivation,
    // not a flag, and the honest evidence for "the world could tell the work had stopped".
    for (const post of underServedPosts(world)) {
      const why = post.unfit.map(u => `${u.person.name} is ${u.reason}`).join(', ') || 'nobody works here';
      const key = `${post.place.id}:${why}`;
      if (!seenVacancy.has(key)) {
        seenVacancy.add(key);
        vacancies.push({ day, hour, place: post.place.name, makes: post.process.output, why, demand: post.openDemand });
      }
      // Who the world currently makes a plausible responder. Read-only: no decision path calls
      // this, so recording it cannot change what anybody does.
      for (const r of plausibleRespondersTo(world, post).slice(0, 4)) {
        if (candidates.some(c => c.who === r.person.name && c.place === post.place.name)) continue;
        candidates.push({ day, place: post.place.name, who: r.person.name, score: round(r.candidacy.score), reasons: r.candidacy.reasons.slice(0, 3) });
      }
    }

    // A live walk of somebody working a post that is not theirs, taken while they are at it —
    // afterwards the post is no longer under-served and the reason is gone from the board.
    if (liveChains.length < 3) {
      for (const stint of world.workStints) {
        if (stint.endedAt) continue;
        const p = world.person(stint.personId);
        const g = p?.mind.goal;
        if (!p || !g || g.type !== 'work' || g.targetPlace !== stint.placeId) continue;
        if (liveChains.some(c => c.title.startsWith(p.name))) continue;
        liveChains.push({ title: `${p.name}: why they are at ${world.nameOf(stint.placeId)}`, lines: traceLines(explainGoal(world, p, g)) });
      }
    }

    // Downstream severity, once a day: how much bread the bakery actually has, and how many
    // people are currently carrying a worry about the material behind it.
    if (day !== lastDownstreamDay) {
      lastDownstreamDay = day;
      const bakery = world.places().find(pl => pl.type === 'bakery');
      const millPlace = world.places().find(pl => pl.type === 'mill');
      if (bakery) {
        const worried = world.persons().filter(p => p.alive && activeConcerns(p).some(c => c.kind === 'supply' && (c.resource === 'flour' || c.resource === 'bread'))).length;
        downstream.push({
          day, resource: 'bread', place: bakery.name, stock: stockAt(world, 'bread', bakery.id),
          flourAtMill: millPlace ? stockAt(world, 'flour', millPlace.id) : 0,
          flourAtBakery: stockAt(world, 'flour', bakery.id),
          worriedPeople: worried,
        });
      }
    }
  };

  const result = runHeadless({
    seed, days, stepSeconds: 0.15, maintenanceIntervalSeconds: HOUR,
    probeIntervalSeconds: probeSeconds,
    onProbe: (world, sim) => observe(world, sim),
  });
  const { world } = result;

  const standIns: StandInRecord[] = world.workStints.map(s => describeStint(world, s));
  for (const l of lessons) {
    const student = world.persons().find(p => p.name === l.student);
    if (student) l.studentSkillNow = round(skillOf(student, l.skill as never));
  }

  const chains = [...liveChains, ...finalChains(world)];
  const deaths = world.persons().filter(p => !p.alive).map(p => p.name);

  const report: AdaptiveTraceReport = {
    scenario: opts.scenario, seed, days,
    wallSeconds: round((Date.now() - startedAt) / 1000),
    population: world.persons().filter(p => p.alive && !p.controlled).length,
    deaths, lostProducer, vacancies, candidates, standIns, lessons, stoppages, output, downstream, chains,
    acceptance: { producerLost: [], outputFell: [], shortageDownstream: [], concernFormed: [], plausibleCandidates: [], responderPerformedTheWork: [], capabilityRoseThroughWork: [], productionResumed: [], shortageEased: [], decisionTracedToTheLoss: [] },
  };
  report.acceptance = assess(world, report);
  return report;
}

function describeStint(world: World, s: WorkStint): StandInRecord {
  const p = world.person(s.personId);
  const post = tradePostAt(world, world.place(s.placeId));
  const skill = post?.process.skill;
  return {
    who: p?.name ?? s.personId,
    place: world.nameOf(s.placeId),
    resource: s.resource,
    day: Math.floor(s.startedAt / 86400),
    batches: s.batches,
    skillAtStart: round(s.skillAtStart),
    skillNow: p && skill ? round(skillOf(p, skill)) : 0,
    teacher: s.teacherId ? world.nameOf(s.teacherId) : undefined,
    reason: s.reason,
    ended: s.endedAt ? `ended on day ${Math.floor(s.endedAt / 86400)}` : undefined,
  };
}

/** Two walks over the state the run finished in: the strongest supply worry still carried, and
 * whichever stand-in got the most work done. Chosen structurally, never by name. */
function finalChains(world: World): TraceChain[] {
  const out: TraceChain[] = [];
  const people = world.persons().filter(p => p.alive && !p.controlled);
  const worst = people
    .flatMap(p => activeConcerns(p).filter(c => c.kind === 'supply').map(c => ({ p, c })))
    .sort((a, b) => b.c.intensity - a.c.intensity)[0];
  if (worst) out.push({ title: `${worst.p.name}: what they are still short of`, lines: traceLines(explainConcern(world, worst.p, worst.c)) });
  const busiest = [...world.workStints].sort((a, b) => b.batches - a.batches)[0];
  if (busiest) {
    const p = world.person(busiest.personId);
    const g = p?.mind.goal;
    if (p && g) out.push({ title: `${p.name}: what they are doing now`, lines: traceLines(explainGoal(world, p, g)) });
  }
  return out;
}

/**
 * The milestone's own chain, each link answered with evidence from THIS run or left empty.
 * Nothing here invents a link the run did not produce — an empty list is the honest report that
 * the village did not, on this seed, get that far.
 */
function assess(world: World, r: AdaptiveTraceReport): AdaptiveAcceptance {
  const lostDay = r.lostProducer?.day ?? -1;
  // The moment of the loss in world-seconds, not the calendar day it fell on: the producer was
  // killed mid-morning, having already worked that morning, so a day-granularity comparison would
  // count his own last batches as evidence that the trade carried on without him.
  const lostAt = r.lostProducer?.at ?? Number.POSITIVE_INFINITY;
  const trade = r.lostProducer ? 'flour' : '';

  const producerLost = r.lostProducer
    ? [`day ${r.lostProducer.day}: the village lost ${r.lostProducer.name}, its only ${r.lostProducer.occupation}`]
    : [];

  const before = r.output.filter(o => o.resource === trade && o.at < lostAt);
  const after = r.output.filter(o => o.resource === trade && o.at > lostAt);
  const gapDays = after.length
    ? round((after[0].at - lostAt) / 86400)
    : round((r.days * 86400 - (lostAt % 86400 ? 0 : 0)) / 86400);
  const outputFell = producerLost.length && before.length > 0 && (after.length === 0 || after[0].at > lostAt + 86400)
    ? [`${trade}: ${before.length} batch(es) up to day ${lostDay}, then none for ${gapDays} day(s)${after.length ? ` — the next was on day ${after[0].day}, by ${after[0].by}` : ' to the end of the run'}`]
    : [];

  const shortageDownstream = r.stoppages.filter(s => s.need === 'flour').slice(0, 4)
    .map(s => `day ${s.day} ${String(s.hour).padStart(2, '0')}h: ${s.worker} could make no ${s.making} at ${s.place}`);

  const concernFormed = world.persons()
    .filter(p => p.alive && !p.controlled)
    .flatMap(p => activeConcerns(p).filter(c => c.kind === 'supply').map(c => `${p.name}: ${describeConcern(world, c)} [${round(c.intensity)}] — ${c.reasons[0] ?? ''}`))
    .slice(0, 6);

  const plausibleCandidates = r.candidates.slice(0, 8)
    .map(c => `day ${c.day} at ${c.place}: ${c.who} (plausibility ${c.score}) — ${c.reasons.join('; ')}`);

  const worked = r.standIns.filter(s => s.batches > 0);
  const responderPerformedTheWork = worked
    .map(s => `${s.who} took up ${s.place} on day ${s.day} and got ${s.batches} batch(es) of ${s.resource} out of it — ${s.reason}`);

  const capabilityRoseThroughWork = worked.filter(s => s.skillNow > s.skillAtStart)
    .map(s => `${s.who}: ${s.skillAtStart} → ${s.skillNow} at the trade, over ${s.batches} real batch(es)`);

  const units = (rs: OutputRecord[]) => rs.reduce((n, o) => n + o.quantity, 0);
  const breadBefore = r.output.filter(o => o.resource === 'bread' && o.at < lostAt);
  const breadAfterResumed = after.length ? r.output.filter(o => o.resource === 'bread' && o.at > after[0].at) : [];
  const productionResumed = after.length
    ? [
      `${after[0].by} made the first ${after[0].quantity} flour since the loss on day ${after[0].day} ${String(after[0].hour).padStart(2, '0')}h at ${after[0].place}`,
      `flour since: ${after.length} batch(es), ${units(after)} units, averaging ${round(units(after) / after.length)} per batch against ${before.length ? round(units(before) / before.length) : 0} under ${r.lostProducer?.name ?? 'the old hand'}`,
      `bread: ${breadBefore.length} batch(es) before the loss, ${breadAfterResumed.length} once the mill was turning again`,
    ]
    : [];

  // Severity, honestly, and downstream of the mill rather than at it: flour actually reaching the
  // bakery is the thing the bakery's shortage is about. Measured from the worst day after the
  // loss to the best day after that — an improvement counts, and a FULL recovery is deliberately
  // not required, because a novice's mill should not produce one (see
  // docs/ADAPTIVE_SOCIETY_V0_5.md).
  const days = r.downstream.filter(d => d.day >= lostDay);
  const worst = days.reduce<typeof days[number] | undefined>((acc, d) => (!acc || d.flourAtBakery < acc.flourAtBakery ? d : acc), undefined);
  const recovered = worst ? days.filter(d => d.day > worst.day).reduce<typeof days[number] | undefined>((acc, d) => (!acc || d.flourAtBakery > acc.flourAtBakery ? d : acc), undefined) : undefined;
  const shortageEased = worst && recovered && recovered.flourAtBakery > worst.flourAtBakery
    ? [`flour at ${recovered.place}: ${worst.flourAtBakery} on day ${worst.day} (worst), ${recovered.flourAtBakery} on day ${recovered.day}; bread there ${worst.stock} → ${recovered.stock}; people carrying a supply worry ${worst.worriedPeople} → ${recovered.worriedPeople}`]
    : [];

  const decisionTracedToTheLoss = r.chains.filter(c => c.lines.length > 1).slice(0, 3)
    .map(c => `${c.title}\n${c.lines.join('\n')}`);

  return {
    producerLost, outputFell, shortageDownstream, concernFormed, plausibleCandidates,
    responderPerformedTheWork, capabilityRoseThroughWork, productionResumed, shortageEased,
    decisionTracedToTheLoss,
  };
}

export function formatAdaptiveReport(r: AdaptiveTraceReport): string {
  const L: string[] = [];
  L.push(`ADAPTIVE SOCIETY TRACE — scenario "${r.scenario}", seed ${r.seed}, ${r.days} world days, ${r.wallSeconds}s wall`);
  L.push(`population ${r.population} alive${r.deaths.length ? `, died: ${r.deaths.join(', ')}` : ''}`);
  if (r.lostProducer) L.push(`the loss: ${r.lostProducer.name}, ${r.lostProducer.occupation}, on day ${r.lostProducer.day}`);
  L.push('');
  L.push(`WORK NOBODY WAS DOING (${r.vacancies.length})`);
  for (const v of r.vacancies.slice(0, 8)) L.push(`  day ${v.day} ${String(v.hour).padStart(2, '0')}h  ${v.place} (makes ${v.makes}, ${v.demand} wanted) — ${v.why}`);
  L.push('');
  L.push(`WHO COULD PLAUSIBLY HAVE ANSWERED (${r.candidates.length})`);
  for (const c of r.candidates.slice(0, 10)) L.push(`  day ${c.day} ${c.place}: ${c.who} [${c.score}] — ${c.reasons.join('; ')}`);
  L.push('');
  L.push(`WHO ACTUALLY DID (${r.standIns.length})`);
  for (const s of r.standIns) L.push(`  ${s.who} at ${s.place} from day ${s.day}: ${s.batches} batch(es) of ${s.resource}, ${s.skillAtStart} → ${s.skillNow}${s.teacher ? `, taught by ${s.teacher}` : ''}${s.ended ? `, ${s.ended}` : ''}\n      because: ${s.reason}`);
  L.push('');
  L.push(`LESSONS GIVEN (${r.lessons.length})`);
  for (const l of r.lessons.slice(0, 8)) L.push(`  day ${l.day}: ${l.teacher} showed ${l.student} how ${l.skill} is done (${l.studentSkillThen} then, ${l.studentSkillNow} now)`);
  L.push('');
  L.push(`STOPPAGES (${r.stoppages.length})`);
  for (const s of r.stoppages.slice(0, 10)) L.push(`  day ${s.day} ${String(s.hour).padStart(2, '0')}h  ${s.worker} could make no ${s.making} at ${s.place}: no ${s.need}`);
  L.push('');
  L.push('DOWNSTREAM SEVERITY (bread at the bakery, and how many people are worried)');
  for (const d of r.downstream) L.push(`  day ${String(d.day).padStart(3)}  ${String(d.stock).padStart(4)} ${d.resource}   flour: ${String(d.flourAtMill).padStart(3)} at the mill, ${String(d.flourAtBakery).padStart(3)} at the bakery   worried: ${d.worriedPeople}`);
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

/** Kept so a caller can ask what instruction anybody is currently carrying. */
export function instructionSummary(world: World): { who: string; what: string; from: string }[] {
  const out: { who: string; what: string; from: string }[] = [];
  for (const p of world.persons()) {
    for (const k of instructionsHeld(p)) {
      out.push({ who: p.name, what: String(k.claim.skill), from: world.nameOf(k.claim.teacherId as EntityId) });
    }
  }
  return out;
}
