import type { Entity, Vec3 } from './types';

/** Derived physical broad phase. Stable insertion order preserves canonical tie breaks. */
export class SpatialIndex<T extends Entity> {
  private buckets = new Map<string, Set<T>>();
  private cells = new Map<T, string[]>();
  private order = new Map<T, number>();
  private oversized = new Set<T>();
  private next = 0;
  candidates = 0;
  constructor(private size = 64) {}
  update(e: T, box: { x0: number; z0: number; x1: number; z1: number } | null): void {
    if (!this.order.has(e)) this.order.set(e, this.next++);
    const keys: string[] = [];
    let large = false;
    if (box) {
      const x0 = Math.floor(box.x0 / this.size), x1 = Math.floor(box.x1 / this.size);
      const z0 = Math.floor(box.z0 / this.size), z1 = Math.floor(box.z1 / this.size);
      large = (x1 - x0 + 1) * (z1 - z0 + 1) > 4096;
      if (!large) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) keys.push(`${x},${z}`);
    }
    const old = this.cells.get(e) ?? [];
    if (large === this.oversized.has(e) && old.length === keys.length && old.every((k, i) => k === keys[i])) return;
    for (const k of old) { const b = this.buckets.get(k)!; b.delete(e); if (!b.size) this.buckets.delete(k); }
    if (large) this.oversized.add(e); else this.oversized.delete(e);
    this.cells.set(e, keys);
    for (const k of keys) { let b = this.buckets.get(k); if (!b) this.buckets.set(k, b = new Set()); b.add(e); }
  }
  point(e: T, pos: Vec3 | null): void { this.update(e, pos ? { x0: pos.x, x1: pos.x, z0: pos.z, z1: pos.z } : null); }
  query(pos: Vec3, radius: number): T[] {
    const found = new Set(this.oversized);
    const x0 = Math.floor((pos.x - radius) / this.size), x1 = Math.floor((pos.x + radius) / this.size);
    const z0 = Math.floor((pos.z - radius) / this.size), z1 = Math.floor((pos.z + radius) / this.size);
    // Large legitimate queries may inspect the complete index, never trillions of empty cells.
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) for (const [e, keys] of this.cells) { if (keys.length) found.add(e); }
    else for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (const e of this.buckets.get(`${x},${z}`) ?? []) found.add(e);
    this.candidates += found.size;
    return [...found].sort((a, b) => this.order.get(a)! - this.order.get(b)!);
  }
}

/** Keep indexes correct through existing direct canonical assignments and save overlays.
 * Descriptors are enumerable; serialization contains ordinary values, never index state. */
export function watchGeometry<T extends object, K extends keyof T>(owner: T, key: K, coordinates: string[], changed: () => void): void {
  const wrap = (value: T[K]): T[K] => {
    if (!value || typeof value !== 'object') return value;
    const copy = { ...value } as Record<string, unknown>;
    for (const coordinate of coordinates) {
      let current = copy[coordinate];
      Object.defineProperty(copy, coordinate, { enumerable: true, configurable: true, get: () => current,
        set: next => { if (next !== current) { current = next; changed(); } } });
    }
    return copy as T[K];
  };
  let value = wrap(owner[key]);
  Object.defineProperty(owner, key, { enumerable: true, configurable: true, get: () => value,
    set: next => { value = wrap(next); changed(); } });
  changed();
}

export function watchValue<T extends object, K extends keyof T>(owner: T, key: K, changed: (previous: T[K], next: T[K]) => void): void {
  let value = owner[key];
  Object.defineProperty(owner, key, { enumerable: true, configurable: true, get: () => value,
    set: next => { const previous = value; value = next; if (previous !== next) changed(previous, next); } });
  changed(value, value);
}
