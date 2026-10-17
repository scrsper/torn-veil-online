import { describe, expect, it } from 'vitest';
import { createCombatGym } from '../src/sim/world/combatGym';
import { canonicalDigest as serialize } from '../src/observatory/fingerprint';
import { BridgeSession } from '../src/bridge/session';
import { requestCombatAction } from '../src/sim/physical/combatAction';
import { B } from '../src/sim/physical/blocks';

describe('Combat Gym fixtures', () => {
  it('recreates the exact canonical initial state for a seed', () => {
    expect(serialize(createCombatGym(918271).world)).toBe(serialize(createCombatGym(918271).world));
    expect(serialize(createCombatGym(918272).world)).not.toBe(serialize(createCombatGym(918271).world));
  });
  it('makes the controlled traveler male (draws player_m)', () => {
    const { world } = createCombatGym();
    expect(world.person(world.playerId!)!.gender).toBe('m');
  });
  it('uses real combat contact and leaves another world untouched', () => {
    const state = createCombatGym(), other = createCombatGym(42), before = serialize(other.world);
    const bridge = new BridgeSession(state.world.seed, { state });
    const [p, target] = state.world.persons(), pb = state.world.primaryBody(p.id)!, tb = state.world.primaryBody(target.id)!;
    const health = tb.health;
    const result = requestCombatAction(state.world, { attackerId: p.id, attackerBodyId: pb.id, targetBodyId: tb.id, attackMode: 'strike', trajectory: 'high' });
    expect(result.rejection).toBeNull();
    for (let i = 0; i < 90; i++) bridge.stepInteraction();
    expect(tb.health).toBeLessThan(health);
    expect(state.world.events.some(e => e.type === 'attack')).toBe(true);
    expect(serialize(other.world)).toBe(before);
  });
  it('publishes physical fixtures and real interaction candidates', () => {
    const state = createCombatGym(), bridge = new BridgeSession(state.world.seed, { state });
    expect(state.world.grid.get(0, 1, 20)).toBe(B.Plaster);
    expect(state.world.grid.get(31, 1, 39)).toBe(B.Table);
    const body = state.world.primaryBody(state.world.playerId!)!;
    body.pos = { x: 26, y: 1, z: 38 };
    const snapshot = bridge.snapshot();
    expect(snapshot.interactions.length).toBeGreaterThan(0);
    expect(state.world.items().map(i => i.name)).toContain('Test bread');
  });
});

