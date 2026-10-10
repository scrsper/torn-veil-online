import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/core/world';
import { makeBody, makePerson } from '../src/sim/world/factory';

describe('identity and embodiment ontology', () => {
  it('supports zero or many manifestations without losing canonical ownership', () => {
    const world = new World(4417);
    const person = makePerson(world, {
      name: 'Unbodied witness', gender: 'f', age: 30, occupation: 'traveler',
      traits: {}, appearance: {}, bio: 'A deterministic ontology fixture.',
    });

    expect(person.bodies).toEqual([]);
    expect(world.primaryBody(person.id)).toBeUndefined();

    const first = makeBody(world, person.id, { x: 2, y: 1, z: 2 });
    const second = makeBody(world, person.id, { x: 8, y: 1, z: 2 });
    world.attachBody(person, first);
    world.attachBody(person.id, first.id); // idempotent, so retries cannot duplicate identity links
    world.attachBody(person, second);

    expect(person.bodies).toEqual([first.id, second.id]);
    expect(world.primaryBody(person.id)?.id).toBe(first.id);
    expect(world.livingIndexErrors()).toEqual([]);

    first.dead = true;
    expect(world.primaryBody(person.id)?.id).toBe(second.id);
    expect(world.activeBodies().map(body => body.id)).toContain(second.id);
    second.present = false;
    expect(world.primaryBody(person.id)?.id).toBe(first.id); // historical carcass fallback
    first.present = false;
    expect(world.primaryBody(person.id)).toBeUndefined();
  });

  it('rejects a body attached through the wrong identity', () => {
    const world = new World(4418);
    const a = makePerson(world, { name: 'A', gender: 'f', age: 30, occupation: 'traveler', traits: {}, appearance: {}, bio: '' });
    const b = makePerson(world, { name: 'B', gender: 'm', age: 30, occupation: 'traveler', traits: {}, appearance: {}, bio: '' });
    const body = makeBody(world, a.id, { x: 2, y: 1, z: 2 });
    expect(() => world.attachBody(b, body)).toThrow(/canonical body owned by/);
    expect(a.bodies).toEqual([]);
    expect(b.bodies).toEqual([]);
    expect(world.livingIndexErrors()).toContain(`body ${body.id} is missing from owner ${a.id} manifestations`);
  });

  it('rejects cloned and cross-world objects even when their ids match', () => {
    const world = new World(4419);
    const otherWorld = new World(4419);
    const person = makePerson(world, { name: 'A', gender: 'f', age: 30, occupation: 'traveler', traits: {}, appearance: {}, bio: '' });
    const otherPerson = makePerson(otherWorld, { name: 'A', gender: 'f', age: 30, occupation: 'traveler', traits: {}, appearance: {}, bio: '' });
    const body = makeBody(world, person.id, { x: 2, y: 1, z: 2 });
    const otherBody = makeBody(otherWorld, otherPerson.id, { x: 2, y: 1, z: 2 });
    expect(otherPerson.id).toBe(person.id);
    expect(otherBody.id).toBe(body.id);
    expect(() => world.attachBody(structuredClone(person), body)).toThrow(/non-canonical owner/);
    expect(() => world.attachBody(otherPerson, body)).toThrow(/non-canonical owner/);
    expect(() => world.attachBody(person, structuredClone(body))).toThrow(/canonical body/);
    expect(() => world.attachBody(person, otherBody)).toThrow(/canonical body/);
    expect(person.bodies).toEqual([]);
  });
});
