/** Presentation-only contract. A supplies canonical objectives and rewards. */
export interface Objective { id: string; title: string; description: string; current: number; target: number; complete?: boolean }
export type ObjectiveEvent = { type: 'objective:update' | 'objective:complete'; objective: Objective };
export interface ObjectiveAPI { getActiveObjectives(): readonly Objective[]; subscribe(listener: (event: ObjectiveEvent) => void): () => void }
export const stubObjectives: ObjectiveAPI = { getActiveObjectives: () => [], subscribe: () => () => {} };
export interface HudState { objectives: Objective[]; rank: string; xp: number | null; nextXp: number | null; journal: boolean }
export const initialHudState = (): HudState => ({ objectives: [], rank: '', xp: null, nextXp: null, journal: false });
export type HudAction = ObjectiveEvent | { type: 'objectives'; objectives: readonly Objective[] } | { type: 'progress'; rank: string; xp?: number; nextXp?: number } | { type: 'journal' };
const finite = (v: number | undefined) => v !== undefined && Number.isFinite(v) ? Math.max(0, v) : null;
export function hudReducer(s: HudState, a: HudAction): HudState {
  if (a.type === 'journal') return { ...s, journal: !s.journal };
  if (a.type === 'progress') {
    const xp=finite(a.xp),nextXp=finite(a.nextXp);
    return s.rank===a.rank&&s.xp===xp&&s.nextXp===nextXp?s:{...s,rank:a.rank,xp,nextXp};
  }
  if (a.type === 'objectives') return { ...s, objectives: a.objectives.map(o => ({ ...o })) };
  const objective = { ...a.objective, complete: a.type === 'objective:complete' || !!a.objective.complete };
  return { ...s, objectives: [...s.objectives.filter(o => o.id !== objective.id), objective] };
}
export function progressFraction(s: HudState): number { return s.xp === null || !s.nextXp ? 0 : Math.min(1, s.xp / s.nextXp); }
