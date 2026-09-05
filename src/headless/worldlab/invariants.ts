import type { World } from '../../sim/core/world';
import type { Finding, InvariantCheck, Observation } from './types';
import { buildPersonTrace } from './trace';

const WORK_GOAL_TYPES = new Set(['work', 'haul', 'chop', 'gather', 'build', 'plant', 'harvest']);

function finding(id: string, category: string, severity: 'warning' | 'failure', message: string, trace?: Finding['trace']): Finding {
  return { id, kind: 'invariant', severity, category, message, trace };
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
];

export function runInvariants(world: World, prev: Observation | null, curr: Observation): Finding[] {
  const out: Finding[] = [];
  for (const inv of INVARIANTS) out.push(...inv.check(world, prev, curr));
  return out;
}
