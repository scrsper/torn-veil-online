import { getPhysicalCapability } from '../src/sim/core/attributes';
import { injuryFromImpact, applyInjury } from '../src/sim/physical/injury';
import { moveByIntent } from '../src/sim/physical/input';
import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v, wall, step } from './helpers/world';
import { makeBody, makeItem } from '../src/sim/world/factory';
import { RNG } from '../src/sim/core/rng';
import { resolveCombatAttack, combatTrace, type CombatAttackIntent } from '../src/sim/physical/combat';

function setup(controlled = true) {
  const tw = createTestWorld(123);
  const a = addPerson(tw, 'Ren', 'farmer', v(10, 1, 10), { controlled });
  const t = addPerson(tw, 'Kaito', 'farmer', v(11.05, 1, 10), { controlled: true });
  const ab = tw.world.primaryBody(a.id)!, tb = tw.world.primaryBody(t.id)!;
  ab.yaw = -Math.PI / 2;
  // Foundation tests isolate physical mechanics from autonomous decision making.
  a.mind.plan = [{ type: 'wait', duration: 100, status: 'pending' }];
  const intent: CombatAttackIntent = { attackerId: a.id, attackerBodyId: ab.id, targetBodyId: tb.id, attackMode: 'strike' };
  return { ...tw, a, t, ab, tb, intent };
}
describe('canonical combat foundation', () => {
  it('resolves weapon reach and three-dimensional separation at contact, not admission', () => {
    const x = setup(); x.tb.pos.x = 12.8;
    for(const weaponId of [null,makeItem(x.world,'dagger','dagger',{holder:x.a.id}).id]) {
      expect(x.sim.resolveAttack({...x.intent,weaponId}).attempted).toBe(true);
      step(x,.8);expect(x.ab.combatAction?.outcome).toBe('miss');expect(x.tb.health).toBe(x.tb.maxHealth);
    }
    const sword=makeItem(x.world,'sword','long sword',{holder:x.a.id});
    const r=x.sim.resolveAttack({...x.intent,weaponId:sword.id});
    expect(r.attempted).toBe(true);expect(r.hit).toBe(false);expect(r.weaponId).toBe(sword.id);
    step(x,.8);expect(x.tb.health).toBeLessThan(x.tb.maxHealth);
    const health=x.tb.health,hits=x.world.events.filter(e=>e.type==='attack').length;x.tb.pos.y+=5;
    expect(x.sim.resolveAttack(x.intent).attempted).toBe(true);step(x,.8);
    expect(x.ab.combatAction?.outcome).toBe('miss');expect(x.tb.health).toBeGreaterThanOrEqual(health);expect(x.world.events.filter(e=>e.type==='attack')).toHaveLength(hits);
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
    for (let i = 0; i < 10; i++) { expect(x.sim.resolveAttack(x.intent).attempted).toBe(true); step(x, .8); }
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
    const stolen = makeItem(x.world, 'sword', 'other sword', { holder: x.t.id });
    check({ ...x.intent, weaponId: stolen.id }, 'invalid_weapon');
    const bread = makeItem(x.world, 'bread', 'bread', { holder: x.a.id });
    check({ ...x.intent, weaponId: bread.id }, 'invalid_weapon');
    check({ ...x.intent, attackMode: 'shoot' as 'strike' }, 'invalid_mode');
    x.ab.dead = true; check(x.intent, 'incapacitated'); x.ab.dead = false;
    x.ab.pose = 'downed'; check(x.intent, 'incapacitated'); x.ab.pose = 'stand';
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
    const x = setup(); const second = makeBody(x.world, x.a.id, v(10.2, 1, 10)); x.a.bodies.push(second.id);
    const intent = { ...x.intent, attackerBodyId: second.id };
    second.yaw = -Math.PI / 2;
    expect(x.sim.resolveAttack(intent).attempted).toBe(true);
    expect(x.sim.resolveAttack(intent).rejection).toBe('cooldown');
    step(x, .5); expect(x.tb.health).toBeLessThan(x.tb.maxHealth);
    expect(x.ab.lastAttackAt).toBe(-99);
    expect(x.sim.resolveAttack(intent).attempted).toBe(true);
    x.world.physicalTime += 1; x.tb.pos.x = 12; wall(x, 11, 6, 14);
    makeItem(x.world, 'dagger', 'wall reach fixture', { holder: x.a.id });
    const health=x.tb.health,hits=x.world.events.filter(e=>e.type==='attack').length;expect(x.sim.resolveAttack(x.intent).attempted).toBe(true);
    step(x,.8);expect(x.ab.combatAction?.outcome).toBe('miss');expect(x.tb.health).toBeGreaterThanOrEqual(health);expect(x.world.events.filter(e=>e.type==='attack')).toHaveLength(hits);
  });
});

describe('localized injury consequences', () => {
  it('replays injuries deterministically and records them on the struck body and event', () => {
    const a = setup(), b = setup();
    expect(a.sim.resolveAttack(a.intent).injury).toBeNull();
    expect(b.sim.resolveAttack(b.intent).injury).toBeNull();
    step(a, .5); step(b, .5);
    const first = a.world.events.find(e => e.type === 'attack')!.data.combat;
    const replay = b.world.events.find(e => e.type === 'attack')!.data.combat;
    expect(first.injury).not.toBeNull(); expect(first.injury).toEqual(replay.injury);
    expect(a.tb.injuries?.[first.injury!.region as keyof NonNullable<typeof a.tb.injuries>]).toBe(first.injury!.severity);
    expect(a.world.events.find(e => e.type === 'attack')!.data.combat.injury).toEqual(first.injury);
    expect(a.ab.injuries).toBeUndefined();
    const weak = injuryFromImpact(a.tb, 8, 0.6)!, strong = injuryFromImpact(a.tb, 28, 0.6)!;
    expect(weak.region).toBe('arm'); expect(strong.severity).toBeGreaterThan(weak.severity);
    expect(injuryFromImpact(a.tb, 0, 0.6)).toBeNull();
  });
  it('arm severity reduces combat capability independently of flat health and preserves the worse wound', () => {
    const x = setup();
    const before = resolveCombatAttack(x.world, x.intent, new RNG(42));
    const cap = getPhysicalCapability(x.a, x.world, { body: x.ab });
    applyInjury(x.ab, { region: 'arm', severity: 0.6 });
    applyInjury(x.ab, { region: 'arm', severity: 0.2 });
    const hurt = getPhysicalCapability(x.a, x.world, { body: x.ab });
    expect(x.ab.health).toBe(x.ab.maxHealth); expect(x.ab.injuries!.arm).toBe(0.6);
    expect(hurt.effectiveStrength).toBeLessThan(cap.effectiveStrength);
    expect(hurt.effectiveDexterity).toBeLessThan(cap.effectiveDexterity);
    expect(resolveCombatAttack(x.world, x.intent, new RNG(42)).impact).toBeLessThan(before.impact);
  });
  it('leg severity slows canonical movement without changing arm capability', () => {
    const a = setup(), b = setup();
    applyInjury(b.ab, { region: 'leg', severity: 0.5 });
    const cap = getPhysicalCapability(b.a, b.world, { body: b.ab });
    expect(cap.movementMultiplier).toBeCloseTo(0.675);
    expect(cap.effectiveStrength).toBe(getPhysicalCapability(a.a, a.world).effectiveStrength);
    moveByIntent(a.sim, a.a, a.ab, 0, 1, false, 0.1);
    moveByIntent(b.sim, b.a, b.ab, 0, 1, false, 0.1);
    expect(b.ab.pos.z - 10).toBeCloseTo((a.ab.pos.z - 10) * cap.movementMultiplier);
  });
});
