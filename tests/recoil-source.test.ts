import { describe, expect, it } from 'vitest';
import { RealmSession } from '../src/sim/world/realms/session';
import { requestCombatAction } from '../src/sim/physical/combatAction';
import { advanceRecoil } from '../src/sim/physical/recoil';

function fixture() {
  const s = new RealmSession(424), target = s.world.persons().find(p => p.id !== s.person.id)!;
  const body = s.world.primaryBody(target.id)!;
  s.body.pos = { x: 3120.5, y: 1, z: 3092.5 }; s.body.yaw = Math.PI;
  body.pos = { x: 3120.5, y: 1, z: 3093.5 }; body.yaw = 0;
  return { s, body };
}
describe('contact response source and posture', () => {
  it('uses kick displacement only for the matching physical contact, never a later hit after a retained kick', () => {
    const { s, body } = fixture();
    const strike = requestCombatAction(s.world, { attackerId: s.person.id, attackerBodyId: s.body.id,
      targetBodyId: body.id, attackMode: 'strike', trajectory: 'low', intent: 'injure' });
    expect(strike.attempted).toBe(true); expect(s.body.combatAction!.moveId).toBe('front_kick');
    s.world.physicalTime = s.body.combatAction!.activeAt;
    s.sim.applyHit(s.person, s.body, body, 7, 'injure', strike);
    expect(body.recoil!.offset.z).toBeCloseTo(.3);
    // Settled previous action is deliberately retained by the canonical action history.
    delete body.recoil; s.world.physicalTime = s.body.combatAction!.completeAt + 1;
    s.body.combatAction!.phase = 'complete'; s.body.combatAction!.outcome = 'hit';
    const cast = s.world.emit('arcane_cast', { actor: s.person.id, data: { bodyId: s.body.id }, summary: 'Explicit contact-source fixture' });
    s.sim.applyHit(s.person, s.body, body, 7, 'injure', undefined, cast.id);
    expect(body.recoil!.offset.z).toBeCloseTo(.13);
  });
  it('retains crouched clearance without applying the voluntary walking speed reduction to an external impulse', () => {
    const standing = fixture(), crouched = fixture(); crouched.body.crouch = 1;
    for (const { s, body } of [standing, crouched]) {
      s.sim.applyHit(s.person, s.body, body, 7, 'injure');
      s.world.physicalTime += .24; advanceRecoil(s.world, .24);
    }
    expect(standing.body.pos.z).toBeGreaterThan(3093.5);
    expect(crouched.body.pos.z).toBeCloseTo(standing.body.pos.z, 10);
    expect(crouched.body.crouch).toBe(1);
  });
});
