import { setExternalControl } from '../../sim/runtime/controllers';
import { newWorld } from '../../sim/persist/save';
import { Simulation } from '../../sim/mind/agent';
import { makeBody, makePerson, makePlace } from '../../sim/world/factory';
import { addPlaceStock, stockItemsAt } from '../../sim/world/stock';
import { B } from '../../sim/physical/blocks';
import { installRuleset, mechanicalPrimitives } from '../../sim/kernel/definitions';
import { createComponent } from '../../sim/kernel/mechanics';
import { methodsHeld, practicalNeed, teachPrimitive } from '../../sim/mind/invention';
import { RNG } from '../../sim/core/rng';
import type { World } from '../../sim/core/world';
import type { Ruleset } from '../../sim/kernel/types';
import held from './held-out.json';

/** Short controlled workshop, on the ordinary canonical world/save path. Fixtures provide
 * primitive stock, a finite gust's energy, needs and primitive knowledge. No assembly or method.
 * Other residents are controlled to isolate the short mechanics demonstration from survival. */
export function createKernelLab(seed = 918271, family: 'grain' | 'water' = 'grain', control = false, heldOut = false) {
  const { world } = newWorld(seed);
  for (const p of world.persons()) setExternalControl(p, true);
  world.clock.timeScale = 1;
  for (let x = 4; x <= 18; x++) for (let z = 4; z <= 18; z++) {
    world.grid.set(x, 0, z, B.Stone);
    for (let y = 1; y < world.grid.H; y++) world.grid.set(x, y, z, B.Air);
  }
  world.nav.rebuildAll();
  const pos = { x: 10.5, y: 1, z: 10.5 };
  const place = makePlace(world, 'square', 'workshop', { x0: 8, x1: 13, z0: 8, z1: 13, y0: 1, y1: 4 }, { inside: pos, indoor: false });
  const rules = mechanicalPrimitives();
  if (heldOut) {
    rules.materials.push(...held.materials as Ruleset['materials']);
    rules.components = [...rules.components.filter(c => c.kind !== 'transmission'), ...held.components as Ruleset['components']];
  }
  installRuleset(world.kernel, rules);
  const id = (name: string) => `${rules.id}/${name}`;
  const inventors = ['A', 'B'].map((name, i) => {
    const p = makePerson(world, { name, age: 28, gender: 'f', occupation: 'villager', home: place.id, traits: { curiosity: 0.7, sociability: 0.3 }, appearance: {}, bio: 'A workshop resident with an unmet practical need.', wealth: 10 });
    // This regression workshop exercises discovery through an initially poor hypothesis.
    // Explicit reference cognition keeps that fixture stable as ordinary people now vary.
    p.attributes.intellect = p.attributes.will = 8;
    const body = makeBody(world, p.id, { ...pos, x: pos.x + i * 0.8 }); p.bodies.push(body.id);
    p.schedule = [{ start: 0, end: 24, activity: 'idle', placeId: place.id, label: 'at the workshop' }];
    p.mind.thinkInterval = 0.25;
    for (const d of rules.components) {
      const c = createComponent(world, d.id, p.id, pos);
      if (control && d.id === id('belt')) c.condition = 0;
      if (i === 0) teachPrimitive(world, p, d);
    }
    addPlaceStock(world, 'grain', 30, place.id, p.id, undefined, 'initial workshop stock');
    const inputId = world.nextId('reservoir'), outputId = world.nextId('reservoir');
    const liquid = id(heldOut ? 'held-dense-liquid' : 'water');
    world.kernel.reservoirs.push({ id: inputId, material: liquid, quantity: 20, capacity: 20, pos: { ...pos }, ownerId: p.id }, { id: outputId, material: liquid, quantity: 0, capacity: 20, pos: { ...pos }, ownerId: p.id });
    const energyId = world.nextId('energy');
    world.kernel.energy.push({ id: energyId, medium: 'kinetic', initialJ: 5000, remainingJ: 5000, maxPowerW: 110 + Math.floor(new RNG(seed).next() * 20), origin: 'Finite 5000 J kinetic-energy parcel from a modeled gust; initial boundary stock, no recharge.', pos: { ...pos }, ownerId: p.id });
    practicalNeed(world, p, 'workshop-need', { effect: family === 'grain' ? id('grinding') : 'transfer:liquid', targetQuantity: family === 'grain' ? 3 : 2,
      bindings: family === 'grain' ? { energyId, placeId: place.id } : { energyId, inputId, outputId }, pos });
    return p;
  });
  return { world, sim: new Simulation(world), inventor: inventors[0], recipient: inventors[1], place, family, control, seed, heldOut };
}
export function advanceKernelLab(world: World, sim: Simulation, seconds: number): void {
  const steps = Math.round(seconds / 0.1);
  for (let i = 0; i < steps; i++) { const dt = 0.1; const wd = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, wd); sim.flushSpeech(); }
}
export function kernelMetrics(lab: ReturnType<typeof createKernelLab>) {
  const { world } = lab;
  return { seed: lab.seed, family: lab.family, control: lab.control, heldOut: lab.heldOut, physicalSeconds: Number(world.physicalTime.toFixed(3)),
    people: [lab.inventor, lab.recipient].map(original => {
      const p = world.person(original.id)!;
      const assemblies = world.kernel.assemblies.filter(a => a.ownerId === p.id);
      const output = lab.family === 'grain' ? stockItemsAt(world, 'flour', lab.place.id).filter(i => i.ownerId === p.id).reduce((n, i) => n + i.quantity, 0) : world.kernel.reservoirs.find(r => r.id === p.knowledge['workshop-need'].claim.practicalNeed.bindings.outputId)!.quantity;
      return { id: p.id, output, methods: methodsHeld(p).map(k => ({ source: k.source.type, from: k.source.from, viaEvent: k.source.viaEvent, definitions: k.claim.method.definitions })),
        trials: world.events.filter(e => e.type === 'mechanism_trial' && e.actor === p.id).map(e => e.data),
        laborSeconds: assemblies.reduce((n, a) => n + a.laborSeconds, 0), operationSeconds: assemblies.reduce((n, a) => n + a.operatedSeconds, 0),
        inputJ: assemblies.reduce((n, a) => n + a.inputJ, 0), usefulJ: assemblies.reduce((n, a) => n + a.usefulJ, 0), dissipatedJ: assemblies.reduce((n, a) => n + a.dissipatedJ, 0),
        acquired: world.events.filter(e => e.type === 'component_acquired' && e.actor === p.id).length,
        componentMassKg: world.kernel.components.filter(c => c.ownerId === p.id).reduce((n, c) => n + world.kernel.ruleset.components.find(d => d.id === c.definition)!.massKg, 0),
        grain: stockItemsAt(world, 'grain', lab.place.id).filter(i => i.ownerId === p.id).reduce((n, i) => n + i.quantity, 0), wealth: p.wealth,
      };
    }),
  };
}
