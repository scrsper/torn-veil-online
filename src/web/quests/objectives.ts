import { ObjectiveTracker, type ObjectiveCompletion, type ObjectiveEvent, type ObjectiveUpdate } from '../../sim/quests/layer';
import type { Objective, ObjectiveReceipt } from '../../sim/quests/types';

export type { Objective, ObjectiveReceipt, ObjectiveUpdate, ObjectiveCompletion, ObjectiveEvent };

/**
 * Browser objective API for HUD, tracker and journal code (Workstream B consumes this).
 *
 *   const quests = new ClientObjectives();
 *   socket message:      quests.ingestMessage(m)     // handles 'state', 'tower_frame' and 'objective'
 *   quests.getActiveObjectives(), quests.getTrackedObjective(), quests.history()
 *   quests.on('objective:update', ({ objective, previous }) => …)
 *   quests.on('objective:complete', ({ objective, receipt }) => …)   // once per receipt
 *
 * The host derives objectives from the World and issues receipts; this only mirrors them.
 * Receipts present on the first message are treated as history and not announced again.
 */
export class ClientObjectives {
  private readonly tracker = new ObjectiveTracker();
  private receipts: ObjectiveReceipt[] = [];
  private seeded = false;

  on<E extends ObjectiveEvent>(event: E, listener: (p: E extends 'objective:update' ? ObjectiveUpdate : ObjectiveCompletion) => void): () => void {
    return this.tracker.on(event, listener);
  }
  getActiveObjectives(): Objective[] { return this.tracker.getActiveObjectives(); }
  getTrackedObjective(): Objective | null { return this.tracker.getTrackedObjective(); }
  /** Receipts seen this session and on connect, oldest first. */
  history(): ObjectiveReceipt[] { return [...this.receipts]; }

  ingest(objectives: readonly Objective[] | undefined, receipts: readonly ObjectiveReceipt[] | undefined): void {
    const known = new Set(this.receipts.map(r => r.objectiveId)), fresh = (receipts ?? []).filter(r => !known.has(r.objectiveId));
    this.receipts.push(...fresh);
    if (!this.seeded) { this.seeded = true; this.tracker.seed(fresh); this.tracker.ingest(objectives ?? []); return; }
    this.tracker.ingest(objectives ?? [], fresh);
  }
  /** Accepts any host message; ignores the ones that carry no objective data. */
  ingestMessage(m: { type?: string; state?: { objectives?: Objective[]; objectiveReceipts?: ObjectiveReceipt[] }; objectives?: Objective[]; receipt?: ObjectiveReceipt; objective?: Objective | null }): void {
    if (m.type === 'state' && m.state) this.ingest(m.state.objectives, m.state.objectiveReceipts);
    else if (m.type === 'tower_frame') this.ingest(m.objectives, undefined);
    else if (m.type === 'objective' && m.receipt) this.ingest(this.getActiveObjectives().filter(o => o.id !== m.receipt!.objectiveId), [m.receipt]);
  }
}

/** Compass/minimap markers for objectives that have a place in the world. */
export function objectiveMarkers(objectives: readonly Objective[]): { id: string; title: string; pos: { x: number; y: number; z: number }; tracked: boolean }[] {
  return objectives.flatMap(o => o.target.pos ? [{ id: o.id, title: o.title, pos: o.target.pos, tracked: o.tracked }] : []);
}

/** Shape Workstream B's HUD (`src/web/ui/sliceHudState.ts` ObjectiveAPI) consumes. */
export interface HudObjective { id: string; title: string; description: string; current: number; target: number; complete?: boolean }
export interface HudObjectiveEvent { type: 'objective:update' | 'objective:complete'; objective: HudObjective }
export function hudObjectiveApi(source: ClientObjectives): { getActiveObjectives(): HudObjective[]; subscribe(listener: (e: HudObjectiveEvent) => void): () => void } {
  const view = (o: Objective, complete = false): HudObjective => ({ id: o.id, title: o.title, description: o.detail, current: complete ? o.progress.required : o.progress.current, target: o.progress.required, ...(complete ? { complete: true } : {}) });
  return {
    getActiveObjectives: () => source.getActiveObjectives().map(o => view(o)),
    subscribe(listener) {
      const off = [source.on('objective:update', ({ objective }) => listener({ type: 'objective:update', objective: view(objective) })),
        source.on('objective:complete', ({ objective, receipt }) => listener({ type: 'objective:complete',
          objective: objective ? view(objective, true) : { id: receipt.objectiveId, title: receipt.key, description: '', current: 1, target: 1, complete: true } }))];
      return () => off.forEach(f => f());
    },
  };
}
