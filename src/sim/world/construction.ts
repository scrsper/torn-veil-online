import type { ConstructionProject, ConstructionRequirement, ItemType, Person, Place, Vec3, EntityId } from '../core/types';
import type { World } from '../core/world';
import { B } from '../physical/blocks';
import { stockAt, takePlaceStock } from './stock';
import { createHaulTask, openHaulTasks, carryCapFor } from '../logistics/haul';

/**
 * Construction projects (v0.3 Living World I, Priority 9-10-12).
 *
 * A project is a place-bound material manifest plus a labour requirement. Creating it does NOT
 * create the structure — the required materials must physically arrive at the site (delivered
 * by haul tasks), and actual `build` labour must be performed, before the world lays permanent
 * blocks. Only then does canonical world state change: the site Place becomes a usable
 * structure, collision/navigation updates, and the voxel client shows it.
 *
 * Resource availability and labour availability are separate (Priority 12): a fully-supplied
 * site with no workers does not complete on its own; `contributions` records person-seconds
 * per worker as the hook a future wage system reads.
 */

/** World-seconds of accumulated `build` work a project needs once its materials are in. */
const DEFAULT_LABOR_SECONDS = 4 * 3600;
/** Emit a `construction_progress` marker at most this often (world-seconds of progress). */
const PROGRESS_EVENT_EVERY = 900;
/** Max concurrent builders on one project (deterministic — first N by id). */
export const MAX_BUILDERS = 3;

export interface ConstructionProjectSpec {
  name: string;
  template: 'storage_shed';
  siteBounds: ConstructionProject['siteBounds'];
  sitePlaceId: EntityId;
  required: ConstructionRequirement[];
  ownerId: EntityId | null;
  laborRequired?: number;
}

export function createConstructionProject(world: World, s: ConstructionProjectSpec): ConstructionProject {
  const p: ConstructionProject = {
    id: world.nextId('proj'), name: s.name, template: s.template, siteBounds: s.siteBounds, sitePlaceId: s.sitePlaceId,
    required: s.required.map(r => ({ ...r })), laborRequired: s.laborRequired ?? DEFAULT_LABOR_SECONDS, laborDone: 0,
    contributions: {}, status: 'gathering', ownerId: s.ownerId, createdAt: world.now,
  };
  world.constructionProjects.push(p);
  world.emit('construction_started', {
    actor: s.ownerId ?? undefined, placeId: s.sitePlaceId, pos: world.place(s.sitePlaceId)?.inside, significance: 0.5, category: 'history',
    data: { projectId: p.id, name: p.name, required: p.required },
    summary: `Work began on ${p.name}${s.ownerId ? ` at ${world.nameOf(s.ownerId)}'s bidding` : ''}`,
  });
  return p;
}

/** How much of each required resource is still needed (delivered + inbound haul tasks counted). */
export function projectDeficits(world: World, p: ConstructionProject): { type: ItemType; deficit: number }[] {
  const out: { type: ItemType; deficit: number }[] = [];
  for (const r of p.required) {
    const onSite = stockAt(world, r.type, p.sitePlaceId);
    const inbound = openHaulTasks(world).filter(t => t.projectId === p.id && t.resource === r.type)
      .reduce((n, t) => n + (t.quantity - t.delivered), 0);
    const deficit = r.quantity - onSite - inbound;
    if (deficit > 0) out.push({ type: r.type, deficit });
  }
  return out;
}

function materialsComplete(world: World, p: ConstructionProject): boolean {
  return p.required.every(r => stockAt(world, r.type, p.sitePlaceId) >= r.quantity);
}

/** Projects a worker can currently contribute `build` labour to. */
export function activeBuildProjects(world: World): ConstructionProject[] {
  return world.constructionProjects.filter(p => p.status === 'ready' || p.status === 'building');
}

/**
 * One slice of construction labour (Priority 12). Only counts while the site has its materials.
 * Records the contribution per worker. Completes the structure when the labour requirement is met.
 */
export function contributeBuildLabor(world: World, p: ConstructionProject, worker: Person, seconds: number): void {
  if (p.status !== 'ready' && p.status !== 'building') return;
  if (seconds <= 0) return;
  if (p.status === 'ready') { p.status = 'building'; p.startedAt = world.now; }
  const before = p.laborDone;
  p.laborDone = Math.min(p.laborRequired, p.laborDone + seconds);
  p.contributions[worker.id] = (p.contributions[worker.id] ?? 0) + (p.laborDone - before);
  if (Math.floor(p.laborDone / PROGRESS_EVENT_EVERY) !== Math.floor(before / PROGRESS_EVENT_EVERY)) {
    world.emit('construction_progress', {
      actor: worker.id, placeId: p.sitePlaceId, pos: world.place(p.sitePlaceId)?.inside, significance: 0.15,
      data: { projectId: p.id, laborDone: Math.round(p.laborDone), laborRequired: p.laborRequired, pct: Math.round(100 * p.laborDone / p.laborRequired) },
      summary: `${p.name} is ${Math.round(100 * p.laborDone / p.laborRequired)}% built`,
    });
  }
  if (p.laborDone >= p.laborRequired) completeProject(world, p);
}

function completeProject(world: World, p: ConstructionProject): void {
  // Consume the delivered materials — they become the structure (conservation).
  for (const r of p.required) takePlaceStock(world, r.type, r.quantity, [p.sitePlaceId]);
  materializeStructure(world, p);
  p.status = 'complete'; p.completedAt = world.now; p.resultPlaceId = p.sitePlaceId;
  world.emit('construction_completed', {
    placeId: p.sitePlaceId, pos: world.place(p.sitePlaceId)?.inside, significance: 0.7, category: 'history',
    data: { projectId: p.id, name: p.name, workers: Object.keys(p.contributions).length },
    summary: `${p.name} was completed`,
  });
}

/**
 * Idempotently raise the physical structure: lay the template's blocks and turn the site Place
 * into a usable building. Called on completion and again from deserialize for a `complete`
 * project (the site Place is regenerated as a bare 'construction' Place by village generation).
 */
export function materializeStructure(world: World, p: ConstructionProject): void {
  const g = world.grid; const b = p.siteBounds;
  const floor = b.y0;
  const wallH = 3;
  const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) if (g.inBounds(x, y, z)) g.set(x, y, z, id);
  };
  // clear the interior, lay a plank floor
  fill(b.x0, floor + 1, b.z0, b.x1, floor + wallH + 2, b.z1, B.Air);
  fill(b.x0, floor, b.z0, b.x1, floor, b.z1, B.Planks);
  // plank walls
  for (let y = floor + 1; y <= floor + wallH; y++) {
    fill(b.x0, y, b.z0, b.x1, y, b.z0, B.Planks); fill(b.x0, y, b.z1, b.x1, y, b.z1, B.Planks);
    fill(b.x0, y, b.z0, b.x0, y, b.z1, B.Planks); fill(b.x1, y, b.z0, b.x1, y, b.z1, B.Planks);
  }
  // stone footing course
  fill(b.x0, floor, b.z0, b.x1, floor, b.z0, B.StoneBrick); fill(b.x0, floor, b.z1, b.x1, floor, b.z1, B.StoneBrick);
  fill(b.x0, floor, b.z0, b.x0, floor, b.z1, B.StoneBrick); fill(b.x1, floor, b.z0, b.x1, floor, b.z1, B.StoneBrick);
  // door on the -z (north) side, middle
  const dx = Math.floor((b.x0 + b.x1) / 2);
  g.set(dx, floor + 1, b.z0, B.Door); g.set(dx, floor + 2, b.z0, B.Air);
  g.set(dx, floor, b.z0 - 1, B.Planks); // a step outside
  // flat roof of tiles
  fill(b.x0, floor + wallH + 1, b.z0, b.x1, floor + wallH + 1, b.z1, B.RoofTile);
  const bx = Math.floor((b.x0 + b.x1) / 2), bz = Math.floor((b.z0 + b.z1) / 2);
  g.set(bx, floor + wallH - 1, bz, B.Lantern);
  world.nav.rebuildArea(b.x0 - 2, b.z0 - 2, b.x1 + 2, b.z1 + 2);
  // turn the site Place into a usable structure
  const place = world.place(p.sitePlaceId);
  if (place) {
    place.type = 'hut';
    place.name = p.name;
    place.indoor = true;
    place.door = { x: dx, y: floor + 1, z: b.z0 - 1 };
    place.inside = { x: bx, y: floor + 1, z: bz };
    place.description = `${p.name} — raised by the village.`;
    place.anchors = [
      { pos: { x: bx, y: floor + 1, z: bz }, kind: 'inside', label: 'store room' },
      { pos: { x: b.x0 + 1, y: floor + 1, z: b.z1 - 1 }, kind: 'work', label: 'shelves' },
    ];
  }
}

/**
 * Deterministic per-upkeep step (called ~every 10 world-minutes from strategic()):
 *  - raise haul needs for each project's remaining materials;
 *  - flip gathering → ready when the manifest is physically on site.
 * Completion itself is driven by `build` labour (contributeBuildLabor), not by this step.
 */
export function stepConstruction(world: World): void {
  // Feed the sawpit from the woodcutter's clearing while any project still needs planks — the
  // upstream link of the wood chain (tree → log → HAUL → sawpit → plank).
  const anyNeedsPlanks = world.constructionProjects.some(p => p.status === 'gathering' && projectDeficits(world, p).some(d => d.type === 'plank'));
  if (anyNeedsPlanks) {
    const sawpit = world.places().find(p => p.type === 'sawpit');
    const clearing = world.places().find(p => p.type === 'wilderness' && p.slug === 'clearing');
    if (sawpit && clearing && stockAt(world, 'log', sawpit.id) < 10 && stockAt(world, 'log', clearing.id) > 0
      && !openHaulTasks(world).some(t => t.resource === 'log' && t.destPlaceId === sawpit.id)) {
      const want = Math.min(carryCapFor('log'), stockAt(world, 'log', clearing.id));
      createHaulTask(world, {
        resource: 'log', quantity: want, sourcePlaceId: clearing.id, destPlaceId: sawpit.id,
        reason: 'the sawpit needs logs', requesterId: sawpit.workers[0] ?? null, priority: 0.7,
      });
    }
  }
  for (const p of world.constructionProjects) {
    if (p.status === 'complete' || p.status === 'cancelled') continue;
    if (p.status === 'gathering' && materialsComplete(world, p)) {
      p.status = 'ready';
      world.emit('construction_material_delivered', {
        placeId: p.sitePlaceId, pos: world.place(p.sitePlaceId)?.inside, significance: 0.4,
        data: { projectId: p.id, name: p.name, ready: true },
        summary: `All the materials for ${p.name} are on site — it needs hands now`,
      });
      continue;
    }
    if (p.status !== 'gathering') continue;
    // Raise a haul task per still-deficient material from the matching producer.
    for (const { type, deficit } of projectDeficits(world, p)) {
      const src = producerPlace(world, type);
      if (!src) continue;
      const already = openHaulTasks(world).some(t => t.projectId === p.id && t.resource === type);
      if (already) continue;
      if (stockAt(world, type, src.id) <= 0) continue; // producer has none yet — wait
      const want = Math.min(carryCapFor(type), deficit, stockAt(world, type, src.id));
      if (want <= 0) continue;
      createHaulTask(world, {
        resource: type, quantity: want, sourcePlaceId: src.id, destPlaceId: p.sitePlaceId,
        reason: `${p.name} needs ${type}`, requesterId: p.ownerId, projectId: p.id, priority: 0.85,
      });
    }
  }
}

function producerPlace(world: World, type: ItemType): Place | undefined {
  if (type === 'plank') return world.places().find(p => p.type === 'sawpit');
  if (type === 'stone') return world.places().find(p => p.type === 'quarry');
  if (type === 'log') return world.places().find(p => p.type === 'wilderness' && p.slug === 'clearing') ?? world.places().find(p => p.type === 'sawpit');
  return world.places().find(p => p.id === type); // no other producers in v0.3
}

// ---------------------------------------------------------------- observability
export interface ConstructionSummary {
  projects: number; complete: number; building: number; gathering: number;
  details: { name: string; status: string; delivered: Record<string, number>; required: Record<string, number>; laborPct: number; workers: number }[];
}
export function constructionSummary(world: World): ConstructionSummary {
  return {
    projects: world.constructionProjects.length,
    complete: world.constructionProjects.filter(p => p.status === 'complete').length,
    building: world.constructionProjects.filter(p => p.status === 'building' || p.status === 'ready').length,
    gathering: world.constructionProjects.filter(p => p.status === 'gathering').length,
    details: world.constructionProjects.map(p => ({
      name: p.name, status: p.status,
      delivered: Object.fromEntries(p.required.map(r => [r.type, stockAt(world, r.type, p.sitePlaceId)])),
      required: Object.fromEntries(p.required.map(r => [r.type, r.quantity])),
      laborPct: Math.round(100 * p.laborDone / p.laborRequired),
      workers: Object.keys(p.contributions).length,
    })),
  };
}
