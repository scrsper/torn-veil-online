import type { World } from '../../sim/core/world';
import { SECONDS_PER_HOUR } from '../../sim/core/time';
import type { Finding, LivenessCheck, Observation } from './types';
import { buildPersonTrace, buildPlaceTrace } from './trace';

function finding(id: string, category: string, message: string, trace?: Finding['trace']): Finding {
  return { id, kind: 'liveness', severity: 'failure', category, message, trace };
}

/**
 * §4/§8 "bounded progress, not brittle exact counts": scans a time series for the FIRST window
 * of at least `boundHours` where `active(obs)` held throughout but the cumulative counter
 * `cumulative(obs)` never advanced — i.e. NOT YET (still inside the bound, nothing reported)
 * became STUCK (bound exceeded with the precondition still true). Returns null if no such
 * window exists (progress happened before the bound, or the precondition never held long
 * enough to judge — both are "not yet", not a finding).
 */
function findStuckWindow(series: Observation[], boundHours: number, active: (o: Observation) => boolean, cumulative: (o: Observation) => number): { start: Observation; end: Observation } | null {
  for (let i = 0; i < series.length; i++) {
    if (!active(series[i])) continue;
    for (let j = i + 1; j < series.length; j++) {
      const spanHours = (series[j].atWorldSeconds - series[i].atWorldSeconds) / SECONDS_PER_HOUR;
      if (spanHours < boundHours) continue;
      const allActive = series.slice(i, j + 1).every(active);
      if (allActive && cumulative(series[j]) <= cumulative(series[i])) return { start: series[i], end: series[j] };
      break; // precondition broke, or already made progress, before the bound — move to next i
    }
  }
  return null;
}

export const LIVENESS: LivenessCheck[] = [
  {
    id: 'mature-wheat-eventually-harvested',
    category: 'agriculture',
    boundHours: 48,
    description: 'Mature wheat + available labor eventually gets harvested.',
    check: (_world, series) => {
      const stuck = findStuckWindow(series, 48, o => o.summary.metabolism.crops.mature > 0, o => o.summary.metabolism.cropsHarvested);
      if (!stuck) return [];
      return [finding('WL-CROP-UNHARVESTED', 'agriculture', `${stuck.start.summary.metabolism.crops.mature} mature crop(s) went unharvested from day ${stuck.start.atWorldDays} to day ${stuck.end.atWorldDays} (${((stuck.end.atWorldSeconds - stuck.start.atWorldSeconds) / SECONDS_PER_HOUR).toFixed(0)}h) despite mature crops being continuously present.`)];
    },
  },
  {
    id: 'grain-flour-bread-chain-progresses',
    category: 'production',
    boundHours: 36,
    description: 'Grain + a functioning mill/bakery + labor eventually turns into flour/bread (resource transforms keep happening while raw stock sits idle).',
    check: (_world, series) => {
      const stuck = findStuckWindow(series, 36, o => (o.summary.metabolism.stock.grain ?? 0) > 0 || (o.summary.metabolism.stock.flour ?? 0) > 0, o => o.summary.metabolism.resourceTransforms);
      if (!stuck) return [];
      return [finding('WL-PRODUCTION-IDLE', 'production', `Grain/flour sat available (grain=${stuck.start.summary.metabolism.stock.grain}, flour=${stuck.start.summary.metabolism.stock.flour}) with zero resource transforms from day ${stuck.start.atWorldDays} to day ${stuck.end.atWorldDays} — a mill or bakery may be idle despite available inputs.`)];
    },
  },
  {
    id: 'hungry-population-eventually-eats',
    category: 'survival',
    boundHours: 24,
    description: 'Someone eats at least once every 24h while the population is alive (a total absence of eating for a full day, in a village with food, indicates the food-acquisition loop is stuck).',
    check: (_world, series) => {
      const stuck = findStuckWindow(series, 24, o => o.alivePopulation > 0, o => o.summary.metabolism.mealsEaten);
      if (!stuck) return [];
      return [finding('WL-NO-EATING', 'survival', `No meals were eaten anywhere in the village from day ${stuck.start.atWorldDays} to day ${stuck.end.atWorldDays} despite ${stuck.start.alivePopulation} living resident(s).`)];
    },
  },
  {
    id: 'thirsty-population-eventually-drinks',
    category: 'survival',
    boundHours: 24,
    description: 'Someone drinks at least once every 24h while the population is alive.',
    check: (_world, series) => {
      const stuck = findStuckWindow(series, 24, o => o.alivePopulation > 0, o => o.summary.metabolism.drinks);
      if (!stuck) return [];
      return [finding('WL-NO-DRINKING', 'survival', `No one drank water anywhere in the village from day ${stuck.start.atWorldDays} to day ${stuck.end.atWorldDays} despite ${stuck.start.alivePopulation} living resident(s).`)];
    },
  },
  {
    id: 'haul-tasks-resolve',
    category: 'logistics',
    boundHours: 24,
    description: 'A loaded haul task eventually gets delivered, released, or explicitly failed — not stuck in transit indefinitely.',
    check: (world) => {
      const out: Finding[] = [];
      for (const t of world.haulTasks) {
        if (t.status !== 'in_transit' && t.status !== 'claimed') continue;
        const ageHours = (world.now - t.updatedAt) / SECONDS_PER_HOUR;
        if (ageHours >= 24) out.push(finding('WL-HAUL-STUCK', 'logistics', `Haul task ${t.id} (${t.resource}, ${t.reason}) has been '${t.status}' for ${ageHours.toFixed(0)}h with no resolution.`, t.claimantId ? buildPersonTrace(world, world.now - ageHours * SECONDS_PER_HOUR, t.claimantId, 'WL-HAUL-STUCK', 'stale haul task') : undefined));
      }
      return out;
    },
  },
  {
    id: 'construction-progresses-with-materials-and-workers',
    category: 'construction',
    boundHours: 48,
    description: 'Construction with delivered materials and assigned workers eventually advances (laborPct increases).',
    check: (world, series) => {
      const out: Finding[] = [];
      if (series.length < 2) return out;
      const byName = (o: Observation) => new Map(o.summary.logistics.construction.details.map(d => [d.name, d]));
      for (let i = 0; i < series.length; i++) {
        const start = byName(series[i]);
        for (let j = i + 1; j < series.length; j++) {
          const spanHours = (series[j].atWorldSeconds - series[i].atWorldSeconds) / SECONDS_PER_HOUR;
          if (spanHours < 48) continue;
          const end = byName(series[j]);
          for (const [name, d0] of start) {
            const d1 = end.get(name);
            if (!d1 || d0.status === 'complete' || d1.status === 'complete') continue;
            const materialsComplete = Object.entries(d0.required).every(([res, need]) => (d0.delivered[res] ?? 0) >= need);
            if (materialsComplete && d0.workers > 0 && d1.laborPct <= d0.laborPct) {
              const site = world.places().find(p => p.name === name);
              out.push(finding('WL-CONSTRUCTION-STALLED', 'construction', `${name} has had complete materials and ${d0.workers} assigned worker(s) since day ${series[i].atWorldDays}, but labour progress has not advanced (${d0.laborPct}% -> ${d1.laborPct}%) by day ${series[j].atWorldDays}.`, site ? buildPlaceTrace(world, 0, site.id, 'WL-CONSTRUCTION-STALLED', 'construction stalled') : undefined));
            }
          }
          break;
        }
      }
      return out;
    },
  },
  {
    id: 'recovery-request-eventually-fulfills-and-pays',
    category: 'social',
    boundHours: 72,
    description: 'An active recover_item desire, once a valid return is physically possible, eventually gets fulfilled and paid — not left open indefinitely once the item is back with the requester.',
    check: (world) => {
      const out: Finding[] = [];
      for (const p of world.persons()) {
        for (const d of p.desires) {
          if (d.type !== 'recover_item' || d.fulfilled || !d.targetId) continue;
          const item = world.item(d.targetId);
          // The item is physically WITH the requester already but the desire is still open —
          // that's a real stuck state (giveItem should have fulfilled it on arrival).
          if (item && item.holderId === p.id) out.push(finding('WL-RECOVERY-UNPAID', 'social', `${p.name}'s recover_item request for ${item.name} is unfulfilled even though the item is already in their possession.`, buildPersonTrace(world, 0, p.id, 'WL-RECOVERY-UNPAID', 'recovery not finalized')));
        }
      }
      return out;
    },
  },
  {
    id: 'conflicts-eventually-resolve',
    category: 'social',
    boundHours: 12,
    description: 'An active conflict eventually disengages, is suspended, or resolves — it does not stay "active" (blows/pursuit) indefinitely.',
    check: (world) => {
      const out: Finding[] = [];
      for (const c of world.conflicts) {
        if (c.status !== 'active') continue;
        const ageHours = (world.now - c.lastMeaningfulInteraction) / SECONDS_PER_HOUR;
        if (ageHours >= 12) out.push(finding('WL-CONFLICT-STUCK', 'social', `Conflict ${c.id} between ${c.participants.map(id => world.nameOf(id)).join(' and ')} has been 'active' with no meaningful interaction for ${ageHours.toFixed(0)}h.`, buildPersonTrace(world, 0, c.participants[0], 'WL-CONFLICT-STUCK', 'conflict never resolved')));
      }
      return out;
    },
  },
];

export function runLiveness(world: World, series: Observation[]): Finding[] {
  const out: Finding[] = [];
  for (const l of LIVENESS) out.push(...l.check(world, series));
  return out;
}
