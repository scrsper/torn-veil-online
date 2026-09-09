import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/core/world';
import { generateSettlementSpec, settlementSeed } from '../src/sim/world/settlementSpec';
import { generateProceduralWorld } from '../src/sim/world/settlement';
import { householdConsistencyErrors } from '../src/sim/world/household';
import { TRADE_MAKES, TRADE_NEEDS, tradesThatMake } from '../src/sim/world/supply';
import { generateLogisticsNeeds } from '../src/sim/logistics/haul';
import { generateProductionNeeds } from '../src/sim/world/production';
import { marry } from '../src/sim/world/demographics';
import { getRel } from '../src/sim/mind/relationships';
import { localPlaces, near } from '../src/sim/world/locality';
import { serialize, deserialize } from '../src/sim/persist/save';
import { knownFoodPlace, learnPlace } from '../src/sim/mind/knowledge';
import { findAccessibleFood } from '../src/sim/world/metabolism';
import { settlementStateDigest } from '../src/headless/worldlab/settlements';
import { physiologyProfileFor } from '../src/sim/core/species';
import { RegionalGrid } from '../src/sim/physical/regionalGrid';

describe('procedural settlements', () => {
  it('rejects regional extents that would alias distinct physical voxels', () => {
    expect(() => new RegionalGrid(Number.MAX_SAFE_INTEGER, 496, 42)).toThrow('exact voxel indexing');
    expect(() => new RegionalGrid(512, -1, 42)).toThrow('exact voxel indexing');
  });
  it('derives stable seeds from the complete site tuple', () => {
    const site = { id: 'a', x: 256, z: 128 };
    expect(settlementSeed(42, site)).toBe(settlementSeed(42, { ...site }));
    expect(new Set([settlementSeed(42, site), settlementSeed(43, site), settlementSeed(42, { ...site, x: 257 }), settlementSeed(42, { ...site, id: 'b' })]).size).toBe(4);
  });
  it('generates plausible and structurally different families and economies across 24 seeds', () => {
    const signatures = new Set<string>(), biographies = new Set<string>();
    for (let seed = 0; seed < 24; seed++) {
      const site = { id: 'a', x: 256, z: 128 }, spec = generateSettlementSpec(seed, site);
      expect(spec).toEqual(generateSettlementSpec(seed, site));
      expect(spec.residents.length).toBeGreaterThanOrEqual(8);
      expect(new Set(spec.residents.map(p => p.name)).size).toBe(spec.residents.length);
      for (const p of spec.residents) {
        for (const id of p.parents) {
          const parent = spec.residents.find(q => q.key === id)!;
          const ages = physiologyProfileFor('human').fertileAges[parent.gender === 'f' ? 'gestational' : 'fertilizing'];
          expect(parent.age - p.age).toBeGreaterThanOrEqual(ages[0]);
          expect(parent.age - p.age).toBeLessThanOrEqual(ages[1]);
        }
        if (p.spouse) { const q = spec.residents.find(q => q.key === p.spouse)!; expect(q.spouse).toBe(p.key); expect(q.household).toBe(p.household); expect(Math.min(p.age, q.age)).toBeGreaterThanOrEqual(18); }
      }
      for (const role of spec.roles) {
        expect(TRADE_MAKES[role]?.length).toBeGreaterThan(0);
        for (const input of TRADE_NEEDS[role] ?? []) expect(tradesThatMake(input).some(p => spec.roles.includes(p))).toBe(true);
      }
      signatures.add(JSON.stringify([spec.biome, spec.resources.fields, spec.roles.slice().sort(), spec.residents.map(p => [p.age, p.household, p.parents.length])]));
      biographies.add(JSON.stringify(spec.history));
    }
    expect(signatures.size).toBeGreaterThanOrEqual(20); expect(biographies.size).toBeGreaterThanOrEqual(20);
  });
  it('fits navigable non-overlapping structures across 16 seeds', () => {
    for (let seed = 0; seed < 16; seed++) {
      const w = new World(seed), [s] = generateProceduralWorld(w, [{ id: 'a', x: 256, z: 128 }]);
      expect(householdConsistencyErrors(w)).toEqual([]);
      const places = Object.values(s.places);
      for (const p of places) {
        expect(w.nav.isWalkable(Math.floor(p.inside.x), Math.floor(p.inside.z)), p.slug).toBe(true);
        expect(w.nav.findPath(s.places.square.inside, p.inside), p.slug).not.toBeNull();
      }
      for (let i = 0; i < places.length; i++) for (const q of places.slice(i + 1)) {
        const p = places[i].bounds, b = q.bounds;
        expect(p.x1 < b.x0 || b.x1 < p.x0 || p.z1 < b.z0 || b.z1 < p.z0).toBe(true);
      }
      expect(w.fields.length).toBe(s.spec.resources.fields);
      for (const home of places.filter(p => p.type === 'house')) expect(home.anchors.filter(a => a.kind === 'bed').length).toBeGreaterThanOrEqual(home.residents.length);
    }
  }, 120000);
  it('keeps demands and relationships local in one shared world', () => {
    const w = new World(42), settlements = generateProceduralWorld(w);
    expect(new Set(settlements.map(s => s.spec.seed)).size).toBe(4);
    generateProductionNeeds(w); generateLogisticsNeeds(w);
    for (const task of w.haulTasks) expect(near(w.place(task.sourcePlaceId)?.inside, w.place(task.destPlaceId)?.inside)).toBe(true);
    const a = Object.values(settlements[0].people).find(p => p.age >= 18)!;
    const b = Object.values(settlements[1].people).find(p => p.age >= 18 && p.gender !== a.gender)!;
    a.relationships = {}; b.relationships = {};
    Object.assign(getRel(a, b.id), { affection: 1, trust: 1, familiarity: 1 }); Object.assign(getRel(b, a.id), { affection: 1, trust: 1, familiarity: 1 });
    expect(marry(w, a, b)).toBe(false);
    expect(localPlaces(w, w.positionOf(a.id)).every(p => p.slug?.startsWith('site_0:'))).toBe(true);
    a.knowledge = {};
    learnPlace(w, a, settlements[1].places.bakery, { type: 'prior' });
    expect(knownFoodPlace(w, a)).toBeUndefined();
    w.primaryBody(a.id)!.pos = { ...settlements[1].places.square.inside };
    expect(findAccessibleFood(w, a, a.homeId)).toBeNull();
    for (const s of settlements) for (const p of Object.values(s.places)) expect(w.nav.findPath(s.places.square.inside, p.inside), p.slug).not.toBeNull();
    expect(w.nav.isWalkable(500_000_000, 250)).toBe(true); // Wilderness between sites is real terrain.
  }, 30000);
  it('reproduces full canonical generation and persists the procedural recipe and remote geometry', () => {
    const sites = [{ id: 'a', x: 256, z: 128 }, { id: 'b', x: 3_000_000_256, z: 128 }];
    const a = new World(7), b = new World(7);
    const sa = generateProceduralWorld(a, sites); generateProceduralWorld(b, [...sites].reverse());
    expect(settlementStateDigest(a)).toBe(settlementStateDigest(b));
    const point = sa[1].places.square.inside;
    a.grid.set(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z), 1);
    const loaded = deserialize(serialize(a));
    expect(loaded).not.toBeNull();
    expect(loaded!.world.settlementSites).toEqual(sites);
    expect(loaded!.world.persons().map(p => [p.name, p.homeId, p.parentIds])).toEqual(a.persons().map(p => [p.name, p.homeId, p.parentIds]));
    expect(loaded!.world.grid.get(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z))).toBe(1);
  }, 30000);
});
