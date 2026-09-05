import type { World } from '../../sim/core/world';
import type { WorldEvent } from '../../sim/core/types';
import type { Finding, InvariantCheck, Observation } from './types';
import { buildPersonTrace } from './trace';
import { detectAnomalies } from '../../sim/telemetry/anomaly';

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
      for (const it of world.items()) if (it.ownerId && !world.person(it.ownerId)) out.push(finding('WL-ORPHAN-OWNER', 'economy', 'failure', `Item ${it.name} (${it.id}) claims ownerId ${it.ownerId}, but no such person exists.`));
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
        if (holder && !holder.controlled) out.push(finding('WL-NPC-HOLDS-INERT-COINS', 'economy', 'warning',
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
];

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
