import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v, wall } from './helpers/world';
import { makeBody, makeItem } from '../src/sim/world/factory';
import { RNG } from '../src/sim/core/rng';
import { resolveCombatAttack, combatTrace, type CombatAttackIntent } from '../src/sim/physical/combat';

function setup(controlled = false) {
  const tw = createTestWorld(123);
  const a = addPerson(tw, 'Ren', 'farmer', v(10, 1, 10), { controlled });
  const t = addPerson(tw, 'Kaito', 'farmer', v(11.5, 1, 10));
  const ab = tw.world.primaryBody(a.id)!, tb = tw.world.primaryBody(t.id)!;
  const intent: CombatAttackIntent = { attackerId: a.id, attackerBodyId: ab.id, targetBodyId: tb.id, attackMode: 'strike' };
  return { ...tw, a, t, ab, tb, intent };
}
describe('canonical combat foundation', () => {
  it('uses weapon reach and three-dimensional distance', () => {
    const x = setup(); x.tb.pos.x = 12.8;
    expect(x.sim.resolveAttack(x.intent).rejection).toBe('out_of_reach');
    makeItem(x.world, 'dagger', 'dagger', { holder: x.a.id });
    expect(x.sim.resolveAttack(x.intent).rejection).toBe('out_of_reach');
    const sword = makeItem(x.world, 'sword', 'long sword', { holder: x.a.id });
    const r = x.sim.resolveAttack(x.intent);
    expect(r.hit).toBe(true); expect(r.weaponId).toBe(sword.id);
    x.world.physicalTime += 1; x.tb.pos.y += 5;
    expect(x.sim.resolveAttack(x.intent).rejection).toBe('out_of_reach');
  });
  it('strength and dexterity change delivered impact with the same random draw', () => {
    const x = setup();
    const resolve = () => resolveCombatAttack(x.world, x.intent, new RNG(42));
    const baseline = resolve();
    x.a.attributes.strength *= 1.5; expect(resolve().impact).toBeGreaterThan(baseline.impact);
    x.a.attributes.dexterity *= 1.5; const dex = resolve();
    x.a.attributes.dexterity /= 1.5; expect(dex.impact).toBeGreaterThan(resolve().impact);
  });
  it('repeated strikes consume fatigue, lowering future effectiveness and recording canonical results', () => {
    const x = setup(); x.tb.health = x.tb.maxHealth = 1000;
    const before = resolveCombatAttack(x.world, x.intent, new RNG(42));
    for (let i = 0; i < 10; i++) { x.world.physicalTime += 1; expect(x.sim.resolveAttack(x.intent).attempted).toBe(true); }
    x.world.physicalTime += 1;
    expect(resolveCombatAttack(x.world, x.intent, new RNG(42)).impact).toBeLessThan(before.impact);
    expect(x.a.physiology.fatigue).toBeGreaterThan(0.1);
    const events = x.world.events.filter(e => e.type === 'attack');
    expect(events).toHaveLength(10); expect(events[0].data.combat.hit).toBe(true);
    expect(combatTrace(events[0].data.combat)).toContain('exertion:');
  });
  it('rejects invalid attacks without consuming RNG or physical resources', () => {
    const x = setup(); const state = x.world.rng.state();
    const check = (intent: CombatAttackIntent, reason: string) => expect(x.sim.resolveAttack(intent).rejection).toBe(reason);
    check({ ...x.intent, attackerId: 'missing' }, 'invalid_attacker');
    check({ ...x.intent, targetBodyId: 'missing' }, 'invalid_target');
    check({ ...x.intent, targetBodyId: x.ab.id }, 'self_target');
    const stolen = makeItem(x.world, 'sword', 'other sword', { holder: x.t.id });
    check({ ...x.intent, weaponId: stolen.id }, 'invalid_weapon');
    const bread = makeItem(x.world, 'bread', 'bread', { holder: x.a.id });
    check({ ...x.intent, weaponId: bread.id }, 'invalid_weapon');
    check({ ...x.intent, attackMode: 'shoot' as 'strike' }, 'invalid_mode');
    x.ab.dead = true; check(x.intent, 'incapacitated'); x.ab.dead = false;
    x.ab.pose = 'downed'; check(x.intent, 'incapacitated'); x.ab.pose = 'stand';
    x.tb.pos.x = 20; check(x.intent, 'out_of_reach');
    expect(x.world.rng.state()).toBe(state); expect(x.a.physiology.fatigue).toBe(0.1);
  });
  it('is deterministic and independent of player control, including health consequences', () => {
    const a = setup(false), b = setup(true); a.tb.health = b.tb.health = 2;
    expect(a.sim.resolveAttack(a.intent)).toEqual(b.sim.resolveAttack(b.intent));
    expect(a.tb.health).toBe(b.tb.health); expect(a.tb.dead).toBe(false); expect(b.tb.dead).toBe(false);
    a.world.physicalTime += 1; b.world.physicalTime += 1;
    expect(a.sim.resolveAttack(a.intent)).toEqual(b.sim.resolveAttack(b.intent));
    expect(a.tb.dead).toBe(false); expect(b.tb.dead).toBe(false);
    const c = setup(), d = setup();
    expect(c.sim.resolveAttack(c.intent)).toEqual(d.sim.resolveAttack(d.intent));
  });
  it('uses the selected manifestation and rejects walls and cooldown bypasses', () => {
    const x = setup(); const second = makeBody(x.world, x.a.id, v(11, 1, 10)); x.a.bodies.push(second.id);
    const intent = { ...x.intent, attackerBodyId: second.id };
    expect(x.sim.resolveAttack(intent).hit).toBe(true);
    expect(x.ab.lastAttackAt).toBe(-99);
    expect(x.sim.resolveAttack(intent).rejection).toBe('cooldown');
    x.world.physicalTime += 1; x.tb.pos.x = 12; wall(x, 11, 6, 14);
    expect(x.sim.resolveAttack(x.intent).rejection).toBe('obstructed');
  });
});
