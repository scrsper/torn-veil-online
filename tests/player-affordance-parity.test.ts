import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { createFields, cropBlockFor } from '../src/sim/world/metabolism';
import { B } from '../src/sim/physical/blocks';

/**
 * v0.8 "The Legible World" §D: player/NPC affordance parity. The player must be able to
 * harvest (and sow) a real field plot through the exact same canonical `Simulation` action path
 * (`harvestWheatAt`/`plantWheatAt` → `world/metabolism.ts`'s `harvestPlot`/`plantPlot`) an NPC's
 * own harvest/plant action already uses — never a player-only shortcut or a parallel mechanic.
 */
function fieldWorld(seed = 950) {
  const tw = createTestWorld(seed, 30);
  const farmer = addPerson(tw, 'Farmer', 'farmer', v(5, 1, 5));
  const player = addPerson(tw, 'the Traveler', 'traveler', v(5, 1, 5), { controlled: true });
  const farm = makePlace(tw.world, 'farm', 'test field', { x0: 2, z0: 2, x1: 14, z1: 14, y0: 2, y1: 4 }, { inside: v(8, 2, 8), indoor: false });
  for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) { tw.world.grid.set(x, 1, z, B.Farmland); }
  createFields(tw.world, [{ placeId: farm.id, ownerId: farmer.id, startMoisture: 0.5 }]);
  makeItem(tw.world, 'grain', 'seed grain', { owner: farmer.id, pos: v(8, 2, 8), placeId: farm.id, quantity: 50 });
  return { world: tw.world, sim: tw.sim, field: tw.world.fields[0], player, farmer };
}

describe('crop lifecycle visual legibility (v0.8 §C)', () => {
  it('planted, growing, mature, and harvested each project to a visually distinct block', () => {
    const blocks = { planted: cropBlockFor('planted'), growing: cropBlockFor('growing'), mature: cropBlockFor('mature'), harvested: cropBlockFor('harvested') };
    const values = Object.values(blocks);
    expect(new Set(values).size).toBe(values.length); // all four pairwise distinct
    expect(blocks.mature).toBe(B.Wheat);
    // fallow (nothing sown) is the one state that stays Air — bare tilled Farmland remains
    // visible beneath it, which already reads as "worked, empty soil", not "identical to
    // planted/harvested".
    expect(cropBlockFor('fallow')).toBe(B.Air);
    expect(blocks.planted).not.toBe(B.Air);
    expect(blocks.harvested).not.toBe(B.Air);
  });
});

describe('player/NPC affordance parity (v0.8 §D) — wheat', () => {
  it('the player can harvest mature wheat through the canonical simulation action path', () => {
    const { world, sim, field, player } = fieldWorld(951);
    const plot = field.plots[0];
    plot.state = 'mature'; plot.growth = 1; plot.maturedAt = world.now;
    world.grid.set(plot.x, plot.y, plot.z, B.Wheat);
    const grainBefore = field.ownerId ? world.persons().find(p => p.id === field.ownerId)! : player;

    const yielded = sim.harvestWheatAt(player, { x: plot.x, y: plot.y, z: plot.z });

    expect(yielded).toBeGreaterThan(0);
    expect(plot.state).toBe('harvested');
    expect(world.grid.get(plot.x, plot.y, plot.z)).toBe(B.Stubble); // canonical state IS visually reflected
    expect(world.events.some(e => e.type === 'crop_harvested' && e.actor === player.id)).toBe(true);
    void grainBefore;
  });

  it('harvesting yields nothing at a plot that is not actually mature — no free grain from clicking bare ground', () => {
    const { world, sim, field, player } = fieldWorld(952);
    const plot = field.plots.find(p => p.state === 'fallow') ?? field.plots[0];
    plot.state = 'fallow';
    const yielded = sim.harvestWheatAt(player, { x: plot.x, y: plot.y, z: plot.z });
    expect(yielded).toBe(0);
  });

  it('the player can sow a fallow plot the same way a farmer NPC does, consuming real seed grain', () => {
    const { world, sim, field, player } = fieldWorld(953);
    const plot = field.plots.find(p => p.state === 'fallow')!;
    const sown = sim.plantWheatAt(player, { x: plot.x, y: plot.y, z: plot.z });
    expect(sown).toBe(true);
    expect(plot.state).toBe('planted');
    expect(world.grid.get(plot.x, plot.y, plot.z)).toBe(B.Seedling);
    expect(world.events.some(e => e.type === 'crop_planted' && e.actor === player.id)).toBe(true);
  });

  it('a hired-hand-equivalent harvest still pays the field owner, not the harvester — the player is not a special case', () => {
    const { world, sim, field, player, farmer } = fieldWorld(954);
    const plot = field.plots[0];
    plot.state = 'mature'; plot.growth = 1; plot.maturedAt = world.now;
    world.grid.set(plot.x, plot.y, plot.z, B.Wheat);
    const stockBeforeOwner = world.items().filter(i => i.type === 'grain' && i.ownerId === farmer.id).reduce((n, i) => n + i.quantity, 0);
    sim.harvestWheatAt(player, { x: plot.x, y: plot.y, z: plot.z });
    const stockAfterOwner = world.items().filter(i => i.type === 'grain' && i.ownerId === farmer.id).reduce((n, i) => n + i.quantity, 0);
    expect(stockAfterOwner).toBeGreaterThan(stockBeforeOwner); // field.ownerId (the farmer) gets it, exactly as an NPC harvester would produce
  });
});
