import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { moveByIntent } from '../src/sim/physical/input';
import { createTestWorld, addPerson, v, wall } from './helpers/world';
import { makeBody } from '../src/sim/world/factory';

describe('canonical movement intents', () => {
  it('normalizes movement, rejects invalid values, and collides with canonical walls', () => {
    const tw = createTestWorld(); const p = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10)); const b = tw.world.primaryBody(p.id)!;
    const start = { ...b.pos }; moveByIntent(tw.sim, p, b, 1, 1, false, 0.1);
    expect(Math.hypot(b.pos.x - start.x, b.pos.z - start.z)).toBeCloseTo(b.speed * 0.1);
    const finite = { ...b.pos }; moveByIntent(tw.sim, p, b, NaN, 0, false, 0.1); expect(b.pos).toEqual(finite);
    wall(tw, 11, 8, 12); for (let i = 0; i < 20; i++) moveByIntent(tw.sim, p, b, 1, 0, true, 0.05);
    expect(b.pos.x).toBeLessThan(10.71);
  });
});

describe('bridge protocol', () => {
  it('seeing one body does not expose another body of the same Person',()=>{
    const s=new BridgeSession(),w=s.world,player=w.primaryBody(w.playerId)!,p=w.persons().find(p=>p.id!==w.playerId)!;
    const near=w.primaryBody(p.id)!; near.pos={...player.pos,x:player.pos.x+1};
    const far=makeBody(w,p.id,{x:1,y:30,z:1});p.bodies.push(far.id);
    for(let i=0;i<6;i++) s.step(.05);
    const snapshot=s.snapshot();
    expect(snapshot.bodies.some(b=>b.bodyId===near.id)).toBe(true);
    expect(snapshot.bodies.some(b=>b.bodyId===far.id)).toBe(false);
    expect(snapshot.controlledBodyId).toBe(player.id);
  });
  it('projects the actual cast, expires abandoned input, and rejects replayed packets', () => {
    const s = new BridgeSession(); const snapshot = s.developerSnapshot();
    expect(snapshot.bodies.filter(b => b.entityId !== s.world.playerId)).toHaveLength(32);
    const npc = snapshot.bodies.find(b => b.entityId !== s.world.playerId)!;
    expect(npc.name).toBe(s.world.person(npc.entityId)!.name);
    const intent = { version: 1, sequence: 1, type: 'move', x: 1, z: 0 };
    expect(s.intent(intent).result).toBe('accepted'); expect(s.intent(intent).result).toBe('invalid_sequence_or_version');
    for (let i = 0; i < 10; i++) s.step();
    const b = s.world.primaryBody(s.world.playerId)!; const stopped = { ...b.pos };
    for (let i = 0; i < 5; i++) s.step(); expect(b.pos).toEqual(stopped);
    expect(s.intent({ version: 1, sequence: 2, type: 'teleport', pos: { x: 0, y: 0, z: 0 } }).result).toBe('invalid_intent');
  });
});
