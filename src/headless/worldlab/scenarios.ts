import type { World } from '../../sim/core/world';
import type { Simulation } from '../../sim/mind/agent';
import { makeItem } from '../../sim/world/factory';
import { learn } from '../../sim/mind/knowledge';
import { INVARIANTS } from './invariants';
import { LIVENESS } from './liveness';
import type { InvariantCheck, LivenessCheck, ScenarioSpec } from './types';

function invariantsIn(categories: string[]): InvariantCheck[] {
  return INVARIANTS.filter(i => categories.includes(i.category));
}
function livenessIn(categories: string[]): LivenessCheck[] {
  return LIVENESS.filter(l => categories.includes(l.category));
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
    id: 'baseline-village', title: 'Baseline Village',
    seeds: [918271, 42424242, 12345], days: 7, probeIntervalSeconds: 3600 * 6,
    invariants: INVARIANTS, liveness: LIVENESS,
  },
  {
    id: 'food-chain', title: 'Food Chain (crops -> grain -> flour -> bread)',
    seeds: [918271, 42424242, 12345], days: 10, probeIntervalSeconds: 3600 * 3,
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
    // §7 "avoid scripting the desired outcome into existence": this seeds only the PRECONDITION
    // (an active request + a witness who genuinely knows where the item is, exactly the same
    // `learn()`/`desires.push` shape a real in-fiction loss would produce) — whether it actually
    // gets resolved and paid is left entirely to the real cognition/goal system to accomplish or
    // fail to accomplish on its own.
    setup: (world: World, _sim: Simulation) => {
      const owner = world.persons().find(p => p.alive && p.occupation === 'farmer');
      const witness = world.persons().find(p => p.alive && p.id !== owner?.id);
      if (!owner || !witness) return;
      const place = world.places().find(p => p.type === 'chapel') ?? world.places()[0];
      if (!place) return;
      const ring = makeItem(world, 'ring', `${owner.name}'s ring`, { owner: owner.id, pos: place.anchors[0]?.pos ?? { x: 0, y: 1, z: 0 }, placeId: place.id });
      owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'My ring was lost. I would give anything to have it back.', reward: 20, fulfilled: false });
      learn(world, witness, { key: `loc:${ring.id}`, kind: 'location', claim: { entityId: ring.id, pos: ring.pos, placeId: place.id }, confidence: 0.9, source: { type: 'witnessed' } }, true);
    },
  },
];

export function scenarioById(id: string): ScenarioSpec | undefined {
  return SCENARIOS.find(s => s.id === id);
}
