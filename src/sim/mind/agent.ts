import { applyInjury } from '../physical/injury';
import { resolveCombatAttack, combatReach, type CombatAttackIntent, type CombatAttackResult } from '../physical/combat';
import type { Person, Body, Vec3, Goal, GoalType, Action, Percept, WorldEvent, EntityId, ItemType, KnowledgeItem, Creature, Place, Anchor, ConflictIntent, Conflict, ConflictCause } from '../core/types';
import { World } from '../core/world';
import { getRel, adjustRel, disposition, isClose, isFamily, relOrNull, evolveRelationships } from './relationships';
import { maintainConflicts, beginConflict, recordConflictBlow, conflictBetween, lastConflictBetween, disengageConflict, resolveConflict, touchConflict } from '../social/conflict';
import { maintainCustody, subdue, takeIntoCustody, beginSurrender, isSubdued } from '../social/custody';
import { SAW_RATIO, stepMetabolism, stepSpoilage, fieldFor, firstPlot, plantPlot, farmSeedGrain, harvestPlot, mill, bake, saw, findAccessibleFood, eatFood, buyFoodPortion, nearestWaterSource, drinkAt, villageStock, restockTavern, gatherHerbs, huntGame, GRAIN_CAP, SEED_PER_PLOT } from '../world/metabolism';
import { stepPhysiology, activityLevelFor, heatBand, hungerBand, thirstBand, sleepBand, comfortBand, severityAtLeast, syncNeeds } from '../core/physiology';
import { isCommittable, EMERGENCY_GOAL_TYPES, interruptionSeverityMet, startCommitment, suspendCommitment, resumeCommitment, finishCommitment, commitmentValidity } from './commitment';
import { getPhysicalCapability, capabilityFor, movementMultiplier } from '../core/attributes';
import { skillOf, tradeBatchSeconds } from '../core/skills';
import { wearTool } from '../core/tools';
import { isFood } from '../world/factory';
import { stockAt, retireStack } from '../world/stock';
import { pickHaulTask, claimHaulTask, loadHaulCargo, depositHaulCargo, failHaulTask, generateLogisticsNeeds, maintainHauls, canHaul } from '../logistics/haul';
import { generateProductionNeeds, claimedProductionRequest, fulfillProductionRequest, BREAD_SHORTAGE_TRIGGER } from '../world/production';
import { nearestAvailableNode, extractFromNode, maintainResourceNodes } from '../world/resources';
import { stepConstruction, activeBuildProjects, performBuildLabor, MAX_BUILDERS } from '../world/construction';
import { stepFire, igniteFire, feedFire, fireIntensityAt, fireAt } from '../world/fire';
import { cook, tendTavernFire } from '../world/cooking';
import { willingnessFor, unitPriceFor, tradeOffersFrom, refusalsFrom, purchaseUnits, type TradeOffer, type Refusal, type PurchaseResult } from '../world/commerce';
import { remember } from './memory';
import { learn, eventClaim, describeClaim, isCrime, crimeSeverity, locationKnowledge, learnPlace, knownFoodPlace, noteFoodShortage } from './knowledge';
import { realizeClaim, realizeTopic } from './realize';
import { currentScheduleEntry } from './schedule';
import { SECONDS_PER_HOUR } from '../core/time';
import { B } from '../physical/blocks';
import { makeItem } from '../world/factory';
import { banditResourcePressure, laborIncentive } from './economy';
import { resolveRobberyCompliance, selectRobberyTake, ROBBERY_COOLDOWN_SECONDS, type RobberyTake } from './robbery';
import { payRecoveryReward, recentlyFailedRequests } from '../core/requests';
import { haulOffersFrom, activeHaulFor, acceptHaulOffer, progressHaul, abandonHaul, buyMealFrom, eatAtHand, drinkHere, type HaulOffer, type HaulProgress } from '../logistics/participation';
// v0.9 Social Causality Vertical Slice — the four generic primitives this milestone adds.
import { noteEventForSituations, maintainSituations } from '../social/situation';
import { refreshReport, reportFor, shouldSeekAuthority, reportUrgencyFactor, noteReportDelivered, noteReportFailed, pruneReports } from './reporting';
import { appraiseClaim } from '../social/appraisal';
import { formConcerns, maintainConcerns, activeConcerns, concernActionable, noteConcernActedOn } from './concern';
import { selectTopic, type Topic } from './conversation';
import { noticeAbsences } from '../social/absence';
import { noteWorkBlocked, clearShortfall, shortfallKey } from '../world/shortfall';
import { drawInferences } from './inference';
// v0.5 Adaptive Society — vacant productive work derived from staffing/capability/output
// (world/labor.ts), who is plausibly moved to take it up (mind/succession.ts), and the smallest
// teaching path (mind/apprenticeship.ts). None of the three decides anything on its own: the
// first is a read-only view, the second returns a number, the third writes a belief.
import { maintainWorkStints, noteStandInBatch, processFor, runTradeBatch, underServedPosts, workAuthorization, type TradePost } from '../world/labor';
import { peopleAwareOfShortage, standInCandidacy } from './succession';
import { maybeTeachAt } from './apprenticeship';
import type { TransformResult } from '../world/metabolism';
import { woundSeverity, SERIOUS_WOUND } from '../core/attributes';
// v0.10 Motivated Lives — persistent purposes (mind/pursuit.ts) and social stakes with
// provenance (social/obligation.ts). Both are read through ONE combined behavioural bridge
// (`motivationBoost`), so concerns, obligations and purposes bend goal utility together and
// under one shared cap rather than each quietly adding its own.
import {
  activePursuits, formPursuits, maintainPursuits, motivationBoost, notePursuitProgress,
  pursuitById, linkGoalToPursuit, pursuitSteps, pursuitStepUtility, describePursuit, resolvePursuit, satisfiedNow, PURSUIT_FORBIDDEN_GOALS,
} from './pursuit';
import { formObligations, forgivenessFor, maintainObligations, noteBenefitEvent, noteRequestEvent, noticeBrokenPromises } from '../social/obligation';
import { takePortionInHand } from '../world/metabolism';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * Causal Society — how much of a whole kindness one event of each type is.
 *
 * All of these are discrete acts EXCEPT tending, which is the same act repeated for as long as
 * somebody is hurt: a single episode of care emits a stream of `heal` events. Measured on a
 * 30-day undisturbed run at seed 918271 before this weighting existed — a father tending his
 * daughter took his wife's and his daughter's trust AND affection toward him to a saturated
 * 1.00 inside a day, purely by repetition. Tending is not less kind than a gift; it is just not
 * a fresh kindness every few seconds.
 */
const KINDNESS_WEIGHT: Record<string, number> = {
  gift: 1, returned_item: 1, debt_paid: 1, apology: 1, heal: 0.3,
};
const dist2 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
/** Shared, never mutated — the ordinary case, where no productive place is going unworked. */
const EMPTY_AWARENESS: ReadonlySet<EntityId> = new Set<EntityId>();
/** v0.2.3: world-time a pursuer waits before re-targeting a quarry it just failed to physically
 * reach. Long enough that the two are likely no longer in perception range of each other; short
 * enough that a genuinely renewed threat still gets answered. */
const PURSUIT_COOLDOWN_SECONDS = 45 * 60;
/** v0.6 §II: how long a failed food-seeking attempt suppresses re-adopting `eat`. Measured
 * directly (seed 918271) that shortening this alone (30 -> 15 min) did not help — for the
 * specific people who fail repeatedly (a schedule that rarely brings them near a food source
 * while genuinely hungry), retrying twice as often just means failing twice as often, not
 * succeeding sooner; see docs/V0_6_KNOWLEDGE_MEMORY_SKILLS_INTENT.md §II for the full
 * before/after evidence. Kept at the original v0.4/v0.5 value. */
const NO_FOOD_RETRY_SECONDS = 30 * 60;
/** v0.9 §D: below this fraction of max health a body is not "wounded and carrying on" — it is on
 * the floor. Recovery up to this point runs at the original, un-slowed rate; see the health-regen
 * call site in `strategic` for the combat-grind pathology that distinction prevents. */
const INCAPACITATED_FRACTION = 0.35;
/** v0.10 §I.B: how many units of food a `provide` errand takes off a household stack to carry to
 * someone who needs it. A couple of meals — enough to matter, not the whole larder. */
const PROVISION_UNITS = 2;
/** Shared empty list, so the common "no crimes to report" case allocates nothing. */
const EMPTY_PERSONS: readonly Person[] = [];

/**
 * The Simulation runs minds and bodies at their own cadences:
 *  - bodies move every physical step (continuous)
 *  - perception samples the world at ~5Hz per mind
 *  - deliberate thinking happens per mind when its subjective think-budget fills (timeRate-scaled),
 *    or immediately when something alarming is perceived
 *  - strategic upkeep (needs, moods, weather) runs once per world minute
 */
export class Simulation {
  perceptionAccum = 0; strategicAccum = 0; compactAccum = 0; socialAccum = 0; inferenceAccum = 0; onSpeech: ((p: Person, text: string) => void) | null = null; onHit: ((b: Body, pos: Vec3) => void) | null = null;
  /** Coarse per-subsystem wall-clock accumulator (v0.2.1 Priority 3: "create benchmark
   * instrumentation so the headless report includes coarse timing information for major
   * subsystems where practical"). Null (the default, used by the browser client and every
   * test) costs nothing — every call site below is a single `if (this.profile)` check. A
   * caller that wants a breakdown (the headless runner) sets this to `{}` before stepping and
   * reads the accumulated milliseconds back out; this never reads simulation state and never
   * feeds back into any decision, so it cannot affect canonical outcomes or determinism. */
  profile: Record<string, number> | null = null;
  /**
   * v0.5 Adaptive Society: the productive places whose work nobody is currently doing, refreshed
   * once per coarse strategic pass (see `strategic`). A read-only DERIVED view — `world/labor.ts`
   * computes it from staffing, capability and demand, and nothing writes it back — cached here
   * for one reason only: `think()` consults it per deliberating person per tick, and re-deriving
   * it there would mean a scan of every place and every open request each time. Ten world-minutes
   * of staleness cannot change an answer that moves on the scale of hours.
   */
  vacantPosts: TradePost[] = [];
  /**
   * v0.5: who currently holds anything at all that could bear on a shortage — the cheap gate in
   * front of `standInCandidacy`, refreshed beside `vacantPosts` on the same coarse pass. See
   * `peopleAwareOfShortage` for why it exists (a measured cost regression, not a design choice)
   * and why widening it can never change an answer.
   */
  awareOfShortage: ReadonlySet<EntityId> = EMPTY_AWARENESS;
  constructor(public world: World) {
    // v0.9: every canonical event flows through ongoing-matter bookkeeping exactly once (see
    // World.eventObserver). The re-entrancy guard exists because `noteEventForSituations` itself
    // emits `situation_opened`/`situation_resolved`; those are not openers or resolvers, so
    // recursing would be a no-op, but iterating `world.situations` while a nested call mutates
    // it is the kind of thing that only breaks later. Deterministic and allocation-free.
    world.eventObserver = (e) => {
      if (this.inSituationHook) return;
      this.inSituationHook = true;
      try {
        noteEventForSituations(world, e);
        // v0.10 §II: the same one-hook discipline, for the same reasons. `noteBenefitEvent`
        // discharges an actor's own standing obligations toward whoever they just did good by
        // (you always know what you yourself did — no perception needed); `noteRequestEvent`
        // keeps the accepted-task obligation in step with the canonical `Request` lifecycle
        // without `core/requests.ts` having to know that `social/` exists.
        noteBenefitEvent(world, e);
        noteRequestEvent(world, e);
      } finally { this.inSituationHook = false; }
    };
  }
  private inSituationHook = false;
  private mark(): number { return this.profile ? performance.now() : 0; }
  private accum(bucket: string, t0: number): void { if (this.profile) this.profile[bucket] = (this.profile[bucket] ?? 0) + (performance.now() - t0); }

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
      if (doPerceive) { const t0 = this.mark(); this.perceive(p, stimuli); this.accum('perceive', t0); }
      // 2. subjective cognition budget
      p.mind.thinkBudget += physDt * p.timeRate;
      const urgent = p.mind.alarm > 0.5;
      if (urgent || p.mind.thinkBudget >= p.mind.thinkInterval) { p.mind.thinkBudget = 0; const t0 = this.mark(); this.think(p, body); this.accum('think', t0); p.mind.alarm = 0; }
      // 3. act on the current plan (continuous)
      { const t0 = this.mark(); this.act(p, body, physDt, worldDt); this.accum('act', t0); }
      if (p.speech && p.speech.until < w.physicalTime) p.speech = null;
    }
    { const t0 = this.mark(); for (const c of w.creatures()) this.creatureStep(c, physDt); this.accum('creatures', t0); }
    // 4. body physics for all non-player bodies
    { const t0 = this.mark(); for (const b of w.bodies()) { const owner = w.get(b.ownerId) as Person | undefined; if (owner?.controlled) continue; this.bodyPhysics(b, physDt); } this.accum('bodyPhysics', t0); }
    // 5. strategic upkeep once per world minute
    this.strategicAccum += worldDt;
    if (this.strategicAccum >= 60) { const minutes = Math.floor(this.strategicAccum / 60); this.strategicAccum -= minutes * 60; const t0 = this.mark(); this.strategic(minutes); this.accum('strategic', t0); }
    // 6. event-log compaction (Constitution §71 "computational pragmatism": this is purely a
    // memory/perf bound, not a gameplay mechanic — nothing about WHICH events survive or their
    // causal ancestry depends on how often this runs, only on `world.events.length` when it
    // does). v0.2.1 Priority 3: this used to run every world-minute from inside strategic(),
    // but compactEvents' own "kept" set keeps every individually-significant event forever
    // (correctly — that's what makes it a real historical record), so as significant events
    // accumulate over a long run, a minute-granular cadence meant re-filtering and re-walking
    // the causal ancestry of that same, ever-growing "already kept" set on almost every call —
    // measured as the single largest cost in a 2-day headless run (~35% of total wall time).
    // Once an hour is still far more often than the compaction threshold (1.5x `keep`, default
    // 6000 events) is likely to be freshly crossed, and produces byte-for-byte identical kept
    // events/causal ancestry to calling it every minute — only the call frequency changes.
    this.compactAccum += worldDt;
    if (this.compactAccum >= 3600) { this.compactAccum = 0; const t0 = this.mark(); w.compactEvents(); this.accum('compact', t0); }
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
    // v0.8 §P0-G (independent audit §4.6): an unheld item in view is exactly as observable as a
    // body — `locationKnowledge` already existed and had exactly one call site (bodies, above).
    // Before this, `loc:<itemId>` was NEVER written at runtime by anything, so a real lost/
    // stolen item could never actually be found by a witness: the recover-item chain had a
    // mechanism (`recover_item` desires, authorized recovery, real reward payment — see
    // requests.ts's `payRecoveryReward`) with no way for the FIRST link (someone seeing where
    // the item is) to ever form. Same cheap-distance-then-lineOfSight gate as the body loop
    // above, so this costs comparably little more per perceive() tick; `pruneKnowledge` (already
    // called by `learn()`/`locationKnowledge`) is the existing, general bound on knowledge-map
    // growth this relies on, same as it already does for the body/person case.
    if (!asleep && !p.controlled) {
      for (const it of w.items()) {
        if (it.holderId || !it.pos) continue;
        const d = Math.hypot(it.pos.x - eye.x, it.pos.z - eye.z); if (d > seeRange) continue;
        const dx = (it.pos.x - eye.x) / (d + 1e-5), dz = (it.pos.z - eye.z) / (d + 1e-5); const dot = dx * facing.x + dz * facing.z;
        if (d >= 2.5 && dot <= -0.1) continue;
        if (w.grid.lineOfSight(eye, { x: it.pos.x, y: it.pos.y + 0.3, z: it.pos.z }, 32)) locationKnowledge(w, p, it.id, it.pos, { type: 'witnessed' });
      }
    }
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
    // Causal Society: most events are keyed by the event, because each one is a separate thing
    // that happened. A stoppage is not: "there is no flour at the bakery" is a STANDING STATE, and
    // it must land in the same slot however it was come by, or the village ends up holding one
    // belief per re-notice — none of which merge, each of which is fresh news to be passed on to
    // everyone all over again. Measured directly on a 30-day seed-918271 run before this: four
    // separate beliefs about the one continuing bakery shortage, told around the whole village
    // four times over, and four separate copies of the same conclusion drawn from them.
    const key = claim.type === 'work_blocked' && claim.placeId && claim.need
      ? shortfallKey(claim.placeId as EntityId, claim.need as ItemType)
      : `ev:${e.id}`;
    const k = learn(w, p, { key, kind: 'event', claim, confidence: saw ? 1 : 0.6, source: { type: saw ? 'witnessed' : 'heard', viaEvent: perc.id }, cause: perc.id, summary: claimSummary });
    const isVictim = claim.target === p.id;
    const victimClose = claim.target ? isClose(p, claim.target) : false;
    // v0.9 §A: how much this event matters to THIS person is now a real appraisal over their own
    // relationships, role, material stake, traits and the provenance of the belief — not the
    // event's own significance times a two-branch victim/close multiplier. The same appraisal
    // then decides what (if anything) they end up carrying about it (`formConcerns`), so memory
    // weight, emotional reaction and downstream behaviour all agree about who cares and why.
    const appraisal = k ? appraiseClaim(w, p, k) : null;
    const sig = appraisal
      ? clamp(e.significance * 0.45 + appraisal.weight * 0.85) * (saw ? 1 : 0.85)
      : e.significance * (isVictim ? 1.4 : victimClose ? 1.2 : 1) * (saw ? 1 : 0.7);
    const valence = isCrime(e.type, e.data?.intent) ? -0.8 : e.type === 'gift' || e.type === 'returned_item' || e.type === 'heal' ? 0.6 : 0;
    remember(w, p, { type: e.type, summary: saw ? `I saw: ${claimSummary}` : `I heard: ${claimSummary}`, eventId: e.id, entities: [claim.actor, claim.target, claim.item].filter(Boolean) as string[], significance: clamp(sig), valence, source: { type: saw ? 'witnessed' : 'heard', viaEvent: perc.id }, placeId: claim.placeId });
    if (p.controlled) return;
    if (k && appraisal) formConcerns(w, p, k, appraisal);
    // v0.10 §II: an obligation forms from a belief with real provenance, exactly like a concern —
    // being helped is something you have to NOTICE, not something the world tells you.
    if (k) formObligations(w, p, k);
    this.reactTo(p, body, e, perc.id, saw, isVictim, victimClose, k, appraisal);
  }

  private reactTo(p: Person, body: Body, e: WorldEvent, cause: string, saw: boolean, isVictim: boolean, victimClose: boolean, k: KnowledgeItem | null, appraisal?: import('../social/appraisal').Appraisal | null): void {
    const w = this.world; const claim = k?.claim ?? eventClaim(w, e, saw); const actor = claim.actor as EntityId | undefined;
    // v0.9 §A/§C: the strength of the RELATIONSHIP change scales with personal significance, so
    // the victim's spouse, the attacker's friend, a guard and an unrelated passer-by no longer
    // move by the same amount on the same event. Falls back to 1 (pre-v0.9 magnitudes) when
    // there is no appraisal to read, so nothing silently changes on paths that lack one.
    const personal = appraisal ? clamp(0.45 + appraisal.weight * 1.1, 0.35, 1.6) : 1;
    if (isCrime(claim.type, claim.intent) && actor !== p.id) {
      const sev = crimeSeverity(claim.type); const actorP = w.person(actor);
      const victimDisp = claim.target ? disposition(p, claim.target) : 0;
      // fear rises with severity, proximity and low courage; grudge with closeness to the victim
      const fear = sev * (1.2 - p.traits.courage) * (isVictim ? 1.5 : 1) * (saw ? 1 : 0.6);
      const grudge = sev * (isVictim ? 1.2 : victimClose ? 1 : 0.35 + Math.max(0, victimDisp) * 0.6);
      // v0.2.3: a defining, durable grievance (grudge that will not simply fade once the fight
      // ends) forms only from genuinely severe harm — the killing of someone dear, or a
      // sustained campaign of assault against oneself (the same attacker, several times over).
      let grievance = 0;
      if (claim.type === 'kill' && (isVictim || victimClose)) grievance = victimClose && isFamily(p, claim.target) ? 0.9 : 0.7;
      else if (claim.type === 'attack' && isVictim && actor) {
        const priorAssaults = Object.values(p.knowledge).filter(kk => kk.kind === 'event' && kk.claim.type === 'attack' && kk.claim.actor === actor && kk.claim.target === p.id).length;
        if (priorAssaults >= 3) grievance = Math.min(0.55, 0.15 + priorAssaults * 0.08);
      }
      // v0.10 §II "forgive a minor offence": someone I genuinely owe gets more benefit of the
      // doubt over something small than a stranger would. Bounded (never more than half the
      // reaction), and — by construction in `forgivenessFor` — never applied to severe harm: a
      // standing favour does not buy forgiveness for a beating or a killing.
      const forgiveness = actor ? forgivenessFor(p, actor, sev) : 0;
      const soften = 1 - forgiveness;
      if (actor) adjustRel(w, p, actor, { fear: fear * 0.7 * personal * soften, trust: -sev * (isVictim ? 0.9 : 0.6) * personal * soften, affection: -sev * (isVictim ? 0.7 : 0.4) * personal * soften, grudge: grudge * 0.6 * personal * soften, grievance, respect: -sev * 0.3 * personal * soften }, `${saw ? 'witnessed' : 'learned of'} ${claim.type}${isVictim ? ' on me' : claim.target ? ` on ${w.nameOf(claim.target)}` : ''}${appraisal ? ` (${appraisal.roles[0]}, personal significance ${appraisal.weight.toFixed(2)})` : ''}${forgiveness > 0.05 ? `, tempered by what I owe them (${forgiveness.toFixed(2)})` : ''}`, cause);
      if (actor && actorP && !actorP.hostile && claim.type !== 'theft') { for (const q of w.persons()) if (q !== p && q.id !== actor && isFamily(p, q.id)) {/* family shares outrage later through telling */} }
      const emo = p.emotions; const before = { ...emo };
      emo.fear = clamp(emo.fear + fear * 0.6); emo.stress = clamp(emo.stress + sev * 0.5); emo.anger = clamp(emo.anger + grudge * 0.5 * (p.traits.aggression + 0.3));
      if (Math.abs(emo.fear - before.fear) + Math.abs(emo.anger - before.anger) > 0.1) w.emit('emotion_changed', { actor: p.id, causes: [cause], significance: 0.25, data: { fear: emo.fear, anger: emo.anger, stress: emo.stress }, summary: `${p.name} feels ${emo.fear > emo.anger ? `afraid (fear ${emo.fear.toFixed(2)})` : `angry (anger ${emo.anger.toFixed(2)})`}` });
      p.mind.alarm = 1; p.mind.attention = actor ?? null;
      const line = this.reactionLine(p, claim.type, actorP, claim.target, isVictim, victimClose);
      if (line) this.say(p, line);
    } else if (e.type === 'gift' || e.type === 'returned_item' || e.type === 'apology' || e.type === 'debt_paid' || e.type === 'heal') {
      // Causal Society. Kindness was the half of the ledger v0.9's appraisal never reached: harm
      // moved a relationship in proportion to what the event MEANT to this person, help moved it
      // by a flat +0.1 for everybody. So watching a stranger hand a coin to a stranger changed a
      // bystander's regard exactly as much as watching someone tend their own child — which is
      // the "every witness reacts identically" failure the milestone names.
      //
      // Two terms now, both read off this person's own relationships. The same `personal` factor
      // the harm branch uses, and — with no counterpart on the harm side — how much I care about
      // the person who was HELPED. A kindness done to someone dear to me is a kindness done to
      // me, and that is a real and ordinary asymmetry between witnesses.
      if (actor && actor !== p.id) {
        const beneficiary = claim.target as EntityId | undefined;
        const forSomeoneDear = beneficiary && beneficiary !== p.id
          ? Math.max(0, disposition(p, beneficiary)) + (isClose(p, beneficiary) ? 0.5 : 0)
          : 0;
        const warmth = clamp((isVictim ? 3 : 1 + forSomeoneDear) * personal * (KINDNESS_WEIGHT[e.type] ?? 1), 0, 3);
        adjustRel(w, p, actor, { trust: 0.1 * warmth, affection: 0.1 * warmth, respect: 0.05 * warmth },
          `${saw ? 'saw' : 'heard of'} ${e.type}${beneficiary && beneficiary !== p.id ? ` done for ${w.nameOf(beneficiary)}` : ''}${forSomeoneDear > 0.2 ? ' — someone I care about' : ''}`, cause);
      }
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
    // v0.9 §B: every candidate goal, whatever proposed it, is offered up to the concerns this
    // person is carrying (mind/concern.ts's `concernGoalBoost`). This is the one place knowledge
    // turns into behaviour, and it is deliberately generic: a welfare concern makes going to see
    // that particular person more attractive, a justice concern makes reporting/investigating
    // more attractive, a work concern makes turning up to the short-handed workplace more
    // attractive — and the goals themselves are the ordinary ones the simulation already had.
    // Bounded (a maximal concern adds < 0.3), so a concern bends a decision, never dictates it.
    // v0.10 §III: `concernGoalBoost` has been generalized into `motivationBoost` — one bridge
    // that folds a live concern, a standing obligation and an active purpose together under ONE
    // shared cap, rather than three independent bonuses that could stack into a decision
    // override. `data.beneficiary` lets a goal whose target is a PLACE or a task still declare
    // whom it is actually for (a haul serves whoever requested it), which is what makes "I'll
    // carry his flour, he stood by me" expressible without a special case.
    const G = (type: GoalType, utility: number, reasons: string[], o: Partial<Goal> = {}) => {
      const key = `${type}:${o.targetEntity ?? o.targetPlace ?? ''}`;
      const boost = motivationBoost(p, type, o.targetEntity ?? o.targetPlace, o.data?.beneficiary as EntityId | undefined, o.data?.resource as ItemType | undefined);
      const data = boost.pursuitId && !o.data?.pursuitId ? { ...(o.data ?? {}), pursuitId: boost.pursuitId } : o.data;
      cands.push({ type, utility: boost.bonus ? clamp(utility + boost.bonus) : utility, reasons: boost.bonus ? [...reasons, ...boost.reasons] : reasons, createdAt: now, key, ...o, data });
    };
    const pos = body.pos; const sched = currentScheduleEntry(p, hour);
    // v0.4 §1/§7: heat escalates progressively rather than a single on/off gate — see
    // core/physiology.ts's `heatBand`. 'severe' dampens heavy-work utility below; 'dangerous'
    // outbids everything with a forced-rest 'idle' goal (Constitution v0.4 §1 "dangerously hot
    // -> forced rest / cooling behaviour"), without inventing a separate goal machinery.
    const heat = heatBand(p);
    if (heat === 'dangerous') {
      G('idle', 0.95, [`dangerously overheated (body heat ${p.physiology.bodyHeat.toFixed(2)})`, 'must rest and cool down']);
    }
    const downed = body.pose === 'downed';
    // v0.2.3 held states: a detained, surrendered, or subdued person runs no autonomous combat
    // or movement (Constitution §11). They wait it out; the maintenance pass ends the state.
    // Crucially this must NOT re-`setGoal` (and re-emit goal_changed) on every think tick for the
    // whole days-long duration — hold the goal, only refresh the wait plan when it lapses.
    const holdGoal = (key: string, type: GoalType, reason: string): void => {
      if (m.goal?.key !== key) this.setGoal(p, { type, utility: 1, reasons: [reason], createdAt: now, key }, [{ type: 'wait', duration: 20 * 60, status: 'pending', data: { held: true } }], reason);
      else if (!m.plan.length || m.plan.every(x => x.status === 'done' || x.status === 'failed')) m.plan = [{ type: 'wait', duration: 20 * 60, status: 'pending', data: { held: true } }];
    };
    if (p.custody?.active) { holdGoal('idle:custody', 'idle', `held in custody (${p.custody.reason})`); return; }
    if (p.surrender) { holdGoal('surrender:held', 'surrender', `surrendered to ${w.nameOf(p.surrender.toId)}`); return; }
    if (body.subduedUntil > w.physicalTime) { holdGoal('idle:subdued', 'idle', 'subdued'); return; }
    if (downed) { holdGoal('idle:downed', 'idle', 'incapacitated'); return; }
    // ---- v0.10 §III "people must remain embodied": how much room this person's body currently
    // leaves for anything that is not their body. Computed once, up here, because two different
    // things read it: `bodyRoom` scales the ordinary social-duty goals below, and `embodiment`
    // (further down, once threat assessment has run) scales every purpose-driven candidate.
    //
    // `bodyRoom` exists because of a measured pathology that predates this milestone but is
    // exactly the failure mode the milestone is required to protect against. `report` clamps to
    // 1.00 on any serious crime involving someone close — 0.45 base + severity + honesty +
    // closeness already exceeds 1 before any concern boost — which ties or beats a CRITICAL
    // thirst and then wins the +0.12 hysteresis margin. Measured on seed 777: a villager spent
    // fourteen straight world hours trying to tell the watch at thirst 1.00 and hunger 1.00,
    // never drinking and never sleeping. It is an identity multiplier (1.0) for anyone who is
    // not actually in distress, so ordinary reporting behaviour is unchanged.
    const purposeBands = { hunger: hungerBand(p), thirst: thirstBand(p), sleep: sleepBand(p) };
    const criticalNeed = severityAtLeast(purposeBands.hunger, 'critical') || severityAtLeast(purposeBands.thirst, 'critical') || severityAtLeast(purposeBands.sleep, 'critical');
    const urgentNeed = severityAtLeast(purposeBands.hunger, 'urgent') || severityAtLeast(purposeBands.thirst, 'urgent') || severityAtLeast(purposeBands.sleep, 'urgent');
    const bodyRoom = criticalNeed ? 0.35 : urgentNeed ? 0.7 : 1;
    // ---- threat assessment from perception + relationships
    let threat: { id: EntityId; d: number; fear: number; body: Body } | null = null;
    let avoid: { id: EntityId; d: number } | null = null; // someone we're wary of but not currently fighting
    for (const pc of m.percepts) {
      const other = w.person(pc.entityId); if (!other || !other.alive) continue; const ob = w.body(pc.bodyId)!; if (ob.dead) continue;
      // v0.2.3: a surrendered / subdued / detained person is not a threat to anyone.
      if (other.surrender || other.custody?.active || ob.subduedUntil > w.physicalTime) continue;
      const attackingMeNow = ob.pose === 'attack' && ob.attackTarget === p.id && dist2(ob.pos, pos) < 3;
      // On pursuit cooldown for this one (just failed to reach them) — stay wary, don't re-chase,
      // unless they are actively attacking me right now.
      if ((m.pursuitCooldowns?.[other.id] ?? 0) > now && !attackingMeNow) { if (!avoid || pc.distance < avoid.d) avoid = { id: other.id, d: pc.distance }; continue; }
      // A downed body is already incapacitated (Constitution §11: 'subdue'/'arrest' must be a
      // real terminal outcome, not merely non-lethal-and-repeatable). Without this, a subdued
      // target kept registering as an active threat every think() tick, so the subduer (or
      // anyone else nearby) would immediately re-attack them — resetting their downed timer
      // forward on every hit and producing an endless attack/arrest loop between the same two
      // actors instead of the fight actually ending. See docs/V0_2_WORLD_ENGINE.md.
      if (ob.pose === 'downed') continue;
      const r = relOrNull(p, other.id); const hostileFaction = other.hostile !== p.hostile;
      const fear = (r?.fear ?? 0) + (hostileFaction ? 0.5 : 0) + (r && r.grudge > 0.5 ? 0.1 : 0);
      // v0.2.1 Priority 7 fix: `attackTarget` must actually be me, not just "someone is in
      // attack pose nearby" — see the Body.attackTarget doc comment in core/types.ts for the
      // bystander-misattribution bug this closes.
      const attackingMe = ob.pose === 'attack' && ob.attackTarget === p.id && dist2(ob.pos, pos) < 3;
      const knownCriminal = (p.occupation === 'guard' || p.occupation === 'captain') && !other.hostile && pc.distance < 17 && this.knownCrimesBy(p, other.id).length > 0;
      const theirGoal = other.mind.goal?.type;
      const freshAggression = attackingMe || theirGoal === 'attack' || theirGoal === 'rob' || theirGoal === 'confront';
      // v0.2.3 re-engagement gate (Priority 7): a conflict that already ended does NOT restart
      // just because grudge/fear is still high and the other party wandered back into view.
      // Only fresh aggression, or a fresh crime learned since the conflict wound down, re-opens it.
      if ((fear > 0.25 || (hostileFaction && pc.distance < 14) || knownCriminal) && !freshAggression && this.reengagementBlocked(p, other.id)) {
        if (!avoid || pc.distance < avoid.d) avoid = { id: other.id, d: pc.distance };
        continue;
      }
      if (fear > 0.25 || attackingMe || (hostileFaction && pc.distance < 14) || knownCriminal) { const f = fear + (attackingMe ? 0.8 : 0); if (!threat || f / (pc.distance + 1) > threat.fear / (threat.d + 1)) threat = { id: other.id, d: pc.distance, fear: f, body: ob }; }
    }
    const isGuard = p.occupation === 'guard' || p.occupation === 'captain';
    const brave = p.traits.courage + p.traits.aggression * 0.5 + (isGuard ? 0.5 : 0) + (p.hostile ? 0.4 : 0);
    // v0.2.3: bound pursuit (Constitution §11 — "do not create endless world-spanning pursuit").
    // If the other party in a live fight has broken contact and is well away, the fight is over:
    // break it off here rather than re-pathing after them across the map every tick.
    if (threat && threat.d > 26) {
      const c = conflictBetween(w, p.id, threat.id);
      if (c && (c.status === 'active' || c.status === 'disengaging')) { disengageConflict(w, c, p.id, 'they broke contact'); threat = null; }
    }
    if (threat) {
      const t = w.person(threat.id)!; const r = getRel(p, threat.id);
      const armed = this.weaponOf(p) > 0; const healthy = body.health / body.maxHealth;
      const fightU = clamp(0.3 + brave * 0.5 + (armed ? 0.15 : -0.15) + healthy * 0.2 - threat.fear * 0.3 + r.grudge * 0.4 + (t.hostile !== p.hostile ? 0.25 : 0) - (isGuard ? 0 : 0.2));
      const fleeU = clamp(0.35 + threat.fear * 0.8 - brave * 0.4 - (armed ? 0.1 : 0) + (1 - healthy) * 0.3 - threat.d * 0.01);
      // v0.2.3 disengagement + surrender (Constitution §11): a fight I am badly losing should
      // end — by breaking off, or, when there is no way out, by yielding. These override the
      // "brave" bandit/guard bravado that otherwise kept both sides fighting forever (v0.2.2 audit).
      const cf = conflictBetween(w, p.id, threat.id);
      const inFight = !!cf && (cf.status === 'active' || cf.status === 'disengaging') && cf.attackCount > 0;
      const tBody0 = w.primaryBody(t.id);
      const theirHealth = tBody0 ? tBody0.health / tBody0.maxHealth : 1;
      const theyMeanToKill = cf?.intent === 'kill' || (threat.body.pose === 'attack' && this.weaponOf(t) >= 26 && r.grudge > 0.85);
      const overwhelmed = m.percepts.filter(pc => { const o = w.person(pc.entityId); return !!o && o.alive && o.id !== p.id && relOrNull(p, o.id) && (relOrNull(p, o.id)!.fear > 0.3 || o.hostile !== p.hostile) && pc.distance < 10; }).length >= 2;
      const cornered = threat.d < 4 && (fleeU < 0.35 || overwhelmed);
      const losingBadly = inFight && healthy < 0.32 && (theirHealth > healthy + 0.12 || overwhelmed);
      if (losingBadly && !theyMeanToKill) {
        G('flee', clamp(0.62 + (1 - healthy) * 0.35 + (overwhelmed ? 0.1 : 0)), [`I'm hurt and losing this fight`, `my health ${(healthy * 100).toFixed(0)}% vs theirs ${(theirHealth * 100).toFixed(0)}%`], { targetEntity: threat.id, data: { disengage: true } });
      }
      // Surrender: genuinely hopeless — critically wounded AND pinned/outnumbered, opponent not
      // out to kill. Fierce (high courage/aggression) actors and guards resist; timid ones fold.
      const hopeless = healthy < 0.16 && (cornered || overwhelmed || threat.fear > 0.55);
      const surrenderU = clamp(
        (inFight && !theyMeanToKill ? 0.2 : -1)
        + (hopeless ? 0.5 : 0) + (1 - healthy) * 0.5
        + threat.fear * 0.25 + (overwhelmed ? 0.2 : 0) + (cornered ? 0.15 : 0)
        + (0.45 - p.traits.courage) * 0.9 - p.traits.aggression * 0.4 - (isGuard ? 0.6 : 0) - p.traits.loyalty * 0.2,
      );
      if (surrenderU > 0.55 && surrenderU >= fightU) {
        G('surrender', surrenderU, [`${t.name} has beaten me and isn't trying to kill me`, `health ${(healthy * 100).toFixed(0)}%`, overwhelmed ? 'outnumbered' : cornered ? 'nowhere to run' : `courage ${p.traits.courage.toFixed(2)}`], { targetEntity: t.id, data: { conflictId: cf?.id } });
      }
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
        // Constitution §71: a bandit must be able to size up a fight it would lose, not just
        // ones it's already losing. "Opposition strength" folds in whether the target is armed,
        // a guard/captain, still near-full health, and — critically — whether allied guards are
        // nearby to back them up, so a materially superior response makes flee outcompete
        // robbery/attack instead of the bandit pressing on regardless.
        const targetArmed = this.weaponOf(t) > 0;
        const tBody = w.primaryBody(t.id);
        const targetHealthy = tBody ? tBody.health / tBody.maxHealth : 1;
        const guardBackup = m.percepts.filter(pc => { const o = w.person(pc.entityId); return !!o && o.alive && o.id !== t.id && (o.occupation === 'guard' || o.occupation === 'captain') && pc.distance < 16; }).length;
        const oppositionStrength = (targetArmed ? 0.3 : 0) + (t.occupation === 'guard' || t.occupation === 'captain' ? 0.3 : 0) + targetHealthy * 0.2 + guardBackup * 0.4;
        const engageU = clamp(fightU + 0.2 + pressure * 0.3 - oppositionStrength * 0.5);
        const fleeFromOpposition = clamp(fleeU + oppositionStrength * 0.5);
        // A robber does not immediately re-victimize someone it just robbed merely because
        // they are still nearby and technically "hostile-flagged" — see robCooldowns. But the
        // cooldown must only block *starting a fresh* robbery, never orphan one already under
        // way (demand/attack/take/disengage is several actions deep): while the bandit's own
        // current goal already IS this robbery and its plan hasn't finished yet, the same
        // candidate keeps being offered so hysteresis has something to hold onto instead of the
        // plan (including the post-robbery disengage step) getting discarded mid-flight.
        // Physical time, not world/calendar time — the same clock the downed-recovery timer
        // (poseUntil) itself uses, so the cooldown reliably outlasts recovery regardless of how
        // fast world/calendar time happens to be running relative to physical seconds. Scoped to
        // robbery specifically (Priority 1's stated focus); the analogous guard-arrest
        // "encounter already resolved" gap is noted as a follow-up in
        // docs/V0_2_1_WORLD_ENGINE_STABILIZATION.md rather than folded in here, since a real fix
        // needs actual custody/arrest-resolution semantics, not just a cooldown.
        const cooldownUntil = intent === 'rob' ? m.robCooldowns?.[t.id] : undefined;
        const onCooldown = !!cooldownUntil && cooldownUntil > w.physicalTime;
        const planInFlight = m.plan.length > 0 && !m.plan.every(a => a.status === 'done' || a.status === 'failed');
        const alreadyRobbingThis = m.goal?.type === 'rob' && m.goal.targetEntity === t.id && planInFlight;
        // v0.2.3: recently released from custody — keep a low profile, don't start a fresh
        // robbery (defence against a revolving-door custody loop; §19 behavioural quality).
        const layingLow = !isGuard && (m.layLowUntil ?? 0) > now && !alreadyRobbingThis;
        if (layingLow) {
          if (t.hostile !== p.hostile && (t.occupation === 'guard' || t.occupation === 'captain') && threat.d < 12) G('flee', clamp(0.5 + threat.fear * 0.4), [`the watch is about and I only just got out`, 'lying low'], { targetEntity: t.id });
        } else if (!isGuard && oppositionStrength > 0.45 && fleeFromOpposition > engageU && !alreadyRobbingThis) {
          G('flee', fleeFromOpposition, [`${t.name} looks like more trouble than it's worth`, `opposition ${oppositionStrength.toFixed(2)}`], { targetEntity: t.id });
        } else if (!onCooldown || alreadyRobbingThis) {
          G(intent === 'rob' ? 'rob' : 'attack', engageU, [`${t.name} is an enemy`, `courage ${p.traits.courage.toFixed(2)}`, `intent: ${intent}`, pressure ? `resource pressure ${pressure.toFixed(2)}` : '', oppositionStrength > 0.2 ? `opposition ${oppositionStrength.toFixed(2)}` : ''], { targetEntity: t.id, data: { intent } });
        }
      }
      // Constitution §11: a hostile-faction flag is only alarming when it differs from my own
      // (t.hostile !== p.hostile) — two members of the SAME hostile faction (e.g. two bandits)
      // are not a threat to each other merely because both happen to be flagged hostile. Without
      // this, a bandit's own ally registered as a "threat" via this bare `t.hostile` check on
      // every think() cycle, producing sustained mutual "self-defense" combat between allies —
      // observed in a real headless run as 963 repeated attacks between two same-faction
      // bandits, the same class of unresolved-loop defect Priority 1 fixed for robbery victims.
      else if ((threat.body.pose === 'attack' && threat.body.attackTarget === p.id) || r.fear > 0.35 || (t.hostile !== p.hostile)) {
        if (fightU > fleeU && (armed || brave > 0.9)) G('attack', fightU, [`${t.name} is a threat (fear ${threat.fear.toFixed(2)})`, `I am ${armed ? 'armed' : 'unarmed'}, courage ${p.traits.courage.toFixed(2)}`, 'intent: defend'], { targetEntity: t.id, data: { intent: 'defend' as ConflictIntent } });
        else G('flee', fleeU, [`${t.name} is a threat (fear ${threat.fear.toFixed(2)}, dist ${threat.d.toFixed(1)})`, `courage ${p.traits.courage.toFixed(2)}${armed ? '' : ', unarmed'}`], { targetEntity: t.id });
      }
    }
    // v0.2.3: someone we have unresolved history with is nearby, but the fight is over and there
    // is no fresh cause — keep our distance rather than restart it (Constitution §11 "persistent
    // nonviolent hostility"; fear/grudge influence decisions, they are not combat-forever).
    if (!threat && avoid && !p.hostile) {
      const ar = getRel(p, avoid.id);
      G('flee', clamp(0.25 + ar.fear * 0.5 + ar.grudge * 0.2 - p.traits.courage * 0.2 - avoid.d * 0.01), [`${w.nameOf(avoid.id)} is about — best keep clear`, `old grudge ${ar.grudge.toFixed(2)}, fear ${ar.fear.toFixed(2)}`], { targetEntity: avoid.id, data: { avoidance: true } });
    }
    // ---- knowledge-driven goals: report crimes, investigate, recover items
    const crimes = Object.values(p.knowledge).filter(k => k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && !k.handled && now - k.learnedAt < 86400 * 3);
    // Resolved once for the whole loop rather than per belief: this is a scan of everyone alive,
    // and a person who remembers five crimes was otherwise paying for it five times a tick.
    const authorities = crimes.length && !isGuard && !p.hostile
      ? w.persons().filter(g => (g.occupation === 'guard' || g.occupation === 'captain') && g.alive)
      : EMPTY_PERSONS;
    for (const k of crimes) {
      const sev = crimeSeverity(k.claim.type); const victimClose = k.claim.target ? isClose(p, k.claim.target) : false; const victimIsMe = k.claim.target === p.id;
      const actorIsMe = k.claim.actor === p.id; if (actorIsMe) continue;
      const actorP = w.person(k.claim.actor);
      if (actorP?.hostile && k.claim.type !== 'kill' && !isGuard) continue; // bandit crimes are old news
      if (isGuard) {
        if (!m.investigated.has(k.key) && k.claim.pos) G('investigate', clamp(0.55 + sev * 0.4 + (k.hops === 0 ? 0.1 : 0)), [`I know of a ${k.claim.type} (${k.source.type}${k.source.from ? ' by ' + w.nameOf(k.source.from) : ''}, confidence ${k.confidence.toFixed(2)})`, 'my duty is to investigate'], { targetPos: k.claim.pos, targetPlace: k.claim.placeId, data: { key: k.key, suspect: k.claim.actor }, causeEvent: k.source.viaEvent });
      } else if (!p.hostile) {
        // v0.10.1 §XII: reporting is progress toward an outcome, not a standing urge. The record
        // (`mind/reporting.ts`) knows whether this has already been delivered, whether the matter
        // is over as far as THIS person has heard, whether there is anyone to tell, and how many
        // trips have already come to nothing — and it is what decides whether to set out again.
        const progress = refreshReport(w, p, k, authorities);
        const untold = authorities.filter(g => !k.sharedWith.includes(g.id));
        const eligible = p.occupation !== 'child' || victimClose;
        if (eligible && untold.length && shouldSeekAuthority(w, progress)) {
          const g = this.nearestKnownGuard(p, pos, untold);
          if (g) {
            const base = clamp(0.45 + sev * 0.5 + p.traits.honesty * 0.2 + (victimClose ? 0.15 : 0) + (victimIsMe ? 0.1 : 0) - (threat ? 0.15 : 0));
            const reasons = [`I know ${describeClaim(w, k)} (${k.source.type})`, `the watch should hear of it`, `honesty ${p.traits.honesty.toFixed(2)}`];
            if (progress.attempts > 0) reasons.push(`I have tried ${progress.attempts} time${progress.attempts === 1 ? '' : 's'} already`);
            G('report', base * reportUrgencyFactor(progress) * bodyRoom, reasons, { targetEntity: g.id, data: { key: k.key } });
          }
        }
      }
    }
    // help injured close ones
    for (const pc of m.percepts) { const o = w.person(pc.entityId); const ob = w.body(pc.bodyId); if (!o || !ob || !o.alive) continue; if ((ob.pose === 'downed' || ob.health < ob.maxHealth * 0.5) && isClose(p, o.id) && !threat) G('help', 0.7, [`${o.name} is hurt and dear to me`], { targetEntity: o.id }); }
    // desires
    for (const d of p.desires) if (!d.fulfilled && d.type === 'recover_item') { const loc = p.knowledge[`loc:${d.targetId}`]; const it = w.item(d.targetId); if (loc && it && !it.holderId && it.pos && !threat) G('recover_item', 0.6, [`I know where ${it.name} is (${loc.source.type})`], { targetEntity: it.id, targetPos: it.pos }); }
    // v0.8 §P0-G/H (independent audit §4.6): an authorized third party — someone who has heard
    // `wanted:<itemId>` (via `maybeAskForHelp`/`hearDesire`) AND separately, through real
    // perception/gossip, actually knows where the item is — can now act on both facts together,
    // rather than that combination being a dead end unless a player happens to open the "ask
    // about an item" dialogue menu (`askAboutItemMenu`). No new knowledge is invented here: both
    // `wanted:` and `loc:` must already be present through their own real, provenance-carrying
    // channels.
    for (const k of Object.values(p.knowledge)) {
      if (k.kind !== 'fact' || !k.claim.wantedItem || !k.claim.itemId) continue;
      const itemId = k.claim.itemId as string; const requesterId = k.claim.requesterId as string;
      if (!requesterId || requesterId === p.id) continue;
      const requester = w.person(requesterId); if (!requester || !requester.alive) continue;
      const desire = requester.desires.find(rd => rd.type === 'recover_item' && rd.targetId === itemId && !rd.fulfilled);
      if (!desire) continue;
      const it = w.item(itemId); const loc = p.knowledge[`loc:${itemId}`];
      // v0.8 §P0-G/H fix: keeps proposing the SAME candidate once the item is actually in this
      // person's own hands mid-delivery (`it.holderId === p.id`), not only while it is still
      // lying loose. Without this, the goal stopped being offered the instant `pickup` succeeded
      // (the item is no longer "loose" — the ordinary `recover_item` gate a few lines above has
      // the same `!it.holderId` shape, which is correct there since the OWNER'S OWN copy of this
      // check should stop once someone else holds it) — leaving nothing to out-compete an
      // ordinary need (hunger, sleep) on the very next think() tick and stranding a helper
      // holding someone else's ring indefinitely. A higher utility while actively carrying it
      // mirrors `mind/commitment.ts`'s 'committed' protection for haul/build: the closer the
      // deliverable is to done, the less it should be interrupted (Constitution v0.5 §8).
      const carrying = it && it.holderId === p.id;
      if (it && ((carrying) || (loc && !it.holderId && it.pos)) && !threat) G('help_recover_item', clamp((carrying ? 0.78 : 0.5) + p.traits.honesty * 0.15), [carrying ? `I have ${it.name} — I should bring it to ${requester.name}` : `I know where ${it.name} is`, `${requester.name} asked me to find it`], { targetEntity: it.id, targetPos: it.pos ?? undefined, data: { deliverTo: requesterId } });
    }
    // ---- v0.9 §B/§D: concerns that call for going somewhere or doing something specific.
    // A welfare concern about someone I have no fresh information about is answered by physically
    // going to look — the same thing a real person does. Suppressed while a threat is present and
    // while the person is already in front of me (there is nothing to go and find out).
    for (const c of activeConcerns(p)) {
      if (c.kind !== 'welfare' || !c.subjectId || c.subjectId === p.id) continue;
      if (threat || !concernActionable(w, c)) continue;
      // Only a real worry gets someone to drop what they are doing and cross the village. A
      // faint one is felt (it still colours conversation and relationships) without becoming an
      // errand — measured directly on the WorldLab construction scenario, where an unbounded
      // version of this goal diverted enough ordinary labour that the village's only building
      // project stalled four planks short at every seed.
      if (c.intensity < 0.3) continue;
      const subject = w.person(c.subjectId); if (!subject || !subject.alive) continue;
      // Concern is not courage: nobody walks across the village to look in on someone they are
      // afraid of, or someone on the other side of an outlaw/settled divide. Without this, a
      // pastoral concern formed about a subdued outlaw sent an unarmed elder repeatedly toward
      // the bandit camp — a real behaviour, but not a sane one, and it never discharged because
      // he could never safely arrive.
      if (subject.hostile !== p.hostile) continue;
      if (getRel(p, c.subjectId).fear > 0.25) continue;
      const seenNow = m.percepts.some(pc => pc.entityId === c.subjectId);
      if (seenNow) continue; // 'help' below already covers someone hurt in front of me
      const loc = p.knowledge[`loc:${c.subjectId}`];
      const believedPos = (loc?.claim.pos as Vec3 | undefined);
      const homePos = w.place(subject.homeId)?.inside;
      const dest = believedPos ?? homePos;
      if (!dest) continue; // I have no idea where to even look — going nowhere is honest
      const staleHours = loc ? (now - loc.learnedAt) / 3600 : 99;
      // Deliberately capped below a claimed haul (0.68) and an occupational work shift, so going
      // to see someone competes with idling, socialising and errands — not with the work the
      // village depends on. A genuine emergency (someone hurt in front of me) is the 'help' goal,
      // which is scored separately and much higher.
      G('check_on', clamp(0.18 + c.intensity * 0.32), [
        `I have not seen ${subject.name} ${loc ? `in ${staleHours.toFixed(0)}h` : 'at all lately'}`,
        ...c.reasons.slice(0, 2),
      ], { targetEntity: c.subjectId, targetPos: { ...dest }, targetPlace: loc?.claim.placeId ?? subject.homeId ?? undefined, data: { concernId: c.id } });
    }
    // ---- v0.10 §I: PERSISTENT PURPOSES propose their own next step.
    //
    // This is the block that turns "reacting to things" into "trying to do something". Each
    // ACTIVE pursuit is asked, fresh, what would serve it given the world as it actually is and
    // as this person believes it to be (`pursuitSteps`); the answer is an ordinary existing goal,
    // offered as an ordinary candidate that has to win on utility like everything else.
    //
    // `embodiment` is the guarantee that people stay people (§III). It is computed from real
    // physiological severity bands and the presence of a threat, and it multiplies every
    // purpose-driven candidate — so a devoted spouse with a critical thirst answers the thirst,
    // and nobody starves for a social purpose. A purpose can never propose a combat or
    // confrontation goal (`PURSUIT_FORBIDDEN_GOALS`); that is the v0.9 justice-concern feedback
    // loop made structurally impossible rather than merely avoided.
    const embodiment = threat || heat === 'dangerous' || downed ? 0 : criticalNeed ? 0.25 : urgentNeed ? 0.55 : 1;
    // (`bodyRoom`, computed alongside the severity bands above, applies the same principle that predate v0.10 but share
    // the failure mode. Measured directly (seed 777, family scenario): `report` clamps to 1.00
    // on any serious crime involving someone close — 0.45 base + severity + honesty + closeness
    // already exceeds 1 before any concern boost — which ties or beats a CRITICAL thirst and
    // then wins the +0.12 hysteresis margin, so a villager spent fourteen straight world hours
    // trying to tell the watch while at thirst 1.00 and hunger 1.00, never drinking and never
    // sleeping. That is precisely the "a social goal becomes absolute and people stop looking
    // after themselves" pathology this milestone is required to protect against, and the fix is
    // the same one purposes get: real physiological severity leaves less room for anything else.
    if (embodiment > 0) {
      for (const pu of activePursuits(p)) {
        // A purpose whose condition is already met ends here and now — see `satisfiedNow`.
        const done = satisfiedNow(w, p, pu);
        if (done) { resolvePursuit(w, p, pu, 'satisfied', done); continue; }
        for (const step of pursuitSteps(w, p, pu)) {
          if (PURSUIT_FORBIDDEN_GOALS.has(step.goal)) continue; // belt and braces; see the set's doc
          G(step.goal, pursuitStepUtility(pu, step, embodiment), [
            `purpose: ${describePursuit(w, pu)} (priority ${pu.priority.toFixed(2)})`,
            step.reason,
            ...pu.reasons.slice(0, 1),
            embodiment < 1 ? `but my own body is telling me otherwise (${criticalNeed ? 'critical' : 'urgent'} need)` : '',
          ], {
            targetEntity: step.targetEntity, targetPlace: step.targetPlace, targetPos: step.targetPos,
            data: { ...(step.data ?? {}), pursuitId: pu.id },
            causeEvent: pu.causeEventId,
          });
        }
      }
    }

    // v0.9 §D: a badly hurt person withdraws from ordinary life. This is the mechanism that makes
    // an assault produce a real, observable secondary consequence — the injured worker is not at
    // work, which is exactly what social/absence.ts lets other people notice. Generic to any
    // cause of injury (a brawl, a fall in a fight, a robbery), not special-cased to assault.
    const wound = woundSeverity(body);
    if (wound >= SERIOUS_WOUND && !threat) {
      G('go_home', clamp(0.45 + wound * 0.5), [`I am badly hurt (wound ${wound.toFixed(2)})`, 'I am fit for nothing but resting'], { targetPlace: p.homeId ?? undefined });
    }

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
    // v0.2.4: eat where the food actually is — carried food or the household larder (free),
    // else a food source THEY KNOW ABOUT (buy). The `eat` action consumes a real food item
    // (mind/metabolism). v0.6 §III.2: `knownFoodPlace` replaces the old omniscient
    // `world.places().find(type === 'bakery')` scan — a hungry mind can only target a food
    // source it has actually learned of (generation seeding, direct observation, or a past
    // purchase — see mind/knowledge.ts), never every bakery/tavern/store that happens to exist.
    const foodHome = findAccessibleFood(w, p, p.homeId ?? null) ?? findAccessibleFood(w, p, w.placeAt(pos)?.id ?? null);
    const gaveUp = (m.noFoodUntil ?? 0) > now;
    const knownFood = knownFoodPlace(w, p);
    const eatPlace = foodHome
      ? ((foodHome.holderId === p.id ? w.placeAt(pos)?.id : foodHome.placeId) ?? p.homeId ?? undefined)
      : (knownFood ?? (sched?.activity === 'eat' ? sched.placeId : undefined) ?? p.homeId ?? undefined);
    if (!gaveUp || foodHome) {
      const grounded = !!(foodHome || knownFood);
      const intentionReason = foodHome ? 'have food on hand or at home' : knownFood ? 'know a place that sells food' : sched?.activity === 'eat' ? 'scheduled meal' : 'no known food source';
      G('eat', clamp(n.hunger * 0.9 + (mealTime ? 0.3 : -0.1) - satiatedPenalty - (gaveUp ? 0.3 : 0)), [`hunger ${n.hunger.toFixed(2)}`, mealTime ? 'meal time' : ateRecently ? 'recently ate' : '', foodHome ? '' : 'must find food'], { targetPlace: eatPlace, data: { food: foodHome?.id, intentionReason, grounded } });
    }
    // v0.6 §VI: the information-limited contrasting case — hunger with no accessible food and no
    // known food source (and no scheduled meal to fall back on) is a real, physical SEARCH, never
    // a magically-resolved trip to an unknown bakery. Bounded utility (never close to a genuine
    // emergency or an informed eat goal); see plan()'s 'wander' case for how the search targets an
    // unvisited place — arriving there is itself how the knowledge gap eventually closes.
    if (!foodHome && !knownFood && !gaveUp && sched?.activity !== 'eat' && severityAtLeast(hungerBand(p), 'uncomfortable')) {
      G('wander', clamp(0.25 + n.hunger * 0.5), [`hunger ${n.hunger.toFixed(2)}`, "I don't know where to find food — looking around"], { data: { foodSearch: true } });
    }
    // v0.2.4: thirst — seek a canonical water source (well / river). Rises faster than hunger,
    // so this is a common everyday goal, kept low-drama (no death spiral).
    let drankRecently = false;
    for (let i = w.events.length - 1; i >= 0; i--) { const ev = w.events[i]; if (now - ev.tick >= 30 * 60) break; if (ev.type === 'water_consumed' && ev.actor === p.id) { drankRecently = true; break; } }
    if (n.thirst > 0.38 && !drankRecently && !threat && sched?.activity !== 'sleep') {
      const src = nearestWaterSource(w, pos);
      if (src) G('drink_water', clamp(0.2 + n.thirst * 0.8 - (night ? 0.25 : 0)), [`thirst ${n.thirst.toFixed(2)}`], { targetPos: src.pos, targetPlace: src.placeId, data: { water: true } });
    }
    // v0.2.4: a farmer whose schedule has them at their field does real field work — harvest a
    // ripe plot, or sow a fallow one — in preference to the generic 'work' animation.
    if ((p.occupation === 'farmer') && sched?.activity === 'work' && sched.placeId) {
      const field = fieldFor(w, sched.placeId);
      if (field) {
        const rainingNow = w.weather.kind === 'rain' || w.weather.kind === 'storm';
        // v0.8 §P0-E fix (independent audit §3.3/§4.3): `GRAIN_CAP` alone gates harvest on
        // whether the FIRST stage of the chain (raw grain) has a full warehouse — it says
        // nothing about whether bread, several stages downstream, is actually feeding anyone.
        // Measured directly: harvest froze for 12+ straight days once grain hit its cap while
        // bread stayed pinned at a fraction of its own stock target the whole time (3466
        // resource_shortage events in 30 days) — mature wheat sat unharvested not because no one
        // could reach it, but because the gate was watching the wrong stage of the chain. This
        // reuses the bakery's own existing "bread is short" threshold (`BREAD_SHORTAGE_TRIGGER`,
        // world/production.ts — the same number that already decides when to raise a baking
        // request) rather than inventing a second magic number: grain is only treated as a
        // genuine glut worth pausing harvest for when bread is ALSO not currently short.
        const breadShort = villageStock(w, 'bread') < BREAD_SHORTAGE_TRIGGER;
        const grainGlut = villageStock(w, 'grain') >= GRAIN_CAP && !breadShort;
        if (firstPlot(field, 'harvest') && !grainGlut) G('harvest', clamp(0.7 + (rainingNow ? -0.1 : 0)), [`wheat is ripe in ${w.nameOf(field.placeId)}`], { targetPlace: field.placeId, data: { fieldId: field.id } });
        // v0.3 Priority 13: sowing needs seed grain at the farm — don't adopt `plant` without it.
        else if (firstPlot(field, 'plant') && !rainingNow && farmSeedGrain(w, field) >= SEED_PER_PLOT) G('plant', 0.58, [`there is fallow ground in ${w.nameOf(field.placeId)}`], { targetPlace: field.placeId, data: { fieldId: field.id } });
      }
    }
    // v0.3 Living World I: physical logistics, extraction, and construction labour. Low-drama
    // "there is useful work to be done" goals — they beat idling/socialising and (when
    // role-matched) standing at an empty workplace, but lose to sleep/eat/flee/combat and to
    // real production work. All shared with the player (Constitution VI). Suppressed under threat.
    // v0.4 §7: physical capability/heat gates heavy work as a continuous multiplier, not a
    // pile of per-goal special cases — a near-exhausted/starving/dehydrated/overheated person's
    // `currentExertionCapacity` (core/attributes.ts) drops toward 0 and the labour goals below
    // simply stop competing (sleep/drink/eat/idle already outbid them once needs are that high;
    // this closes the gap for someone whose needs aren't yet critical but is still spent).
    const laborCapacity = heat === 'dangerous' ? 0 : getPhysicalCapability(p, w).currentExertionCapacity;
    // Purely observational tallies (Constitution §53/v0.4 §23 "work stopped due to X") — which
    // physiological pressure is currently the dominant reason labour isn't competing for this
    // person. Never read back into any decision; a headless run's summary reports these so the
    // benchmark can show WHY, not just THAT, heavy work fell off.
    const laborOk = laborCapacity > 0.15;
    // v0.5 §III: a person already COMMITTED to a haul/build (mind/commitment.ts) keeps that one
    // candidate available even through a momentary capacity dip AT the 0.15 boundary — without
    // this, capacity noise right at the threshold (ordinary fatigue fluctuation between think()
    // ticks) made the candidate flicker in and out of `cands`, which read as "the work vanished"
    // to the protection logic below and caused rapid suspend/resume thrash instead of one clean
    // interruption. A GENUINE incapacitation still ends the commitment correctly — it shows up
    // as a real severity-band need (hunger/thirst/sleep) crossing the interruption threshold,
    // since those and `laborCapacity` are driven by the same underlying physiology.
    const committedHaulOrBuild = m.commitment && (m.commitment.status === 'active' || m.commitment.status === 'suspended') && (m.commitment.goalType === 'haul' || m.commitment.goalType === 'build') ? m.commitment.goalType : null;
    if (!threat && !p.hostile && canHaul(p) && !laborOk && !committedHaulOrBuild) {
      const n = p.needs;
      if (heat === 'dangerous' || heat === 'severe') w.runTally.work_stopped_heat = (w.runTally.work_stopped_heat ?? 0) + 1;
      else if (p.physiology.hydration < 0.25) w.runTally.work_stopped_thirst = (w.runTally.work_stopped_thirst ?? 0) + 1;
      else if (n.energy > 0.75) w.runTally.work_stopped_sleep = (w.runTally.work_stopped_sleep ?? 0) + 1;
      else w.runTally.work_stopped_fatigue = (w.runTally.work_stopped_fatigue ?? 0) + 1;
    }
    if (!threat && !p.hostile && canHaul(p) && (laborOk || committedHaulOrBuild)) {
      // v0.5 §V.19: paid work's own utility is weighted by how much this person NEEDS the wage
      // right now (mind/economy.ts's `laborIncentive` — poor and hungry values it more, wealthy
      // and fed values it less). A genuinely critical physiological need still overrides it
      // regardless, since eat/drink_water/sleep's own utilities (and the commitment/interrupt
      // machinery above) are computed entirely independently of this factor.
      const incentive = laborIncentive(p);
      // Haul: physically move a needed resource between two Places.
      if (laborOk || committedHaulOrBuild === 'haul') {
        const haul = pickHaulTask(w, p, pos);
        if (haul) {
          const t = haul.task;
          // Causal Society: `data.resource` is how a haul candidate declares WHAT it would carry,
          // so a supply worry can lift the haul that answers it and leave the rest of the board
          // alone — the material counterpart of `data.beneficiary` declaring whom a haul is for.
          const mine = t.claimantId === p.id;
          const src = w.place(t.sourcePlaceId);
          G('haul', clamp(((mine ? 0.68 : 0.42) + haul.score * 0.4) * laborCapacity * incentive), [`${t.resource} is needed at ${w.nameOf(t.destPlaceId)}`, t.reason, laborCapacity < 0.6 ? `but I am spent (capacity ${laborCapacity.toFixed(2)})` : '', incentive > 1 ? `and I could use the silver` : incentive < 1 ? `though I am not short of coin` : ''], { targetPlace: src ? t.sourcePlaceId : undefined, targetPos: src?.inside, data: { taskId: t.id, beneficiary: t.requesterId ?? undefined, resource: t.resource } });
        }
      }
      // Chop: a woodcutter at the clearing fells a standing tree.
      if (laborOk && p.occupation === 'woodcutter' && sched?.activity === 'work' && sched.placeId && w.place(sched.placeId)?.type === 'wilderness') {
        const node = nearestAvailableNode(w, 'tree', pos, 90);
        if (node) G('chop', clamp(0.66 * laborCapacity), [`there are trees to fell near ${w.nameOf(node.placeId)}`], { targetPos: node.pos, data: { nodeId: node.id } });
      }
      // Build: contribute labour to a project whose materials are on site (cap concurrent builders).
      const proj = laborOk || committedHaulOrBuild === 'build' ? activeBuildProjects(w)[0] : undefined;
      if (proj) {
        const builders = w.persons().filter(q => q.alive && q.mind.goal?.type === 'build' && q.mind.goal.data?.projectId === proj.id).map(q => q.id);
        const site = w.place(proj.sitePlaceId);
        if (site && dist2(pos, site.inside) < 120 && (builders.includes(p.id) || builders.length < MAX_BUILDERS)) {
          G('build', clamp((0.5 + (proj.status === 'building' ? 0.08 : 0)) * laborCapacity * incentive), [`the village needs hands to raise ${proj.name}`], { targetPlace: proj.sitePlaceId, data: { projectId: proj.id } });
        }
      }
      // Fell for planks: a gathering project short of planks, with no wood anywhere that could
      // still become one.
      //
      // v0.10.1 §X/§XI: this is the missing symmetric half of the stone rule below, and it is the
      // root of the `WL-CONSTRUCTION-MATERIAL-STALLED` violation v0.9 and v0.10 both recorded as
      // pre-existing. Demand for planks propagates from the site to the sawpit
      // (`world/construction.ts` raises a plank haul) and from the sawpit to the clearing (it
      // raises a log haul) — but the last link, "and therefore somebody should fell a tree", does
      // not exist. Wood only ever appears because the woodcutter's SCHEDULE happens to put him at
      // the clearing while he is fit to work.
      //
      // Measured on seed 918271 (this is what a 45-day run looks like when that coincidence fails
      // to happen): the shed sits at 15 of 16 planks with the sawpit holding two logs, the
      // clearing empty, twelve trees still standing, and no haul task open, for weeks. The
      // woodcutter is chronically fatigued and hungry — on `main` too, identically — so he sleeps
      // or socialises through shift after shift. The village has the trees, the tools and the
      // need, and nothing connects them.
      //
      // The rule is the stone rule with wood's own pipeline: what could still become a plank is
      // planks on site, planks at the sawpit, logs at the sawpit (`SAW_RATIO`), logs in the
      // clearing, and logs being carried. Same role list, same concurrency cap, same utility, and
      // it stops the moment the pipeline can cover the requirement.
      for (const gp of (laborOk ? w.constructionProjects : [])) {
        if (gp.status !== 'gathering') continue;
        const req = gp.required.find(r => r.type === 'plank'); if (!req) continue;
        const sawpits = w.places().filter(pl => pl.type === 'sawpit');
        const clearings = w.places().filter(pl => pl.type === 'wilderness' && pl.slug === 'clearing');
        const logsToPlanks = (logs: number) => Math.floor(logs / SAW_RATIO.in) * SAW_RATIO.out;
        const looseLogs = w.items().filter(i => i.type === 'log' && i.holderId).reduce((n, i) => n + i.quantity, 0);
        const pipeline = stockAt(w, 'plank', gp.sitePlaceId)
          + sawpits.reduce((n, pl) => n + stockAt(w, 'plank', pl.id), 0)
          + w.items().filter(i => i.type === 'plank' && i.holderId).reduce((n, i) => n + i.quantity, 0)
          + logsToPlanks(sawpits.reduce((n, pl) => n + stockAt(w, 'log', pl.id), 0)
            + clearings.reduce((n, pl) => n + stockAt(w, 'log', pl.id), 0) + looseLogs);
        if (pipeline >= req.quantity) continue;
        const already = w.persons().filter(q => q.alive && q.id !== p.id && q.mind.goal?.type === 'chop').length;
        const chopping = p.mind.goal?.type === 'chop';
        const roleOk = ['woodcutter', 'farmer', 'vagrant', 'apprentice', 'hunter'].includes(p.occupation);
        if (!chopping && (already >= 2 || !roleOk)) continue;
        const node = nearestAvailableNode(w, 'tree', pos, 220);
        if (node) G('chop', clamp(0.5 * laborCapacity * incentive), [`${gp.name} still needs planks, and there is no wood for them`], { targetPos: node.pos, data: { nodeId: node.id } });
      }
      // Gather stone: a gathering project short of stone, with none in the pipeline yet.
      for (const gp of (laborOk ? w.constructionProjects : [])) {
        if (gp.status !== 'gathering') continue;
        const req = gp.required.find(r => r.type === 'stone'); if (!req) continue;
        const pipeline = stockAt(w, 'stone', gp.sitePlaceId)
          + w.places().filter(pl => pl.type === 'quarry').reduce((n, pl) => n + stockAt(w, 'stone', pl.id), 0)
          + w.items().filter(i => i.type === 'stone' && i.holderId).reduce((n, i) => n + i.quantity, 0);
        if (pipeline >= req.quantity) continue;
        const already = w.persons().filter(q => q.alive && q.id !== p.id && q.mind.goal?.type === 'gather').length;
        const gathering = p.mind.goal?.type === 'gather';
        const roleOk = ['woodcutter', 'farmer', 'vagrant', 'apprentice', 'hunter'].includes(p.occupation);
        if (!gathering && (already >= 2 || !roleOk)) continue;
        const node = nearestAvailableNode(w, 'stone', pos, 220);
        if (node) G('gather', clamp(0.5 * laborCapacity * incentive), [`${gp.name} still needs stone`], { targetPos: node.pos, data: { nodeId: node.id } });
      }
    }
    // ---- Adaptive Society (v0.5): work that nobody is doing.
    //
    // This is the whole behavioural half of the milestone, and it is four lines because it had to
    // be: taking up a vacant trade is ONE MORE ORDINARY CANDIDATE, scored by
    // `mind/succession.ts` from what this person knows, can do, owes, needs and has time for, and
    // then left to compete with sleep, hunger, their own shift and everything else on the board.
    // Nobody is assigned. Nobody is told. `standInCandidacy` returns null — no candidate at all —
    // for the overwhelming majority of the village, most often because they have simply never
    // learned that anything is short, and that silence is the mechanism, not a gap in it.
    //
    // `this.vacantPosts` is refreshed on the coarse strategic pass rather than derived here: the
    // derivation reads every place and every request, under-servedness moves on the scale of
    // hours, and doing it inside think() would cost that scan per deliberating person per tick.
    if (!threat && !p.hostile && laborOk && this.vacantPosts.length && this.awareOfShortage.has(p.id)) {
      for (const post of this.vacantPosts) {
        const cand = standInCandidacy(w, p, post);
        if (!cand) continue;
        G('work', cand.utility, cand.reasons, {
          targetPlace: post.place.id,
          data: { standIn: post.place.id, resource: post.process.output, standInCauses: cand.causes, teacherId: cand.teacherId },
        });
      }
    }
    // ---- schedule
    if (sched && !['sleep', 'eat'].includes(sched.activity)) {
      const rainingNow = w.weather.kind === 'rain' || w.weather.kind === 'storm';
      const outdoorTask = !sched.placeId || !(w.place(sched.placeId)?.indoor);
      const rainPenalty = rainingNow && outdoorTask && !isGuard && !p.hostile ? 0.2 + w.weather.intensity * 0.15 : 0;
      // v0.9 §D: being seriously hurt keeps you off your shift. `laborCapacity` already gates the
      // heavy v0.3 labour goals through `getPhysicalCapability`, but a baker's ordinary scheduled
      // work goal never consulted capability at all, so an injured baker still stood at the oven.
      const woundPenalty = wound >= SERIOUS_WOUND ? Math.min(0.6, wound * 0.75) : 0;
      const base = 0.45 + (sched.activity === 'work' ? 0.1 : 0) + (sched.activity === 'patrol' || sched.activity === 'guard_post' ? 0.15 : 0) - rainPenalty - woundPenalty;
      G(sched.activity, clamp(base + (p.traits.loyalty - 0.5) * 0.1), [`schedule: ${sched.label} (${sched.start}:00–${sched.end}:00)`, rainPenalty ? 'but it is raining out there' : '', woundPenalty ? `but I am hurt (wound ${wound.toFixed(2)})` : ''], { targetPlace: sched.placeId, data: { label: sched.label } });
    }
    // rain shelter (and keep sheltering while it rains) — v0.7: the CONDITION that makes shelter
    // worth considering is still "it is raining and I am outside" (real, current perception),
    // but the DESIRE is driven by accumulated wetness/discomfort (`needs.comfort`, derived from
    // `physiology.wetness` — core/physiology.ts), not by the instantaneous fact of rain itself
    // (Constitution v0.7: "rain is not an instruction" — the bad pattern is `rain -> shelter`
    // directly; the desired one is `rain -> wetness -> discomfort -> a person weighs shelter
    // against everything else they're doing"). A moment in a light shower barely registers; only
    // someone who has actually gotten wet finds shelter genuinely attractive — and even then,
    // this is one utility candidate among many: it can still lose to a higher-utility goal, and
    // it can never interrupt a `committed` haul/build (mind/commitment.ts's
    // `interruptionSeverityMet` only ever lets eat/drink/sleep distress do that).
    const raining = w.weather.kind === 'rain' || w.weather.kind === 'storm';
    // v0.2.4: someone whose schedule has them at an INDOOR workplace (miller, baker, smith,
    // merchant...) does not abandon their work to shelter — they were heading inside anyway.
    const indoorWork = sched?.activity === 'work' && !!w.place(sched.placeId)?.indoor;
    if (raining && (!w.isIndoors(pos) || m.goal?.type === 'shelter') && !isGuard && !p.hostile && !indoorWork) {
      const comfort = p.needs.comfort; // 0 dry .. 1 soaked through
      const desc = comfort > 0.6 ? 'soaked through' : comfort > 0.3 ? 'getting wet' : 'starting to feel the rain';
      G('shelter', clamp(comfort * 0.75 + w.weather.intensity * 0.1 - p.traits.courage * 0.15), [`${desc} and outside in the ${w.weather.kind}`], { targetPlace: dist2(pos, w.place(p.homeId!)?.inside ?? pos) < dist2(pos, w.place(this.tavernId())?.inside ?? pos) ? p.homeId ?? undefined : this.tavernId() });
    }
    // socialising when the need is high
    G('socialize', clamp(n.social * 0.7 * (0.5 + p.traits.sociability * 0.8) - (night ? 0.3 : 0)), [`social need ${n.social.toFixed(2)}`, `sociability ${p.traits.sociability.toFixed(2)}`], { targetPlace: hour > 16 ? this.tavernId() : this.squareId() });
    // mourning
    if (p.emotions.sadness > 0.4 && hour >= 17 && hour < 20 && p.homeId) { const gy = w.places().find(pl => pl.type === 'graveyard'); if (gy) G('mourn', clamp(0.4 + p.emotions.sadness * 0.4), [`sadness ${p.emotions.sadness.toFixed(2)}`, 'the graveyard, at evening'], { targetPlace: gy.id }); }
    // worship for the pious at service times
    if (p.traits.piety > 0.55 && ((hour >= 7 && hour < 8) || (hour >= 18 && hour < 19)) && p.occupation !== 'priest' && p.occupation !== 'acolyte' && !isGuard) G('worship', clamp(0.35 + p.traits.piety * 0.35), [`piety ${p.traits.piety.toFixed(2)}`, 'service is being held'], { targetPlace: this.chapelId() });
    G('idle', 0.1, ['nothing better to do']);
    // v0.5: resolve the current commitment against canonical world state BEFORE using it to
    // protect/boost anything this tick — a commitment whose deliverable already completed/
    // vanished must not keep forcing a stale candidate (see core/commitment.ts's
    // `commitmentValidity`, which reads the real HaulTask/ConstructionProject rather than "is
    // it in `cands` right now," so a momentary threat/fatigue dip never misreads as
    // abandonment). A suspension that has dragged on far past any reasonable "I'll get back to
    // it" window (Constitution v0.5 §12 — persistent inability to resume is itself a valid
    // abandonment reason, alongside the request simply no longer existing) is abandoned
    // explicitly too, and — for a haul specifically — the physically-carried cargo is dropped
    // canonically (`failHaulTask`) so the task genuinely reopens for someone else, rather than
    // staying claimed by someone who in practice never returns to finish it.
    const MAX_SUSPEND_SECONDS = 6 * SECONDS_PER_HOUR;
    if (m.commitment && (m.commitment.status === 'active' || m.commitment.status === 'suspended')) {
      const validity = commitmentValidity(w, m.commitment);
      const staleSuspension = m.commitment.status === 'suspended' && now - (m.commitment.suspendedAt ?? m.commitment.startedAt) > MAX_SUSPEND_SECONDS;
      if (validity === 'completed') finishCommitment(w, p, 'completed');
      else if (validity === 'abandoned' || staleSuspension) {
        if (m.commitment.goalType === 'haul' && m.commitment.data?.taskId) {
          const task = w.haulTasks.find(x => x.id === m.commitment!.data!.taskId);
          if (task && task.claimantId === p.id && (task.status === 'claimed' || task.status === 'in_transit')) failHaulTask(w, task, 'the worker never returned to finish it');
        }
        finishCommitment(w, p, 'abandoned', staleSuspension ? 'set aside too long to realistically finish' : 'the work is no longer available');
      }
    }
    // v0.5 §11: a SUSPENDED commitment (a temporary physiological interruption set it aside,
    // not destroyed it) gets a modest utility bonus toward resuming — "the agent should
    // remember: I am still committed... and preferentially resume it afterward," not silently
    // forget it the moment the interrupting need passes and some other ordinary goal (a
    // schedule slot, socializing) happens to be scored slightly higher that particular tick.
    // Deliberately a BONUS, not an absolute override (unlike an ACTIVE commitment's protection
    // below) — a large fixed haul/build task should not indefinitely starve a person's own
    // occupational schedule once they have already stepped away from it for good reason; the
    // max-suspension abandonment above is the backstop that keeps this bounded either way.
    if (m.commitment && m.commitment.status === 'suspended') {
      const resumeCand = cands.find(c => c.key === m.commitment!.goalKey);
      if (resumeCand) resumeCand.utility = clamp(resumeCand.utility + 0.4);
    }
    // v0.10: two different motivations can legitimately propose the SAME errand — a welfare
    // concern's own `check_on` and a `tend` purpose's next step are literally the same walk to
    // the same door. Collapse candidates by key, keeping the strongest case and merging the
    // reasons and data (so the surviving candidate still carries the `pursuitId` link even when
    // the pre-existing rule out-scored the purpose's own proposal). Without this, hysteresis's
    // `cands.find(c => c.key === cur.key)` could match whichever duplicate happened to be pushed
    // first rather than the one that actually won. Insertion order is preserved, so this changes
    // no ordering and no determinism.
    if (cands.length > 1) {
      const byKey = new Map<string, Goal>();
      for (const c of cands) {
        const prev = byKey.get(c.key);
        if (!prev) { byKey.set(c.key, c); continue; }
        const keep = c.utility > prev.utility ? c : prev;
        const drop = keep === c ? prev : c;
        for (const r of drop.reasons) if (r && !keep.reasons.includes(r)) keep.reasons.push(r);
        if (drop.data) keep.data = { ...drop.data, ...(keep.data ?? {}) };
        if (!keep.causeEvent && drop.causeEvent) keep.causeEvent = drop.causeEvent;
        if (!keep.targetPos && drop.targetPos) keep.targetPos = drop.targetPos;
        byKey.set(c.key, keep);
      }
      if (byKey.size !== cands.length) { cands.length = 0; cands.push(...byKey.values()); }
    }
    // ---- choose with hysteresis + goal commitment (v0.5 §III)
    cands.sort((a, b) => b.utility - a.utility);
    const best0 = cands[0]; const cur = m.goal;
    const needBands = { hunger: hungerBand(p), thirst: thirstBand(p), sleep: sleepBand(p) };
    // A protected goal (an in-progress 'sleep', or a just-adopted need-driven survival goal
    // within its short grace window) overrides `best` UNLESS the raw best candidate is a real
    // emergency (threat, forced-rest heat, help/flee/attack/confront/surrender) or a
    // physiological need that has actually crossed the interruption threshold for how resistant
    // this goal is (Constitution v0.5 §10). 'committed' (haul/build) is handled differently,
    // below — see `forceNotDone`.
    let best = best0;
    const protect = (protectedCand: Goal | undefined, interruptibility: import('../core/types').Interruptibility, hardGrace = false): void => {
      if (!protectedCand || protectedCand.key === best0.key) return;
      const emergency = !!threat || heat === 'dangerous' || EMERGENCY_GOAL_TYPES.has(best0.type);
      const allow = emergency || (!hardGrace && interruptionSeverityMet(interruptibility, best0.type, needBands));
      if (!allow) best = protectedCand;
    };
    // v0.5 §10/§11: TWO genuinely critical needs (e.g. critical hunger AND critical sleep
    // pressure at once, both clamped to the same top utility) can otherwise out-preempt each
    // OTHER every think() tick, forever — neither ever gets the few real seconds it needs to
    // either succeed or hit its own natural failure/cooldown path (findAccessibleFood's
    // `noFoodUntil`, the sleep action's own wake conditions). A short hard grace window after
    // adopting a need-driven survival goal (sleep/eat/drink_water) blocks even a same-or-lesser
    // severity competing need from preempting it before that; only a real emergency still can.
    const NEED_GOAL_GRACE_SECONDS = 5 * 60;
    // Only protects a genuinely IN-PROGRESS attempt — once the plan has already finished (the
    // meal was eaten, the drink taken, `goal_completed` fired), there is nothing left to shield
    // from interruption, and forcing `best` back onto it anyway would just re-run the action
    // from scratch against an already-satisfied need (observed: a satiated person eating
    // repeatedly for the length of the grace window instead of once).
    const curInProgress = m.plan.length > 0 && !m.plan.every(a => a.status === 'done' || a.status === 'failed');
    if (cur && curInProgress && (cur.type === 'sleep' || cur.type === 'eat' || cur.type === 'drink_water')) {
      const withinGrace = now - cur.createdAt < NEED_GOAL_GRACE_SECONDS;
      protect(cands.find(c => c.key === cur.key), cur.type === 'sleep' ? 'emergency_only' : 'committed', withinGrace);
    }
    let chosen = best; let switched = false; let note = '';
    if (cur && cur.key !== best.key) {
      const curCand = cands.find(c => c.key === cur.key);
      // A forced multi-step pipeline (rob's demand->[attack]->take->disengage, or an in-progress
      // attack/confront) must be allowed to run to completion once started. Its trigger (the
      // threat that originally justified it) can legitimately drop out of *this tick's*
      // candidates without the goal itself having become wrong — most concretely, disengaging
      // from a just-robbed victim means moving away and no longer facing them, so they briefly
      // stop being perceived at all. Falling back to utility 0 in that case would let an
      // ordinary need (hunger, socializing) outbid an unfinished robbery and strand its
      // disengage step mid-plan, exactly the kind of "goal completes on paper but never really
      // finishes" defect this stabilization pass exists to close.
      const inFlightPipeline = cur.type === 'rob' || cur.type === 'attack' || cur.type === 'confront';
      const curU = curCand?.utility ?? (inFlightPipeline ? 0.9 : 0);
      // v0.5 §III: a 'committed' goal (haul/build) whose deliverable is still open must NOT lose
      // hysteresis protection just because THIS particular leg's plan finished (goto+load+goto+
      // unload is one leg of a possibly-many-trip haul) — that reset-to-unprotected-at-every-
      // leg-boundary was exactly the v0.4-disclosed pathology (docs/V0_4_EMBODIED_ECONOMY.md
      // §15). Treat it as still "not done" for hysteresis purposes, so the SAME ordinary +0.12
      // margin that already protects a mid-action goal now also protects it across leg
      // boundaries — persistent through trivial utility fluctuation (idle curiosity, a passing
      // urge to socialize), but still fairly outbid by something that legitimately deserves to
      // win (a schedule-driven occupational duty, a real need). Deliberately NOT an absolute
      // block — over-protecting here previously caused a baker who opportunistically picked up
      // an unrelated haul task to neglect the bakery for days (see the scaling-risks section of
      // docs/V0_5_HUMAN_PHYSIOLOGY_AUTONOMOUS_ECONOMY.md).
      const committedNotDone = !!m.commitment && m.commitment.status === 'active' && cur.key === m.commitment.goalKey;
      const done = (m.plan.length === 0 || m.plan.every(a => a.status === 'done' || a.status === 'failed')) && !committedNotDone;
      if (!done && best.utility < curU + 0.12 && !(best.type === 'flee' || best.type === 'attack' || best.type === 'confront' || best.type === 'rob')) { chosen = { ...cur, utility: curU }; note = `kept ${cur.type} (hysteresis)`; }
      else { switched = true; note = best === best0 ? `switched from ${cur.type} to ${best.type}` : `resumed ${best.type} (committed)`; }
    } else if (!cur) { switched = true; note = `adopted ${best.type}`; }
    else { chosen = cur; note = best === best0 ? `continuing ${cur.type}` : `continuing ${cur.type} (committed)`; }
    m.decision = { tick: now, candidates: cands.slice(0, 8).map(c => ({ type: c.type, key: c.key, utility: c.utility, reasons: c.reasons.filter(Boolean) })), chosen: chosen.key, switched, note };
    if (switched) {
      // v0.5 §III: commitment transitions, driven by what we're actually leaving/adopting —
      // never a per-tick heartbeat, only on a real switch.
      if (m.commitment && m.commitment.status === 'active' && cur && cur.key === m.commitment.goalKey && chosen.key !== m.commitment.goalKey) {
        suspendCommitment(w, p, chosen.type);
      }
      // Resuming must match the SAME underlying deliverable, not merely the same goal key (two
      // different haul tasks from the same source place share a key — see Goal.key's comment).
      // If it drifted (the old task was reassigned/replaced while suspended), the old commitment
      // is superseded rather than silently kept pointing at someone else's task.
      const matchesCommitment = !!m.commitment && chosen.key === m.commitment.goalKey
        && (chosen.type === 'haul' ? chosen.data?.taskId === m.commitment.data?.taskId
          : chosen.type === 'build' ? chosen.data?.projectId === m.commitment.data?.projectId
          : true);
      if (m.commitment && m.commitment.status === 'suspended' && matchesCommitment) {
        resumeCommitment(w, p);
      }
      if (isCommittable(chosen.type) && !matchesCommitment) {
        if (m.commitment && (m.commitment.status === 'active' || m.commitment.status === 'suspended')) {
          finishCommitment(w, p, 'abandoned', 'a different commitment was adopted');
        }
        startCommitment(w, p, chosen);
      }
      this.setGoal(p, chosen, this.plan(p, body, chosen), note);
    }
    else if (m.plan.length === 0 || m.plan.every(a => a.status === 'done' || a.status === 'failed')) { m.plan = this.plan(p, body, chosen); }
  }
  private setGoal(p: Person, g: Goal, plan: Action[], note: string): void {
    const w = this.world; const prev = p.mind.goal; p.mind.goal = g; p.mind.plan = plan;
    // v0.10.1 §XII: a report that is being ABANDONED is an attempt that did not land, and has to
    // be recorded as one. `tell` records the case where they arrived and the guard had moved on;
    // this records every other way the errand ends — a failed path, an interruption, something
    // more urgent — which is most of them. Without it the record sits at zero attempts for
    // anyone who keeps getting distracted, and they re-adopt at full urgency indefinitely.
    if (prev && prev.type === 'report' && prev.key !== g.key) {
      const key = prev.data?.key as string | undefined;
      const record = key ? reportFor(p, key) : undefined;
      if (key && record && record.status !== 'delivered' && record.status !== 'moot') {
        noteReportFailed(w, p, key, prev.targetEntity, 'set out and did not get there');
      }
    }
    // v0.10 §I: when the adopted goal is serving a persistent purpose, the purpose records that
    // it has been tried again and which step it is on. `Pursuit.steps` is the visible evidence
    // that one purpose produced several DIFFERENT actions over time, and `attempts` is half of
    // the backstop that stops a purpose nobody can finish from running forever.
    // `pursuitForGoal` matches on the DELIVERABLE, not on which candidate happened to win — see
    // its doc comment for the gap that caused. Stamping the id back onto the goal's own data is
    // what makes `goal_changed` (and therefore the event feed, the observer overlay and the trace
    // harness) able to answer "and what is that in aid of".
    linkGoalToPursuit(w, p, g);
    const causes: string[] = []; if (g.causeEvent) causes.push(g.causeEvent);
    // link to the most recent knowledge/relationship change that motivated it
    if (g.type === 'flee' || g.type === 'attack' || g.type === 'confront' || g.type === 'report' || g.type === 'investigate' || g.type === 'help') {
      const recent = [...w.events].reverse().find(e => e.actor === p.id && (e.type === 'knowledge_gained' || e.type === 'relationship_changed' || e.type === 'perceived') && w.now - e.tick < 600);
      if (recent && !causes.includes(recent.id)) causes.push(recent.id);
    }
    const target = g.targetEntity ? ` → ${w.nameOf(g.targetEntity)}` : g.targetPlace ? ` @ ${w.nameOf(g.targetPlace)}` : '';
    w.emit('goal_changed', { actor: p.id, target: g.targetEntity, placeId: g.targetPlace, causes, significance: g.type === 'flee' || g.type === 'attack' || g.type === 'report' || g.type === 'investigate' || g.type === 'confront' || g.type === 'surrender' ? 0.45 : 0.12, // v0.10.1 §XI: `fromUtility` makes "was this task dropped for something meaningfully better,
      // or for noise?" answerable from the event log alone — the difference between a person
      // changing their mind and a person flickering.
      data: { from: prev?.type, fromUtility: prev?.utility, to: g.type, utility: g.utility, reasons: g.reasons, key: g.key, pursuitId: g.data?.pursuitId }, summary: `${p.name}: goal ${prev ? prev.type + ' → ' : ''}${g.type}${target} (u=${g.utility.toFixed(2)})` });
    // v0.2.3: choosing to flee an opponent we have a live conflict with IS breaking off that
    // conflict (Constitution §11 disengagement) — mark it so `maintainConflicts` settles it.
    if (g.type === 'flee' && g.targetEntity) {
      const c = conflictBetween(w, p.id, g.targetEntity);
      if (c && (c.status === 'active' || c.status === 'disengaging')) disengageConflict(w, c, p.id, g.data?.avoidance ? 'keeping clear' : 'fled');
    }
    this.updateIntention(p, g);
  }
  /**
   * v0.6 §VI: the vertical slice's Intention layer — what the mind has decided to DO about a
   * need and on what evidence, distinct from the Goal's own utility-driven `reasons`. Only set
   * for the goal types where it materially helps explain a decision (Constitution v0.6 §VI:
   * "do not over-generalize") — currently the food case, informed and information-limited alike.
   * Updated only on a real goal ADOPTION (called from `setGoal`, never per-tick), exactly like
   * `goal_changed`/`goal_committed`'s own event cadence.
   */
  private updateIntention(p: Person, g: Goal): void {
    const w = this.world; const m = p.mind;
    const isFoodIntention = g.type === 'eat' || (g.type === 'wander' && g.data?.foodSearch);
    if (!isFoodIntention) {
      if (m.intention && (m.intention.type === 'obtain_food' || m.intention.type === 'search_food')) m.intention = null;
      return;
    }
    const type = g.type === 'eat' ? 'obtain_food' : 'search_food';
    const reason = g.type === 'eat' ? (g.data?.intentionReason as string ?? '') : "no known food source — searching";
    const grounded = g.type === 'eat' ? !!g.data?.grounded : false;
    if (m.intention && m.intention.type === type && m.intention.target === g.targetPlace && m.intention.reason === reason) return;
    m.intention = { type, target: g.targetPlace, reason, createdAt: w.now, grounded };
    w.emit('intention_formed', {
      actor: p.id, target: g.targetPlace, significance: 0.05, data: { type, reason, grounded },
      summary: `${p.name} intends to ${type === 'obtain_food' ? 'obtain food' : 'find food'}${g.targetPlace ? ` at ${w.nameOf(g.targetPlace)}` : ''} (${reason})`,
    });
  }
  private knownCrimesBy(p: Person, actor: EntityId): KnowledgeItem[] { return Object.values(p.knowledge).filter(k => k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && k.claim.actor === actor && !k.handled).sort((a, b) => crimeSeverity(b.claim.type) - crimeSeverity(a.claim.type)); }
  /**
   * v0.2.3 re-engagement gate (Priority 7): true when a conflict with `otherId` has already
   * ended (resolved / suspended / disengaging) and nothing NEW has happened since to justify
   * re-opening it. Grudge and fear on their own must not restart a fight — that is exactly the
   * loop the v0.2.2 audit flagged. A fresh un-handled crime by them, learned AFTER the conflict
   * wound down, is a legitimate new cause and unblocks re-engagement.
   */
  private reengagementBlocked(p: Person, otherId: EntityId): boolean {
    const c = lastConflictBetween(this.world, p.id, otherId);
    if (!c || c.status === 'active') return false;
    const since = c.resolvedAt ?? c.lastMeaningfulInteraction;
    const newCrime = this.knownCrimesBy(p, otherId).some(k => k.learnedAt > since);
    return !newCrime;
  }
  private nearestKnownGuard(p: Person, pos: Vec3, guards: Person[]): Person | null {
    const w = this.world; let best: Person | null = null; let bd = Infinity;
    for (const g of guards) { const loc = p.knowledge[`loc:${g.id}`]?.claim.pos ?? w.place(g.workId)?.inside ?? w.primaryBody(g.id)?.pos; if (!loc) continue; const d = dist2(pos, loc); if (d < bd) { bd = d; best = g; } }
    return best;
  }
  placeIdOfType(type: import('../core/types').PlaceType): string | undefined { return this.world.places().find(p => p.type === type)?.id; }
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
      case 'wander': {
        // v0.6 §VI/§VII: a hunger-driven search (no known food source) targets a nearby place
        // NOT yet known as a food source, rather than idle jitter — arriving there and perceiving
        // it is the direct-observation acquisition path (act()'s goto-arrival calls `learnPlace`).
        // Still just physical movement among places that already exist in the voxel world
        // (Constitution v0.6 §VII: knowledge bounds BELIEFS about services, not raw navigation).
        if (g.data?.foodSearch) {
          const candidateTypes: Array<Place['type']> = ['bakery', 'store', 'tavern', 'stall', 'well'];
          const known = w.places().filter(pl2 => candidateTypes.includes(pl2.type));
          const unknown = known.filter(pl2 => !p.knowledge[`svc:${pl2.id}`]);
          const target = (unknown.length ? unknown : known).sort((a, b) => dist2(body.pos, a.inside) - dist2(body.pos, b.inside))[0];
          if (target) return [A({ type: 'goto', pos: target.inside, placeId: target.id }), A({ type: 'wait', duration: 3 * 60 })];
        }
        const pl = w.place(this.squareId())!; return [A({ type: 'goto', pos: { x: pl.inside.x + (w.rng.next() - 0.5) * 16, y: pl.inside.y, z: pl.inside.z + (w.rng.next() - 0.5) * 16 } }), A({ type: 'wait', duration: 5 * 60 })];
      }
      case 'go_home': case 'shelter': case 'return_home_safe': { const pl = place ?? w.place(p.homeId); return [A({ type: 'goto', pos: anchorIn(pl, ['seat', 'fire', 'inside']) ?? pl?.inside ?? body.pos, placeId: pl?.id }), A({ type: 'wait', duration: 30 * 60 })]; }
      case 'patrol': { const pts = p.patrol ?? []; const start = Math.floor(w.rng.next() * pts.length); const acts: Action[] = []; for (let i = 0; i < pts.length; i++) { const pt = pts[(start + i) % pts.length]; acts.push(A({ type: 'goto', pos: pt }), A({ type: 'look', duration: 40, pos: pt })); } return acts.length ? acts : [A({ type: 'wait', duration: 60 })]; }
      case 'guard_post': { const pl = place ?? w.place(p.workId); const post = p.occupation === 'guard' ? (w.places().find(x => x.type === 'gate' && x.name.includes('east'))?.anchors[0].pos ?? pl?.inside) : anchorIn(pl, ['post', 'work', 'inside']); return [A({ type: 'goto', pos: post ?? body.pos }), A({ type: 'look', duration: 20 * 60, pos: post ?? body.pos })]; }
      case 'flee': { const threatPos = w.primaryBody(g.targetEntity!)?.pos ?? body.pos; const guards = w.persons().filter(q => (q.occupation === 'guard' || q.occupation === 'captain') && q.alive && q.id !== g.targetEntity); const gd = p.traits.sociability > 0.3 && !p.hostile ? this.nearestKnownGuard(p, body.pos, guards) : null; let dest: Vec3; if (gd) { dest = p.knowledge[`loc:${gd.id}`]?.claim.pos ?? w.place(gd.workId)?.inside ?? w.primaryBody(gd.id)!.pos; } else { const home = w.place(p.homeId); dest = home?.inside ?? this.awayFrom(body.pos, threatPos, 18); } if (dist2(dest, threatPos) < 8) dest = this.awayFrom(body.pos, threatPos, 20); return [A({ type: 'goto', pos: dest, run: true, data: { flee: true } }), A({ type: 'wait', duration: 3 * 60, data: { hide: true } })]; }
      case 'report': { const g2 = w.person(g.targetEntity!)!; return [A({ type: 'goto', targetEntity: g2.id, run: true }), A({ type: 'tell', targetEntity: g2.id, data: { key: g.data?.key } })]; }
      case 'investigate': { return [A({ type: 'goto', pos: g.targetPos!, run: p.occupation === 'captain' }), A({ type: 'look', duration: 3 * 60, pos: g.targetPos!, data: { key: g.data?.key, investigate: true } })]; }
      case 'confront': case 'attack': return [A({ type: 'goto', targetEntity: g.targetEntity, run: true }), A({ type: g.type === 'confront' ? 'talk' : 'attack', targetEntity: g.targetEntity, data: g.data })];
      // v0.2.3: yield out of a losing fight; escort a yielded/subdued suspect into custody.
      case 'surrender': return [A({ type: 'yield', targetEntity: g.targetEntity, data: g.data })];
      case 'escort_custody': return [A({ type: 'goto', targetEntity: g.targetEntity, run: true }), A({ type: 'take_custody', targetEntity: g.targetEntity, data: g.data })];
      // Robbery is its own goal (not plain 'attack') so it can carry a demand step and an
      // explicit completion/disengage step, rather than ending the moment the target is downed
      // with nothing actually taken (Constitution requirement: robbery must have an explicit
      // semantic goal and completion condition). See think()'s bandit branch and act()'s
      // 'demand'/'rob' action handlers for the rest of the pipeline — 'demand' dynamically
      // splices in either a direct 'rob' (voluntary compliance) or 'attack' + 'rob' (resistance).
      case 'rob': return [A({ type: 'goto', targetEntity: g.targetEntity, run: true }), A({ type: 'demand', targetEntity: g.targetEntity, data: g.data })];
      case 'help': return [A({ type: 'goto', targetEntity: g.targetEntity, run: true }), A({ type: 'use', targetEntity: g.targetEntity, duration: 60, data: { heal: true } })];
      // v0.9 §B: go to where I BELIEVE they are and look. Deliberately targets the remembered
      // position (`Goal.targetPos`, taken from my own `loc:` knowledge or their home), never the
      // live body — if they have moved since I last saw them I walk to the wrong place and find
      // nothing, which is the correct outcome for someone acting on stale information.
      case 'check_on': {
        // Setting the cooldown here, at adoption, rather than only on a successful look: the
        // point is to space out ATTEMPTS. A person who sets out and does not find them has still
        // spent that effort, and should get on with their day before trying again.
        const started = (p.mind.concerns ?? []).find(c => c.id === g.data?.concernId);
        if (started) noteConcernActedOn(w, started);
        const dest = g.targetPos ?? w.place(g.targetPlace)?.inside ?? body.pos;
        return [A({ type: 'goto', pos: dest, placeId: g.targetPlace, run: true }), A({ type: 'look', pos: dest, duration: 90, data: { checkOn: g.targetEntity, concernId: g.data?.concernId } })];
      }
      // v0.2.4 metabolism goals.
      case 'drink_water': { const wp = g.targetPos ?? place?.inside ?? body.pos; return [A({ type: 'goto', pos: wp, placeId: g.targetPlace }), A({ type: 'drink', pos: wp, placeId: g.targetPlace, duration: 90 })]; }
      case 'plant': case 'harvest': {
        const field = w.fields.find(f => f.id === g.data?.fieldId) ?? (place ? w.fields.find(f => f.placeId === place.id) : undefined);
        const target = field?.plots.find(pl => g.type === 'harvest' ? pl.state === 'mature' : pl.state === 'fallow');
        const spot = target ? { x: target.x + 0.5, y: target.y, z: target.z + 0.5 } : (place?.inside ?? body.pos);
        return [A({ type: 'goto', pos: spot, placeId: field?.placeId }), A({ type: g.type, pos: spot, placeId: field?.placeId, duration: 30 * 60, data: { fieldId: field?.id } })];
      }
      // v0.3 logistics/materials/construction. Multi-step, like robbery: walk to source, load,
      // walk to destination, unload — no teleportation.
      case 'haul': {
        const task = w.haulTasks.find(t => t.id === g.data?.taskId);
        if (!task || task.status === 'delivered' || task.status === 'failed' || task.status === 'cancelled') return [A({ type: 'wait', duration: 30 })];
        claimHaulTask(w, task, p); // idempotent — only claims a still-`needed` task
        const src = w.place(task.sourcePlaceId); const dst = w.place(task.destPlaceId);
        const srcSpot = src?.anchors.find(a => a.kind === 'work')?.pos ?? src?.inside ?? body.pos;
        const dstSpot = dst?.anchors.find(a => a.kind === 'work' || a.kind === 'inside')?.pos ?? dst?.inside ?? body.pos;
        return [
          A({ type: 'goto', pos: srcSpot, placeId: task.sourcePlaceId, run: false }),
          A({ type: 'haul_load', pos: srcSpot, placeId: task.sourcePlaceId, duration: 90, data: { taskId: task.id } }),
          A({ type: 'goto', pos: dstSpot, placeId: task.destPlaceId, run: false }),
          A({ type: 'haul_unload', pos: dstSpot, placeId: task.destPlaceId, duration: 60, data: { taskId: task.id } }),
        ];
      }
      case 'chop': case 'gather': {
        const node = w.resourceNodes.find(n => n.id === g.data?.nodeId);
        const spot = node ? { ...node.pos } : (g.targetPos ?? body.pos);
        return [A({ type: 'goto', pos: spot, run: false }), A({ type: g.type, pos: spot, duration: 30 * 60, data: { nodeId: g.data?.nodeId } })];
      }
      case 'build': {
        const proj = w.constructionProjects.find(pr => pr.id === g.data?.projectId);
        const site = proj ? w.place(proj.sitePlaceId) : place;
        const spot = site?.anchors.find(a => a.kind === 'work')?.pos ?? site?.inside ?? body.pos;
        return [A({ type: 'goto', pos: spot, placeId: site?.id }), A({ type: 'build', pos: spot, duration: 40 * 60, data: { projectId: g.data?.projectId } })];
      }
      case 'recover_item': return [A({ type: 'goto', pos: g.targetPos! }), A({ type: 'pickup', targetEntity: g.targetEntity })];
      case 'help_recover_item': {
        const to = w.person(g.data?.deliverTo as EntityId);
        const toBody = to ? w.primaryBody(to.id) : undefined;
        const dest = toBody?.pos ?? (to?.homeId ? w.place(to.homeId)?.inside : undefined) ?? g.targetPos!;
        const acts = [A({ type: 'goto', pos: g.targetPos! }), A({ type: 'pickup', targetEntity: g.targetEntity })];
        if (to) acts.push(A({ type: 'goto', pos: dest, targetEntity: to.id }), A({ type: 'give', targetEntity: to.id, data: { item: g.targetEntity } }));
        return acts;
      }
      // v0.10 §I.B: the "obtain something required, then bring it" step of a persistent purpose.
      // Composed entirely from actions the simulation already had — goto, pickup, goto, give —
      // and it deliberately walks to the person's LIVE body when one is perceivable and to the
      // remembered/home position otherwise, exactly like `check_on`: acting on stale information
      // and arriving to find nobody there is the honest outcome, not a bug.
      case 'provide': {
        const to = w.person(g.targetEntity!);
        const it = w.item(g.data?.itemId as EntityId | undefined);
        if (!to || !it || !to.alive) return [A({ type: 'wait', duration: 5 * 60 })];
        const toBody = w.primaryBody(to.id);
        const seen = p.mind.percepts.some(pc => pc.entityId === to.id);
        const dest = (seen && toBody ? toBody.pos : undefined) ?? g.targetPos ?? toBody?.pos ?? (to.homeId ? w.place(to.homeId)?.inside : undefined) ?? body.pos;
        const acts: Action[] = [];
        if (it.holderId !== p.id) {
          const src = it.pos ?? w.place(g.data?.sourcePlaceId as EntityId | undefined)?.inside ?? w.place(p.homeId)?.inside ?? body.pos;
          acts.push(A({ type: 'goto', pos: { ...src }, placeId: g.data?.sourcePlaceId as EntityId | undefined }));
          acts.push(A({ type: 'pickup', targetEntity: it.id, data: { provision: true } }));
        }
        acts.push(A({ type: 'goto', pos: { ...dest }, targetEntity: seen ? to.id : undefined, placeId: g.targetPlace }));
        acts.push(A({ type: 'give', targetEntity: to.id, data: { item: it.id, provision: true } }));
        return acts;
      }
      // v0.9 §F/Constitution §66 ("avoid bespoke character scripting"): this used to look for a
      // grave anchor whose label begins with one hardcoded first name, so every mourner in the
      // world walked to the same authored grave regardless of whom they had actually lost. It now
      // resolves the grave from a real grief CONCERN (mind/concern.ts) — the person this mourner
      // actually grieves — and falls back to any grave when the mourner has no such concern.
      case 'mourn': {
        const gy = place!;
        const grieving = activeConcerns(p).filter(c => c.kind === 'grief' && c.subjectId).sort((a, b) => b.intensity - a.intensity)[0];
        const name = grieving?.subjectId ? w.nameOf(grieving.subjectId).split(' ')[0] : null;
        const grave = (name ? gy.anchors.find(a => a.kind === 'grave' && a.label?.startsWith(name)) : undefined) ?? gy.anchors.find(a => a.kind === 'grave') ?? gy.anchors[0];
        return [A({ type: 'goto', pos: grave.pos }), A({ type: 'pray', pos: grave.pos, duration: 40 * 60 })];
      }
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
    // v0.2.3 safety net: a chase/retry pipeline (attack/take_custody re-unshifting a `goto` when
    // the target is out of reach) can otherwise let `plan` grow without bound with `goto/failed`
    // entries, which never triggers a replan (the pending tail action isn't done/failed). Compact
    // spent entries once the plan is clearly not a normal 2–14 step plan any more.
    if (m.plan.length > 28) m.plan = m.plan.filter(x => x.status === 'pending' || x.status === 'active');
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
        // v0.8 "The Legible World" §B: a hauler physically carrying real cargo (a claimed,
        // in-transit HaulTask with units actually loaded) is visually distinct from an ordinary
        // walk — previously indistinguishable, so the player could never tell "moving supplies"
        // from "just walking somewhere".
        const hauling = w.haulTasks.some(t => t.claimantId === p.id && t.status === 'in_transit' && t.carried > 0);
        body.pose = hauling ? 'haul' : (a.run ? 'run' : 'walk');
        const arrived = this.followPath(body, physDt);
        if (arrived) {
          a.status = 'done'; body.path = null; if (!a.targetEntity && dist2(body.pos, dest) > 3) { /* couldn't reach */ }
          if (a.data?.flee) w.emit('fled', { actor: p.id, pos: body.pos, significance: 0.3, summary: `${p.name} fled to ${w.placeAt(body.pos)?.name ?? 'safety'}` });
          else if (a.placeId) {
            w.emit('arrived', { actor: p.id, placeId: a.placeId, pos: body.pos, significance: 0.05, summary: `${p.name} arrived at ${w.nameOf(a.placeId)}` });
            // v0.6 §III.3: direct observation — arriving somewhere teaches what it is (Constitution
            // v0.6 §VII "current place... may expose information"). Quiet (no knowledge_gained
            // spam for every ordinary arrival at a place already known) and a no-op for place
            // types with nothing service-relevant to learn (see mind/knowledge.ts's SERVICE_OFFERS).
            const arrivedPlace = w.place(a.placeId); if (arrivedPlace && !p.controlled) learnPlace(w, p, arrivedPlace, { type: 'witnessed' });
          }
        }
        break;
      }
      // v0.4: fatigue/sleep-debt recovery while asleep is applied centrally by
      // Simulation.strategic()'s once-per-minute physiology step (it reads `body.pose ===
      // 'sleep'` — see core/physiology.ts's `activityLevelFor`/`stepPhysiology`), not here.
      case 'sleep': {
        body.pose = 'sleep'; body.sitAnchor = a.pos ?? null;
        if (a.pos) { body.pos.x = Math.floor(a.pos.x) + 0.5; body.pos.z = Math.floor(a.pos.z) + 0.5; }
        const wellRested = p.needs.energy <= 0.02 && w.now - (a.startedAt ?? 0) > (a.duration ?? 0) * 0.5;
        const overslept = w.now - (a.startedAt ?? 0) > 9 * SECONDS_PER_HOUR;
        if (wellRested || overslept) {
          p.physiology.lastSleepAt = w.now;
          if (overslept) w.emit('sleep_completed', { actor: p.id, significance: 0.03, summary: `${p.name} woke up` });
          a.status = 'done';
        }
        break;
      }
      case 'sit': body.pose = 'sit'; body.sitAnchor = a.pos ?? null; if (a.pos) { body.pos.x = Math.floor(a.pos.x) + 0.5; body.pos.z = Math.floor(a.pos.z) + 0.5; } p.needs.social = clamp(p.needs.social - worldDt / (3 * SECONDS_PER_HOUR)); this.maybeChat(p, body); if (this.elapsed(a)) a.status = 'done'; break;
      case 'eat': {
        body.pose = 'eat'; body.sitAnchor = a.pos ?? null;
        // v0.2.4: a meal consumes a real food item. Resolve once, when the sit-down settles in.
        if (!a.data?.done && w.now - (a.startedAt ?? 0) > 60) {
          a.data = a.data ?? {}; a.data.done = true;
          const hereId = w.placeAt(body.pos)?.id ?? null;
          let food = findAccessibleFood(w, p, hereId) ?? findAccessibleFood(w, p, p.homeId ?? null);
          // Not free to hand: buy a few units from a food vendor here (carry the rest home so one
          // trip covers several meals — keeps the whole village off one counter every few hours).
          if (!food) {
            // v0.10.1: ask whether the owner would actually sell it before walking up to the
            // counter, rather than letting the purchase fail at the till. Same rule as the
            // player's Trade menu (`world/commerce.ts`).
            const forSale = w.items().find(i => {
              if (i.holderId || !isFood(i.type) || i.placeId !== hereId || !i.ownerId || i.ownerId === p.id || i.quantity <= 0) return false;
              const owner = w.person(i.ownerId);
              return !!owner?.alive && !willingnessFor(w, owner, i, p).reason;
            });
            if (forSale) food = buyFoodPortion(w, p, forSale, 3);
          }
          if (food && food.quantity > 0) {
            const type = eatFood(w, p, food);
            w.emit('meal', { actor: p.id, pos: body.pos, significance: 0.05, summary: `${p.name} ate ${type} at ${w.placeAt(body.pos)?.name ?? 'home'}` });
            a.status = 'done'; break;
          }
          // Genuinely nothing. Give up the search for a while (hunger keeps rising — pressure),
          // and log the shortage at most once per give-up window rather than every tick — see
          // `NO_FOOD_RETRY_SECONDS`'s own comment for why this window was investigated and kept.
          const since = w.now - (m.noFoodUntil ?? -Infinity) + NO_FOOD_RETRY_SECONDS;
          if (!m.noFoodUntil || since >= NO_FOOD_RETRY_SECONDS) {
            w.emit('resource_shortage', { actor: p.id, pos: body.pos, placeId: w.placeAt(body.pos)?.id, significance: 0.3, data: { need: 'food', hunger: Math.round(p.needs.hunger * 100) / 100 }, summary: `${p.name} could find nothing to eat` });
          }
          // v0.6 §IV.4: a real, place-tagged memory of failure — the second required memory
          // consequence — so `knownFoodPlace` demotes this specific source next time rather than
          // the whole village silently retrying it forever.
          if (hereId && !p.controlled) noteFoodShortage(w, p, hereId);
          m.noFoodUntil = w.now + NO_FOOD_RETRY_SECONDS;
          a.status = 'failed'; break;
        }
        if (this.elapsed(a)) a.status = 'done';
        break;
      }
      case 'work': {
        body.pose = 'work'; body.sitAnchor = a.pos ?? null; this.maybeChat(p, body);
        if (a.pos && w.rng.next() < physDt * 0.15) { body.yaw += (w.rng.next() - 0.5) * 0.6; }
        // v0.2.4: a miller / baker at their workplace runs a production batch every ~12 world-min
        // of work (real resource transformation; conservation; demand-driven — mill/bake stop
        // when the village has plenty). Only checked on the batch cadence, so no per-substep cost.
        //
        // v0.5 Adaptive Society: the gate on the two REQUEST-DRIVEN transforms is no longer the
        // worker's occupation. `p.occupation === 'miller'` deciding whether a batch of flour
        // happens is precisely the "a label grants the capability" inversion Constitution §IX
        // forbids, and it is the exact mechanism by which a village could lose its miller and
        // never grind again: the work stopped existing along with the label. What decides it now
        // is `world/labor.ts`'s `workAuthorization` — you work here, or the place's work is going
        // undone and you are in a state to do it — and how WELL it goes is decided by proficiency
        // (`core/skills.ts`), which is earned by doing it. The gathering trades below are
        // unchanged; see the note on `TRADE_PROCESSES` for why they are a different shape.
        // Who could POSSIBLY have a batch to run here — a cheap prefilter in front of the
        // `placeAt` scan, which walks every Place and is paid per physical substep. This matters:
        // resolving the place unconditionally, for everybody with a `work` action, cost enough
        // that a neighbouring test with a five-second budget timed out (see the note on
        // `peopleAwareOfShortage`). Two of the three terms are O(1) map lookups.
        //
        // None of them is a permission, and the first is deliberately NOT occupation: `workId` is
        // the canonical record of where somebody works, so the mill's own worker qualifies
        // whatever they are called. The gathering trades keep the occupation prefilter they have
        // had since v0.6 — their branches below are occupation-gated anyway (see the note on
        // `TRADE_PROCESSES` for why they are a different shape of work).
        const ownTradeHasAProcess = !!processFor(w.place(p.workId ?? '')?.type);
        const couldStandIn = this.vacantPosts.length > 0 && this.awareOfShortage.has(p.id);
        if (ownTradeHasAProcess || couldStandIn || p.occupation === 'woodcutter' || p.occupation === 'innkeeper' || p.occupation === 'herbalist' || p.occupation === 'cook' || p.occupation === 'hunter') {
          const herePlace = w.placeAt(body.pos);
          const t = herePlace?.type;
          const process = processFor(t);
          a.data = a.data ?? {};
          // v0.4 §2/§6: sawing's fixed log:plank ratio (SAW_RATIO) never changes — no duplication
          // risk — but a dexterous sawyer with a saw in hand completes a batch faster than one
          // without, so their WORK RATE (throughput over time) is real and continuous rather than
          // a flat "woodcutter" bonus. Clamped so the interval stays sane at either extreme.
          const sawing = p.occupation === 'woodcutter' && t === 'sawpit';
          // v0.6 §V.7 (baking): skill improves TIME efficiency, never batch size (BAKE_RATIO is
          // untouched) — a practiced baker completes the same batch in less real time, exactly
          // the effect the milestone names for this trade ("do not create extra bread from
          // nothing"). Bounded, symmetric with sawing's own capability-driven cadence below.
          // v0.5: and `tradeBatchSeconds` adds the other end of the same continuum — somebody who
          // has NOT learned the trade takes materially longer over one batch, which is where a
          // novice's higher time-and-energy cost comes from without inventing a second rule for it.
          const proficiency = process ? skillOf(p, process.skill) : 0;
          const bakeRateMult = process?.skill === 'baking' ? 1 + proficiency * 0.4 : 1;
          const batchInterval = sawing
            ? Math.max(3 * 60, Math.min(20 * 60, (8 * 60) / capabilityFor(w, p, 'saw', w.placeAt(body.pos)?.id).cap.workRate))
            : process ? Math.max(4 * 60, tradeBatchSeconds(process.baseBatchSeconds / bakeRateMult, proficiency))
            : 8 * 60;
          const last = (a.data.batchAt ?? (a.startedAt ?? w.now) - batchInterval) as number;
          if (w.now - last >= batchInterval) {
            a.data.batchAt = w.now;
            // v0.6 §VIII: milling converted from unconditional cadence production to the same
            // demand-aware Request pattern v0.5 already gave baking — a second production/work
            // domain made emergent rather than "every batch, regardless of need" (Constitution
            // v0.6 §VIII). world/production.ts's PRODUCTION_TARGETS now includes the mill.
            // Causal Society: the batch result is no longer read for `.ok` alone. A batch that
            // could not run for want of its input is a real thing that happened to a real person
            // standing in a real place, and `noteWorkBlocked` is what turns it into a belief
            // they hold (and everyone present can see) instead of a discarded return value.
            // That was the exact point at which the economic chain stopped propagating: the
            // physical stoppage was already correct, it just left no trace in any mind.
            //
            // v0.5 §IV: baking (and, since v0.6 §VIII, milling) is demand-driven through the
            // shared Request lifecycle rather than an unconditional per-batch call — nobody
            // produces, and nobody is paid, unless the place has genuinely raised a production
            // request (world/production.ts's `generateProductionNeeds`, upkeep-driven from real
            // stock vs. desired reserve).
            //
            // v0.5 Adaptive Society: `workAuthorization` is resolved HERE, on the batch cadence,
            // rather than every physical substep — the derivation reads every open request, and a
            // person's standing at a place cannot meaningfully change between two batches.
            const runBatch = (placeId: string, input: ItemType, output: ItemType, run: () => TransformResult, onProduced?: () => void) => {
              const req = claimedProductionRequest(w, placeId, output, p.id);
              if (!req) return;
              const result = run();
              fulfillProductionRequest(w, req, p, result.ok);
              if (result.ok) { clearShortfall(w, p, placeId, input); onProduced?.(); }
              else if (result.shortage) noteWorkBlocked(w, p, placeId, result.shortage, output);
            };
            const auth = process ? workAuthorization(w, p, herePlace) : null;
            if (auth) {
              const { post } = auth;
              const skillBefore = skillOf(p, post.process.skill);
              runBatch(post.place.id, post.process.input, post.process.output, () => runTradeBatch(w, p, post), () => {
                // Somebody who is not this place's worker just got real output out of it. The
                // record is opened only now, AFTER the fact, which is what keeps it provenance
                // rather than permission — see `WorkStint` in core/types.ts.
                if (auth.standing !== 'stand_in') return;
                const g = p.mind.goal;
                noteStandInBatch(w, p, post, {
                  reason: (g?.data?.standIn === post.place.id ? g.reasons.filter(Boolean)[0] : undefined) ?? auth.why,
                  teacherId: g?.data?.teacherId as string | undefined,
                  causes: (g?.data?.standInCauses as string[] | undefined)?.filter(id => !!w.event(id)) ?? [],
                  skillBefore,
                });
              });
              // Being shown how, at the work — the smallest teaching path (mind/apprenticeship.ts).
              // Whoever is ahead teaches; instruction grants no proficiency, it only makes the
              // practice that follows count for more.
              maybeTeachAt(w, p, post.process.skill, post.place.id);
            }
            else if (sawing) { saw(w, p); wearTool(w, capabilityFor(w, p, 'saw', w.placeAt(body.pos)?.id).tool, batchInterval / 3600); } // v0.3: log → plank
            // v0.6 §II: the innkeeper keeps the tavern's larder stocked while working — see
            // world/metabolism.ts's `restockTavern` doc comment for why this closed a genuine
            // "always runs out after day one" access bug rather than being new economic scope.
            else if (p.occupation === 'innkeeper' && t === 'tavern') restockTavern(w, p);
            // v0.8 §A/F: the herbalist gathers at her own workplace, real bounded stock.
            else if (p.occupation === 'herbalist') gatherHerbs(w, p);
            // v0.8 §D (found via this milestone's own 90-day benchmark): the hunter restocks her
            // own stall while working there — without this, meat was one-time-seeded and never
            // replenished, so cook()'s new haul demand could only ever move the original stock
            // once. See world/metabolism.ts's `huntGame` doc comment.
            else if (p.occupation === 'hunter' && t === 'stall') huntGame(w, p);
            // v0.8 §D: the cook tends the tavern hearth (lighting it if needed, from whatever
            // wood is on hand) and, once it's genuinely burning, cooks a real batch — see
            // world/cooking.ts. Demand-gated exactly like baking/milling (claimedProductionRequest).
            else if (p.occupation === 'cook' && t === 'tavern') {
              const tavernId = w.placeAt(body.pos)!.id;
              tendTavernFire(w, p);
              runBatch(tavernId, 'meat', 'stew', () => cook(w, p));
            }
          }
        }
        if (this.elapsed(a)) a.status = 'done';
        break;
      }
      case 'drink': {
        body.pose = 'drink'; body.yaw = a.pos ? Math.atan2(-(a.pos.x - body.pos.x), -(a.pos.z - body.pos.z)) : body.yaw;
        if (this.elapsed(a)) { drinkAt(w, p, a.placeId); a.status = 'done'; }
        break;
      }
      case 'plant': case 'harvest': {
        body.pose = 'work'; body.sitAnchor = null;
        const field = w.fields.find(f => f.id === a.data?.fieldId);
        if (!field) { a.status = 'failed'; break; }
        // Work one plot at a time; each plot takes a slice of the action's duration.
        a.data = a.data ?? {}; const perPlot = 4 * 60; // ~4 world-minutes per plot
        if (w.now - (a.data.plotAt ?? a.startedAt ?? w.now) >= perPlot || a.data.plotAt === undefined) {
          a.data.plotAt = w.now;
          const plot = field.plots.find(pl => a.type === 'harvest' ? pl.state === 'mature' : pl.state === 'fallow');
          if (plot) {
            const spot = { x: plot.x + 0.5, y: plot.y, z: plot.z + 0.5 };
            if (dist2(body.pos, spot) > 2.5) { a.status = 'pending'; m.plan.unshift({ type: 'goto', pos: spot, status: 'pending' }); break; }
            body.pos.x = plot.x + 0.5; body.pos.z = plot.z + 0.5;
            if (a.type === 'harvest') harvestPlot(w, field, plot, p);
            else if (!plantPlot(w, field, plot, p)) { a.status = 'done'; break; } // out of seed grain — stop
          } else { a.status = 'done'; break; } // no more actionable plots
        }
        if (this.elapsed(a)) a.status = 'done';
        break;
      }
      // v0.3 Living World I — physical hauling, extraction, construction labour.
      case 'haul_load': {
        const task = w.haulTasks.find(t => t.id === a.data?.taskId);
        if (!task || task.status === 'delivered' || task.status === 'failed' || task.status === 'cancelled') { a.status = 'done'; break; }
        body.pose = 'work'; body.sitAnchor = null;
        const src = w.place(task.sourcePlaceId);
        if (src && dist2(body.pos, src.inside) > 4 && !(a.pos && dist2(body.pos, a.pos) <= 3)) {
          a.status = 'pending'; m.plan.unshift({ type: 'goto', pos: a.pos ?? src.inside, placeId: src.id, status: 'pending' }); break;
        }
        if (this.elapsed(a)) {
          const ok = loadHaulCargo(w, task, p);
          a.status = ok && task.status === 'in_transit' ? 'done' : 'failed';
        }
        break;
      }
      case 'haul_unload': {
        const task = w.haulTasks.find(t => t.id === a.data?.taskId);
        if (!task || task.status === 'delivered' || task.status === 'cancelled') { a.status = 'done'; break; }
        body.pose = 'work'; body.sitAnchor = null;
        const dst = w.place(task.destPlaceId);
        if (dst && dist2(body.pos, dst.inside) > 4 && !(a.pos && dist2(body.pos, a.pos) <= 3)) {
          a.status = 'pending'; m.plan.unshift({ type: 'goto', pos: a.pos ?? dst.inside, placeId: dst.id, status: 'pending' }); break;
        }
        if (this.elapsed(a)) { depositHaulCargo(w, task, p); a.status = 'done'; }
        break;
      }
      case 'chop': case 'gather': {
        const node = w.resourceNodes.find(n => n.id === a.data?.nodeId);
        // v0.8 §16: felling a tree / quarrying stone is now visibly distinct from generic
        // labour — same pattern `case 'build'` above already uses (`body.pose = 'work'`, with the
        // finer chop-vs-quarry distinction resolved by the renderer's `workStyleFor` from this
        // Action's own `nodeId`/type — see game/presentation/activityCues.ts and actors.ts).
        body.pose = 'work'; body.sitAnchor = null;
        if (!node || node.state !== 'available' || node.remaining <= 0) { a.status = 'done'; break; } // depleted — stop, don't retry
        if (a.pos && dist2(body.pos, a.pos) > 2.6) { a.status = 'pending'; m.plan.unshift({ type: 'goto', pos: a.pos, status: 'pending' }); break; }
        body.yaw = Math.atan2(-(node.pos.x - body.pos.x), -(node.pos.z - body.pos.z));
        a.data = a.data ?? {}; const swing = 5 * 60; // ~5 world-min per extraction
        if (a.data.swingAt === undefined || w.now - a.data.swingAt >= swing) {
          a.data.swingAt = w.now;
          if (extractFromNode(w, node, p) <= 0) { a.status = 'done'; break; }
        }
        if (this.elapsed(a)) a.status = 'done';
        break;
      }
      case 'build': {
        const proj = w.constructionProjects.find(pr => pr.id === a.data?.projectId);
        body.pose = 'work'; body.sitAnchor = a.pos ?? null; this.maybeChat(p, body);
        if (!proj || proj.status === 'complete' || proj.status === 'cancelled') { a.status = 'done'; break; }
        const site = w.place(proj.sitePlaceId);
        if (site && a.pos && dist2(body.pos, a.pos) > 3) { a.status = 'pending'; m.plan.unshift({ type: 'goto', pos: a.pos, placeId: site.id, status: 'pending' }); break; }
        if (proj.status === 'gathering') { a.status = 'done'; break; } // materials not in yet — nothing to build
        a.data = a.data ?? {}; const slice = 60; // credit labour every world-minute of work
        if (a.data.laborAt === undefined) a.data.laborAt = a.startedAt ?? w.now;
        if (w.now - a.data.laborAt >= slice) {
          const secs = Math.min(w.now - a.data.laborAt, 300);
          a.data.laborAt = w.now;
          performBuildLabor(w, proj, p, secs);
        }
        if ((proj.status as string) === 'complete' || this.elapsed(a)) a.status = 'done';
        break;
      }
      case 'pray': body.pose = 'pray'; body.sitAnchor = a.pos ?? null; if (this.elapsed(a)) a.status = 'done'; break;
      case 'wait': {
        // v0.2.3: a held-state wait (subdued / surrendered) keeps the body on the ground; every
        // other wait stands.
        const heldDown = a.data?.held && (body.subduedUntil > w.physicalTime || !!p.surrender);
        if (!heldDown) body.pose = 'stand';
        if (a.data?.social) this.maybeChat(p, body);
        if (this.elapsed(a)) a.status = 'done';
        break;
      }
      case 'look': { body.pose = 'stand'; body.yaw += physDt * 0.5;
        // v0.9 §B: arriving somewhere out of concern for someone and actually LOOKING is a real
        // epistemic act — it either closes the information gap (they are here; how they are is
        // now something I have seen for myself) or confirms it (they are not, and I know that
        // first-hand rather than by inference). Either way the concern has been acted on, so it
        // stops driving the same walk on the next think() tick without pretending to be resolved.
        if (a.data?.checkOn) {
          const subjectId = a.data.checkOn as EntityId;
          const concern = (p.mind.concerns ?? []).find(c => c.id === a.data?.concernId);
          const seen = m.percepts.find(pc => pc.entityId === subjectId && pc.how === 'saw');
          if (seen || this.elapsed(a)) {
            if (concern) noteConcernActedOn(w, concern);
            const subjectBody = seen ? w.body(seen.bodyId) : undefined;
            if (subjectBody) {
              // A first-hand belief about how they actually are — provenance 'witnessed', formed
              // by looking at them, not read off canonical state from across the map.
              const wound = woundSeverity(subjectBody);
              const state = subjectBody.dead ? 'dead' : wound >= SERIOUS_WOUND ? 'badly hurt' : wound > 0.1 ? 'hurt' : 'unharmed';
              learn(w, p, { key: `state:${subjectId}`, kind: 'state', claim: { entityId: subjectId, state, wound: Math.round(wound * 100) / 100, tick: w.now, text: `${w.nameOf(subjectId)} is ${state}` }, confidence: 1, source: { type: 'witnessed' } }, true);
              remember(w, p, { type: 'checked_on', summary: `I found ${w.nameOf(subjectId)} ${state}`, entities: [subjectId], significance: 0.35, valence: state === 'unharmed' ? 0.2 : -0.4, source: { type: 'witnessed' }, placeId: w.placeAt(body.pos)?.id });
              this.say(p, state === 'unharmed' ? `${w.nameOf(subjectId).split(' ')[0]}. Good — I had to see for myself.` : `${w.nameOf(subjectId).split(' ')[0]}... gods. Let me help you.`);
            } else {
              remember(w, p, { type: 'checked_on', summary: `I went looking for ${w.nameOf(subjectId)} and did not find them`, entities: [subjectId], significance: 0.3, valence: -0.35, source: { type: 'witnessed' }, placeId: w.placeAt(body.pos)?.id });
              this.say(p, `${w.nameOf(subjectId).split(' ')[0]}? ...Not here either.`);
            }
            a.status = 'done';
          }
          break;
        }
        if (a.data?.investigate) { const key = a.data.key as string; const k = p.knowledge[key]; const suspect = k?.claim.actor as string | undefined; const seen = suspect ? m.percepts.find(pc => pc.entityId === suspect) : null; if (seen) { a.status = 'done'; m.investigated.add(key); m.alarm = 1; break; } if (this.elapsed(a)) { a.status = 'done'; m.investigated.add(key); if (k) k.handled = true; w.emit('investigation', { actor: p.id, pos: body.pos, placeId: k?.claim.placeId, causes: k?.source.viaEvent ? [k.source.viaEvent] : [], significance: 0.4, data: { key, outcome: 'suspect not found' }, summary: `${p.name} investigated ${k ? describeClaim(w, k) : 'a report'} but found no one` }); this.say(p, suspect ? `${w.nameOf(suspect).split(' ')[0]}... where did they go?` : 'Nothing here now.'); } } else if (this.elapsed(a)) a.status = 'done'; break; }
      case 'tell': {
        const t = w.person(a.targetEntity!); const tb = w.primaryBody(a.targetEntity!);
        const key = a.data?.key as string | undefined;
        // v0.10.1 §XII: the failure case is where the old loop lived. Getting to where the guard
        // was and finding them gone is a real outcome and is recorded as one, so the next tick
        // does not simply set out again at the same urgency.
        if (!t || !tb || dist2(body.pos, tb.pos) > 3.5) {
          if (key && p.knowledge[key]) noteReportFailed(w, p, key, a.targetEntity, t ? `${t.name} had moved on` : 'they were not there');
          a.status = 'failed'; break;
        }
        const k = key ? p.knowledge[key] : undefined;
        if (k) { this.tell(p, t, k); if ((t.occupation === 'guard' || t.occupation === 'captain') && key) noteReportDelivered(w, p, key, t.id); }
        body.pose = 'talk'; body.poseUntil = w.physicalTime + 2; a.status = 'done'; break;
      }
      case 'talk': {
        const t = w.person(a.targetEntity!); const tb = w.primaryBody(a.targetEntity!);
        if (!t || !tb) { a.status = 'failed'; break; }
        if (dist2(body.pos, tb.pos) > 3) {
          // Couldn't get to them to have words. If this was a confrontation over a crime and we
          // keep failing to reach them, back off for a while rather than re-adopting every tick.
          const chased = (a.data && (a.data._chase = (a.data._chase ?? 0) + 1));
          if ((chased ?? 0) > 3 && a.targetEntity) { m.pursuitCooldowns = m.pursuitCooldowns ?? {}; m.pursuitCooldowns[a.targetEntity] = w.now + PURSUIT_COOLDOWN_SECONDS; }
          a.status = 'failed'; break;
        }
        this.confront(p, body, t, a); a.status = 'done'; break;
      }
      case 'attack': {
        const tb = w.primaryBody(a.targetEntity!); const tp = w.person(a.targetEntity!);
        if (!tb || tb.dead) { a.status = 'done'; break; }
        // v0.2.3: stop the moment the target is out of the fight (downed / subdued / surrendered).
        if (tb.pose === 'downed' || (tp && (tp.surrender || tp.custody?.active || tb.subduedUntil > w.physicalTime))) {
          const intent = a.data?.intent as ConflictIntent | undefined;
          const isGuard = p.occupation === 'guard' || p.occupation === 'captain';
          // A guard who has just put down a suspect (arrest intent, or a known crime, or an
          // outlaw) escorts them into custody rather than standing over them.
          if (tp && !tp.custody?.active && tp.alive && isGuard && (intent === 'arrest' || intent === 'subdue') && (a.data?.arrest || this.knownCrimesBy(p, tp.id).length > 0 || tp.hostile)) {
            m.plan.push({ type: 'take_custody', targetEntity: tp.id, status: 'pending', data: { crime: a.data?.crime ?? this.knownCrimesBy(p, tp.id)[0]?.key } });
          }
          a.status = 'done'; break;
        }
        const d = dist2(body.pos, tb.pos); body.yaw = Math.atan2(-(tb.pos.x - body.pos.x), -(tb.pos.z - body.pos.z));
        if (d > combatReach(w, p)) {
          // v0.2.3: bound the pursuit (Constitution §11 disengagement — "do not create endless
          // world-spanning pursuit"). Give up after a few failed approaches, or if the target has
          // simply outrun us; the conflict then lapses to disengaging/deterrence via maintenance.
          const chased = (a.data && (a.data._chase = (a.data._chase ?? 0) + (m.plan[0]?.status === 'failed' ? 1 : 0)));
          if (d > 46 || (chased ?? 0) > 4) {
            const cf = a.targetEntity ? conflictBetween(w, p.id, a.targetEntity) : undefined;
            if (cf && (cf.status === 'active' || cf.status === 'disengaging')) disengageConflict(w, cf, p.id, 'lost the pursuit');
            if (a.targetEntity) { m.pursuitCooldowns = m.pursuitCooldowns ?? {}; m.pursuitCooldowns[a.targetEntity] = w.now + PURSUIT_COOLDOWN_SECONDS; }
            a.status = 'done'; break;
          }
          a.status = 'pending';
          if (m.plan[0]?.type === 'goto' && m.plan[0].status === 'failed') m.plan.shift();
          m.plan.unshift({ type: 'goto', targetEntity: a.targetEntity, run: true, status: 'pending' });
          break;
        }
        if (w.physicalTime - body.lastAttackAt > 1.1) { this.attack(p, body, tb, a.data?.intent as ConflictIntent | undefined); }
        // If that blow put the target down/out, the guard at the top of this case re-runs next
        // substep and takes over (custody escort / disengage). Here just stop on a kill.
        if (tb.dead) a.status = 'done';
        break;
      }
      case 'yield': {
        const t = w.person(a.targetEntity!);
        const cf = a.data?.conflictId ? w.conflicts.find(c => c.id === a.data!.conflictId) : (t ? conflictBetween(w, p.id, t.id) : undefined);
        beginSurrender(w, p, a.targetEntity ?? cf?.initiator ?? p.id, 'overwhelmed in the fight', cf ?? undefined);
        this.say(p, p.traits.courage < 0.3 ? `Please — I yield! Don't!` : `Enough. I yield.`);
        a.status = 'done'; break;
      }
      case 'take_custody': {
        const t = w.person(a.targetEntity!); const tb = t ? w.primaryBody(t.id) : undefined;
        if (!t || !tb || !t.alive) { a.status = 'done'; break; }
        if (t.custody?.active) { a.status = 'done'; break; }
        // Must still be yielded/subdued/downed — if they got up and left, abandon (don't chase).
        const yielded = t.surrender || isSubdued(w, t) || tb.pose === 'downed';
        if (!yielded) { a.status = 'failed'; break; }
        if (dist2(body.pos, tb.pos) > 3) {
          const chased = (a.data && (a.data._chase = (a.data._chase ?? 0) + (m.plan[0]?.status === 'failed' ? 1 : 0)));
          if ((chased ?? 0) > 3) {
            if (a.targetEntity) { m.pursuitCooldowns = m.pursuitCooldowns ?? {}; m.pursuitCooldowns[a.targetEntity] = w.now + PURSUIT_COOLDOWN_SECONDS; }
            a.status = 'failed'; break;
          }
          a.status = 'pending';
          if (m.plan[0]?.type === 'goto' && m.plan[0].status === 'failed') m.plan.shift();
          m.plan.unshift({ type: 'goto', targetEntity: a.targetEntity, run: true, status: 'pending' });
          break;
        }
        const cf = conflictBetween(w, p.id, t.id) ?? lastConflictBetween(w, p.id, t.id);
        takeIntoCustody(w, t, p, (a.data?.crime as string | undefined) ?? this.knownCrimesBy(p, t.id)[0]?.key, cf && cf.status !== 'resolved' ? cf : undefined);
        this.say(p, `On your feet. You're in the watch's charge now.`);
        body.pose = 'talk'; body.poseUntil = w.physicalTime + 2;
        a.status = 'done'; break;
      }
      // ---- robbery (Constitution requirement: an explicit demand/response step, not an
      // automatic taking). Resolved once, deterministically, then splices the rest of the
      // robbery into the plan — mirrors how confront() pushes a forced 'attack'.
      case 'demand': {
        const t = w.person(a.targetEntity!); const tb = t ? w.primaryBody(t.id) : undefined;
        if (!t || !tb || tb.dead) { a.status = 'done'; break; }
        const d = dist2(body.pos, tb.pos);
        if (d > 3) { a.status = 'pending'; m.plan.unshift({ type: 'goto', targetEntity: a.targetEntity, run: true, status: 'pending' }); break; }
        body.pose = 'talk'; body.poseUntil = w.physicalTime + 1; body.yaw = Math.atan2(-(tb.pos.x - body.pos.x), -(tb.pos.z - body.pos.z));
        const intent = (a.data?.intent as ConflictIntent) ?? 'rob';
        const demandEv = w.emit('confrontation', { actor: p.id, target: t.id, pos: { ...body.pos }, placeId: w.placeAt(body.pos)?.id, significance: 0.4, visibility: 16, loudness: 10, data: { demand: true, intent }, summary: `${p.name} demanded ${t.name} hand over their valuables` });
        const robCf = beginConflict(w, { initiator: p.id, target: t.id, cause: 'robbery', intent: 'rob', causeEvent: demandEv.id });
        touchConflict(w, robCf); demandEv.data.conflictId = robCf.id;
        const compliant = resolveRobberyCompliance(w, t, p);
        if (compliant) { this.say(p, `Smart. Hand it over.`); m.plan.push({ type: 'rob', targetEntity: t.id, status: 'pending', data: { intent, compliant: true } }); }
        else { this.say(p, `Wrong answer, then.`); m.plan.push({ type: 'attack', targetEntity: t.id, status: 'pending', data: { intent: intent === 'rob' ? 'subdue' : intent } }, { type: 'rob', targetEntity: t.id, status: 'pending', data: { intent, compliant: false } }); }
        a.status = 'done'; break;
      }
      case 'rob': {
        const t = w.person(a.targetEntity!); const tb = t ? w.primaryBody(t.id) : undefined;
        if (!t) { a.status = 'done'; break; }
        const compliant = !!a.data?.compliant;
        // Resistance path: the preceding 'attack' step must have actually incapacitated the
        // target before anything is taken. If it didn't (target fled, died, or the fight was
        // otherwise abandoned) the robbery is abandoned rather than looping.
        if (!compliant && (!tb || (!tb.dead && tb.pose !== 'downed'))) { a.status = 'failed'; break; }
        if (tb?.dead) { a.status = 'done'; break; }
        const take = selectRobberyTake(w, t);
        if (take) this.executeRobbery(p, t, take, (a.data?.intent as ConflictIntent) ?? 'rob');
        else w.emit('confrontation', { actor: p.id, target: t.id, pos: tb?.pos ?? body.pos, significance: 0.25, visibility: 10, data: { intent: a.data?.intent, outcome: 'nothing_to_take' }, summary: `${p.name} searched ${t.name} but found nothing worth taking` });
        m.robCooldowns = m.robCooldowns ?? {}; m.robCooldowns[t.id] = w.physicalTime + ROBBERY_COOLDOWN_SECONDS;
        // v0.2.3: a completed robbery is a real conflict resolution (Constitution §51) — the
        // objective was met, so the conflict ends here rather than grinding on until a death.
        const rcf = conflictBetween(w, p.id, t.id);
        if (rcf && rcf.status !== 'resolved') resolveConflict(w, rcf, 'robbery_completed');
        // Disengage: a completed robbery ends by retreating, not by lingering next to a target
        // who will shortly recover and re-register as a threat.
        const away = this.awayFrom(body.pos, tb?.pos ?? body.pos, 22);
        m.plan.push({ type: 'goto', pos: away, run: true, status: 'pending', data: { flee: true } });
        a.status = 'done'; break;
      }
      case 'use': { if (a.data?.heal) { const tb = w.primaryBody(a.targetEntity!); if (tb && dist2(body.pos, tb.pos) < 3) { body.pose = 'work'; tb.health = Math.min(tb.maxHealth, tb.health + worldDt * 0.02); if (this.elapsed(a)) { a.status = 'done'; if (tb.pose === 'downed') tb.pose = 'stand'; w.emit('heal', { actor: p.id, target: a.targetEntity, pos: body.pos, significance: 0.4, visibility: 12, summary: `${p.name} tended to ${w.nameOf(a.targetEntity)}'s wounds` }); this.say(p, `There. You'll live.`); } } else a.status = 'failed'; } else a.status = 'done'; break; }
      case 'pickup': {
        const it = w.item(a.targetEntity!);
        if (it && it.pos && !it.holderId && dist2(body.pos, it.pos) < 2.5) {
          // v0.10 §I.B: a `provide` errand takes a PORTION off a household stack rather than the
          // whole larder — `takePortionInHand` (world/metabolism.ts) is the same split-and-carry
          // step a purchase performs once payment has cleared, with no price, because this is
          // someone's own household bread. The delivery step is retargeted onto the carried
          // stack the split produced, since the source stack may now be empty and retired.
          if (a.data?.provision) {
            const carried = takePortionInHand(w, p, it, PROVISION_UNITS, 'to bring to someone who needs it');
            if (carried) for (const step of m.plan) { if (step.type === 'give' && step.data?.provision) step.data.item = carried.id; }
          } else this.takeItem(p, it, 'recovered');
        }
        a.status = 'done'; break;
      }
      // v0.8 §P0-G/H: the delivery step of the 'help_recover_item' plan — hand a carried item
      // (already in `p.inventory` from the preceding 'pickup' step) to the person it was fetched
      // for. Fails harmlessly (does nothing, just ends) if the recipient walked out of reach or
      // the item somehow isn't actually being carried — never teleports the hand-off.
      case 'give': { const it = w.item(a.data?.item); const to = w.person(a.targetEntity!); const tb = to ? w.primaryBody(to.id) : undefined; if (it && to && tb && it.holderId === p.id && dist2(body.pos, tb.pos) < 3.5) { this.giveItem(p, to, it); } a.status = 'done'; break; }
      default: a.status = 'done';
    }
    if (a.status === 'done' && m.plan.every(x => x.status === 'done' || x.status === 'failed')) {
      const g = m.goal;
      if (g) {
        // v0.10: naming the goal and the purpose it was serving makes a completed PLAN legible.
        // One purpose routinely produces several completed plans — a many-trip haul, a walk over
        // and a walk back — and "how many times did this person finish a leg of what they are
        // trying to do" is exactly the question the observer overlay and the trace harness ask.
        const servingPursuit = g.data?.pursuitId as string | undefined;
        w.emit('goal_completed', { actor: p.id, significance: 0.05, data: { goalType: g.type, goalKey: g.key, pursuitId: servingPursuit }, summary: `${p.name} finished ${g.type}` });
        // v0.10 §I.A: a completed plan is a purpose GETTING SOMEWHERE, not a purpose ending. This
        // is the exact distinction the milestone is about: "help my injured spouse" must not cease
        // to exist because one `check_on` finished. Recording progress here resets the
        // no-progress backstop, and the pursuit simply proposes its next step on the next think()
        // tick — which may well be a different goal entirely, because the world has changed.
        const pu = pursuitById(p, g.data?.pursuitId as string | undefined);
        if (pu && (pu.status === 'active' || pu.status === 'deferred')) notePursuitProgress(w, pu);
      }
      m.thinkBudget = m.thinkInterval; body.sitAnchor = null;
    }
    if (a.status === 'failed') {
      body.sitAnchor = null; body.path = null;
      // v0.2.1 Priority 7 fix: every OTHER action failure forces an immediate rethink next
      // step (someone worth reacting to quickly moved out of range, etc.), but a 'goto'
      // failure is a navigational dead end — the world hasn't changed, so an immediate retry
      // fails identically. Forcing an immediate rethink here meant a genuinely unreachable
      // destination (a real content/navmesh gap, or just a momentarily blocked path) produced
      // a livelock: think() -> same goal -> new 'goto' -> pathTo() fails -> forced rethink
      // next physics SUBSTEP, forever — not merely every thinkInterval (~1.5s) like every
      // other decision, but every single step (headless substep 0.15s: ~10x more often).
      // Measured on a real 7-day headless benchmark (seed 918271) as the dominant cost after
      // fixing the bystander-misattribution bug (Priority 7, agent.ts's think()): sim.act
      // jumped to 45.7% of total wall time (255s of 557.8s) and three agents' path_failure
      // counts reached 400-565 in a single 3-hour anomaly window. Retries now happen at the
      // normal thinkInterval cadence instead, which still recovers promptly once a path
      // genuinely opens up, but no longer burns full pathfinding cost every substep against an
      // unreachable destination. See tests/pathfinding-livelock.test.ts.
      if (a.type !== 'goto') m.thinkBudget = m.thinkInterval;
    }
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
    const speed = body.speed * movementMultiplier(body);
    const step = Math.min(d, speed * dt); const nx = body.pos.x + dx / d * step, nz = body.pos.z + dz / d * step;
    const doorX = Math.floor(nx), doorZ = Math.floor(nz), doorY = this.world.nav.floorY(doorX, doorZ);
    if (doorY >= 0 && this.world.grid.get(doorX, doorY, doorZ) === B.Door && !this.world.grid.isDoorOpen(doorX, doorY, doorZ)) this.world.setDoorOpen({ x: doorX, y: doorY, z: doorZ }, true, body.ownerId);
    // separation from other bodies
    let sx = 0, sz = 0; for (const o of this.world.bodies()) { if (o === body || !o.present || o.dead) continue; const ox = body.pos.x - o.pos.x, oz = body.pos.z - o.pos.z; const od = Math.hypot(ox, oz); if (od < 0.7 && od > 1e-3) { sx += ox / od * (0.7 - od); sz += oz / od * (0.7 - od); } }
    body.pos.x = nx + sx * dt * 2; body.pos.z = nz + sz * dt * 2;
    const targetYaw = Math.atan2(-dx, -dz); let dy = targetYaw - body.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; body.yaw += dy * Math.min(1, dt * 10);
    body.vel.x = dx / d * speed; body.vel.z = dz / d * speed;
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
    if (b.pose === 'attack' && b.poseUntil < this.world.physicalTime) { b.pose = 'stand'; b.attackTarget = null; }
    if (b.pose === 'downed' && b.poseUntil < this.world.physicalTime && b.subduedUntil < this.world.physicalTime) {
      // v0.2.3: a body whose owner has surrendered or is in custody stays down — it does not
      // spring back up when the plain knock-down timer lapses.
      const owner = this.world.get(b.ownerId) as Person | undefined;
      const heldByState = owner?.kind === 'person' && (!!owner.surrender || !!owner.custody?.active);
      if (!heldByState) { b.pose = 'stand'; b.health = Math.max(b.health, b.maxHealth * 0.3); }
    }
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
    // v0.8 §P0-G/H (independent audit §4.6): before falling back to ordinary gossip, an NPC who
    // is themself the victim of an unfulfilled `recover_item` desire gets a chance to actually
    // ASK for help, exactly like `DialogueSystem.hearDesire` lets a player ask an NPC "is there
    // anything you need?" — without this, `isAuthorizedRecovery` could only ever be satisfied by
    // a player being asked directly, meaning no NPC-to-NPC recovery chain could ever complete.
    if (this.maybeAskForHelp(p, other)) return;
    // share the most significant thing I know that they don't seem to know
    const share = this.pickGossip(p, other);
    if (share) this.tell(p, other, share); else { const lines = this.smallTalk(p, other); this.say(p, lines); adjustRel(w, p, other.id, { familiarity: 0.02, affection: 0.01 }, 'chatted', undefined, true); adjustRel(w, other, p.id, { familiarity: 0.02 }, 'chatted', undefined, true); p.needs.social = clamp(p.needs.social - 0.05); other.needs.social = clamp(other.needs.social - 0.03); }
  }
  /** v0.8 §P0-G/H: the NPC-side mirror of `DialogueSystem.hearDesire` — writes the exact same
   * `wanted:<itemId>` fact knowledge shape (see dialogue.ts) so `isAuthorizedRecovery` and
   * `askAboutItemMenu` treat a request heard from an NPC identically to one heard from a player.
   * Returns true (and consumes this chat turn) only when there was a real unfulfilled desire to
   * voice and the listener didn't already know about it. */
  private maybeAskForHelp(p: Person, other: Person): boolean {
    const w = this.world;
    const desire = p.desires.find(d => d.type === 'recover_item' && !d.fulfilled && d.targetId && !other.knowledge[`wanted:${d.targetId}`]);
    if (!desire || !desire.targetId) return false;
    const line = desire.note + ` I'd pay ${desire.reward} silver to whoever brings it.`;
    learn(w, other, { key: `wanted:${desire.targetId}`, kind: 'fact', claim: { text: line, wantedItem: true, itemId: desire.targetId, requesterId: p.id, reward: desire.reward }, confidence: 1, source: { type: 'told', from: p.id } }, true);
    this.say(p, line);
    adjustRel(w, other, p.id, { affection: 0.02 }, 'asked for help', undefined, true);
    return true;
  }
  /**
   * v0.9 §E: what (if anything) is worth saying to THIS person, right now. The ranking is no
   * longer "the most significant unshared fact I hold" — that is what made the village read like
   * an event log being recited. `selectTopic` (mind/conversation.ts) weighs my own involvement,
   * whether I am carrying a concern about it, whether the matter is still unresolved AS FAR AS I
   * KNOW, how recently I learned it, and whether it is any of this listener's business. Returning
   * null — silence — is a normal and preferred outcome.
   */
  private pickGossip(p: Person, other: Person): KnowledgeItem | null {
    const w = this.world; const r = getRel(p, other.id); if (r.trust < -0.3) return null;
    const topic = selectTopic(w, p, other);
    if (topic) { this.lastTopic.set(p.id, topic); return topic.k; }
    this.lastTopic.delete(p.id);
    // Item-location knowledge is not an "ongoing matter" and has no situation of its own, so it
    // is ranked separately below rather than through `selectTopic`.
    // v0.8 §P0-G (independent audit §4.6): a KNOWN item location can now travel too, not just
    // event news — the whole reason `locationKnowledge` was extended to items (see `perceive`
    // above) is so this information can reach the person who actually needs it, exactly the way
    // real gossip works ("I saw Anna's ring at the well"). Ranked well below ordinary news UNLESS
    // it directly answers an active `recover_item` desire the LISTENER holds — that is the one
    // case genuinely worth interrupting small talk for.
    const locationCands = Object.values(p.knowledge).filter(k => k.kind === 'location' && w.get(k.claim.entityId as string)?.kind === 'item' && !k.sharedWith.includes(other.id) && !other.knowledge[k.key]);
    const locationValue = (k: KnowledgeItem) => other.desires.some(d => d.type === 'recover_item' && !d.fulfilled && d.targetId === k.claim.entityId) ? 0.9 : 0.12;
    const best = locationCands.map(k => ({ k, v: locationValue(k) })).sort((a, b) => b.v - a.v)[0];
    if (!best) return null;
    if (best.v < 0.2 && p.traits.sociability < 0.6) return null;
    return best.k;
  }
  /** The topic `pickGossip` most recently chose per speaker, so `tellLine` can realize it with
   * its supporting facts and its personally-known resolution status instead of re-deriving them.
   * Transient presentation state only — never read back into any decision, never persisted. */
  private lastTopic = new Map<EntityId, Topic>();
  /**
   * v0.9 §F ("no fabricated history") audit finding. This pool used to assert things that had
   * never happened in the simulation and that no mind held any belief about: "Still owe me for
   * that timber" (no such debt existed), "Candles are two coppers now" (no such price), "It's
   * quiet without her" (naming a bereavement the speaker may not have suffered, about a person
   * the simulation never lost). Those were the clearest source of the "statements that appear to
   * describe history that did not actually occur" this milestone was called to fix — and they
   * were in the AMBIENT path, which fires constantly during ordinary play.
   *
   * Small talk is now strictly phatic: greetings, weather (a real, canonical `world.weather`),
   * the time of day, and openers that ask rather than assert. Nothing here states that anything
   * happened. When a speaker actually HAS something to say, `pickGossip`/`selectTopic` has
   * already taken this turn — small talk is what is left when there is honestly nothing.
   */
  private smallTalk(p: Person, other: Person): string {
    const w = this.world; const r = getRel(p, other.id); const first = other.name.split(' ')[0]; const h = w.clock.hourF; const wk = w.weather.kind;
    const pool = [`Fine ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}, ${first}.`, wk === 'rain' ? `This rain will rot the wheat.` : wk === 'clear' ? `Good weather for it.` : `Looks like weather coming.`, `How's the family, ${first}?`, `Busy day.`, `Have you eaten?`];
    if (r.tags.includes('spouse')) pool.push(`You look tired, love.`, `Will you be home before dark?`);
    if (r.tags.includes('rival')) pool.push(`Hmph. ${first}.`, `${first}.`);
    if (p.occupation === 'merchant') pool.push(`Everything has a price, ${first}.`);
    if (p.occupation === 'child') pool.push(`Race you to the well!`);
    // Sadness is a real, canonical emotion — expressing it is not a factual claim. Naming a
    // specific loss would be; that is what was removed.
    if (p.emotions.sadness > 0.4) pool.push(`...`, `I've not much to say today.`);
    return pool[Math.floor(w.rng.next() * pool.length)];
  }
  /** One mind tells another something it knows. Knowledge travels with provenance. */
  tell(speaker: Person, listener: Person, k: KnowledgeItem): void {
    const w = this.world; const sb = w.primaryBody(speaker.id);
    const text = this.tellLine(speaker, listener, k);
    // Prefer the original canonical event (`claim.eventId`) as the cause over the speaker's own
    // ephemeral perception of it (`source.viaEvent`) — for a retained event (a killing, an
    // arrest) the canonical event outlives compaction where the perception does not, so gossip
    // about it days later still resolves to a real cause instead of dangling. Fall back to the
    // perception, then to nothing, and drop any id that no longer resolves.
    const toldCauses = [k.claim.eventId as string | undefined, k.source.viaEvent].filter((id): id is string => !!id && !!w.event(id));
    const ev = w.emit('told', { actor: speaker.id, target: listener.id, pos: sb?.pos, causes: toldCauses.slice(0, 1), significance: 0.3 + (k.claim.significance ?? 0.3) * 0.4, data: { key: k.key, text, hops: k.hops + 1 }, summary: `${speaker.name} told ${listener.name}: "${describeClaim(w, k)}"`, loudness: 4 });
    k.sharedWith.push(listener.id);
    this.say(speaker, text); speaker.mind.lastSpokeAt = w.physicalTime; speaker.mind.lastToldAt[listener.id] = w.physicalTime;
    if (sb) { sb.pose = 'talk'; sb.poseUntil = w.physicalTime + 2.5; }
    if (listener.controlled) return;
    const trust = getRel(listener, speaker.id).trust; const conf = clamp(k.confidence * (0.55 + 0.35 * clamp(trust + 0.5)) * (speaker.traits.honesty * 0.3 + 0.7));
    const learned = learn(w, listener, { key: k.key, kind: k.kind, claim: { ...k.claim }, confidence: conf, source: { type: 'told', from: speaker.id, viaEvent: ev.id }, hops: k.hops + 1, cause: ev.id, summary: describeClaim(w, k) });
    remember(w, listener, { type: 'told', summary: `${speaker.name} told me ${describeClaim(w, k)}`, eventId: k.claim.eventId, entities: [speaker.id, k.claim.actor, k.claim.target].filter(Boolean) as string[], significance: clamp((k.claim.significance ?? 0.3) * 0.7), valence: isCrime(k.claim.type, k.claim.intent) ? -0.4 : 0, source: { type: 'told', from: speaker.id, viaEvent: ev.id } });
    ev.perceivedBy.push({ who: listener.id, how: 'heard', tick: w.now });
    adjustRel(w, listener, speaker.id, { familiarity: 0.03, affection: 0.02 }, 'talked', undefined, true);
    // v0.9 §A/§B/§C: hearsay is appraised and can form real concerns exactly like perception —
    // this is the step that makes "knowledge can cause behaviour" true for information that
    // TRAVELLED, not only for what a person saw with their own eyes. Provenance and confidence
    // are already folded into the appraisal (a third-hand rumour lands lighter than an eyewitness
    // account), so nothing here needs a separate hearsay discount.
    const listenerAppraisal = learned ? appraiseClaim(w, listener, learned) : null;
    if (learned && listenerAppraisal) formConcerns(w, listener, learned, listenerAppraisal);
    // v0.10 §II: hearing about a debt you owe (the seeded `debt` beliefs travel this way) is a
    // real way to come by one. `formObligations` applies its own epistemic test — it only ever
    // forms a stake when the CLAIM names this listener as the one helped or the one who owes —
    // so third-party gossip about other people's favours creates nothing.
    if (learned) formObligations(w, listener, learned);
    const toldPersonal = listenerAppraisal ? clamp(0.45 + listenerAppraisal.weight * 1.1, 0.35, 1.6) : 1;
    if (learned && isCrime(k.claim.type, k.claim.intent) && k.claim.actor) {
      const sev = crimeSeverity(k.claim.type); const victimClose = k.claim.target ? isClose(listener, k.claim.target) : false;
      adjustRel(w, listener, k.claim.actor, { fear: sev * 0.3 * conf * (1.2 - listener.traits.courage) * toldPersonal, trust: -sev * 0.4 * conf * toldPersonal, grudge: sev * conf * (victimClose ? 0.6 : 0.2) * toldPersonal, affection: -sev * 0.3 * conf * toldPersonal }, `was told by ${speaker.name}`, ev.id);
      listener.mind.alarm = 1;
      const lb = w.primaryBody(listener.id); if (lb) { lb.pose = 'talk'; lb.poseUntil = w.physicalTime + 1.5; }
      const isGuard = listener.occupation === 'guard' || listener.occupation === 'captain';
      this.sayLater(listener, isGuard ? `${k.claim.type === 'kill' ? 'Murder?!' : 'An assault?'} Where? I'll see to it.` : listener.traits.courage > 0.6 ? `That so? Someone should do something.` : `Gods. I'll keep my door barred.`, 1.2);
    } else if (learned) { this.sayLater(listener, ['Is that so.', 'I hadn\'t heard.', 'Well, well.', 'Hm.', 'Really?'][Math.floor(w.rng.next() * 5)], 1.5); }
  }
  /**
   * v0.8 "The Legible World" §A: ambient NPC-to-NPC gossip is exactly the same grounded
   * knowledge → speech step player-facing dialogue (`mind/dialogue.ts`) already goes through —
   * previously this had its OWN separate, more repetitive switch-per-event-type template here
   * ("X! Y attacked Z at W. Q told me!"), the exact database-log style the v0.8 playtest flagged,
   * just in a code path the player never directly interacts with (a speech bubble, not a
   * dialogue menu) — arguably MORE visible than the on-demand dialogue system, since it fires
   * constantly during ordinary play. Reusing `realizeClaim` here means ambient gossip and
   * deliberate conversation are the SAME synthesis, not two divergent narrative layers that
   * could drift out of sync with each other or with what's actually grounded.
   */
  private tellLine(sp: Person, li: Person, k: KnowledgeItem): string {
    const c = k.claim; const first = li.name.split(' ')[0];
    // v0.9 §E: when this line came from a chosen topic, realize the whole SITUATION — the fact,
    // one supporting fact the speaker also believes, and (only if the speaker personally knows
    // it) whether the matter has since been settled. Falls back to the single-claim realization
    // for lines raised any other way (a `report` goal's `tell` action, a player-driven `tell`).
    const topic = this.lastTopic.get(sp.id);
    const body = topic && topic.k.key === k.key ? realizeTopic(this.world, sp, topic) : realizeClaim(this.world, sp, k);
    // Direct address is kept only for the two "you need to know this NOW" urgent types — the
    // rest read naturally as realizeClaim already produces them.
    return (c.type === 'attack' || c.type === 'kill') ? `${first}! ${body}` : body;
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
    if (k) { k.handled = true; p.mind.investigated.add(k.key); }
    // v0.2.3: a confrontation over a real crime opens a canonical Conflict whose initiator is the
    // SUSPECT (their crime caused this encounter), cause 'crime_response'. So if they then flee,
    // maintainConflicts reads it as the aggressor fleeing, not the guard withdrawing.
    if (k) {
      const cf = beginConflict(w, { initiator: t.id, target: p.id, cause: 'crime_response', intent: sev >= 0.6 ? 'arrest' : 'threaten', causeEvent: ev.id });
      touchConflict(w, cf); ev.data.conflictId = cf.id;
    }
    const src = k ? (k.source.type === 'told' ? `${w.nameOf(k.source.from).split(' ')[0]} told me` : 'I know') : '';
    if (sev >= 0.6) { this.say(p, `${t.name}! ${src} you attacked ${k?.claim.target ? w.nameOf(k.claim.target) : 'someone'}. You're coming with me.`); // escalate to force
      p.mind.plan.push(
        { type: 'attack', targetEntity: t.id, status: 'pending', data: { arrest: true, intent: 'arrest' as ConflictIntent, crime: key } },
        { type: 'take_custody', targetEntity: t.id, status: 'pending', data: { crime: key } });
    }
    else if (k?.claim.type === 'theft') { this.say(p, `${t.name}. ${src} you took ${k.claim.item ? w.nameOf(k.claim.item) : 'what isn\'t yours'}. Give it back, or answer for it.`); p.desires.push({ type: 'recover_item', targetId: k.claim.item, note: `Recover ${w.nameOf(k.claim.item)} from ${t.name}`, reward: 0, fulfilled: false }); }
    else this.say(p, `${t.name}. I've heard things about you. Mind yourself.`);
    void ev;
  }

  // ------------------------------------------------------------------ combat
  attack(attacker: Person, ab: Body, tb: Body, intent?: ConflictIntent): CombatAttackResult {
    return this.resolveAttack({ attackerId: attacker.id, attackerBodyId: ab.id, targetBodyId: tb.id, attackMode: 'strike', intent });
  }
  resolveAttack(intent: CombatAttackIntent): CombatAttackResult {
    const w = this.world;
    const result = resolveCombatAttack(w, intent, w.rng);
    if (!result.attempted) return result;
    const attacker = w.person(intent.attackerId)!, ab = w.body(intent.attackerBodyId)!, tb = w.body(intent.targetBodyId)!;
    ab.lastAttackAt = w.physicalTime; ab.pose = 'attack'; ab.poseUntil = w.physicalTime + 0.45; ab.attackTarget = tb.ownerId;
    attacker.physiology.fatigue += result.exertionCost;
    syncNeeds(attacker);
    if (result.injury) applyInjury(tb, result.injury);
    this.applyHit(attacker, ab, tb, result.impact, intent.intent ?? 'injure', result);
    return result;
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
  applyHit(attacker: Person, ab: Body, tb: Body, dmg: number, intent?: ConflictIntent, combat?: CombatAttackResult): WorldEvent | null {
    const w = this.world; if (tb.dead) return null; const victim = w.get(tb.ownerId) as Person | Creature;
    // v0.2.3: a surrendered, subdued, or in-custody person is out of the fight. An aggressor
    // without explicit lethal intent does not keep hitting them (Constitution §11) — this is the
    // safety net; goal selection already avoids re-targeting them. Only 'kill' may strike anyway.
    if (victim.kind === 'person' && intent !== 'kill') {
      const vp = victim as Person;
      if (vp.surrender || vp.custody?.active || tb.subduedUntil > w.physicalTime) return null;
    }
    const wasDowned = tb.pose === 'downed';
    tb.health -= dmg; tb.lastHitAt = w.physicalTime;
    const dx = tb.pos.x - ab.pos.x, dz = tb.pos.z - ab.pos.z; const d = Math.hypot(dx, dz) || 1; tb.vel.x += dx / d * 4; tb.vel.z += dz / d * 4;
    this.onHit?.(tb, { x: tb.pos.x, y: tb.pos.y + 1.2, z: tb.pos.z });
    const place = w.placeAt(tb.pos);
    const ev = w.emit('attack', { actor: attacker.id, target: victim.id, pos: { ...tb.pos }, placeId: place?.id, significance: 0.7, visibility: 26, loudness: 14, data: { combat, damage: Math.round(dmg), weapon: combat ? (combat.weaponId ? w.nameOf(combat.weaponId) : 'fists') : this.weaponName(attacker), health: Math.round(tb.health), intent }, summary: `${attacker.name} attacked ${victim.name}${place ? ' at ' + place.name : ''} (${Math.round(dmg)} dmg)` });
    // v0.2.3: track this as part of a canonical Conflict (Constitution §11). Idempotent per pair.
    let conflict: Conflict | null = null;
    if (victim.kind === 'person') {
      const vp = victim as Person;
      const existing = conflictBetween(w, attacker.id, vp.id);
      const cause: ConflictCause = existing?.cause
        ?? (intent === 'rob' ? 'robbery'
          : intent === 'arrest' || intent === 'subdue' ? 'crime_response'
          : intent === 'defend' ? 'self_defense'
          : attacker.hostile !== vp.hostile ? 'faction_hostility' : 'retaliation');
      conflict = beginConflict(w, { initiator: attacker.id, target: vp.id, cause, intent: intent ?? 'injure', causeEvent: ev.id });
      recordConflictBlow(w, conflict, attacker.id, intent);
      ev.data.conflictId = conflict.id; // lets the Chronicle fold a whole fight into one entry
    }
    if (tb.health <= 0) {
      const lethal = intent === 'kill' || victim.kind === 'creature' || (!combat && attacker.controlled && (wasDowned || (intent === undefined && dmg > 20 && w.rng.next() < 0.5)));
      if (lethal) { tb.dead = true; tb.pose = 'dead'; tb.health = 0; if (victim.kind === 'person') { victim.alive = false; victim.deathTick = w.now; victim.mind.goal = null; victim.mind.plan = []; }
        const de = w.emit('kill', { actor: attacker.id, target: victim.id, pos: { ...tb.pos }, placeId: place?.id, causes: [ev.id], significance: 1, visibility: 26, loudness: 14, summary: `${attacker.name} killed ${victim.name}${place ? ' at ' + place.name : ''}` }); w.emit('death', { target: victim.id, pos: { ...tb.pos }, placeId: place?.id, causes: [de.id], significance: 1, summary: `${victim.name} died` }); }
      else {
        tb.pose = 'downed'; tb.poseUntil = w.physicalTime + 45; tb.health = 1; if (victim.kind === 'person') { victim.mind.plan = []; victim.mind.goal = null; }
        // v0.2.3: a downing blow whose intent was to subdue or arrest imposes a real, longer
        // incapacitation (Constitution §11: 'subdue'/'arrest' as an outcome, not a repeatable
        // non-lethal loop). The act('attack') handler escalates an arrest to actual custody.
        if (victim.kind === 'person' && (intent === 'subdue' || intent === 'arrest') && conflict) {
          subdue(w, victim as Person, attacker.id, conflict);
        }
      }
    } else { tb.pose = 'hit'; tb.poseUntil = w.physicalTime + 0.4; if (victim.kind === 'person' && !victim.controlled) { victim.mind.alarm = 1; victim.mind.attention = attacker.id; const cur = victim.mind.plan.find(x => x.status === 'active'); if (cur && cur.type !== 'attack') cur.status = 'failed'; } }
    // the victim always knows who hit them (unless asleep and it was dark... keep simple: they know)
    if (victim.kind === 'person' && !victim.controlled) {
      const vp = victim as Person; if (!ev.perceivedBy.some(x => x.who === vp.id)) { ev.perceivedBy.push({ who: vp.id, how: 'saw', tick: w.now }); const perc = w.emit('perceived', { actor: vp.id, target: attacker.id, causes: [ev.id], significance: 0.4, data: { how: 'saw', eventType: 'attack', eventId: ev.id }, summary: `${vp.name} was attacked by ${attacker.name}` }); learn(w, vp, { key: `ev:${ev.id}`, kind: 'event', claim: eventClaim(w, ev, true), confidence: 1, source: { type: 'witnessed', viaEvent: perc.id }, cause: perc.id, summary: ev.summary }); remember(w, vp, { type: 'attack', summary: `${attacker.name} attacked me${place ? ' at ' + place.name : ''}`, eventId: ev.id, entities: [attacker.id], significance: 0.9, valence: -0.9, source: { type: 'witnessed', viaEvent: perc.id }, placeId: place?.id }); this.reactTo(vp, tb, ev, perc.id, true, true, false, null); }
    }
    return ev;
  }
  weaponName(p: Person): string { let best: string = 'fists'; let bd = 0; for (const id of p.inventory) { const it = this.world.item(id); if (it && it.damage > bd) { bd = it.damage; best = it.name; } } return best; }

  /**
   * Player/NPC-shared (Constitution VI): chop or quarry the resource node at — or adjacent to —
   * a world cell. Same `extractFromNode` path an NPC's `chop`/`gather` action uses. Returns the
   * units extracted, or 0 if there is no workable node there.
   */
  extractResourceAt(actor: Person, pos: Vec3): number {
    const w = this.world;
    const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
    const node = w.resourceNodes.find(n => n.state === 'available' && n.remaining > 0
      && (n.blocks.some(b => b.x === cx && b.z === cz && Math.abs(b.y - cy) <= 5) || dist2(n.pos, pos) < 2.5));
    return node ? extractFromNode(w, node, actor) : 0;
  }

  /**
   * v0.8 "The Legible World" §D (player/NPC affordance parity): a mature wheat plot is real,
   * canonical resource state (`CropPlot`) exactly like a `ResourceNode` — this is the same
   * shape of wrapper as `extractResourceAt` above, calling the SAME `harvestPlot`/`plantPlot`
   * an NPC's own `harvest`/`plant` action already uses (`case 'harvest'`/`'plant'` below), never
   * a player-only shortcut. No tool/capability gate is added here because none exists for an
   * NPC's own harvest/plant either — parity means matching the real requirement, not inventing
   * a stricter one for the player. Yield/seed-cost still flow through the field's real
   * `ownerId` (a hired hand's harvest already paid the landowner, not themselves; the player
   * harvesting someone else's field behaves identically — the same canonical rule, not a
   * special case). Returns grain yielded (0 if nothing to harvest here).
   */
  harvestWheatAt(actor: Person, pos: Vec3): number {
    const w = this.world;
    const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
    const place = w.placeAt(pos); const field = place ? fieldFor(w, place.id) : undefined;
    const plot = field?.plots.find(p => p.x === cx && p.y === cy && p.z === cz);
    if (!field || !plot) return 0;
    return harvestPlot(w, field, plot, actor);
  }
  /** Sibling of `harvestWheatAt` for sowing a fallow plot — same parity rationale. Returns
   * whether a plot was actually sown (false if there is none here, or no seed grain at the
   * farm). */
  plantWheatAt(actor: Person, pos: Vec3): boolean {
    const w = this.world;
    const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
    const place = w.placeAt(pos); const field = place ? fieldFor(w, place.id) : undefined;
    const plot = field?.plots.find(p => p.x === cx && p.y === cy && p.z === cz);
    if (!field || !plot) return false;
    return plantPlot(w, field, plot, actor);
  }

  // ------------------------------------------------------------------ items
  /**
   * v0.8 §1A: whether `actor` picking up `it` (which someone else owns) is a grounded, authorized
   * recovery rather than theft. This requires ALL of:
   *  - the owner has an active (unfulfilled) `recover_item` desire naming this exact item — not
   *    "any owned item", and not a request that has already been fulfilled or withdrawn;
   *  - `actor` has actually learned of that specific request through canonical knowledge (the
   *    `wanted:<itemId>` fact `DialogueSystem.hearDesire` grants when the owner asks for help) —
   *    never simulation omniscience;
   *  - that learned fact still names the correct requester and item, so stale or wrong knowledge
   *    doesn't authorize picking up a different owner's property.
   * Ordinary unrelated pickup of someone else's belongings remains theft; this is a narrow,
   * evidence-gated exception, not a blanket "owned items are exempt from theft" rule.
   */
  isAuthorizedRecovery(actor: Person, it: import('../core/types').Item): boolean {
    if (!it.ownerId || it.ownerId === actor.id) return false;
    const owner = this.world.person(it.ownerId);
    if (!owner) return false;
    const desire = owner.desires.find(d => d.type === 'recover_item' && d.targetId === it.id && !d.fulfilled);
    if (!desire) return false;
    const known = actor.knowledge[`wanted:${it.id}`];
    return !!known && known.claim.itemId === it.id && known.claim.requesterId === owner.id;
  }
  takeItem(p: Person, it: import('../core/types').Item, how: 'pickup' | 'theft' | 'recovered' | 'bought' | 'given', from?: EntityId): WorldEvent {
    const w = this.world; const pos = it.pos ? { ...it.pos } : w.primaryBody(p.id)?.pos; const place = it.placeId ? w.place(it.placeId) : pos ? w.placeAt(pos) : undefined;
    const prevHolder = it.holderId; if (prevHolder) { const h = w.person(prevHolder); if (h) h.inventory = h.inventory.filter(x => x !== it.id); }
    it.holderId = p.id; it.pos = null; it.placeId = null; if (!p.inventory.includes(it.id)) p.inventory.push(it.id);
    const ownedByOther = how === 'pickup' && !!it.ownerId && it.ownerId !== p.id;
    const authorizedRecovery = ownedByOther && this.isAuthorizedRecovery(p, it);
    const stolen = how === 'theft' || (ownedByOther && !authorizedRecovery);
    const type = stolen ? 'theft' : how === 'recovered' || authorizedRecovery ? 'recovered' : how === 'given' ? 'give' : how === 'bought' ? 'trade' : 'pickup';
    it.provenance.push({ tick: w.now, from: from ?? prevHolder ?? it.ownerId ?? null, to: p.id, how: stolen ? 'stolen' : how });
    const ev = w.emit(type, { actor: p.id, target: stolen ? it.ownerId! : (from ?? it.ownerId ?? undefined), item: it.id, pos, placeId: place?.id, significance: stolen ? 0.5 : 0.15, visibility: stolen ? 16 : 8, data: { how, authorized: authorizedRecovery || undefined }, summary: stolen ? `${p.name} stole ${it.name} from ${w.nameOf(it.ownerId)}${place ? ' at ' + place.name : ''}` : authorizedRecovery ? `${p.name} recovered ${it.name} to return to ${w.nameOf(it.ownerId)}${place ? ' at ' + place.name : ''}` : `${p.name} ${how === 'recovered' ? 'recovered' : how === 'bought' ? 'bought' : 'picked up'} ${it.name}${place ? ' at ' + place.name : ''}` });
    it.provenance[it.provenance.length - 1].eventId = ev.id;
    if (how === 'bought') it.ownerId = p.id;
    else if (!stolen && how !== 'given') it.ownerId = it.ownerId ?? p.id;
    // v0.8 §P0-H (independent audit §4.6): `giveItem` below already closes a `recover_item`
    // desire (and pays a reward) when a THIRD PARTY hands the item back — but an owner who finds
    // and picks up their OWN lost item directly (this 'pickup'/'recovered' path, no `giveItem`
    // involved) never went through any code that closed the matching desire, leaving it open
    // forever even though the item was, in fact, back in its owner's hands. No reward is paid
    // here (there is no third-party helper to compensate for finding one's own property).
    if (!stolen && it.ownerId === p.id) {
      for (const d of p.desires) if (!d.fulfilled && d.type === 'recover_item' && d.targetId === it.id) { d.fulfilled = true; p.emotions.joy = clamp(p.emotions.joy + 0.3); }
    }
    return ev;
  }
  /**
   * Canonical robbery completion: transfers whatever `selectRobberyTake` chose — `takeItem` for
   * a real physical item/coin stack, a direct `wealth` transfer for abstract money (v0.8 §P0-B:
   * no longer materializes a new coin item nobody but the player can spend — see the doc
   * comments on each branch below) — then makes sure the victim — who was present and directly
   * targeted — always knows they were robbed, with full provenance, the same way `applyHit`
   * guarantees a victim always knows who struck them.
   */
  private executeRobbery(bandit: Person, victim: Person, take: RobberyTake, intent: ConflictIntent): WorldEvent {
    const w = this.world; const vb = w.primaryBody(victim.id); const pos = vb?.pos ?? w.primaryBody(bandit.id)?.pos;
    const place = pos ? w.placeAt(pos) : undefined;
    let ev: WorldEvent;
    if (take.kind === 'coins' || take.kind === 'item') {
      ev = this.takeItem(bandit, take.item, 'theft', victim.id);
      // v0.8 §P0-B: an NPC's money must stay spendable. Every NPC economic action —
      // `buyFoodPortion`, `payWage`, `payRecoveryReward`, `settleWholesale`, `laborIncentive`,
      // `banditResourcePressure` — reads `Person.wealth`; none of them ever reads a physical
      // `coins` Item (only the player's own dialogue/inventory UI does). A bandit who steals an
      // existing physical coin stack (this only realistically happens when the victim is the
      // player, who is the one entity that actually carries coins as a literal prop) still needs
      // that money banked to be able to spend it like any other villager. The player keeps
      // physically losing/gaining coin items when robbed/looted — only a *non-player* recipient
      // auto-deposits, immediately, into their own spendable wealth.
      if (take.kind === 'coins' && !bandit.controlled) {
        const amount = take.item.quantity;
        bandit.wealth += amount; bandit.inventory = bandit.inventory.filter(id => id !== take.item.id);
        take.item.quantity = 0; retireStack(w, take.item);
      }
    } else {
      // v0.8 §P0-B (audit finding — §3.1/§4.1 of the independent review): this branch used to
      // mint a brand-new `coins` Item for the bandit, creating a SECOND, incompatible
      // representation of money that no NPC economic action can ever spend (listed above). Over
      // a real run that is a one-way pump: spendable purchasing power drains out of the village
      // into an inert reservoir (measured: hundreds of silver per simulated month; `Person.wealth`
      // and total coin-item counts diverge while a "wealth + coin items" conservation check
      // reports a perfect residual throughout, because the quantity it conserves is not the
      // quantity anyone can spend). A direct wealth-to-wealth transfer is the smallest
      // structurally coherent fix: it is exactly the operation `buyFoodPortion`/`payWage`/
      // `sellItem`'s buyer side already perform for every other NPC-to-NPC payment in this
      // codebase, it keeps stolen money spendable by the bandit (closing `mind/economy.ts`'s
      // documented-but-previously-inert `banditResourcePressure` feedback loop for the first
      // time — a bandit faction's measured wealth now actually falls when it robs successfully),
      // and it invents no new mechanism. No item is created because none is needed: 'wealth'
      // means abstract money, not a physical coin stack that has to exist as an object.
      victim.wealth -= take.amount; bandit.wealth += take.amount;
      ev = w.emit('theft', { actor: bandit.id, target: victim.id, pos, placeId: place?.id, significance: 0.5, visibility: 16, data: { intent, wealth: true, amount: take.amount }, summary: `${bandit.name} robbed ${take.amount} silver from ${victim.name}${place ? ' at ' + place.name : ''}` });
    }
    if (victim.alive && !victim.controlled && !ev.perceivedBy.some(x => x.who === victim.id)) {
      ev.perceivedBy.push({ who: victim.id, how: 'saw', tick: w.now });
      const perc = w.emit('perceived', { actor: victim.id, target: bandit.id, causes: [ev.id], significance: 0.6, data: { how: 'saw', eventType: 'theft', eventId: ev.id }, summary: `${victim.name} was robbed by ${bandit.name}` });
      learn(w, victim, { key: `ev:${ev.id}`, kind: 'event', claim: eventClaim(w, ev, true), confidence: 1, source: { type: 'witnessed', viaEvent: perc.id }, cause: perc.id, summary: ev.summary });
      remember(w, victim, { type: 'theft', summary: `${bandit.name} robbed me`, eventId: ev.id, entities: [bandit.id], significance: 0.85, valence: -0.8, source: { type: 'witnessed', viaEvent: perc.id }, placeId: place?.id });
      adjustRel(w, victim, bandit.id, { fear: 0.5, trust: -0.5, affection: -0.3, grudge: 0.5, respect: -0.2 }, 'was robbed', perc.id);
      victim.emotions.fear = clamp(victim.emotions.fear + 0.5); victim.emotions.anger = clamp(victim.emotions.anger + 0.3);
      victim.mind.alarm = 1; victim.mind.attention = bandit.id;
    }
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
    // v0.10 §II: a real material gift now has durable consequences — it creates an obligation that
    // can still be shaping the recipient's decisions days later (social/obligation.ts). An event a
    // later state points back at for its provenance must be significant enough to survive
    // `World.compactEvents`' 0.5 threshold, or the "because of what canonical event" question the
    // milestone requires an answer to dead-ends at exactly the point it starts mattering.
    const ev = w.emit(returned ? 'returned_item' : 'gift', { actor: from.id, target: to.id, item: it.id, pos, significance: returned ? 0.6 : 0.5, visibility: 14, loudness: 6, summary: `${from.name} ${returned ? 'returned' : 'gave'} ${it.name} to ${to.name}` });
    it.provenance[it.provenance.length - 1].eventId = ev.id;
    for (const d of to.desires) if (!d.fulfilled && d.type === 'recover_item' && d.targetId === it.id) {
      d.fulfilled = true; adjustRel(w, to, from.id, { affection: 0.6, trust: 0.5, respect: 0.3 }, `returned ${it.name}`, ev.id); to.emotions.joy = 1; to.emotions.sadness *= 0.5;
      // v0.8 §1B: a promised reward is really paid, from the requester who offered it, honestly
      // capped by what they actually have (payRecoveryReward never manufactures currency).
      const paid = d.reward > 0 ? payRecoveryReward(w, to.id, from, d.reward) : 0;
      this.say(to, paid >= d.reward ? `You... you found it. I don't know what to say. Thank you, stranger. Here — ${paid} silver, as promised.` : paid > 0 ? `You found it! Thank you. I've only ${paid} silver on me right now, but take it — it's yours.` : `You... you found it. I don't know what to say. Thank you, stranger.`);
    }
    return ev;
  }

  /**
   * Canonical purchase of one whole object. Payment is `wealth` -> `wealth` — the one currency
   * every NPC economic path already reads (`buyFoodPortion`, `payWage`, `settleWholesale`,
   * robbery). The player used to pay from a carried `coins` Item instead, the last live instance
   * of the dual-currency split the independent audit flagged (Constitution §9: no separate player
   * ontology; and an inert-money leak by construction).
   *
   * v0.10.1: whether the sale may happen at all, and what it costs, now come from
   * `world/commerce.ts` — the same `willingnessFor`/`unitPriceFor` the offer list and every NPC
   * stack purchase use. The caller may still name a price it agreed with the seller, but it is
   * clamped to what this seller would actually charge, so a stale menu cannot undercut them. A
   * refusal comes back as null with the reason available from `willingnessFor` for the caller to
   * report; ownership moves through `takeItem`, which is the one place that keeps inventories,
   * provenance and the theft/recovery distinction straight.
   */
  buyItem(buyer: Person, seller: Person, it: import('../core/types').Item, price?: number): WorldEvent | null {
    const w = this.world;
    if (it.holderId || it.quantity <= 0) return null;
    if (willingnessFor(w, seller, it, buyer).reason) return null;
    const asking = unitPriceFor(w, seller, it, buyer);
    const paid = Math.max(asking, price ?? asking);
    if (buyer.wealth < paid) return null;
    buyer.wealth -= paid; seller.wealth += paid;
    w.runTally.purchase_amount = (w.runTally.purchase_amount ?? 0) + paid;
    const ev = this.takeItem(buyer, it, 'bought', seller.id);
    ev.data.price = paid; ev.data.buyer = buyer.id; ev.data.seller = seller.id;
    ev.summary = `${buyer.name} bought ${it.name} from ${seller.name} for ${paid} silver`;
    return ev;
  }
  /** What this person would sell that person right now, and why the rest is not on offer — the
   * client's Trade menu asks the Simulation rather than reaching into `world/commerce.ts`
   * itself, per AGENTS.md. */
  tradeOffers(seller: Person, buyer: Person): TradeOffer[] { return tradeOffersFrom(this.world, seller, buyer); }
  tradeRefusals(seller: Person, buyer: Person): Refusal[] { return refusalsFrom(this.world, seller, buyer); }
  /** Buy `qty` units off a stack — the same `purchaseUnits` a hungry NPC's own food purchase
   * goes through. */
  buyUnits(buyer: Person, seller: Person, stack: import('../core/types').Item, qty: number): PurchaseResult {
    return purchaseUnits(this.world, buyer, seller, stack, qty);
  }

  /** Canonical sale path: the seller's item goes on the buyer's display, the buyer's `wealth`
   * pays the seller's `wealth`. No coin Item is minted (see `buyItem`). */
  sellItem(seller: Person, buyer: Person, it: import('../core/types').Item, price: number, displayPos?: Vec3, placeId?: EntityId): WorldEvent | null {
    const w = this.world;
    if (buyer.wealth < price || it.holderId !== seller.id || !seller.inventory.includes(it.id)) return null;
    buyer.wealth -= price; seller.wealth += price;
    seller.inventory = seller.inventory.filter(id => id !== it.id);
    it.holderId = null; it.ownerId = buyer.id;
    const pos = displayPos ?? w.primaryBody(buyer.id)?.pos ?? w.primaryBody(seller.id)?.pos ?? null;
    it.pos = pos ? { ...pos } : null; it.placeId = placeId ?? (pos ? w.placeAt(pos)?.id ?? null : null);
    const ev = w.emit('trade', { actor: seller.id, target: buyer.id, item: it.id, pos: pos ?? undefined, placeId: it.placeId ?? undefined, significance: 0.2, visibility: 10, data: { price, buyer: buyer.id, seller: seller.id }, summary: `${seller.name} sold ${it.name} to ${buyer.name} for ${price} silver` });
    it.provenance.push({ tick: w.now, eventId: ev.id, from: seller.id, to: buyer.id, how: 'sold' });
    return ev;
  }

  // ------------------------------------------------------------------ participation (any person, incl. the player)
  // Thin canonical entry points over logistics/participation.ts — the same functions an NPC's
  // own `haul`/`eat`/`drink` actions bottom out in, exposed so the client calls Simulation (per
  // AGENTS.md) rather than reaching into the world. None of these read `controlled`.
  haulOffersFrom(npc: Person): HaulOffer[] { return haulOffersFrom(this.world, npc); }
  activeHaulFor(p: Person): import('../core/types').HaulTask | undefined { return activeHaulFor(this.world, p); }
  acceptHaul(p: Person, task: import('../core/types').HaulTask): boolean { return acceptHaulOffer(this.world, task, p); }
  /** One physical step of the person's current haul from where they stand (load / deposit /
   * still to walk). Briefly shows the same `work` pose an NPC's load/unload step shows. */
  progressHaul(p: Person): HaulProgress {
    const b = this.world.primaryBody(p.id); if (!b) return { kind: 'no_job' };
    const r = progressHaul(this.world, p, b.pos);
    if (r.kind === 'loaded' || r.kind === 'delivered') { b.pose = 'work'; b.poseUntil = this.world.physicalTime + 0.8; }
    return r;
  }
  abandonHaul(p: Person): boolean { return abandonHaul(this.world, p); }
  buyMeal(buyer: Person, seller: Person, n = 1): import('../core/types').Item | null { return buyMealFrom(this.world, buyer, seller, n); }
  /** Eat one unit of food to hand (own carried food, or the household larder at home). */
  eatAtHand(p: Person): import('../core/types').ItemType | null {
    const b = this.world.primaryBody(p.id); const here = b ? this.world.placeAt(b.pos)?.id ?? null : null;
    const type = eatAtHand(this.world, p, here);
    if (type && b) { b.pose = 'eat'; b.poseUntil = this.world.physicalTime + 1.5; }
    return type;
  }
  /**
   * Eat/drink ONE named thing this person is carrying — the inventory panel's version of the
   * same act `eatAtHand` performs when a person just wants food. Refuses anything they are not
   * actually holding, so a stale panel cannot consume something already given away.
   */
  consumeItem(p: Person, it: import('../core/types').Item): import('../core/types').ItemType | null {
    if (it.holderId !== p.id || it.quantity <= 0 || !isFood(it.type)) return null;
    const b = this.world.primaryBody(p.id);
    const type = eatFood(this.world, p, it);
    if (b) { b.pose = it.type === 'ale' ? 'drink' : 'eat'; b.poseUntil = this.world.physicalTime + 1.5; }
    return type;
  }
  /** Drink at the water source the person is standing at, if any. */
  drinkHere(p: Person): boolean {
    const b = this.world.primaryBody(p.id); if (!b) return false;
    const ok = drinkHere(this.world, p, b.pos);
    if (ok) { b.pose = 'drink'; b.poseUntil = this.world.physicalTime + 1.2; }
    return ok;
  }

  // ------------------------------------------------------------------ strategic (per world minute)
  private strategic(minutes: number): void {
    const w = this.world; const h = minutes / 60;
    const t0 = this.mark();
    for (const p of w.persons()) {
      if (!p.alive) continue; const b = w.primaryBody(p.id);
      p.needs.social = clamp(p.needs.social + h / 10 * p.traits.sociability);
      // v0.4 §1: energy(calories)/hydration/fatigue/sleepDebt/bodyHeat now come from one
      // centralized physiology step (core/physiology.ts), classified by the person's current
      // goal (`activityLevelFor`) — replacing the flat per-minute hunger/energy/thirst deltas
      // this used to apply directly. `needs.hunger/.thirst/.energy` are still real fields
      // (dozens of callers read them), just derived from the physiology reserves now.
      // v0.8 §D: a real, lit fire warms whoever is actually at that Place — genuine physical
      // consequence of the fire's own intensity, not a separate "warm" status effect.
      const firePlace = b ? w.placeAt(b.pos) : undefined;
      const nearFire = firePlace ? fireIntensityAt(w, firePlace.id) : 0;
      if (b) stepPhysiology(w, p, h, activityLevelFor(p, b), { indoor: w.isIndoors(b.pos), daylight: this.lightAt(), nearFire });
      // v0.8 §P0-D fix: a detainee has no agency to seek their own food/water — `custody?.active`
      // already suspends their autonomous goal system entirely (this file's think(), the
      // `idle:custody` hold) — so an institution holding someone has a basic duty of care, the
      // same way it already prevents ordinary health regen without providing MORE than survival
      // (see the "held" health-regen guard a few lines below this one). Before this fix, a
      // multi-day detention (`custodyDurationFor`: 1.5-6 days) combined with zero sustenance
      // mechanism meant a detainee's hunger/thirst climbed to `critical` and simply stayed there
      // for the ENTIRE detention — measured directly (seed 918271: Vex arrested at hour 5, held
      // until hour 113, critical hunger+thirst for over 100 continuous hours) — an institutional
      // neglect bug, not a consequence of a bandit's chosen precarious lifestyle. This floors
      // (never restores past) hunger/thirst at "uncomfortable", not comfortable — a cell is still
      // not a good place to be, but a real jail feeds and waters its prisoners enough that they
      // don't starve or dehydrate to crisis while held.
      if (p.custody?.active) {
        p.physiology.energy = Math.max(p.physiology.energy, 0.4);
        p.physiology.hydration = Math.max(p.physiology.hydration, 0.45);
        syncNeeds(p);
      }
      // v0.6 §XV: time-weighted (not point-in-time-snapshot) severity-band distribution — how
      // many world-MINUTES the village actually spends at each band, the benchmark evidence the
      // milestone asks for ("average hunger band distribution") rather than a single end-of-run
      // sample that a busy/idle moment could skew. Purely observational (never read back into
      // any decision); a few comparisons per person per world-minute, not a new hot path.
      if (!p.controlled) {
        w.runTally[`hunger_band_${hungerBand(p)}_min`] = (w.runTally[`hunger_band_${hungerBand(p)}_min`] ?? 0) + minutes;
        w.runTally[`thirst_band_${thirstBand(p)}_min`] = (w.runTally[`thirst_band_${thirstBand(p)}_min`] ?? 0) + minutes;
        w.runTally[`sleep_band_${sleepBand(p)}_min`] = (w.runTally[`sleep_band_${sleepBand(p)}_min`] ?? 0) + minutes;
        w.runTally[`comfort_band_${comfortBand(p)}_min`] = (w.runTally[`comfort_band_${comfortBand(p)}_min`] ?? 0) + minutes;
      }
      const e = p.emotions; e.fear *= Math.pow(0.5, h / 1.5); e.anger *= Math.pow(0.5, h / 3); e.stress *= Math.pow(0.5, h / 4); e.joy = e.joy * Math.pow(0.5, h / 2) + 0.3 * (1 - Math.pow(0.5, h / 2)); e.sadness *= Math.pow(0.5, h / 48);
      // A subdued or in-custody body does not regenerate health from strategic upkeep while held
      // incapacitated — but is not otherwise harmed. Ordinary recovery resumes on release.
      const held = (b && b.subduedUntil > w.physicalTime) || !!p.custody?.active;
      // v0.9 §D: a real wound takes real time to MEND. The flat 0.15/minute rate healed a
      // near-fatal beating in about four world hours, which is precisely why a serious assault
      // used to have no consequences in ordinary life — by the next work shift there was nothing
      // left to notice.
      //
      // The slowdown deliberately applies only ABOVE `INCAPACITATED_FRACTION`. Getting back on
      // your feet is not the slow part; mending is. Slowing recovery all the way down to zero
      // health instead produced a measured, severe pathology (seed 918271, 10 days): a bandit and
      // a guard locked in a 74-world-hour, 3623-blow grind, because the loser was pinned in the
      // knocked-down/stand-up/knocked-down band for hours instead of recovering enough to win,
      // flee, or die. Below the threshold, recovery is exactly the pre-v0.9 rate; above it, a
      // serious wound still costs the better part of a working day. Tended wounds close faster:
      // the `heal` action adds health directly on top of this, unchanged.
      if (b && !b.dead && !held && b.health < b.maxHealth) {
        const fraction = b.health / b.maxHealth;
        const rate = fraction < INCAPACITATED_FRACTION ? 0.15 : 0.15 * (0.35 + 0.65 * fraction);
        b.health = Math.min(b.maxHealth, b.health + minutes * rate);
      }
      // notice missing possessions when at work: inference without a witness
      if (b && p.workId && w.placeAt(b.pos)?.id === p.workId && w.rng.next() < 0.3 * minutes) {
        // v0.8 §P0-F fix: an item legitimately assigned to a haul task and carried by that
        // task's authorized claimant is not missing — it is exactly where a haul is supposed to
        // put it, in transit. Before this check, a bakery owner "noticing" their own flour is
        // gone every time a hauler had legitimately picked it up (`loadHaulCargo` makes the
        // owner the requester and the holder the hauler, on purpose) produced a real,
        // provenance-stamped FALSE belief ("someone took it") at a measured rate of roughly one
        // per day across a 20-day run — a confident false belief formed from a broken inference,
        // which Constitution §5/§6 explicitly forbids. `it.haulTaskId` is the authoritative
        // "this stack is a haul cargo currently being carried between two Places for the named
        // task" signal (see core/types.ts's `Item.haulTaskId` doc) — checking it directly (not
        // merely suppressing the emitted event) is what makes this a real custody/transport
        // distinction rather than a name-based patch.
        for (const it of w.items()) if (it.ownerId === p.id && it.holderId && it.holderId !== p.id && !it.haulTaskId && !p.knowledge[`missing:${it.id}`]) {
          const knownTheft = Object.values(p.knowledge).find(k => k.kind === 'event' && k.claim.type === 'theft' && k.claim.item === it.id);
          if (knownTheft) continue;
          const ev = w.emit('item_missing', { actor: p.id, item: it.id, pos: b.pos, placeId: p.workId, significance: 0.45, summary: `${p.name} noticed ${it.name} is missing` });
          const missing = learn(w, p, { key: `missing:${it.id}`, kind: 'event', claim: { eventId: ev.id, type: 'item_missing', item: it.id, placeId: p.workId, tick: w.now, actorUnknown: true, significance: 0.45 }, confidence: 0.9, source: { type: 'inferred', viaEvent: ev.id }, cause: ev.id, summary: `${it.name} is missing` });
          // v0.9 §B: a belief acquired by INFERENCE forms concerns exactly like one acquired by
          // perception or hearsay. Without this, the one path in the whole simulation by which an
          // unwitnessed theft is ever discovered produced a belief that changed nothing about the
          // owner's behaviour and was never worth mentioning to anyone — the precise failure mode
          // ("NPCs just know more things") this milestone exists to close.
          if (missing) formConcerns(w, p, missing);
          remember(w, p, { type: 'item_missing', summary: `${it.name} is gone from its place. Someone took it.`, eventId: ev.id, entities: [it.id], significance: 0.6, valence: -0.5, source: { type: 'inferred', viaEvent: ev.id } });
          p.emotions.anger = clamp(p.emotions.anger + 0.4); p.desires.push({ type: 'recover_item', targetId: it.id, note: `${it.name} was taken from ${w.nameOf(p.workId)}. I want it back.`, reward: 15, fulfilled: false }); this.say(p, `Where is ${it.name}?! It was right here!`);
        }
      }
    }
    this.accum('strategic.persons', t0);
    // Social upkeep (v0.2.3) — relationship evolution + conflict/custody lifecycle. Runs on a
    // coarser cadence than per-minute needs: its half-lives are hours-to-days, and the conflict
    // status transitions key off world-time thresholds far longer than a minute. Batching it to
    // ~10-minute steps keeps a 30-day run's cost flat — the per-person work here (an all-conflicts
    // scan, an all-knowledge scan) is what made per-minute evolution superlinear.
    this.socialAccum += minutes;
    if (this.socialAccum >= 10) {
      const sh = this.socialAccum / 60; this.socialAccum = 0;
      const tc = this.mark();
      // One pass over conflicts builds every person's active-threat set (was O(conflicts) per
      // person = O(conflicts x persons) every minute).
      const threatsByPerson = new Map<string, Set<string>>();
      for (const c of w.conflicts) {
        if (c.status !== 'active' && c.status !== 'disengaging') continue;
        for (const x of c.participants) for (const y of c.participants) if (x !== y) {
          let s = threatsByPerson.get(x); if (!s) threatsByPerson.set(x, s = new Set()); s.add(y);
        }
      }
      const EMPTY = new Set<string>();
      // v0.10: computed once for the whole pass rather than rescanned per person — see
      // `recentlyFailedRequests`.
      const failedWork = recentlyFailedRequests(w);
      // Causal Society: drawing conclusions runs on an HOURLY cadence, not this block's ten-minute
      // one. Its first step is a full scan of a mind's knowledge map (to find what it currently
      // believes is short), which is the most expensive thing in this pass, and a conclusion
      // stands for a day once drawn (`REINFER_SECONDS`) — so running it six times an hour buys
      // nothing and costs six times as much.
      this.inferenceAccum += sh;
      const drawNow = this.inferenceAccum >= 1;
      if (drawNow) this.inferenceAccum = 0;
      for (const p of w.persons()) {
        if (!p.alive) continue;
        const unresolvedHarm = new Set<string>();
        for (const k of Object.values(p.knowledge)) {
          if (k.kind === 'event' && !k.handled && k.claim.actor && (k.claim.type === 'attack' || k.claim.type === 'kill' || k.claim.type === 'theft')) unresolvedHarm.add(k.claim.actor);
        }
        evolveRelationships(p, sh, { activeThreatIds: threatsByPerson.get(p.id) ?? EMPTY, unresolvedHarmIds: unresolvedHarm });
      }
      maintainConflicts(w);
      maintainCustody(w);
      // v0.9 §G: ongoing matters age and settle at the world level; the concerns people carry
      // about them age and discharge at the personal level. Same coarse cadence as relationship
      // evolution above — both work on half-lives of hours to days.
      maintainSituations(w);
      for (const p of w.persons()) {
        if (!p.alive || p.controlled) continue;
        maintainConcerns(w, p, sh);
        // v0.10 §I/§II: the personal layers age and settle on the same coarse cadence as
        // concerns, and in this order for a reason — obligations first (they are one of the
        // things a purpose can rest on), then purposes are formed from whatever is currently
        // live, then re-prioritised and resolved. `noticeBrokenPromises` is the honest,
        // inference-based way a person finds out that work they commissioned was dropped.
        maintainObligations(w, p, sh);
        noticeBrokenPromises(w, p, failedWork);
        formPursuits(w, p);
        maintainPursuits(w, p);
        // v0.10.1 §XII: drop report records whose belief is gone or whose outcome is old — this
        // is bookkeeping, so it belongs in the coarse pass rather than in `think()`.
        pruneReports(w, p);
        // v0.9 §D: notice that someone who ought to be here is not — the generic information-gap
        // inference (social/absence.ts). On this coarse cadence rather than per world-minute:
        // its thresholds are measured in HOURS, so a ten-minute granularity changes no outcome,
        // and its first step is a `placeAt` scan over every Place — running that for every person
        // every simulated minute was a measurable, entirely avoidable cost.
        noticeAbsences(w, p, w.clock.hourF);
        // Causal Society: and, from what they now believe, work out WHY (mind/inference.ts).
        // Placed immediately after `noticeAbsences` because an absence is one of its premises,
        // so a conclusion can be drawn in the same pass the gap was noticed in.
        if (drawNow) drawInferences(w, p);
      }
      this.accum('strategic.conflict', tc);
      // v0.2.4 world metabolism: weather → soil moisture → crop growth. Deterministic, emits
      // only semantic transitions (crop_matured). Same ~10-min cadence as social upkeep.
      const tmet = this.mark();
      stepMetabolism(w, sh);
      // v0.3 Living World I: logistics needs, haul-queue upkeep, construction advance, resource
      // node regrowth, and stock spoilage — all deterministic, all on this coarse cadence so
      // they cost nothing per physical step.
      generateLogisticsNeeds(w);
      generateProductionNeeds(w);
      // v0.5 Adaptive Society: end stints that reality has already ended (the place's own worker
      // is fit and back, the stand-in died, or they simply stopped), then re-derive which posts
      // are going unworked. In this order, and AFTER `generateProductionNeeds`, because
      // under-servedness is defined partly by demand this pass may just have raised.
      maintainWorkStints(w);
      this.vacantPosts = underServedPosts(w);
      this.awareOfShortage = this.vacantPosts.length ? peopleAwareOfShortage(w) : EMPTY_AWARENESS;
      stepConstruction(w);
      maintainHauls(w);
      maintainResourceNodes(w);
      stepSpoilage(w, sh);
      // v0.8 §C: fire as a real world process — fuel consumption, rain suppression for an
      // exposed fire. Same coarse cadence as everything else in this block.
      stepFire(w, sh);
      this.accum('strategic.metabolism', tmet);
    }
    // weather
    const t1 = this.mark();
    const wt = w.weather;
    if (w.now >= wt.nextChangeAt) {
      // v0.8 §9: weather draws from its own forked stream (`w.weatherRng`) precisely so that
      // weather is never a source of, or victim of, RNG-sequence coupling with anything else.
      const r = w.weatherRng.next(); const kinds: import('../core/types').WeatherKind[] = wt.kind === 'clear' ? ['clear', 'cloudy', 'cloudy', 'fog'] : wt.kind === 'cloudy' ? ['clear', 'rain', 'cloudy', 'storm'] : wt.kind === 'rain' ? ['cloudy', 'rain', 'storm', 'clear'] : wt.kind === 'storm' ? ['rain', 'cloudy'] : ['clear', 'cloudy'];
      const kind = kinds[Math.floor(r * kinds.length)]; const prev = wt.kind; wt.kind = kind; wt.intensity = kind === 'storm' ? 1 : kind === 'rain' ? 0.5 + w.weatherRng.next() * 0.4 : kind === 'fog' ? 0.7 : 0; wt.wind = 0.1 + w.weatherRng.next() * (kind === 'storm' ? 1 : 0.5); wt.nextChangeAt = w.now + (1.5 + w.weatherRng.next() * 4) * SECONDS_PER_HOUR;
      if (prev !== kind) w.emit('weather', { significance: 0.2, data: { kind }, summary: `The weather turned to ${kind}` });
    }
    this.accum('strategic.weather', t1);
  }
}
