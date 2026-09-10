import type { Person } from '../core/types';
import type { World } from '../core/world';
import type { Assembly, ComponentDefinition, Ruleset } from './types';
import { materialOf } from '../core/materials';
import { RESOURCE_MASS_KG } from '../world/factory';
import { stockItemsAt, outboundStock, retireStack } from '../world/stock';
import { getPhysicalCapability } from '../core/attributes';
import { practiceSkill, skillOf } from '../core/skills';
import { bestToolFor, toolWorkMultiplier, wearTool } from '../core/tools';
import { createComponent, reachable, owns, mayUseProperty } from './mechanics';
import { materialFits, mechanicalPrimitives, validateRuleset } from './definitions';

/** Narrow legacy boundary: actual stock measures and existing material hardness. Authored
 * primitive shapes are expanded over compatible material data, never finished arrangements. */
export function settlementPrimitives(): Ruleset {
  const r = mechanicalPrimitives(), q = (s: string) => `${r.id}/${s}`;
  // The reference workshop declares its own measures. Ordinary settlements use the existing
  // inventory/carry masses. Re-express mass-conserving output in those actual stock measures;
  // copying the workshop's 3:4 quantity ratio would silently gain mass at this boundary.
  for (const material of r.materials) if (material.legacyItem && RESOURCE_MASS_KG[material.legacyItem]) material.kgPerUnit = RESOURCE_MASS_KG[material.legacyItem]!;
  const mass = (flow: { material: string; quantity: number }) => r.materials.find(m => m.id === flow.material)!.kgPerUnit * flow.quantity;
  for (const process of r.processes) process.output.quantity = (mass(process.input) - process.byproducts.reduce((n, f) => n + mass(f), 0)) / r.materials.find(m => m.id === process.output.material)!.kgPerUnit;
  for (const item of ['log', 'plank', 'stone'] as const) r.materials.push({ id: q(`stock-${item}`), unit: `legacy ${item} measure`,
    kgPerUnit: RESOURCE_MASS_KG[item]!, phase: 'solid', maxPowerW: 180, legacyItem: item,
    properties: { hardness: materialOf(item)!.hardness } });
  const shapes = r.components;
  r.components = [];
  for (const shape of shapes) {
    // Working wood has an upper hardness limit; an abrasive work surface has a lower one.
    const fabrication = shape.kind === 'process'
      ? { seconds: 8, min: { hardness: 0.7 } }
      : { seconds: shape.massKg, min: { hardness: 0.2 }, max: { hardness: 0.6 } };
    for (const material of r.materials.filter(m => m.legacyItem && materialFits(m, fabrication)))
      r.components.push({ ...shape, id: `${shape.id}~${material.id.split('/').at(-1)}`, material: material.id, fabrication });
  }
  validateRuleset(r); return r;
}

export function manufactureStock(world: World, p: Person, definition: ComponentDefinition, placeId: string): number {
  const material = world.kernel.ruleset.materials.find(m => m.id === definition.material);
  const place = world.place(placeId);
  if (!material?.legacyItem || !definition.fabrication || !place || !mayUseProperty(world, p, place.ownerId, placeId) || !reachable(world, p, place.inside)) return 0;
  return Math.max(0, stockItemsAt(world, material.legacyItem, placeId).filter(i => owns(p, i.ownerId) && !!i.pos && reachable(world, p, i.pos))
    .reduce((n, i) => n + i.quantity, 0) - outboundStock(world, material.legacyItem, placeId));
}

/** Paid, interruptible manufacture within the existing assembly project. Stock is checked
 * before each labor slice and debited atomically on completion. Partial work is not a part. */
export function manufactureComponent(world: World, p: Person, a: Assembly, definition: ComponentDefinition, seconds: number): 'missing' | 'working' | 'made' | 'inaccessible' {
  const canonical = world.kernel.ruleset.components.find(d => d.id === definition.id);
  if (!canonical || a.method.definitions[a.parts.length] !== canonical.id) return 'inaccessible';
  definition = canonical; // beliefs/callers cannot lower the actual material or labor bill
  const f = definition.fabrication, material = world.kernel.ruleset.materials.find(m => m.id === definition.material);
  const placeId = a.bindings.placeId;
  if (a.ownerId !== p.id || !reachable(world, p, a.pos) || !placeId || !f || !material?.legacyItem || !materialFits(material, f)
    || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60) return 'inaccessible';
  const quantity = definition.massKg / material.kgPerUnit;
  if (manufactureStock(world, p, definition, placeId) + 1e-9 < quantity) return 'missing';
  const capacity = getPhysicalCapability(p, world).currentExertionCapacity;
  if (capacity <= 0.15) return 'inaccessible';
  const rawTool = bestToolFor(world, p, 'construct', placeId);
  const tool = rawTool && owns(p, rawTool.ownerId) ? rawTool : null;
  const rate = toolWorkMultiplier('construct', tool) * (0.5 + skillOf(p, 'crafting')) * capacity;
  const key = `make:${a.parts.length}`, progress = a.progress[key] ?? 0;
  const spent = Math.min(seconds, Math.max(0, f.seconds - progress) / rate);
  a.progress[key] = progress + spent * rate; a.laborSeconds += spent;
  a.progress[`makeLabor:${a.parts.length}`] = (a.progress[`makeLabor:${a.parts.length}`] ?? 0) + spent;
  wearTool(world, tool, spent * world.clock.timeScale / 3600);
  if (a.progress[key] < f.seconds - 1e-9) return 'working';
  let remaining = quantity;
  const consumed: { itemId: string; quantity: number }[] = [], causes = a.lastEvent ? [a.lastEvent] : [];
  for (const item of stockItemsAt(world, material.legacyItem, placeId).filter(i => owns(p, i.ownerId) && !!i.pos && reachable(world, p, i.pos)).sort((x, y) => x.id.localeCompare(y.id))) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, item.quantity); remaining -= take; item.quantity -= take;
    consumed.push({ itemId: item.id, quantity: take });
    const origin = item.provenance.at(-1)?.eventId; if (origin) causes.push(origin);
    if (item.quantity <= 1e-9) { item.quantity = 0; retireStack(world, item); }
  }
  const c = createComponent(world, definition.id, p.id, a.pos);
  const ev = world.emit('component_manufactured', { actor: p.id, placeId, pos: a.pos, causes: [...new Set(causes)], visibility: 8, significance: 0.4,
    data: { componentId: c.id, assemblyId: a.id, definition: definition.id, material: material.id, consumed, massKg: definition.massKg,
      laborSeconds: a.progress[`makeLabor:${a.parts.length}`], toolId: tool?.id }, summary: `${p.name} shaped material into a working component` });
  c.madeEvent = ev.id; a.lastEvent = ev.id;
  delete a.progress[key]; delete a.progress[`makeLabor:${a.parts.length}`]; practiceSkill(p, 'crafting', 1);
  return 'made';
}
