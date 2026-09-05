import type { World } from '../../sim/core/world';
import type { EntityId } from '../../sim/core/types';
import { SECONDS_PER_DAY } from '../../sim/core/time';
import type { Trace, TraceStep } from './types';

/**
 * §6 "Focused causal traces": a compact, bounded timeline built ONLY from real canonical
 * `world.events` (never invented) plus a live snapshot of current mind/task state — never a full
 * event-log dump. Answers "what should the developer investigate next?" by keeping only the
 * events that actually involve the subject, most recent first, capped at `maxSteps`.
 */
const MAX_STEPS = 14;

function dayOf(world: World, tick: number, worldStart: number): number {
  return Math.round(((tick - worldStart) / SECONDS_PER_DAY) * 10) / 10;
}

/** A compact causal trace for one PERSON: their own recent actor/target events (goal changes,
 * work, interruptions, conflicts, ...) plus their current live goal/plan/needs snapshot. */
export function buildPersonTrace(world: World, worldStart: number, personId: EntityId, id: string, title: string): Trace {
  const p = world.person(personId);
  const events = world.events
    .filter(e => e.actor === personId || e.target === personId)
    .sort((a, b) => a.tick - b.tick)
    .slice(-MAX_STEPS);
  const steps: TraceStep[] = events.map(e => ({ atWorldDays: dayOf(world, e.tick, worldStart), label: e.summary }));
  if (p) {
    const g = p.mind.goal;
    steps.push({
      atWorldDays: dayOf(world, world.now, worldStart),
      label: `[current state] goal=${g ? `${g.type} (${g.reasons.join('; ') || 'no stated reason'})` : 'none'}; `
        + `plan=${p.mind.plan.map(a => a.type).join(' -> ') || 'empty'}; `
        + `needs: energy=${p.physiology.energy.toFixed(2)} hydration=${p.physiology.hydration.toFixed(2)} fatigue=${p.physiology.fatigue.toFixed(2)} sleepDebt=${p.physiology.sleepDebt.toFixed(2)}h; `
        + `alive=${p.alive}; inventory=[${p.inventory.map(id2 => world.nameOf(id2)).join(', ')}]`,
    });
  }
  return { id, title, subjectName: p ? p.name : world.nameOf(personId), steps };
}

/** A compact causal trace anchored on a PLACE (e.g. a stalled construction site, an idle mill) —
 * every real event that happened there, most recent first, capped. */
export function buildPlaceTrace(world: World, worldStart: number, placeId: EntityId, id: string, title: string): Trace {
  const place = world.place(placeId);
  const events = world.events
    .filter(e => e.placeId === placeId)
    .sort((a, b) => a.tick - b.tick)
    .slice(-MAX_STEPS);
  const steps: TraceStep[] = events.map(e => ({ atWorldDays: dayOf(world, e.tick, worldStart), label: e.summary }));
  return { id, title, subjectName: place ? place.name : world.nameOf(placeId), steps };
}

export function formatTrace(t: Trace): string {
  const lines = [`${t.id} — ${t.title}`, t.subjectName];
  for (const s of t.steps) lines.push(`  Day ${s.atWorldDays.toFixed(1).padStart(6)}   ${s.label}`);
  return lines.join('\n');
}
