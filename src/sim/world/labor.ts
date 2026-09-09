import type { EntityId, ItemType, Person, Place, PlaceType, SkillId, WorkStint } from '../core/types';
import type { ToolAction } from '../core/tools';
import type { World } from '../core/world';
import { getPhysicalCapability, SERIOUS_WOUND, woundSeverity } from '../core/attributes';
import { skillOf } from '../core/skills';
import { productionSpecs, reserveFor } from './production';
import { stockAt } from './stock';
import { bake, mill, saw, type TransformResult } from './metabolism';
import { cook, tendTavernFire } from './cooking';

/**
 * VACANT WORK, DERIVED (Adaptive Society v0.5).
 *
 * The failure this module exists to end: a productive place could lose its worker and stay
 * stopped forever. Not because anything was broken — the physical chain was correct, the demand
 * was raised, the shortage propagated, and people formed real worries about it — but because the
 * one question "is there work here that nobody is doing?" was not askable. Whether a batch
 * happened was decided by `p.occupation === 'miller'`, so the mill's work simply ceased to exist
 * the moment the only person carrying that label did.
 *
 * THERE IS NO VACANCY FLAG. Nothing writes "the mill is vacant" anywhere. A post is under-served
 * when three canonical facts hold at once, each of which is already true or false in the world
 * whether or not anybody asks:
 *
 *   staffing    — nobody on this place's canonical staff is currently fit to work it
 *                 (`unfitReason`: dead, gone, downed, badly hurt, held, away, or spent);
 *   demand      — the place has genuinely raised a production request it cannot fill
 *                 (world/production.ts, which raises one only from real stock below reserve);
 *   output      — and no batch has actually come out of the place for long enough that this is a
 *                 stoppage rather than the gap between two shifts.
 *
 * Delete this file and the world state it reads is unchanged. That is the test of whether a
 * derived view is really derived.
 *
 * CONSTITUTION §IX / milestone §5 — occupation is DESCRIPTIVE here, and the distinction is
 * load-bearing rather than decorative. `p.occupation` appears nowhere in this file. Who counts as
 * staff is read from the place's own `workers`/`ownerId` and from `workId` — the canonical record
 * of where somebody works, which a label does not confer — and whether they can do the work is
 * read from body and capability. Setting somebody's occupation to 'miller' changes nothing any
 * function here returns.
 */

/** One canonical input → output process, and the place it happens at. */
export interface TradeProcess {
  placeType: PlaceType;
  input: ItemType;
  output: ItemType;
  skill: SkillId;
  /** Plain-words verb, for reasons and summaries. */
  verb: string;
  /** Ordinary seconds of work per batch for a settled tradesman (see core/skills.ts's
   * `TRADE_BASELINE`). A novice pays more; nobody pays less for this term. */
  baseBatchSeconds: number;
  /** The tool this work is done with, if it is done with one. A sawyer with a saw in hand gets
   * through a log measurably faster than one without (`core/tools.ts`, `core/attributes.ts`'s
   * `workRate`), and the tool wears with the work. Declared here rather than branched on at the
   * call site, which is how it used to be: `p.occupation === 'woodcutter' && placeType ===
   * 'sawpit'` was the last occupation gate left in the batch path. */
  toolAction?: ToolAction;
}

/**
 * The two ends of Ashford's one real supply chain, and deliberately only those two.
 *
 * The rule for adding a row, which matters more than the rows: a process belongs here only if it
 * is a REQUEST-DRIVEN transform of a material input into a material output at a fixed place —
 * that is, one whose work anybody standing there with the material could in principle do badly.
 * The village's other work is not that shape. Gathering herbs, hunting, and keeping a larder
 * stocked are somebody's own stall and their own stock, with no input to be short of and nothing
 * for a stand-in to take over; the cook's stew additionally needs a lit hearth, which is a second
 * physical precondition this model has nothing to say about. Those stay where they are, gated by
 * whose stall it is, until there is a reason to generalize them that is not "for symmetry".
 */
const TRADE_PROCESSES: TradeProcess[] = [
  { placeType: 'mill', input: 'grain', output: 'flour', skill: 'milling', verb: 'milling', baseBatchSeconds: 8 * 60 },
  { placeType: 'bakery', input: 'flour', output: 'bread', skill: 'baking', verb: 'baking', baseBatchSeconds: 8 * 60 },
  // The sawpit. It qualifies on every clause of the rule above and always did — a request-driven
  // transform of a material input into a material output at a fixed place — and was outside this
  // table only because sawing was still an unconditional cadence call gated on
  // `p.occupation === 'woodcutter'`. Both of those are now gone: `world/production.ts` raises real
  // plank demand from the open deficit across live construction projects, and the batch runs
  // through `workAuthorization` like every other trade.
  { placeType: 'sawpit', input: 'log', output: 'plank', skill: 'sawing', verb: 'sawing', baseBatchSeconds: 8 * 60, toolAction: 'saw' },
  // The tavern's stew. The one process with a second physical precondition — the hearth has to be
  // genuinely burning, not merely lit (`world/cooking.ts`) — which is why the note above used to
  // give it as the example of work this model had nothing to say about. It turns out the model
  // does not need to say anything: `runTradeBatch` tends the fire and then cooks, so a stand-in
  // who has never been near the tavern lights it from whatever fuel is in the house exactly as
  // its own cook does, and a batch that could not be cooked returns `produced: 0` and is never
  // paid for. The precondition lives in the transform, where it always did.
  { placeType: 'tavern', input: 'meat', output: 'stew', skill: 'cooking', verb: 'cooking', baseBatchSeconds: 8 * 60 },
];

export function processFor(placeType: PlaceType | undefined): TradeProcess | undefined {
  if (!placeType) return undefined;
  return TRADE_PROCESSES.find(t => t.placeType === placeType);
}
export function tradeProcesses(): readonly TradeProcess[] { return TRADE_PROCESSES; }

// ---------------------------------------------------------------- who is fit, and who is staff

/** How far from their workplace somebody has to be before it is fair to say they are not at it.
 * Generous: Ashford is small, and an ordinary errand across the village must not read as leaving. */
export const AWAY_FROM_WORK_METRES = 90;
/** The same exertion floor `mind/agent.ts` uses for heavy labour (`laborOk`). Shared rather than
 * restated so "too spent to work" means one thing in this codebase. */
export const WORK_CAPACITY_FLOOR = 0.15;
/** How long a place can go without producing anything before a stoppage is a stoppage rather than
 * the gap between two shifts. A working mill batches several times an hour; a night plus a
 * morning is comfortably longer than any ordinary quiet spell. */
export const STOPPAGE_HOURS = 14;
/**
 * The same question for a workforce that is merely SPENT rather than gone.
 *
 * Found by running the undisturbed village: at seven in the morning on an ordinary day the
 * miller's exertion capacity is briefly under the floor — he has not eaten yet — and with a
 * production request standing and no batch since the previous afternoon, the mill read as work
 * nobody was doing. Nobody acted on it (nobody knew of any shortage, which is the awareness gate
 * doing its job) but it was still a false reading, and a false reading that says "this trade has
 * been lost" about a man who is standing at his own stones wanting his breakfast is the kind of
 * thing that would quietly become load-bearing later.
 *
 * So a transient reason has to persist: one tired morning is not a vacancy, and a worker who has
 * been too spent to get anything out of the place for two full days genuinely is one. This is the
 * milestone's fourth route to a vacancy — "the worker cannot perform the work" — with the honesty
 * that it has to actually last.
 */
export const TRANSIENT_STOPPAGE_HOURS = 48;

export type UnfitReason = 'dead' | 'gone' | 'incapacitated' | 'badly hurt' | 'held' | 'away' | 'spent';
/** The reasons that are a real change in the world rather than a bad hour. Anything outside this
 * set has to persist (`TRANSIENT_STOPPAGE_HOURS`) before it reads as the trade being lost. */
const PERSISTENT_UNFIT = new Set<UnfitReason>(['dead', 'gone', 'incapacitated', 'badly hurt', 'held', 'away']);

/**
 * Why this person cannot work this place right now, or null if they can. Every branch reads
 * canonical state that exists for its own reasons — this function invents nothing and stores
 * nothing. It is also the ONE definition of unfitness in this milestone: the same call decides
 * whether a post has lost its worker and whether a would-be stand-in is in any state to take it
 * on, so the two can never disagree about what "cannot work" means.
 */
export function unfitReason(world: World, p: Person, place?: Place | null): UnfitReason | null {
  if (!p.alive) return 'dead';
  const body = world.primaryBody(p.id);
  if (!body || body.dead) return 'gone';
  if (body.pose === 'downed' || body.subduedUntil > world.physicalTime) return 'incapacitated';
  if (woundSeverity(body) >= SERIOUS_WOUND) return 'badly hurt';
  if (p.custody?.active) return 'held';
  if (place && Math.hypot(body.pos.x - place.inside.x, body.pos.z - place.inside.z) > AWAY_FROM_WORK_METRES) return 'away';
  if (getPhysicalCapability(p, world).currentExertionCapacity < WORK_CAPACITY_FLOOR) return 'spent';
  return null;
}

/** The people this place canonically belongs to as work: its owner and its registered workers,
 * plus anybody whose `workId` names it. Not a label — `workers`/`workId` are written once at
 * world generation from who actually holds the place, and are already read all over this codebase
 * (haul priority, commerce, who a request is raised for). */
export function staffOf(world: World, place: Place): Person[] {
  const ids = new Set<EntityId>(place.workers);
  if (place.ownerId) ids.add(place.ownerId);
  const out: Person[] = [];
  for (const id of ids) { const p = world.person(id); if (p) out.push(p); }
  // Registered ids above preserve dead historical workers where vacancy explanation needs them;
  // the fallback discovery path only needs current workers and must not scan every past person.
  for (const p of world.livingPersons()) if (p.workId === place.id && !ids.has(p.id)) out.push(p);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- the derived post

export interface TradePost {
  place: Place;
  process: TradeProcess;
  /** Everyone this place is canonically worked by, fit or not. */
  staff: Person[];
  /** Those of them who could actually do the work right now. */
  ableStaff: Person[];
  /** Why each unfit staff member is unfit — the human-readable half of the derivation, and what a
   * trace prints when it says WHY the work fell to somebody else. */
  unfit: { person: Person; reason: UnfitReason }[];
  /** Real, currently-unfilled demand for this place's output. */
  openDemand: number;
  /** World-time of the last batch that actually came out of here, if the world still records one. */
  lastOutputAt?: number;
  /** Nobody fit is working it, it is genuinely being asked for output, and none has come. */
  underServed: boolean;
  /** People who are not staff, have got real output out of this place, and are still at it. */
  standIns: WorkStint[];
}

/**
 * Whether the place is producing, and whether anything is asking it to, are read from the world's
 * own record of production requests rather than from any counter this module keeps — requests are
 * canonical, persisted, and bounded by real work, and a counter would be a second truth store for
 * facts the world already holds. See the single pass inside `tradePostAt`.
 */
export function tradePostAt(world: World, place: Place | undefined | null): TradePost | undefined {
  if (!place) return undefined;
  const process = processFor(place.type);
  if (!process) return undefined;
  const staff = staffOf(world, place);
  const ableStaff: Person[] = [];
  const unfit: { person: Person; reason: UnfitReason }[] = [];
  for (const p of staff) {
    const reason = unfitReason(world, p, place);
    if (reason) unfit.push({ person: p, reason }); else ableStaff.push(p);
  }
  // Real demand, and BOTH halves of it are needed. An open production request alone is not
  // enough: a request is raised when stock falls under the reserve and is only ever closed by
  // somebody completing it, so a place that has since been restocked by other means can sit on a
  // stale request indefinitely. Measured on the undisturbed village — the mill held 26 flour, its
  // reserve, for a week, while carrying 16 units of demand raised days earlier, which was enough
  // to make a momentarily tired miller read as a lost trade. So the place must ALSO still be
  // genuinely under its own reserve, read from the same canonical spec that raised the request.
  // COST GATE, and it is the reason this whole layer is affordable. Everything below reads the
  // whole item list and the whole request list, and a place with somebody fit standing in it
  // cannot be under-served whatever those say — so a healthy village pays for none of it.
  // Measured: without this, four full scans of `world.items()`/`world.requests` per productive
  // place per coarse pass added roughly a tenth to the whole test suite's CPU, which was enough to
  // starve a neighbouring test with a five-second budget. `openDemand`/`lastOutputAt` are
  // therefore only meaningful on a post whose staff are all unfit, which is the only case anything
  // reads them in.
  if (ableStaff.length > 0) {
    return { place, process, staff, ableStaff, unfit, openDemand: 0, underServed: false, standIns: standInsAt(world, place.id) };
  }
  const spec = productionSpecs().find(s => s.placeType === place.type && s.resource === process.output);
  const shortOfOutput = !spec || stockAt(world, process.output, place.id) < reserveFor(world, spec, place).trigger;
  let openDemand = 0;
  let demandSince = Number.POSITIVE_INFINITY;
  let last: number | undefined;
  // One pass, not three: open demand, when that demand arose, and when the place last actually
  // produced, all come off the same list.
  if (shortOfOutput) {
    for (const r of world.requests) {
      if (r.type !== 'production' || r.payload.placeId !== place.id || r.payload.resource !== process.output) continue;
      if (r.status === 'open' || r.status === 'accepted') {
        openDemand += r.payload.quantity ?? 0;
        if (r.createdAt < demandSince) demandSince = r.createdAt;
      } else if (r.status === 'completed' && r.completedAt !== undefined && (last === undefined || r.completedAt > last)) {
        last = r.completedAt;
      }
    }
  }
  // How long this place has been FAILING TO ANSWER THE DEMAND IT HAS — not how long since it last
  // produced anything, which is a different and much weaker question. A mill with a full flour bin
  // legitimately stands quiet for days (production is demand-driven; see world/production.ts), and
  // reading that quiet as a stoppage is how an ordinary morning where the miller has not had his
  // breakfast yet turned into "the trade has been lost" on the undisturbed village. So the clock
  // starts at the LATER of the last batch and the moment the oldest standing demand was raised.
  const idleSince = Math.max(last ?? Number.NEGATIVE_INFINITY, demandSince);
  // A workforce that has genuinely been lost is judged on the ordinary window; one that is merely
  // spent has to have left the work undone for far longer before it counts. Note `every`: if any
  // one of them is gone for a persistent reason, the shorter window applies.
  const lostPersistently = unfit.length > 0 && unfit.every(u => PERSISTENT_UNFIT.has(u.reason));
  const idleHours = Number.isFinite(idleSince) ? (world.now - idleSince) / 3600 : 0;
  const stale = idleHours >= (lostPersistently ? STOPPAGE_HOURS : TRANSIENT_STOPPAGE_HOURS);
  return {
    place, process, staff, ableStaff, unfit, openDemand, lastOutputAt: last,
    underServed: openDemand > 0 && stale,
    standIns: standInsAt(world, place.id),
  };
}

function standInsAt(world: World, placeId: EntityId): WorkStint[] {
  if (!world.workStints.length) return EMPTY_STINTS;
  return world.workStints.filter(s => s.placeId === placeId && !s.endedAt);
}
const EMPTY_STINTS: WorkStint[] = [];

/** Every productive place in the world whose work nobody is currently doing. Cheap: one pass over
 * places, and only two of them have a process at all. */
export function underServedPosts(world: World): TradePost[] {
  const out: TradePost[] = [];
  for (const place of world.places()) {
    const post = tradePostAt(world, place);
    if (post?.underServed) out.push(post);
  }
  return out.sort((a, b) => a.place.id.localeCompare(b.place.id));
}

// ---------------------------------------------------------------- may this person work here

export type WorkStanding = 'worker' | 'stand_in';
export interface WorkAuthorization { post: TradePost; standing: WorkStanding; why: string; }

/**
 * May this person get work out of this place, standing where they are standing?
 *
 * Two ways, and no third. Either you work here — the place is yours, or you are on its staff — or
 * the place's work is going undone and you are in a state to do it. The second is not a permission
 * anybody grants: an unattended mill with grain in it, in a village asking for flour, is simply
 * available in a way a working mill with its miller at the stones is not. Nothing here consults
 * occupation, and nothing consults a `WorkStint` (a stint is opened AFTER the first batch, so it
 * could not be the thing that allowed it).
 *
 * Returns null when there is no work here for this person, which is the ordinary answer.
 */
export function workAuthorization(world: World, p: Person, place: Place | undefined | null): WorkAuthorization | null {
  const post = tradePostAt(world, place);
  if (!post) return null;
  if (unfitReason(world, p, post.place)) return null;
  if (post.staff.some(s => s.id === p.id)) return { post, standing: 'worker', why: 'this is my work' };
  if (!post.underServed) return null;
  return {
    post, standing: 'stand_in',
    why: `nobody is working ${post.place.name}${post.unfit.length ? ` (${post.unfit.map(u => `${u.person.name} is ${u.reason}`).join(', ')})` : ''}`,
  };
}

/**
 * Run one batch of this post's process for this worker.
 *
 * A one-line dispatch, and deliberately so: the transforms themselves stay exactly where they
 * were (`world/metabolism.ts`), with the same conservation, the same demand caps and the same
 * physical-input rules they have had since v0.3. This function's only job is to remove the last
 * place where "which transform runs" was answered by looking at what the worker is CALLED.
 *
 * Note there is no capability check here. There does not need to be one: `mill`/`bake` already
 * read the worker's proficiency for their yield, and the caller has already asked
 * `workAuthorization` whether this person may be working here at all.
 */
export function runTradeBatch(world: World, worker: Person, post: TradePost): TransformResult {
  switch (post.process.placeType) {
    case 'mill': return mill(world, worker);
    case 'bakery': return bake(world, worker);
    case 'sawpit': return saw(world, worker);
    // The hearth first, then the pot. Tending it is part of doing the work, not part of being
    // called a cook — which is what it was gated on before (`p.occupation === 'cook'`).
    case 'tavern': tendTavernFire(world, worker); return cook(world, worker);
    default: return { ok: false, produced: 0, consumed: 0 };
  }
}

// ---------------------------------------------------------------- the record of having done it

export function openStintFor(world: World, personId: EntityId, placeId: EntityId): WorkStint | undefined {
  return world.workStints.find(s => s.personId === personId && s.placeId === placeId && !s.endedAt);
}
export function stintsOf(world: World, personId: EntityId): WorkStint[] {
  return world.workStints.filter(s => s.personId === personId);
}

/**
 * Record one real batch by a stand-in, opening the stint if this was their first.
 *
 * Called ONLY after a batch has genuinely produced something — a stint counts work done, not
 * shifts turned up for. The opening event is emitted once, is perceivable (so the village can
 * find out that somebody has taken up the mill the same way it finds out anything else), and
 * carries the canonical events behind the decision so a trace can walk from "Osric began milling"
 * back to "the bakery had no flour" back to "the miller was killed".
 */
export function noteStandInBatch(world: World, p: Person, post: TradePost, o: { reason: string; teacherId?: EntityId; causes?: string[]; skillBefore?: number }): WorkStint {
  const existing = openStintFor(world, p.id, post.place.id);
  if (existing) { existing.batches++; existing.lastBatchAt = world.now; return existing; }
  const stint: WorkStint = {
    id: world.nextId('stint'),
    personId: p.id, placeId: post.place.id, resource: post.process.output,
    startedAt: world.now, lastBatchAt: world.now, batches: 1,
    // The proficiency they had BEFORE the batch that opened this record — the caller passes it,
    // because by the time we are called the batch has already trained them, and a stint whose
    // starting skill silently included its own first lesson would understate what they learned.
    skillAtStart: o.skillBefore ?? skillOf(p, post.process.skill),
    teacherId: o.teacherId,
    reason: o.reason,
  };
  world.workStints.push(stint);
  const body = world.primaryBody(p.id);
  world.emit('work_taken_up', {
    actor: p.id, placeId: post.place.id, pos: body ? { ...body.pos } : { ...post.place.inside },
    causes: o.causes ?? [], significance: 0.45, visibility: 12,
    data: { stintId: stint.id, resource: post.process.output, skill: stint.skillAtStart, teacherId: o.teacherId, reason: o.reason },
    summary: `${p.name} began ${post.process.verb} at ${post.place.name}`,
  });
  return stint;
}

/** The stand-in is done. Closed on the coarse upkeep pass (`maintainWorkStints`), never by
 * whoever happens to walk past. */
export function closeStint(world: World, stint: WorkStint, why: string): void {
  if (stint.endedAt) return;
  stint.endedAt = world.now;
  const p = world.person(stint.personId);
  world.emit('work_given_up', {
    actor: stint.personId, placeId: stint.placeId, category: 'social', significance: 0.25,
    data: { stintId: stint.id, resource: stint.resource, batches: stint.batches, why },
    summary: `${p?.name ?? 'someone'} stopped working ${world.nameOf(stint.placeId)} (${why}, ${stint.batches} batch${stint.batches === 1 ? '' : 'es'})`,
  });
}

/** How long a stand-in may go without producing anything before the stint is over in fact as well
 * as in name. Longer than `STOPPAGE_HOURS` on purpose: somebody who worked yesterday and has not
 * managed a batch today has not given up, they have had a bad day. */
export const STINT_LAPSE_HOURS = 48;

/** Coarse upkeep: end stints that reality has already ended. Three honest reasons only — the
 * place's own worker is fit and back at it, the stand-in has died, or they have simply stopped
 * producing. Nothing here starts a stint; only real work does that. */
export function maintainWorkStints(world: World): void {
  for (const stint of world.workStints) {
    if (stint.endedAt) continue;
    const place = world.place(stint.placeId);
    const person = world.person(stint.personId);
    if (!place || !person) { closeStint(world, stint, 'the work no longer exists'); continue; }
    if (!person.alive) { closeStint(world, stint, 'they died'); continue; }
    const post = tradePostAt(world, place);
    if (post && post.ableStaff.length > 0 && !post.staff.some(s => s.id === stint.personId)) {
      closeStint(world, stint, `${post.ableStaff[0].name} is back at it`);
      continue;
    }
    if (world.now - (stint.lastBatchAt ?? stint.startedAt) > STINT_LAPSE_HOURS * 3600) {
      closeStint(world, stint, 'they stopped coming');
    }
  }
}
