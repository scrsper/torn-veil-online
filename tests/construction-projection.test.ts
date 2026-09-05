import { describe, it, expect } from 'vitest';
import { createTestWorld } from './helpers/world';
import { createConstructionProject, contributeBuildLabor, stepConstruction } from '../src/sim/world/construction';
import { addPlaceStock } from '../src/sim/world/stock';
import { addPerson } from './helpers/world';
import { deriveConstructionPresentation } from '../src/game/presentation/constructionProjector';
import { v } from './helpers/world';

describe('ConstructionProjector — deriveConstructionPresentation', () => {
  it('a zero-material project derives site state', () => {
    const tw = createTestWorld();
    const site = tw.world.place(tw.places.square)!;
    const proj = createConstructionProject(tw.world, {
      name: 'Test Shed', template: 'storage_shed', siteBounds: { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 5 },
      sitePlaceId: site.id, required: [{ type: 'plank', quantity: 10 }, { type: 'stone', quantity: 4 }], ownerId: null,
    });
    const p = deriveConstructionPresentation(tw.world, proj);
    expect(p.stage).toBe('site');
    expect(p.materialsFraction).toBe(0);
    expect(p.materials.every(m => m.delivered === 0)).toBe(true);
    expect(p.cues.some(c => c.type === 'completion')).toBe(false);
  });

  it('real delivered material changes cues and advances to the materials stage', () => {
    const tw = createTestWorld();
    const site = tw.world.place(tw.places.square)!;
    const proj = createConstructionProject(tw.world, {
      name: 'Test Shed', template: 'storage_shed', siteBounds: { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 5 },
      sitePlaceId: site.id, required: [{ type: 'plank', quantity: 10 }, { type: 'stone', quantity: 4 }], ownerId: null,
    });
    addPlaceStock(tw.world, 'plank', 10, site.id, null, undefined, 'test delivery');
    // Stone not yet delivered — materials fraction must reflect the SMALLEST ratio, not planks alone.
    let p = deriveConstructionPresentation(tw.world, proj);
    expect(p.stage).toBe('materials');
    expect(p.materials.find(m => m.type === 'plank')?.bucket).toBe('many');
    expect(p.materials.find(m => m.type === 'stone')?.bucket).toBe('none');
    expect(p.cues.some(c => c.type === 'show_material' && c.data?.type === 'plank')).toBe(true);
    expect(p.cues.some(c => c.type === 'show_material' && c.data?.type === 'stone')).toBe(false);

    addPlaceStock(tw.world, 'stone', 4, site.id, null, undefined, 'test delivery');
    p = deriveConstructionPresentation(tw.world, proj);
    expect(p.materialsFraction).toBe(1);
    expect(p.stage).toBe('foundation'); // materials complete, no labour yet
  });

  it('stage advances with real labor once materials are complete', () => {
    const tw = createTestWorld();
    const site = tw.world.place(tw.places.square)!;
    const worker = addPerson(tw, 'Builder', 'apprentice', v(4, 1, 4));
    const proj = createConstructionProject(tw.world, {
      name: 'Test Shed', template: 'storage_shed', siteBounds: { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 5 },
      sitePlaceId: site.id, required: [{ type: 'plank', quantity: 10 }], ownerId: null, laborRequired: 1000,
    });
    addPlaceStock(tw.world, 'plank', 10, site.id, null, undefined, 'test delivery');
    stepConstruction(tw.world); // gathering -> ready

    contributeBuildLabor(tw.world, proj, worker, 200); // 20%
    expect(deriveConstructionPresentation(tw.world, proj).stage).toBe('foundation');

    contributeBuildLabor(tw.world, proj, worker, 250); // 45%
    expect(deriveConstructionPresentation(tw.world, proj).stage).toBe('frame');

    contributeBuildLabor(tw.world, proj, worker, 250); // 70%
    expect(deriveConstructionPresentation(tw.world, proj).stage).toBe('walls');

    contributeBuildLabor(tw.world, proj, worker, 250); // 95%
    expect(deriveConstructionPresentation(tw.world, proj).stage).toBe('roof');
  });

  it('never claims a stage past materials when a required material is entirely absent, however much labour is recorded', () => {
    const tw = createTestWorld();
    const site = tw.world.place(tw.places.square)!;
    const proj = createConstructionProject(tw.world, {
      name: 'Test Shed', template: 'storage_shed', siteBounds: { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 5 },
      sitePlaceId: site.id, required: [{ type: 'plank', quantity: 10 }, { type: 'stone', quantity: 8 }], ownerId: null, laborRequired: 1000,
    });
    addPlaceStock(tw.world, 'plank', 10, site.id, null, undefined, 'test delivery');
    // Force labour credit directly (bypassing the real gate) to prove the PROJECTOR itself, not
    // just the simulation's own gating, refuses to imply stone is present.
    proj.status = 'building'; proj.laborDone = 600; // 60% of laborRequired
    const p = deriveConstructionPresentation(tw.world, proj);
    expect(p.stage).toBe('materials');
    expect(p.materials.find(m => m.type === 'stone')?.delivered).toBe(0);
  });

  it('a complete project emits no intermediate-stage presentation', () => {
    const tw = createTestWorld();
    const site = tw.world.place(tw.places.square)!;
    const proj = createConstructionProject(tw.world, {
      name: 'Test Shed', template: 'storage_shed', siteBounds: { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 5 },
      sitePlaceId: site.id, required: [], ownerId: null, laborRequired: 100,
    });
    proj.status = 'complete'; proj.laborDone = 100;
    const p = deriveConstructionPresentation(tw.world, proj);
    expect(p.stage).toBe('complete');
    expect(p.cues).toEqual([
      { type: 'completion', placeId: site.id },
      { type: 'hide_temporary_visual', placeId: site.id },
    ]);
  });

  it('derivation is deterministic for the same canonical state', () => {
    const tw = createTestWorld();
    const site = tw.world.place(tw.places.square)!;
    const proj = createConstructionProject(tw.world, {
      name: 'Test Shed', template: 'storage_shed', siteBounds: { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 5 },
      sitePlaceId: site.id, required: [{ type: 'plank', quantity: 10 }], ownerId: null, laborRequired: 1000,
    });
    addPlaceStock(tw.world, 'plank', 6, site.id, null, undefined, 'test delivery');
    const a = deriveConstructionPresentation(tw.world, proj);
    const b = deriveConstructionPresentation(tw.world, proj);
    expect(a).toEqual(b);
  });

  it('does not mutate the project or world state', () => {
    const tw = createTestWorld();
    const site = tw.world.place(tw.places.square)!;
    const proj = createConstructionProject(tw.world, {
      name: 'Test Shed', template: 'storage_shed', siteBounds: { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 5 },
      sitePlaceId: site.id, required: [{ type: 'plank', quantity: 10 }], ownerId: null, laborRequired: 1000,
    });
    addPlaceStock(tw.world, 'plank', 6, site.id, null, undefined, 'test delivery');
    const before = JSON.parse(JSON.stringify(proj));
    const itemCountBefore = tw.world.items().length;
    deriveConstructionPresentation(tw.world, proj);
    expect(JSON.parse(JSON.stringify(proj))).toEqual(before);
    expect(tw.world.items().length).toBe(itemCountBefore);
  });
});
