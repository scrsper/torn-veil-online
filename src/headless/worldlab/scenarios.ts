import type { World } from '../../sim/core/world';
import type { Simulation } from '../../sim/mind/agent';
import { makeItem } from '../../sim/world/factory';
import { INVARIANTS } from './invariants';
import { LIVENESS } from './liveness';
import { TAIL_CHECKS } from './tail';
import { THROUGHPUT_CHECKS } from './throughput';
import { TREND_CHECKS } from './trend';
import type { InvariantCheck, LivenessCheck, ScenarioSpec } from './types';

// v0.8 §21 "four classes of health check": `LIVENESS` (mechanism-liveness, pre-existing),
// `TAIL_CHECKS` (individual/tail), `THROUGHPUT_CHECKS` (service/throughput), `TREND_CHECKS`
// (sustainability) each live in their own file/array — merged here only at the point scenarios
// pick checks by category, so a scenario asking for e.g. 'survival' automatically picks up both
// the old village-wide liveness checks AND the new per-person tail checks without a separate
// per-scenario wire-up.
const ALL_LIVENESS: LivenessCheck[] = [...LIVENESS, ...TAIL_CHECKS, ...THROUGHPUT_CHECKS, ...TREND_CHECKS];

function invariantsIn(categories: string[]): InvariantCheck[] {
  return INVARIANTS.filter(i => categories.includes(i.category));
}
function livenessIn(categories: string[]): LivenessCheck[] {
  return ALL_LIVENESS.filter(l => categories.includes(l.category));
}

// Structural invariants worth checking in EVERY scenario regardless of focus — corruption here
// is never "expected emergent behavior" the way e.g. a stalled construction site might be.
const ALWAYS_INVARIANTS = invariantsIn(['economy', 'logistics', 'cognition']);

/**
 * v0.8 §7 "Functional scenarios": real generated-village runs (`generateVillage`, the same one
 * the browser client boots into) validated against bounded invariants/liveness — never a
 * scripted-to-pass outcome. `baseline-village` in particular runs with NO setup at all: whatever
 * happens is exactly what the actual village produces on its own.
 *
 * Not every scenario named in the milestone brief gets a distinct entry here: `knowledge-
 * grounding` and `player-parity` are already covered, more precisely, by dedicated deterministic
 * unit tests (`tests/dialogue-grounding.test.ts`, `tests/player-affordance-parity.test.ts`,
 * `tests/recovery-authorization.test.ts`) and the browser functional harness (§10) — a headless
 * multi-day WorldLab run adds little there since those properties are per-interaction, not
 * emergent-over-time. Documented here rather than added as a low-value duplicate scenario.
 */
export const SCENARIOS: ScenarioSpec[] = [
  {
    // v0.8 §P2-B/C (independent audit §4.8): 1337 is the seed `main.ts` actually boots — the
    // audit measured it among the worst (-47% spendable wealth, 22/32 unable to buy any meal by
    // day 30) while it sat in no WorldLab tier at all. 30 days matches this milestone's own
    // "standard multi-seed 30-day horizon" requirement — every finding in the audit was already
    // visible by day ~10 and unambiguous by day 20; a 7-day window could not have caught it.
    id: 'baseline-village', title: 'Baseline Village',
    // v0.8 §22 "re-run matrix": at least 5 seeds at the 30-day standard horizon — the 4 the
    // milestone names explicitly (918271, 918272, 1337, 42424242) plus one more (12345).
    seeds: [918271, 918272, 1337, 42424242, 12345], days: 30, probeIntervalSeconds: 3600 * 6,
    invariants: INVARIANTS, liveness: ALL_LIVENESS,
  },
  {
    id: 'food-chain', title: 'Food Chain (crops -> grain -> flour -> bread)',
    seeds: [918271, 42424242, 12345], days: 21, probeIntervalSeconds: 3600 * 3,
    invariants: [...ALWAYS_INVARIANTS], liveness: livenessIn(['agriculture', 'production', 'survival']),
  },
  {
    id: 'water-survival', title: 'Water Survival',
    seeds: [918271, 42424242, 12345], days: 5, probeIntervalSeconds: 3600,
    invariants: [...ALWAYS_INVARIANTS], liveness: livenessIn(['survival']),
  },
  {
    id: 'logistics', title: 'Logistics (haul tasks)',
    seeds: [918271, 42424242, 12345], days: 7, probeIntervalSeconds: 3600 * 3,
    invariants: invariantsIn(['logistics', 'economy']), liveness: livenessIn(['logistics']),
  },
  {
    id: 'construction', title: 'Construction',
    seeds: [918271, 42424242, 12345], days: 14, probeIntervalSeconds: 3600 * 6,
    invariants: [...ALWAYS_INVARIANTS], liveness: livenessIn(['construction', 'logistics']),
  },
  {
    id: 'conflict-resolution', title: 'Conflict Resolution',
    seeds: [42424242, 918271, 12345], days: 7, probeIntervalSeconds: 3600 * 3,
    invariants: [...ALWAYS_INVARIANTS], liveness: livenessIn(['social']),
  },
  {
    id: 'recover-item', title: 'Recover Item (authorization + reward)',
    seeds: [918271, 42424242, 12345], days: 5, probeIntervalSeconds: 3600 * 2,
    invariants: [...ALWAYS_INVARIANTS], liveness: livenessIn(['social']),
    // §7 "avoid scripting the desired outcome into existence": this seeds only the loss itself —
    // an active `recover_item` desire (an owner's belief about their OWN property is not
    // omniscience; it's the one fact an in-fiction owner is entitled to know without having
    // witnessed anything) and a ring left lying loose where the owner is not currently present.
    // v0.8 §P0-G (independent audit §4.6): earlier this ALSO hand-authored a witness's `loc:`
    // knowledge via a direct `learn()` call — i.e. the harness told a bystander a fact the
    // simulation itself never gave them any evidence for, exactly the kind of confident,
    // provenance-less belief Constitution §5/§6 forbids. That line is gone: whoever ends up
    // knowing where the ring is, and whether that knowledge ever reaches the owner or an
    // authorized recoverer, is now entirely up to the real `perceive()` (mind/agent.ts, item-
    // location perception) → `pickGossip`/`tell` (knowledge travel) → `maybeAskForHelp`
    // (authorization) → goal-formation (line ~415) chain to accomplish or fail to accomplish on
    // its own — the scenario supplies a lost ring, not a solved case.
    setup: (world: World, _sim: Simulation) => {
      const owner = world.persons().find(p => p.alive && p.occupation === 'farmer');
      if (!owner) return;
      const place = world.places().find(p => p.type === 'chapel') ?? world.places()[0];
      if (!place) return;
      const ring = makeItem(world, 'ring', `${owner.name}'s ring`, { owner: owner.id, pos: place.anchors[0]?.pos ?? { x: 0, y: 1, z: 0 }, placeId: place.id });
      owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'My ring was lost. I would give anything to have it back.', reward: 20, fulfilled: false });
    },
  },
];

export function scenarioById(id: string): ScenarioSpec | undefined {
  return SCENARIOS.find(s => s.id === id);
}
