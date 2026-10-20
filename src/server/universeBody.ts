import type { RealmSession } from '../sim/world/realms/session';
import { stepPhysiology } from '../sim/core/physiology';
import { advanceBodyExertion, spendExertion } from '../sim/physical/exertion';
import { recoverDownedBody } from '../sim/physical/recovery';
import { arcaneBody, ARCANE_RECOVERY_PER_SECOND } from '../sim/physical/arcana/runtime';
import { arcaneCapacity } from '../sim/physical/arcana/growth';
import { TRAVEL_DT, type PersonalFlight } from '../sim/world/universe/travel';
import { flightEnvironment, type PersonalFlightStep } from '../sim/world/universe/personalFlight';
import { length } from '../sim/world/planet/planet';

/** The retained astral body remains absent from planar physics. Its resources
 * still advance once on the canonical clock. No second Person or inventory. */
export function stepUniverseBody(s: RealmSession, result?: PersonalFlightStep, flight?: PersonalFlight): void {
  const w = s.world, r = w.universeExpedition, p = s.person, b = s.body;
  if (!r?.active || r.bodyId !== b.id || b.present || !p.alive || b.dead) return;
  const moving = length(r.state.velocity) > .15, env = flightEnvironment(r.spec, r.state);
  // Town weather belongs to the home world. Other worlds currently have a calm
  // weather baseline; the protected vessel/ward is treated as shelter. This is
  // explicit environmental scheduling, not a vacuum-damage or climate system.
  const home = r.state.systemIndex === 0 && env.planet.index === 0;
  const sheltered = r.state.mode === 'flight';
  stepPhysiology(w, p, TRAVEL_DT * w.clock.timeScale / 3600, flight ? 'craft' : moving && !sheltered ? 'walk' : 'idle', {
    indoor: sheltered, daylight: .5, weather: home && !sheltered ? w.weather : { ...w.weather, kind: 'clear', intensity: 0 },
  });
  recoverDownedBody(w, b);
  if (flight) {
    if (result?.powered && b.arcana) {
      const a = arcaneBody(w, b);
      const mana = Math.min(a.mana, result.mana);
      a.mana -= mana; a.sampledAt = w.physicalTime;
      spendExertion(w, p, b, result.effort);
      flight.manaSpent += mana; flight.effortSpent += result.effort;
    } else if (b.arcana) {
      // Coasting/falling does not refill a depleted flight in midair.
      b.arcana.sampledAt = w.physicalTime;
    }
  } else {
    advanceBodyExertion(w, b, moving && r.state.mode === 'surface');
    if (b.arcana) {
      const a = arcaneBody(w, b);
      if (!['sleep', 'downed'].includes(b.pose) && b.subduedUntil <= w.physicalTime && !p.surrender && !p.custody?.active
        && p.physiology.energy >= .25 && p.physiology.hydration >= .25)
        a.mana = Math.min(arcaneCapacity(p, w, b).reserve, a.mana + TRAVEL_DT * ARCANE_RECOVERY_PER_SECOND);
      a.sampledAt = w.physicalTime;
    }
  }
}
