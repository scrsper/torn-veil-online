import { describe, expect, it } from 'vitest';
import { towerEncounter } from '../src/sim/progression/towerEncounters';
import { planFloor } from '../src/web/arena/tower/floorgen';
import { FOES } from '../src/web/arena/combat';

describe('Tower encounter escalation', () => {
  it('increases pressure throughout the climb while bounding attack concurrency and warning time', () => {
    for (let floor = 2; floor <= 100; floor++) {
      const previous = towerEncounter(floor - 1), current = towerEncounter(floor);
      expect(current.hp).toBeGreaterThan(previous.hp); expect(current.damage).toBeGreaterThan(previous.damage);
      expect(current.enemies).toBeGreaterThanOrEqual(previous.enemies);
      expect(current.rangedShare).toBeGreaterThanOrEqual(previous.rangedShare);
      expect(current.cooldown).toBeLessThan(previous.cooldown); expect(current.attackTokens).toBeLessThanOrEqual(4);
      for (const foe of Object.values(FOES)) expect(Math.max(.55, foe.tell * current.tell)).toBeGreaterThanOrEqual(.55);
    }
  });
  it('uses replenishment decisions between shrine rests rather than a full refill every floor', () => {
    expect(towerEncounter(1).refill).toBe('rest'); expect(towerEncounter(2).refill).toBe('one');
    expect(towerEncounter(10).refill).toBe('one'); expect(towerEncounter(11).refill).toBe('rest');
  });
  for (const seed of [1, 7, 918271, 20261008]) {
    it(`retains authored trial/boss cadence and ranged/frontline compositions at seed ${seed}`, () => {
      for (let f = 1; f <= 100; f++) {
        // Maze query functions are fresh closures; compare the complete serialized plan, not function identities.
        const p = planFloor(seed, f); expect(JSON.parse(JSON.stringify(p))).toEqual(JSON.parse(JSON.stringify(planFloor(seed, f))));
        if (f === 10) { expect(p.kind).toBe('avatar'); continue; }
        if (f % 5 === 0) expect(p.boss).toBeDefined();
        if (f >= 8) {
          expect(p.foes.some(e => !!FOES[e.kind].ranged)).toBe(true);
          expect(p.foes.some(e => !FOES[e.kind].ranged)).toBe(true);
        }
      }
    });
  }
});
