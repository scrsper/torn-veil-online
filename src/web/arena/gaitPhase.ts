import type { ClipTemplate } from './retarget';
import { MOVESETS, RELAXED } from './combat';

export const wrapPhase = (phase: number): number => ((phase % 1) + 1) % 1;

/** Centre of left support in a looping clip. Double support cancels out. */
export function supportPhase(contact: ClipTemplate['contact']): number {
  if (!contact) return 0;
  // The bake includes the duplicate loop endpoint; do not count it twice.
  const count = Math.min(contact[0].length, contact[1].length) - 1;
  if (count < 2) return 0;
  let x = 0, y = 0;
  for (let i = 0; i < count; i++) {
    const support = contact[0][i] - contact[1][i], angle = i / count * Math.PI * 2;
    x += support * Math.cos(angle); y += support * Math.sin(angle);
  }
  return Math.hypot(x, y) < 1e-5 ? 0 : wrapPhase(Math.atan2(y, x) / (Math.PI * 2));
}

/** Only cyclic travel clips participate; attacks and dodges keep their authored clock. */
export function gaitPhases(clips: ReadonlyMap<string, ClipTemplate>): ReadonlyMap<string, number> {
  const phases = new Map<string, number>();
  const travel = new Set([RELAXED.walk, RELAXED.run, ...Object.values(MOVESETS).flatMap(set => [set.walk, set.run]),
    'unarmed/walk_backward', 'unarmed/walk_strafe_left', 'unarmed/walk_strafe_right']);
  for (const [name, clip] of clips) {
    if (travel.has(name)) {
      phases.set(name, supportPhase(clip.contact));
    }
  }
  return phases;
}

/** Authored support remains valid when a fitted body's ankle has a different sole offset. */
export function contactHints(source: { name: string; frame: number } | null, clips: ReadonlyMap<string, ClipTemplate>): [boolean, boolean] | undefined {
  const contact = source && clips.get(source.name)?.contact;
  if (!source || !contact) return undefined;
  const frame = Math.max(0, Math.min(contact[0].length - 1, Math.floor(source.frame)));
  return [!!contact[0][frame], !!contact[1][frame]];
}
