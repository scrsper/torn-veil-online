import { describe, expect, it } from 'vitest';
import { recogniseClass } from '../src/sim/mind/vocation';
import { practiceSkill } from '../src/sim/core/skills';
import { beginConflict, recordConflictBlow } from '../src/sim/social/conflict';
import { BridgeSession } from '../src/bridge/session';
import { createTestWorld, addPerson, v } from './helpers/world';
import { readFileSync } from 'node:fs';

/**
 * Capability before class. These assert the derivation, not the numbers — that a class follows
 * from what someone can do and what they have done, that it never follows from what they are
 * called, and that the player and an NPC are read by the same function.
 */
describe('class recognition', () => {
  it('recognises nobody by default: a life has to have made a pattern first', () => {
    const tw = createTestWorld();
    const p = addPerson(tw, 'Nobody', 'farmer', v(10, 1, 10));
    expect(recogniseClass(tw.world, p)).toBeNull();
  });

  it('reads the same occupation two ways when two lives differ', () => {
    const tw = createTestWorld();
    const worked = addPerson(tw, 'Worked', 'baker', v(10, 1, 10));
    const idle = addPerson(tw, 'Idle', 'baker', v(12, 1, 10));
    for (let i = 0; i < 80; i++) practiceSkill(worked, 'baking');
    expect(recogniseClass(tw.world, worked)?.id).toBe('artisan');
    expect(recogniseClass(tw.world, idle)).toBeNull();
  });

  it('reads two different occupations the same way when the two lives match', () => {
    const tw = createTestWorld();
    const a = addPerson(tw, 'A Cook', 'cook', v(10, 1, 10));
    const b = addPerson(tw, 'A Vagrant', 'vagrant', v(12, 1, 10));
    for (const p of [a, b]) { p.skills = {}; for (let i = 0; i < 80; i++) practiceSkill(p, 'cooking'); }
    const ra = recogniseClass(tw.world, a), rb = recogniseClass(tw.world, b);
    expect(ra?.id).toBe('artisan');
    expect(rb?.id).toBe('artisan');
    expect(ra?.confidence).toBeCloseTo(rb!.confidence, 6);
  });

  it('never reads occupation at all', () => {
    // The one rule this layer exists to keep. A grep over the code (the prose is allowed to say
    // the word) is the honest way to hold it.
    const code = readFileSync(new URL('../src/sim/mind/vocation.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.occupation/);
    expect(code).not.toMatch(/\bOccupation\b/);
  });

  it('separates the maker from the person who works the country', () => {
    const tw = createTestWorld();
    const maker = addPerson(tw, 'Maker', 'traveler', v(10, 1, 10));
    const ranger = addPerson(tw, 'Ranger', 'traveler', v(12, 1, 10));
    for (let i = 0; i < 80; i++) { practiceSkill(maker, 'crafting'); practiceSkill(ranger, 'herbalism'); }
    expect(recogniseClass(tw.world, maker)?.id).toBe('artisan');
    expect(recogniseClass(tw.world, ranger)?.id).toBe('scout');
  });

  it('needs a history of fighting, not a strong body and a blade', () => {
    const tw = createTestWorld();
    const p = addPerson(tw, 'Strong', 'traveler', v(10, 1, 10));
    p.attributes.strength = 0.95;
    expect(recogniseClass(tw.world, p)).toBeNull();
  });

  it('recognises an Armsman from canonical conflicts, and one brawl is not enough', () => {
    const tw = createTestWorld();
    const fighter = addPerson(tw, 'Fighter', 'traveler', v(10, 1, 10));
    const foe = addPerson(tw, 'Foe', 'traveler', v(12, 1, 10));
    fighter.attributes.strength = 0.7;

    const one = beginConflict(tw.world, { initiator: fighter.id, target: foe.id, cause: 'retaliation', intent: 'injure' });
    for (let i = 0; i < 4; i++) recordConflictBlow(tw.world, one, fighter.id, 'injure');
    expect(recogniseClass(tw.world, fighter)).toBeNull();

    const third = addPerson(tw, 'Another', 'traveler', v(14, 1, 10));
    const two = beginConflict(tw.world, { initiator: third.id, target: fighter.id, cause: 'retaliation', intent: 'injure' });
    for (let i = 0; i < 8; i++) recordConflictBlow(tw.world, two, third.id, 'injure');
    const now = recogniseClass(tw.world, fighter);
    expect(now?.id).toBe('armsman');
    expect(now!.evidence.join(' ')).toMatch(/2 conflicts/);
  });

  it('runs the same derivation for the player as for anyone else', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const npc = addPerson(tw, 'Villager', 'farmer', v(12, 1, 10));
    for (const p of [player, npc]) { p.skills = {}; for (let i = 0; i < 60; i++) practiceSkill(p, 'construction'); }
    player.attributes = { ...npc.attributes };
    expect(recogniseClass(tw.world, player)).toEqual(recogniseClass(tw.world, npc));
  });

  it('is a reading, never a modifier: recognition changes no canonical state', () => {
    const tw = createTestWorld();
    const p = addPerson(tw, 'Smith', 'traveler', v(10, 1, 10));
    for (let i = 0; i < 80; i++) practiceSkill(p, 'crafting');
    const body = tw.world.primaryBody(p.id)!;
    const before = JSON.stringify({ skills: p.skills, attributes: p.attributes, speed: body.speed, health: body.health, events: tw.world.events.length });
    recogniseClass(tw.world, p);
    recogniseClass(tw.world, p);
    expect(JSON.stringify({ skills: p.skills, attributes: p.attributes, speed: body.speed, health: body.health, events: tw.world.events.length })).toBe(before);
  });

  it('lowers its confidence when a second reading nearly fits as well', () => {
    const tw = createTestWorld();
    const clear = addPerson(tw, 'Clear', 'traveler', v(10, 1, 10));
    const mixed = addPerson(tw, 'Mixed', 'traveler', v(12, 1, 10));
    for (let i = 0; i < 90; i++) practiceSkill(clear, 'crafting');
    for (let i = 0; i < 90; i++) { practiceSkill(mixed, 'crafting'); practiceSkill(mixed, 'herbalism'); }
    const a = recogniseClass(tw.world, clear)!, b = recogniseClass(tw.world, mixed)!;
    expect(a.id).toBe('artisan');
    expect(b.confidence).toBeLessThan(a.confidence);
  });
});

describe('class recognition on the real village', () => {
  it('names only the few whose capability has actually gone somewhere', () => {
    const s = new BridgeSession();
    const named = s.world.persons().map(p => ({ p, c: recogniseClass(s.world, p) })).filter(r => r.c);
    // Most of Ashford is simply itself. That is the point of the threshold.
    expect(named.length).toBeGreaterThan(0);
    expect(named.length).toBeLessThan(s.world.persons().length / 2);
    // And at least one occupation appears on both sides of the line.
    const byOccupation = new Map<string, Set<string>>();
    for (const p of s.world.persons()) {
      const c = recogniseClass(s.world, p);
      const set = byOccupation.get(p.occupation) ?? new Set<string>();
      set.add(c?.id ?? 'none'); byOccupation.set(p.occupation, set);
    }
    expect([...byOccupation.values()].some(set => set.size > 1)).toBe(true);
  });
});
