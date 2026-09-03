import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';

function attackOutcome(seed: number): { damage: number; health: number } {
  const tw = createTestWorld(seed, 14);
  const attacker = addPerson(tw, 'Attacker', 'traveler', v(4.5, 1, 4.5), { controlled: true });
  const victim = addPerson(tw, 'Victim', 'farmer', v(5.5, 1, 4.5));
  tw.sim.attack(attacker, tw.world.primaryBody(attacker.id)!, tw.world.primaryBody(victim.id)!);
  const event = tw.world.events.find(e => e.type === 'attack')!;
  return { damage: event.data.damage, health: tw.world.primaryBody(victim.id)!.health };
}

describe('canonical randomness', () => {
  it('replays combat outcomes from the world seed', () => {
    expect(attackOutcome(101)).toEqual(attackOutcome(101));
    expect(attackOutcome(101)).not.toEqual(attackOutcome(102));
  });
});
