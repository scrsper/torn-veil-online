import { expect, it } from 'vitest';
import { humanoidPresence } from '../src/bridge/humanoidPresence';
import { BridgeSession } from '../src/bridge/session';
import { serialize } from '../src/sim/persist/save';
import { makeBody } from '../src/sim/world/factory';
import { addPerson, createTestWorld, v, wall } from './helpers/world';

function fixture() {
  const tw = createTestWorld(7182, 140);
  const observer = addPerson(tw, 'Observer', 'traveler', v(20.5, 1, 40.5), { controlled: true });
  const resident = addPerson(tw, 'Resident', 'farmer', v(60.5, 1, 40.5));
  const viewer = tw.world.primaryBody(observer.id)!;
  const body = tw.world.primaryBody(resident.id)!;
  return { ...tw, observer, resident, viewer, body };
}

it('projects persistent physical people beyond cognitive attention without granting social knowledge', () => {
  const f = fixture();
  // A non-geographic save regenerates the reference village terrain. Keep this
  // projection/persistence fixture above it; grounded walking is verified in PIE.
  f.viewer.pos.y = f.body.pos.y = 30;
  f.resident.speech = { text: 'Private distant conversation', until: 100 };
  const session = new BridgeSession(0, { save: serialize(f.world) });
  const before = JSON.parse(session.save());
  delete before.savedAt;
  const snapshot = session.snapshot();
  expect(snapshot.bodies.find(b => b.bodyId === f.body.id)).toMatchObject({
    entityId: f.resident.id, name: 'an unfamiliar person', pos: f.body.pos, speech: '',
  });
  expect(snapshot.knowledge.people).toEqual([]);
  expect(snapshot.talkTargets).toEqual([]);
  const after = JSON.parse(session.save());
  delete after.savedAt;
  expect(after).toEqual(before);
  const reloaded = new BridgeSession(0, { save: session.save() });
  expect(reloaded.snapshot().bodies.map(b => [b.entityId, b.bodyId, b.pos]))
    .toEqual(snapshot.bodies.map(b => [b.entityId, b.bodyId, b.pos]));
});

it('uses geometry, range and each manifestation rather than a person roster or cognitive facing', () => {
  const f = fixture();
  f.viewer.yaw = Math.PI / 2; // Behind the body, still potentially within the third-person camera.
  const sibling = makeBody(f.world, f.resident.id, v(125.5, 1, 40.5));
  f.resident.bodies.push(sibling.id);
  expect(humanoidPresence(f.world, f.viewer).map(b => b.id)).toEqual([f.body.id]);
  wall(f, 45, 36, 44);
  expect(humanoidPresence(f.world, f.viewer)).toEqual([]);
});

it('withdraws representations without deleting people, and respects fog/sleep', () => {
  const f = fixture();
  f.world.weather.kind = 'fog';
  expect(humanoidPresence(f.world, f.viewer)).toEqual([]);
  f.world.weather.kind = 'clear';
  f.viewer.pose = 'sleep';
  expect(humanoidPresence(f.world, f.viewer)).toEqual([]);
  f.viewer.pose = 'stand';
  f.body.present = false;
  expect(humanoidPresence(f.world, f.viewer)).toEqual([]);
  expect(f.world.person(f.resident.id)).toBe(f.resident);
  f.body.present = true;
  expect(humanoidPresence(f.world, f.viewer).map(b => b.id)).toEqual([f.body.id]);
});
