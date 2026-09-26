import { describe, expect, it } from 'vitest';
import { serialize, deserialize } from '../src/sim/persist/save';
import { addPerson, createTestWorld, v } from './helpers/world';
import { guardContact, requestGuard, validSavedGuard } from '../src/sim/physical/guard';
import { requestCombatAction, advanceCombat, captureCombatTransforms } from '../src/sim/physical/combatAction';

function setup() {
  const t = createTestWorld(941), w = t.world;
  const defender = addPerson(t, 'Defender', 'villager', v(12, 1, 12));
  const attacker = addPerson(t, 'Attacker', 'villager', v(12, 1, 11));
  const b = w.primaryBody(defender.id)!, a = w.primaryBody(attacker.id)!;
  b.yaw = 0; a.yaw = Math.PI;
  return { w, defender, attacker, a, b };
}
describe('canonical guard and committed heavy strikes', () => {
  it('parries an actual frontal contact once, then blocks subsequent contacts at an effort cost', () => {
    const { w, defender, a, b } = setup();
    expect(requestGuard(w, b.id, true)).toBe('accepted');
    w.physicalTime += 0.1;
    const parry = guardContact(w, a, b, 10);
    expect(parry.parried).toBe(true); expect(parry.impact).toBe(0);
    expect(parry.event?.causes).toContain(b.guard!.eventId);
    expect(guardContact(w, a, b, 10).impact).toBeCloseTo(3);
    expect(defender.physiology.fatigue).toBeGreaterThan(0.1);
  });
  it('refreshing or rapidly releasing/re-raising does not reset the parry window', () => {
    const { w, a, b } = setup(); requestGuard(w, b.id, true);
    w.physicalTime = 0.2; requestGuard(w, b.id, true);
    expect(guardContact(w, a, b, 10).parried).toBe(false);
    requestGuard(w, b.id, false); requestGuard(w, b.id, true);
    expect(guardContact(w, a, b, 10).parried).toBe(false);
    w.physicalTime = 1; requestGuard(w, b.id, true);
    expect(guardContact(w, a, b, 10).parried).toBe(true);
  });
  it('does not guard the rear or retain a disconnected held input forever', () => {
    const { w, a, b } = setup(); requestGuard(w, b.id, true);
    b.yaw = Math.PI; expect(guardContact(w, a, b, 10).impact).toBe(10);
    b.yaw = 0; w.physicalTime = 0.4; expect(guardContact(w, a, b, 10).impact).toBe(10);
  });
  it('breaks under pressure and refuses an exhausted body', () => {
    const { w, defender, a, b } = setup(); requestGuard(w, b.id, true);
    defender.physiology.fatigue = 0.94;
    expect(guardContact(w, a, b, 30).impact).toBe(30);
    expect(requestGuard(w, b.id, true)).toBe('exhausted');
  });
  it('accepts additive saved stance but rejects nonfinite and indefinite guard state', () => {
    const { w, b } = setup(); requestGuard(w, b.id, true);
    expect(validSavedGuard(undefined, 0)).toBe(true);
    expect(validSavedGuard(JSON.parse(JSON.stringify(b.guard)), 0)).toBe(true);
    expect(validSavedGuard({ ...b.guard, until: 100 }, 0)).toBe(false);
    expect(validSavedGuard({ ...b.guard, startedAt: NaN }, 0)).toBe(false);
  });
  it('retains a held stance through compaction and reload and rejects invented guard provenance', () => {
    const { w, b } = setup(); requestGuard(w, b.id, true);
    for (let i = 0; i < 30; i++) w.emit('arrived', { actor: b.ownerId, significance: 0 });
    w.compactEvents(4);
    expect(w.event(b.guard!.eventId)).toBeDefined();
    const saved = serialize(w), restored = deserialize(saved)!;
    expect(restored.world.body(b.id)!.guard).toEqual(b.guard);
    const corrupt = JSON.parse(saved); corrupt.bodies.find((x: {id: string}) => x.id === b.id).guard.eventId = 'invented';
    expect(deserialize(JSON.stringify(corrupt))).toBeNull();
    for (const invalid of [{actorBodyId:'another-manifestation'}, {phase:'contact'}]) {
      const mismatched=JSON.parse(saved);
      Object.assign(mismatched.events.find((e:{id:string})=>e.id===b.guard!.eventId).data,invalid);
      expect(deserialize(JSON.stringify(mismatched))).toBeNull();
    }
  });
  it('heavy attacks buy force with longer commitment and more fatigue, without increasing reach', () => {
    const light = setup(), heavy = setup();
    for (const [t, weight] of [[light, 'light'], [heavy, 'heavy']] as const) {
      expect(requestCombatAction(t.w, { attackerId: t.attacker.id, attackerBodyId: t.a.id, targetBodyId: t.b.id, attackMode: 'strike', weight }).attempted).toBe(true);
    }
    const a = light.a.combatAction!, b = heavy.a.combatAction!;
    expect(b.activeAt).toBeGreaterThan(a.activeAt); expect(b.completeAt).toBeGreaterThan(a.completeAt);
    expect(b.impact).toBeGreaterThan(a.impact); expect(b.exertionCost).toBeGreaterThan(a.exertionCost);
    expect(b.reach).toBe(a.reach); expect(heavy.a.pos).toEqual(light.a.pos);
  });
  it('a timed guard intercepts a swept human strike before injury is applied', () => {
    const { w, attacker, a, b } = setup();
    requestCombatAction(w, { attackerId: attacker.id, attackerBodyId: a.id, targetBodyId: b.id, attackMode: 'strike' });
    const active = a.combatAction!.activeAt;
    let hits = 0, raised = false;
    for (let i = 0; i < 70; i++) {
      if (w.physicalTime >= active - .08) { requestGuard(w, b.id, true); raised = true; }
      const before = captureCombatTransforms(w); w.physicalTime += 1 / 60;
      advanceCombat(w, 1 / 60, before, () => { hits++; return null; });
    }
    expect(raised).toBe(true); expect(hits).toBe(0);
    expect(w.events.some(e => e.data.kind === 'guard' && e.data.outcome === 'parried')).toBe(true);
    expect(a.combatAction!.outcome).toBe('interrupted');
  });

});
