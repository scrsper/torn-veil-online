import { expect, it } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';
import { createAnimal, naturalDeath } from '../src/sim/ecology/animals';
import { wildlifeProjection } from '../src/bridge/wildlife';

function fixture() {
  const tw = createTestWorld(4401, 40);
  const person = addPerson(tw, 'Observer', 'traveler', v(10.5, 1, 20.5), { controlled: true });
  const viewer = tw.world.primaryBody(person.id)!;
  viewer.yaw = -Math.PI / 2;
  const animal = createAnimal(tw.world, 'roe_deer', v(15.5, 1, 20.5), { sex: 'male' });
  const body = tw.world.body(animal.bodies[0])!;
  return { tw, viewer, animal, body };
}

it('projects a renderer-neutral wildlife row with canonical identity, motion, activity and condition', () => {
  const { tw, viewer, animal, body } = fixture();
  body.health = body.maxHealth * 0.6;
  body.yaw = 0.35;
  body.vel = { x: 0.4, y: 0, z: -0.2 };
  const row = wildlifeProjection(tw.world, viewer).bodies.find(candidate => candidate.bodyId === body.id);

  expect(row).toMatchObject({
    bodyId: body.id,
    creatureId: animal.id,
    speciesId: 'roe_deer',
    pos: body.pos,
    yaw: body.yaw,
    vel: body.vel,
    condition: 0.6,
    alive: true,
    dead: false,
    present: true,
  });
  expect(row).toBeDefined();
  expect(Object.keys(row!).sort()).toContain('condition');
});

it('keeps present dead bodies observable while withdrawal is distinct from death', () => {
  const { tw, viewer, animal, body } = fixture();
  const state = animal.wildlife!.embodiments[body.id];
  naturalDeath(tw.world, animal, body, state, 'old_age', tw.world.now);

  expect(wildlifeProjection(tw.world, viewer).bodies.find(candidate => candidate.bodyId === body.id)).toMatchObject({
    bodyId: body.id, condition: 0, alive: false, dead: true, present: true, activity: 'dead',
  });

  body.present = false;
  expect(wildlifeProjection(tw.world, viewer).bodies.some(candidate => candidate.bodyId === body.id)).toBe(false);
  expect(tw.world.body(body.id)).toBe(body);
});
