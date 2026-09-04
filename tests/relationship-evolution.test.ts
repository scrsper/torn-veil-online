import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { evolveRelationships, getRel, adjustRel } from '../src/sim/mind/relationships';
import type { Person } from '../src/sim/core/types';

/**
 * v0.2.3 Priority 1 — deterministic, semantically-shaped relationship evolution.
 * `evolveRelationships(person, hours, ctx)` is a pure transform over a person's relationships.
 */
const NONE = { activeThreatIds: new Set<string>(), unresolvedHarmIds: new Set<string>() };

function pair(seed: number): { a: Person; b: Person } {
  const tw = createTestWorld(seed);
  const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
  const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5));
  return { a, b };
}

describe('relationship evolution (Constitution §7/§11)', () => {
  it('minor fear decays over time once the danger is gone', () => {
    const { a, b } = pair(1);
    getRel(a, b.id).fear = 0.4;
    for (let h = 0; h < 24 * 4; h++) evolveRelationships(a, 1, NONE); // 4 days
    expect(getRel(a, b.id).fear).toBeLessThan(0.05);
  });

  it('minor grudge decays, but markedly slower than fear', () => {
    const { a, b } = pair(2);
    const r = getRel(a, b.id); r.fear = 0.4; r.grudge = 0.4;
    for (let h = 0; h < 60; h++) evolveRelationships(a, 1, NONE); // 2.5 days
    expect(r.fear).toBeLessThan(0.05);
    expect(r.grudge).toBeGreaterThan(r.fear);
    expect(r.grudge).toBeGreaterThan(0.15); // still meaningfully resentful
    expect(r.grudge).toBeLessThan(0.4);     // but fading
  });

  it('repeated reinforcement prevents decay from winning', () => {
    const { a, b } = pair(3);
    const tw = createTestWorld(31); // for adjustRel's world arg
    getRel(a, b.id).grudge = 0.5;
    for (let h = 0; h < 24 * 3; h++) {
      evolveRelationships(a, 1, NONE);
      if (h % 6 === 0) adjustRel(tw.world, a, b.id, { grudge: 0.15 }, 'fresh slight', undefined, true);
    }
    expect(getRel(a, b.id).grudge).toBeGreaterThan(0.5);
  });

  it('a severe grievance lasts far longer than an ordinary grudge', () => {
    const { a, b } = pair(4);
    const rMinor = getRel(a, b.id); rMinor.grudge = 0.5;
    // a second relationship carrying a real grievance (murder of kin, etc.)
    a.relationships['grievor'] = { trust: 0, affection: 0, fear: 0, respect: 0, familiarity: 0.2, grudge: 0.9, grievance: 0.85, tags: [], lastUpdated: 0 };
    for (let d = 0; d < 20; d++) for (let h = 0; h < 24; h++) evolveRelationships(a, 1, NONE); // 20 days
    expect(rMinor.grudge).toBeLessThan(0.1);                 // ordinary grudge is gone
    expect(a.relationships['grievor'].grudge).toBeGreaterThan(0.6); // the grievance floor holds
  });

  it('an active threat prevents inappropriate cooling of fear and grudge', () => {
    const { a, b } = pair(5);
    const r = getRel(a, b.id); r.fear = 0.7; r.grudge = 0.7;
    const ctx = { activeThreatIds: new Set([b.id]), unresolvedHarmIds: new Set<string>() };
    for (let h = 0; h < 24 * 3; h++) evolveRelationships(a, 1, ctx);
    expect(r.fear).toBeCloseTo(0.7, 5);
    expect(r.grudge).toBeCloseTo(0.7, 5);
  });

  it('is deterministic — identical inputs give identical outputs', () => {
    const run = () => {
      const { a, b } = pair(6);
      const r = getRel(a, b.id); r.fear = 0.55; r.grudge = 0.6; r.trust = -0.4;
      for (let h = 0; h < 50; h++) evolveRelationships(a, 1, NONE);
      return { fear: r.fear, grudge: r.grudge, trust: r.trust };
    };
    expect(run()).toEqual(run());
  });

  it('does not touch affection, respect, or familiarity on a combat timescale', () => {
    const { a, b } = pair(7);
    const r = getRel(a, b.id);
    r.fear = 0.6; r.affection = 0.8; r.respect = 0.5; r.familiarity = 0.7;
    for (let h = 0; h < 24 * 5; h++) evolveRelationships(a, 1, NONE);
    expect(r.affection).toBe(0.8);
    expect(r.respect).toBe(0.5);
    expect(r.familiarity).toBe(0.7);
  });

  it('negative trust recovers slowly toward neutral; positive trust is left alone', () => {
    const { a, b } = pair(8);
    const r = getRel(a, b.id); r.trust = -0.8;
    a.relationships['friend'] = { trust: 0.6, affection: 0, fear: 0, respect: 0, familiarity: 0.3, grudge: 0, tags: [], lastUpdated: 0 };
    for (let h = 0; h < 24 * 6; h++) evolveRelationships(a, 1, NONE);
    expect(r.trust).toBeGreaterThan(-0.8);
    expect(r.trust).toBeLessThanOrEqual(0);
    expect(a.relationships['friend'].trust).toBe(0.6);
  });
});
