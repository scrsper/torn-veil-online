import { describe, expect, it } from 'vitest';
import { getRel, setRelTags } from '../src/sim/mind/relationships';
import { addPerson, createTestWorld, face, step, v, wall } from './helpers/world';

describe('crime information flow', () => {
  it('carries a witnessed attack through memory, reporting, and a physical guard response', () => {
    const tw = createTestWorld(41, 40);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(6.5, 1, 6.5), { controlled: true });
    const tomas = addPerson(tw, 'Tomas Reed', 'apprentice', v(5.5, 1, 6.5));
    const mara = addPerson(tw, 'Mara Bramble', 'baker', v(5.5, 1, 10.5), { traits: { courage: 0.35, honesty: 0.9 } });
    const guard = addPerson(tw, 'Hale Dorn', 'guard', v(34.5, 1, 10.5), { workId: tw.places.guardhouse, traits: { courage: 0.8 } });
    guard.mind.thinkInterval = Number.POSITIVE_INFINITY;
    setRelTags(mara, tomas.id, 'sweetheart');
    getRel(mara, tomas.id).affection = 0.9;
    face(mara, tw, tw.world.primaryBody(tomas.id)!.pos);

    const attack = tw.sim.applyHit(player, tw.world.primaryBody(player.id)!, tw.world.primaryBody(tomas.id)!, 8)!;
    expect(attack.type).toBe('attack');
    expect(attack.actor).toBe(player.id);
    expect(attack.target).toBe(tomas.id);

    const maraStartX = tw.world.primaryBody(mara.id)!.pos.x;
    step(tw, 8);

    const maraKnowledge = mara.knowledge[`ev:${attack.id}`];
    expect(maraKnowledge?.source.type).toBe('witnessed');
    expect(maraKnowledge?.claim.actor).toBe(player.id);
    expect(maraKnowledge?.claim.actorUnknown).not.toBe(true);
    expect(mara.memories.some(m => m.eventId === attack.id && m.source.type === 'witnessed' && m.entities.includes(player.id))).toBe(true);
    expect(getRel(mara, player.id).trust).toBeLessThan(0);
    expect(mara.emotions.fear + mara.emotions.anger).toBeGreaterThan(0);
    expect(tw.world.events.some(e => e.type === 'goal_changed' && e.actor === mara.id && ['report', 'flee'].includes(e.data.to))).toBe(true);
    expect(tw.world.primaryBody(mara.id)!.pos.x).toBeGreaterThan(maraStartX + 2);

    const told = tw.world.events.find(e => e.type === 'told' && e.actor === mara.id && e.target === guard.id && e.data.key === `ev:${attack.id}`);
    expect(told).toBeDefined();
    const guardKnowledge = guard.knowledge[`ev:${attack.id}`];
    expect(guardKnowledge?.source).toMatchObject({ type: 'told', from: mara.id, viaEvent: told?.id });
    expect(guardKnowledge?.hops).toBe(1);
    expect(guardKnowledge?.claim.actor).toBe(player.id);
    expect(guardKnowledge?.source.type).not.toBe('witnessed');
    expect(attack.perceivedBy.some(p => p.who === guard.id)).toBe(false);
    expect(['investigate', 'confront']).toContain(guard.mind.goal?.type);

    const guardStartX = 34.5;
    step(tw, 1);
    expect(tw.world.primaryBody(guard.id)!.pos.x).toBeLessThan(guardStartX - 0.5);
  });

  it('keeps a completely unseen and unheard attack local', () => {
    const tw = createTestWorld(42, 40);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(5.5, 1, 5.5), { controlled: true });
    const tomas = addPerson(tw, 'Tomas Reed', 'apprentice', v(6.5, 1, 5.5));
    const villager = addPerson(tw, 'Unrelated Villager', 'farmer', v(35.5, 1, 35.5));
    const guard = addPerson(tw, 'Remote Guard', 'guard', v(35.5, 1, 30.5), { workId: tw.places.guardhouse });
    const before = { ...getRel(villager, player.id) };

    const attack = tw.sim.applyHit(player, tw.world.primaryBody(player.id)!, tw.world.primaryBody(tomas.id)!, 8)!;
    step(tw, 1);

    expect(villager.knowledge[`ev:${attack.id}`]).toBeUndefined();
    expect(villager.memories.some(m => m.eventId === attack.id)).toBe(false);
    expect(getRel(villager, player.id)).toEqual(before);
    expect(villager.mind.goal?.type).not.toBe('report');
    expect(guard.knowledge[`ev:${attack.id}`]).toBeUndefined();
    expect(attack.perceivedBy.some(p => p.who === villager.id || p.who === guard.id)).toBe(false);
  });

  it('preserves an unknown attacker through hearing and gossip until a witness identifies them', () => {
    const tw = createTestWorld(43, 28);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(5.5, 1, 5.5), { controlled: true });
    const tomas = addPerson(tw, 'Tomas Reed', 'apprentice', v(5.5, 1, 6.5));
    const witness = addPerson(tw, 'Reliable Witness', 'farmer', v(5.5, 1, 10.5), { traits: { honesty: 1 } });
    const listener = addPerson(tw, 'Listener', 'farmer', v(12.5, 1, 6.5), { traits: { honesty: 0.9 } });
    const guard = addPerson(tw, 'Guard', 'guard', v(22.5, 1, 6.5), { workId: tw.places.guardhouse });
    guard.mind.thinkInterval = Number.POSITIVE_INFINITY;
    wall(tw, 8, 2, 12);
    face(witness, tw, tw.world.primaryBody(tomas.id)!.pos);
    face(listener, tw, tw.world.primaryBody(tomas.id)!.pos);
    const listenerRelBefore = { ...getRel(listener, player.id) };

    const attack = tw.sim.applyHit(player, tw.world.primaryBody(player.id)!, tw.world.primaryBody(tomas.id)!, 8)!;
    step(tw, 0.3);

    const heard = listener.knowledge[`ev:${attack.id}`];
    expect(heard?.source.type).toBe('heard');
    expect(heard?.claim.actorUnknown).toBe(true);
    expect(heard?.claim.actor).toBeUndefined();
    const heardMemory = listener.memories.find(m => m.eventId === attack.id && m.source.type === 'heard');
    expect(heardMemory?.entities).not.toContain(player.id);
    expect(heardMemory?.summary).not.toContain(player.name);
    expect(getRel(listener, player.id)).toEqual(listenerRelBefore);

    tw.sim.tell(listener, guard, heard!);
    const guardUnknown = guard.knowledge[`ev:${attack.id}`];
    expect(guardUnknown?.source.type).toBe('told');
    expect(guardUnknown?.source.from).toBe(listener.id);
    expect(guardUnknown?.claim.actorUnknown).toBe(true);
    expect(guardUnknown?.claim.actor).toBeUndefined();
    expect(guard.relationships[player.id]).toBeUndefined();

    const witnessed = witness.knowledge[`ev:${attack.id}`];
    expect(witnessed?.claim.actor).toBe(player.id);
    tw.sim.tell(witness, listener, witnessed!);
    expect(listener.knowledge[`ev:${attack.id}`].claim.actor).toBe(player.id);
    expect(listener.knowledge[`ev:${attack.id}`].claim.actorUnknown).not.toBe(true);
    expect(listener.knowledge[`ev:${attack.id}`].source).toMatchObject({ type: 'told', from: witness.id });

    tw.sim.tell(listener, guard, listener.knowledge[`ev:${attack.id}`]);
    expect(guard.knowledge[`ev:${attack.id}`].claim.actor).toBe(player.id);
    expect(guard.knowledge[`ev:${attack.id}`].claim.actorUnknown).not.toBe(true);
    expect(guard.knowledge[`ev:${attack.id}`].source.type).toBe('told');
    expect(guard.knowledge[`ev:${attack.id}`].source.from).toBe(listener.id);
  });
});
