import { B } from '../../physical/blocks';
import type { World } from '../../core/world';
import { RealmGrid } from '../realms/grid';
import type { RealmSpec } from '../realms/layout';
import { INTERIOR_NAMESPACE, interiorSlot, interiorVoxel, planInterior, validInteriorDescriptor, type InteriorDescriptor, type InteriorPlan } from './layout';

/** Persist this registry beside the owning World's realmSpec. Cached plans are derived;
 * cell edits stay in the ordinary grid diff map and are never discarded by eviction. */
export interface InteriorRegistry { version: 1; namespace: typeof INTERIOR_NAMESPACE.id; descriptors: InteriorDescriptor[] }
export const emptyInteriors = (): InteriorRegistry => ({ version: 1, namespace: INTERIOR_NAMESPACE.id, descriptors: [] });
/** Install without reindexing any existing door or edit. The registry is canonical;
 * the two derived grid caches are disposable. */
export function attachInteriorGrid(w: World, registry = w.interiors ?? emptyInteriors()): FoldedRealmGrid {
  if (!w.realmSpec) throw Error('Folded interiors require a realm world');
  if (w.grid instanceof FoldedRealmGrid && w.interiors === registry) return w.grid;
  const old = w.grid, next = new FoldedRealmGrid(w.realmSpec, registry);
  next.applyDiffs([...old.diffs]); next.restoreDoorStates([...old.doorStates]); next.recording = old.recording;
  w.interiors = registry; w.grid = next; w.initNav(); return next;
}
export function validInteriorRegistry(x: unknown): x is InteriorRegistry {
  if (!x || typeof x !== 'object') return false;
  const r = x as InteriorRegistry;
  return r.version === 1 && r.namespace === INTERIOR_NAMESPACE.id && Array.isArray(r.descriptors)
    && r.descriptors.length <= INTERIOR_NAMESPACE.capacity && r.descriptors.every(validInteriorDescriptor)
    && new Set(r.descriptors.map(d => d.id)).size === r.descriptors.length
    && new Set(r.descriptors.map(d => d.slot)).size === r.descriptors.length;
}

/** Same metre grid, existing realms and saved indices. Only explicitly registered
 * folded interiors carve out space; unknown / unallocated addresses remain solid. */
export class FoldedRealmGrid extends RealmGrid {
  private bySlot = new Map<number, InteriorDescriptor>();
  private plans = new Map<string, InteriorPlan>();
  private interiorEdits = new Map<number, number>();
  constructor(spec: RealmSpec, readonly interiors: InteriorRegistry) {
    super(spec);
    if (!validInteriorRegistry(interiors)) throw Error('Invalid folded-interior registry');
    for (const d of interiors.descriptors) this.bySlot.set(d.slot, d);
  }
  get cachedInteriors() { return this.plans.size; }
  register(descriptor: InteriorDescriptor): void {
    if (!validInteriorDescriptor(descriptor)) throw Error('Invalid interior descriptor');
    const old = this.interiors.descriptors.find(d => d.id === descriptor.id);
    if (old) {
      if (old.version !== descriptor.version || old.buildingId !== descriptor.buildingId || old.seed !== descriptor.seed
        || old.floor !== descriptor.floor || old.slot !== descriptor.slot) throw Error('Interior identity already has different geometry');
      return;
    }
    if (this.bySlot.has(descriptor.slot)) throw Error('Interior address already occupied');
    // Do not reinterpret latent edits from an old world as a newly allocated room.
    for (const index of this.diffs.keys()) {
      const column = Math.floor(index / this.H), x = Math.floor(column / this.D), z = column % this.D;
      if (interiorSlot(x, z) === descriptor.slot) throw Error('Interior address contains existing edits');
    }
    const d = { ...descriptor }; this.interiors.descriptors.push(d); this.bySlot.set(d.slot, d);
  }
  interior(id: string): InteriorPlan {
    let p = this.plans.get(id);
    if (!p) {
      const d = this.interiors.descriptors.find(d => d.id === id); if (!d) throw Error('Unknown interior');
      p = planInterior(d);
      if (this.plans.size >= 12) this.plans.delete(this.plans.keys().next().value!);
      this.plans.set(id, p);
    }
    return p;
  }
  override evict(): void { super.evict(); this.plans.clear(); }
  override get(x: number, y: number, z: number): number {
    if (![x, y, z].every(Number.isInteger)) return B.Air;
    const slot = interiorSlot(x, z); if (slot === null) return super.get(x, y, z);
    const d = this.bySlot.get(slot); if (!d) return B.Stone;
    if (y < 0) return B.Stone; if (y >= this.H) return B.Air;
    const edit = this.interiorEdits.get(this.idx(x, y, z));
    return edit ?? interiorVoxel(this.interior(d.id), x, y, z) ?? B.Stone;
  }
  override set(x: number, y: number, z: number, id: number): void {
    if (interiorSlot(x, z) === null) { super.set(x, y, z, id); return; }
    if (!this.inBounds(x, y, z)) return;
    const key = this.idx(x, y, z); this.interiorEdits.set(key, id);
    if (this.recording) this.diffs.set(key, id); this.markDirty(x, z);
  }
  override groundHeight(x: number, z: number): number {
    const slot = interiorSlot(x, z); if (slot === null) return super.groundHeight(x, z);
    const d = this.bySlot.get(slot); return d && interiorVoxel(this.interior(d.id), Math.floor(x), 0, Math.floor(z)) !== undefined ? 0 : -1;
  }
}
