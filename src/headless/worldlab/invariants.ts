import { isExternallyControlled } from '../../sim/runtime/controllers';
import type { World } from '../../sim/core/world';
import type { Vec3, WorldEvent } from '../../sim/core/types';
import { DAILY_LOCAL_RANGE, near } from '../../sim/world/locality';
import type { Finding, InvariantCheck, Observation } from './types';
import { buildPersonTrace } from './trace';
import { detectAnomalies } from '../../sim/telemetry/anomaly';
import { householdConsistencyErrors } from '../../sim/world/household';

const WORK_GOAL_TYPES = new Set(['work', 'haul', 'chop', 'gather', 'build', 'plant', 'harvest']);

function finding(id: string, category: string, severity: 'warning' | 'failure', message: string, trace?: Finding['trace']): Finding {
  // Every check in this file is, by the v0.8 §21 taxonomy, an integrity check: a property that
  // must never be false, checked at every probe — see types.ts's `FindingClass` doc.
  return { id, kind: 'invariant', class: 'integrity', severity, category, message, trace };
}

/** §4 invariants: "always true" properties of canonical state. Each check is a pure read over
 * live `World` (plus, where useful, the previous probe's `Observation` for a delta) — never a
 * repair, never a mutation. A concrete, currently-checkable subset of the invariants named in
 * the milestone brief; the remainder (full production-input conservation, unknown-actor
 * identification, player-UI-does-not-mutate-canonical-state) are documented in
 * docs/WORLDLAB.md as not yet mechanically checked rather than silently skipped.
 */
export const INVARIANTS: InvariantCheck[] = [
  {
    id: 'no-negative-wealth',
    category: 'economy',
    description: 'No person ever holds negative wealth (every payment path caps at the payer\'s actual balance).',
    check: (world) => {
      const out: Finding[] = [];
      for (const p of world.persons()) {
        if (p.wealth < -0.001) out.push(finding('WL-NEG-WEALTH', 'economy', 'failure', `${p.name} has negative wealth (${p.wealth}) — a payment path is not capping at the payer's balance.`, buildPersonTrace(world, world.now, p.id, 'WL-NEG-WEALTH', 'negative wealth')));
      }
      return out;
    },
  },
  {
    id: 'living-index-consistency', category: 'identity',
    description: 'Living/active indices exactly match canonical person/body life state.',
    check: (world) => world.livingIndexErrors().map(message => finding('WL-LIVING-INDEX', 'identity', 'failure', message)),
  },
  {
    id: 'household-consistency', category: 'social',
    description: 'Every household membership is reciprocal and contains only living people.',
    check: (world) => householdConsistencyErrors(world).map(message => finding('WL-HOUSEHOLD', 'social', 'failure', message)),
  },
  {
    id: 'currency-conservation',
    category: 'economy',
    description: 'Total currency (wealth + carried coin items) never increases between probes, and only ever decreases by the explicit, tallied supply-cost sink.',
    check: (world, prev, curr) => {
      if (!prev) return [];
      const expectedSink = curr.summary.circulation.supplyCostAmount - prev.summary.circulation.supplyCostAmount;
      const actualDelta = curr.totalCurrency - prev.totalCurrency;
      // actualDelta should equal -(expectedSink) (within floating-point/rounding tolerance).
      // A POSITIVE unexplained delta (currency appearing) is always a failure; a larger-than-
      // explained negative delta is reported as a warning (an undocumented sink is a smell, but
      // not proof of currency being destroyed incorrectly the way appearing currency is proof of
      // creation).
      const unexplained = actualDelta + expectedSink;
      if (unexplained > 0.5) return [finding('WL-CURRENCY-CREATED', 'economy', 'failure', `Total currency increased by ${unexplained.toFixed(2)} silver between day ${prev.atWorldDays} and day ${curr.atWorldDays} with no tracked source (wealth+coins ${prev.totalCurrency}->${curr.totalCurrency}, supply-cost sink only accounts for ${expectedSink.toFixed(2)}).`)];
      if (unexplained < -0.5) return [finding('WL-CURRENCY-LEAK', 'economy', 'warning', `Total currency decreased by ${(-unexplained).toFixed(2)} silver more than the tracked supply-cost sink explains between day ${prev.atWorldDays} and day ${curr.atWorldDays} — an untracked sink may exist.`)];
      return [];
    },
  },
  {
    id: 'inventory-holder-agreement',
    category: 'logistics',
    description: 'Every item\'s holderId agrees with exactly one person\'s inventory list (no item held by nobody it claims, no item held by two people).',
    check: (world) => {
      const out: Finding[] = [];
      const holdersOf = new Map<string, string[]>();
      for (const p of world.persons()) for (const itemId of p.inventory) holdersOf.set(itemId, [...(holdersOf.get(itemId) ?? []), p.id]);
      for (const [itemId, holders] of holdersOf) if (holders.length > 1) out.push(finding('WL-DUAL-HOLD', 'logistics', 'failure', `Item ${world.nameOf(itemId)} appears in more than one person's inventory: ${holders.map(h => world.nameOf(h)).join(', ')}.`));
      for (const it of world.items()) {
        if (!it.holderId) continue;
        const holder = world.person(it.holderId);
        if (!holder) { out.push(finding('WL-ORPHAN-HOLDER', 'logistics', 'failure', `Item ${it.name} (${it.id}) claims holderId ${it.holderId}, but no such person exists.`)); continue; }
        if (!holder.inventory.includes(it.id)) out.push(finding('WL-HOLDER-MISMATCH', 'logistics', 'failure', `Item ${it.name} claims holderId ${holder.name}, but is not in ${holder.name}'s inventory list.`, buildPersonTrace(world, world.now, holder.id, 'WL-HOLDER-MISMATCH', 'inventory/holder mismatch')));
      }
      return out;
    },
  },
  {
    id: 'dead-do-not-work',
    category: 'cognition',
    description: 'A dead person never holds an active work-type goal or a non-empty plan.',
    check: (world) => {
      const out: Finding[] = [];
      for (const p of world.persons()) {
        if (p.alive) continue;
        if (p.mind.goal && WORK_GOAL_TYPES.has(p.mind.goal.type)) out.push(finding('WL-DEAD-WORKING', 'cognition', 'failure', `${p.name} is dead but still holds an active '${p.mind.goal.type}' goal.`, buildPersonTrace(world, world.now, p.id, 'WL-DEAD-WORKING', 'dead entity still working')));
        else if (p.mind.plan.length) out.push(finding('WL-DEAD-PLAN', 'cognition', 'warning', `${p.name} is dead but still has a non-empty action plan (${p.mind.plan.map(a => a.type).join(', ')}).`));
      }
      return out;
    },
  },
  {
    id: 'haul-cargo-conserved',
    category: 'logistics',
    description: 'An in-transit haul task\'s cargo item, if it materialized one, is actually held by the claimant; delivered/carried never exceed the requested quantity.',
    check: (world) => {
      const out: Finding[] = [];
      for (const t of world.haulTasks) {
        if (t.delivered > t.quantity + 0.001) out.push(finding('WL-HAUL-OVERDELIVER', 'logistics', 'failure', `Haul task ${t.id} (${t.resource}) delivered ${t.delivered} but only ${t.quantity} was requested.`));
        if (t.carried > t.quantity + 0.001) out.push(finding('WL-HAUL-OVERCARRY', 'logistics', 'warning', `Haul task ${t.id} (${t.resource}) is carrying ${t.carried} against a ${t.quantity} request.`));
        if (t.status === 'in_transit' && t.cargoItemId) {
          const item = world.item(t.cargoItemId);
          if (item && t.claimantId && item.holderId !== t.claimantId) out.push(finding('WL-HAUL-CARGO-MISMATCH', 'logistics', 'failure', `Haul task ${t.id}'s cargo item is not actually held by its claimant ${world.nameOf(t.claimantId)}.`, t.claimantId ? buildPersonTrace(world, world.now, t.claimantId, 'WL-HAUL-CARGO-MISMATCH', 'haul cargo mismatch') : undefined));
        }
      }
      return out;
    },
  },
  {
    id: 'ownership-references-real-entities',
    category: 'economy',
    description: 'An item\'s ownerId, when set, always names a person that actually exists.',
    check: (world) => {
      const out: Finding[] = [];
      for (const it of world.items()) if (it.ownerId && !world.person(it.ownerId) && world.get(it.ownerId)?.kind !== 'household') out.push(finding('WL-ORPHAN-OWNER', 'economy', 'failure', `Item ${it.name} (${it.id}) claims ownerId ${it.ownerId}, but no such person or household exists.`));
      return out;
    },
  },
  {
    id: 'spendable-currency-is-real',
    category: 'economy',
    description: 'Spendable wealth never falls while total currency (wealth + coins) holds steady — that signature means money is being converted into a form nothing can spend, not conserved.',
    // v0.8 §P0-A/B (independent audit §4.1): the pre-existing `currency-conservation` check
    // above only asks "is the loss explained?", which a robbery converting wealth into an inert
    // coin item satisfies trivially (the coin item IS the explanation). This asks the question
    // that actually matters: even when every silver is accounted for, is it still SPENDABLE?
    // `executeRobbery` (mind/agent.ts) was the one place this could happen; it has been fixed to
    // transfer wealth directly rather than minting a coin item — this check is the regression
    // guard, not the fix itself.
    check: (world, prev, curr) => {
      if (!prev) return [];
      const spendableDrop = prev.economy.spendableWealth - curr.economy.spendableWealth;
      const totalDrop = prev.totalCurrency - curr.totalCurrency;
      const convertedToInert = spendableDrop - totalDrop; // > 0 means spendable fell more than total currency did
      if (convertedToInert <= 0.5) return [];
      return [finding('WL-CURRENCY-INERT-CONVERSION', 'economy', 'failure',
        `${convertedToInert.toFixed(2)} silver of SPENDABLE wealth disappeared between day ${prev.atWorldDays} and day ${curr.atWorldDays} while total currency `
        + `(wealth+coins) only fell by ${totalDrop.toFixed(2)} — money is being converted into a physical coin item no NPC economic action can spend `
        + `(spendable ${prev.economy.spendableWealth}->${curr.economy.spendableWealth}, coins ${prev.economy.coinItems}->${curr.economy.coinItems}).`)];
    },
  },
  {
    id: 'no-inert-currency-growth',
    category: 'economy',
    description: 'No non-player person ever holds a physical coins item — every NPC economic action reads Person.wealth, never a coin Item, so a held coin item is dead money.',
    check: (world) => {
      const out: Finding[] = [];
      for (const it of world.items()) {
        if (it.type !== 'coins' || !it.holderId || it.quantity <= 0) continue;
        const holder = world.person(it.holderId);
        if (holder && !isExternallyControlled(holder)) out.push(finding('WL-NPC-HOLDS-INERT-COINS', 'economy', 'warning',
          `${holder.name} (${holder.occupation}) is holding ${it.quantity} physical silver coins as an item — no NPC purchase path can spend a coin item, only Person.wealth. This money is inert.`));
      }
      return out;
    },
  },
  {
    id: 'no-false-theft-belief',
    category: 'social',
    description: 'An item legitimately assigned to an open haul task and carried by its authorized claimant never generates a missing/stolen belief in its owner\'s mind.',
    // v0.8 §P0-F regression guard for the fix in mind/agent.ts's strategic() item_missing
    // inference — checks LIVE state (never `world.events`, which the independent audit showed
    // drops item_missing's significance-0.45 events well before a long run's compaction floor).
    check: (world) => {
      const out: Finding[] = [];
      for (const t of world.haulTasks) {
        if (t.status !== 'claimed' && t.status !== 'in_transit') continue;
        if (!t.cargoItemId) continue;
        const cargo = world.item(t.cargoItemId);
        if (!cargo || !cargo.ownerId) continue;
        const owner = world.person(cargo.ownerId);
        if (!owner) continue;
        const falselyBelievesMissing = !!owner.knowledge[`missing:${cargo.id}`];
        const falseDesire = owner.desires.some(d => d.type === 'recover_item' && d.targetId === cargo.id && !d.fulfilled);
        if (falselyBelievesMissing || falseDesire) out.push(finding('WL-FALSE-THEFT-BELIEF', 'social', 'failure',
          `${owner.name} believes ${cargo.name} is missing/stolen, but it is legitimate in-transit haul cargo (task ${t.id}) carried by its authorized claimant ${t.claimantId ? world.nameOf(t.claimantId) : '?'}.`,
          buildPersonTrace(world, world.now, owner.id, 'WL-FALSE-THEFT-BELIEF', 'false theft belief on haul cargo')));
      }
      return out;
    },
  },
  {
    /**
     * LOCALITY — nothing an agent's life resolves to is outside the locality they live in.
     *
     * The claim this exists to prove, in the single-village world where it is trivially true,
     * BEFORE a second settlement makes it load-bearing. Ashford has exactly one mill, one bakery,
     * one tavern, so `world.places().find(p => p.type === X)` — "the first place of this type
     * anywhere in the world" — was right by accident at roughly thirty call sites.
     * `world/locality.ts` replaced those with questions asked from somewhere; this check is what
     * says the answers are right, and it is what will fail loudly the first time a second
     * settlement is generated and something still reaches across the map.
     *
     * TWO SEPARATE CLAIMS, both required:
     *
     *  - REACHABILITY, proven against the real navigator (`physical/nav.ts`'s `findPath`) rather
     *    than against a radius. Nothing an agent has committed to may be somewhere they cannot
     *    physically walk to. This is affordable here and nowhere else: a path query per person per
     *    probe is fine, the same query per person per TICK is not — which is exactly why
     *    `world/locality.ts` resolves by distance in the hot path and is CHECKED by path here.
     *  - LOCALITY, that the reachable thing is also within the reach of an ordinary day
     *    (`DAILY_LOCAL_RANGE`). A post on the far side of a continent is walkable in principle
     *    and is still not somebody's work.
     *
     * Judged against where the person LIVES rather than where they happen to be standing: that is
     * what locality means, and judging a haul by the hauler's current position would pass every
     * journey once it was already under way.
     */
    id: 'locality-of-commitments', category: 'logistics',
    description: "Every place and person an agent's goal, plan, work post or haul task resolves to is reachable from where they live, and within an ordinary day's reach of it.",
    check: (world) => {
      const out: Finding[] = [];
      // WHICH WALKABLE REGION, not "is this exact cell pathable".
      //
      // The first version of this asked `nav.findPath(home, target)` and it asked the wrong
      // question. A `provide` goal targets where a person is standing THIS instant, and somebody
      // standing on the rim of the village well occupies a cell A* will not route to — so it
      // reported that Elder Godwin could not reach Rowan Ashford, who was ten metres away in the
      // middle of Godwin's own village. That is a real property of the world (the goto fails, the
      // goal fails, and `stuck_agent` already watches for it) but it is not a locality violation
      // and must not be reported as one.
      //
      // Locality is about which connected piece of walkable ground you are on, so that is what is
      // measured: one flood fill over the navigator's own walkability, and two positions are in
      // the same locality when they land in the same region. It answers exactly the question a
      // second settlement across a river or a mountain would make load-bearing, it cannot be
      // defeated by an A* iteration budget the way a per-pair path query can, and it costs one
      // pass over the heightfield per probe rather than a search per commitment.
      const region = walkableRegions(world);
      /**
       * Can somebody standing on `from`'s ground get to where `to` is?
       *
       * Not "is `to`'s exact cell in my region", because a target is very often a body rather
       * than a floor tile, and a body can be standing somewhere its own cell is a walkable island
       * — on the rim of the village well (floor height 19 against the village's 14), on a market
       * stall's counter (17). Measured: asking about the exact cell reported that Elder Godwin
       * could not reach Rowan Ashford, who was ten metres away in the middle of Godwin's own
       * square. Getting to somebody standing on the well is standing next to the well.
       *
       * So the question is whether MY OWN region reaches to within a few strides of the target.
       * Sixteen metres is comfortably inside one settlement and nowhere near another, and the
       * scan is bounded by that square.
       */
      const REACH_MARGIN = 16;
      const regionsAround = (pos: Vec3): Set<number> => {
        const out = new Set<number>();
        const cx = Math.floor(pos.x), cz = Math.floor(pos.z);
        for (let dx = -REACH_MARGIN; dx <= REACH_MARGIN; dx++) {
          for (let dz = -REACH_MARGIN; dz <= REACH_MARGIN; dz++) {
            const id = region.at(cx + dx, cz + dz);
            if (id >= 0) out.add(id);
          }
        }
        return out;
      };
      // Symmetric, because the walkable-island problem is not only a property of targets. A
      // house's own `inside` is sometimes a raised tile too (seed 1337: Maud Penny's is at floor
      // height 16 against her village's 14), and judging her from that one cell said she could not
      // walk to her own square. Two positions are in one locality when the ground around them
      // shares a region.
      const reachable = (from: Vec3, to: Vec3): boolean => {
        const here = regionsAround(from);
        if (!here.size) return true; // nothing navigable near the asker at all: unplaceable, not a violation
        for (const id of regionsAround(to)) if (here.has(id)) return true;
        return false;
      };
      for (const person of world.livingPersons()) {
        if (isExternallyControlled(person)) continue;
        const home = world.place(person.homeId ?? '')?.inside
          ?? world.place(person.workId ?? '')?.inside
          ?? world.primaryBody(person.id)?.pos;
        if (!home) continue;
        // Everything this person's life currently points at, each with a plain-words name, so a
        // failure says WHICH commitment reached out of the locality rather than only that one did.
        const commitments: { what: string; pos: Vec3 | undefined; alternates?: Vec3[] }[] = [];
        const placePos = (id: string | null | undefined) => (id ? world.place(id)?.inside : undefined);
        // Where somebody actually STANDS at a place. A market stall's own `inside` cell is the
        // stall itself and is not walkable — nobody stands in the counter — so a bare path query
        // to it correctly reports "no route" while Mara sells bread there every morning. The
        // anchors are the same positions `mind/agent.ts`'s plans resolve to, so asking about them
        // is asking the question the world itself asks.
        const approaches = (id: string | null | undefined): Vec3[] => (id ? world.place(id)?.anchors.map(a => a.pos) ?? [] : []);
        commitments.push({ what: 'their work post', pos: placePos(person.workId), alternates: approaches(person.workId) });
        const goal = person.mind.goal;
        if (goal) {
          commitments.push({ what: `their goal (${goal.type})`, pos: goal.targetPos ?? placePos(goal.targetPlace), alternates: goal.targetPos ? [] : approaches(goal.targetPlace) });
          if (goal.targetEntity) {
            const target = world.person(goal.targetEntity);
            commitments.push({
              what: `the ${goal.type} target ${world.nameOf(goal.targetEntity)}`,
              pos: target ? world.primaryBody(target.id)?.pos : placePos(goal.targetEntity),
            });
          }
        }
        for (const step of person.mind.plan) {
          if (step.status === 'done' || step.status === 'failed') continue;
          commitments.push({ what: `a ${step.type} step in their plan`, pos: step.pos ?? placePos(step.placeId), alternates: step.pos ? [] : approaches(step.placeId) });
        }
        for (const task of world.haulTasks) {
          if (task.claimantId !== person.id) continue;
          if (task.status === 'delivered' || task.status === 'failed' || task.status === 'cancelled') continue;
          commitments.push({ what: `the haul they took on, from ${world.nameOf(task.sourcePlaceId)}`, pos: placePos(task.sourcePlaceId), alternates: approaches(task.sourcePlaceId) });
          commitments.push({ what: `the haul they took on, to ${world.nameOf(task.destPlaceId)}`, pos: placePos(task.destPlaceId), alternates: approaches(task.destPlaceId) });
        }
        for (const { what, pos, alternates } of commitments) {
          if (!pos) continue;
          if (![pos, ...(alternates ?? [])].some(candidate => reachable(home, candidate))) {
            out.push(finding('WL-LOCALITY-UNREACHABLE', 'logistics', 'failure',
              `${person.name} has committed to something they cannot walk to: ${what} is at (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}) and no path exists from ${world.nameOf(person.homeId)}.`,
              buildPersonTrace(world, world.now, person.id, 'WL-LOCALITY-UNREACHABLE', 'unreachable commitment')));
          } else if (!near(home, pos)) {
            out.push(finding('WL-LOCALITY-DISTANT', 'logistics', 'failure',
              `${person.name}'s locality does not extend to ${what}: ${Math.hypot(pos.x - home.x, pos.z - home.z).toFixed(0)}m from ${world.nameOf(person.homeId)}, past the ${DAILY_LOCAL_RANGE}m an ordinary day reaches — a commitment resolved outside their own settlement.`,
              buildPersonTrace(world, world.now, person.id, 'WL-LOCALITY-DISTANT', 'commitment outside locality')));
          }
        }
      }
      return out;
    },
  },
];

/**
 * The connected regions of walkable ground, labelled in one pass.
 *
 * Deliberately here in the harness rather than on `Navigator`: it is a checking tool, it is paid
 * for once per probe rather than per tick, and the simulation itself has no business asking the
 * question. Reads only `isWalkable` and the step-height rule A* itself uses, so two cells are in
 * the same region exactly when a walker could get between them.
 */
function walkableRegions(world: World): { at(x: number, z: number): number } {
  const nav = world.nav;
  const W = world.grid.W, D = world.grid.D;
  const label = new Int32Array(W * D).fill(-1);
  const stack: number[] = [];
  let next = 0;
  const walkable = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < D && nav.isWalkable(x, z);
  for (let sx = 0; sx < W; sx++) {
    for (let sz = 0; sz < D; sz++) {
      const start = sx * D + sz;
      if (label[start] >= 0 || !walkable(sx, sz)) continue;
      const id = next++;
      label[start] = id; stack.push(start);
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = (cur / D) | 0, cz = cur % D;
        const cy = nav.floorY(cx, cz);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!walkable(nx, nz)) continue;
          const ni = nx * D + nz;
          if (label[ni] >= 0) continue;
          if (Math.abs(nav.floorY(nx, nz) - cy) > 1) continue; // the same step-height rule A* uses
          label[ni] = id; stack.push(ni);
        }
      }
    }
  }
  return { at: (x, z) => (x >= 0 && z >= 0 && x < W && z < D ? label[x * D + z] : -1) };
}

export function runInvariants(world: World, prev: Observation | null, curr: Observation): Finding[] {
  const out: Finding[] = [];
  for (const inv of INVARIANTS) out.push(...inv.check(world, prev, curr));
  return out;
}

/**
 * v0.8 §P0-I (independent audit §4.7): `sim/telemetry/anomaly.ts`'s `detectAnomalies` has always
 * been able to notice things like dangling causal references, invalid entity ids, and epistemic
 * leaks — but WorldLab never actually LOOKED at what it found: `Observation.anomalies` was pure
 * observational data, collected every probe and then never consulted again, so `verdictOf`
 * (scorecard.ts) could report PASS/21-of-21 on a run that `detectAnomalies` itself had already
 * flagged as structurally broken. This converts the subset of anomaly types that are genuinely
 * unambiguous structural-integrity defects (never a legitimate behavioral pattern, unlike e.g.
 * `event_spam`/`goal_churn`, which can be real activity — see `HIGH_FREQUENCY_SEMANTIC`) into
 * real `Finding`s, once per run, over the FINAL world + the fullest available event history —
 * exactly the shape a liveness check already uses. `stuck_agent` is kept at 'warning': a
 * clustered path-failure run CAN legitimately mean "there is no route" (a map-edge or
 * under-construction area), not only a pathing bug, so it should degrade a run rather than fail
 * it outright.
 */
const STRUCTURAL_ANOMALY_SEVERITY: Partial<Record<string, 'warning' | 'failure'>> = {
  dangling_cause: 'failure',
  invalid_entity_reference: 'failure',
  epistemic_leak: 'failure',
  surrender_or_custody_ignored: 'failure',
  stuck_agent: 'warning',
};
export function structuralFindingsFrom(world: World, eventSource?: WorldEvent[]): Finding[] {
  const anomalies = detectAnomalies(world, {}, eventSource);
  const out: Finding[] = [];
  for (const a of anomalies) {
    const severity = STRUCTURAL_ANOMALY_SEVERITY[a.type];
    if (!severity) continue;
    const who = a.entity ? world.nameOf(a.entity) : undefined;
    out.push({
      id: `WL-ANOMALY-${a.type.toUpperCase()}`, kind: 'invariant', class: 'integrity', severity, category: 'cognition',
      message: `${who ? `${who}: ` : ''}${a.type.replace(/_/g, ' ')} (${a.occurrences} occurrence(s), ${JSON.stringify(a.data)})`,
      trace: a.entity ? buildPersonTrace(world, world.now, a.entity, `WL-ANOMALY-${a.type.toUpperCase()}`, a.type) : undefined,
    });
  }
  return out;
}
