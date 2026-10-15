import type { Objective, ObjectiveReceipt } from './types';

export type ObjectiveEvent = 'objective:update' | 'objective:complete';
export interface ObjectiveUpdate { objective: Objective; previous: Objective | null }
export interface ObjectiveCompletion { objective: Objective | null; receipt: ObjectiveReceipt }
type Listener<E extends ObjectiveEvent> = (payload: E extends 'objective:update' ? ObjectiveUpdate : ObjectiveCompletion) => void;

/**
 * The objective API consumers read: `getActiveObjectives()` plus `objective:update` and
 * `objective:complete` notifications. It holds no truth of its own; `ingest` is handed the
 * latest derived list and receipts (from the World on the host, or from a snapshot in the
 * browser) and reports what changed. Re-ingesting the same input reports nothing.
 */
export class ObjectiveTracker {
  private active = new Map<string, Objective>();
  private receipted = new Set<string>();
  private listeners: { [E in ObjectiveEvent]: Set<Listener<E>> } = { 'objective:update': new Set(), 'objective:complete': new Set() };

  on<E extends ObjectiveEvent>(event: E, listener: Listener<E>): () => void {
    this.listeners[event].add(listener); return () => { this.listeners[event].delete(listener); };
  }
  getActiveObjectives(): Objective[] { return [...this.active.values()]; }
  getTrackedObjective(): Objective | null { return [...this.active.values()].find(o => o.tracked) ?? null; }

  /** Receipts first: a completion is announced once, with the last known state of its objective. */
  ingest(objectives: readonly Objective[], receipts: readonly ObjectiveReceipt[] = []): { updated: number; completed: number } {
    let updated = 0, completed = 0;
    for (const receipt of receipts) {
      if (this.receipted.has(receipt.objectiveId)) continue;
      this.receipted.add(receipt.objectiveId);
      const last = this.active.get(receipt.objectiveId) ?? objectives.find(o => o.id === receipt.objectiveId) ?? null;
      this.active.delete(receipt.objectiveId); completed++;
      for (const l of this.listeners['objective:complete']) l({ objective: last, receipt });
    }
    const next = new Map(objectives.filter(o => !this.receipted.has(o.id)).map(o => [o.id, o]));
    for (const [id, objective] of next) {
      const previous = this.active.get(id) ?? null;
      if (previous && same(previous, objective)) continue;
      updated++;
      for (const l of this.listeners['objective:update']) l({ objective, previous });
    }
    this.active = next;
    return { updated, completed };
  }
  /** Receipts known on (re)connect are history: mark them without announcing. */
  seed(receipts: readonly ObjectiveReceipt[]): void { for (const r of receipts) this.receipted.add(r.objectiveId); }
}
function same(a: Objective, b: Objective): boolean {
  return a.progress.current === b.progress.current && a.progress.required === b.progress.required && a.tracked === b.tracked
    && a.title === b.title && a.detail === b.detail;
}
