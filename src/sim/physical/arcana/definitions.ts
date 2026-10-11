import { BOOKS, ESSENCES, SCROLLS, SIGNS, type SkillDef, type Kernel } from './catalogue';

/** Immutable authored mechanical catalogue. Legacy Tower may rank its own copies; the
 * host never accepts power/rank/cost/riders from a controller or its old checkpoint. */
const definitions = [...SIGNS, ...Object.values(BOOKS).map(b => b.skill),
  ...Object.values(ESSENCES).map(e => e.skill), ...SCROLLS];
export const ARCANE_DEFINITIONS: ReadonlyMap<string, Readonly<SkillDef>> = new Map(definitions.map(d => [d.id,
  Object.freeze({ ...d, riders: Object.freeze([...d.riders]) as unknown as SkillDef['riders'] })]));

export interface KernelGeometry { range: number; radius: number; windup: number; recovery: number; damage: number; }
/** Physical metres/seconds. Presentation retimes to these values; clips never set them. */
export const KERNEL_GEOMETRY: Readonly<Record<Kernel, KernelGeometry>> = Object.freeze({
  cone: { range: 7, radius: 3, windup: .45, recovery: .4, damage: 16 },
  wave: { range: 7, radius: 4, windup: .5, recovery: .5, damage: 10 },
  ward: { range: 0, radius: 0, windup: .4, recovery: .3, damage: 0 },
  sigil: { range: 10, radius: 3, windup: .7, recovery: .45, damage: 12 },
  nova: { range: 5, radius: 5, windup: .65, recovery: .5, damage: 20 },
  chain: { range: 10, radius: 4, windup: .6, recovery: .5, damage: 18 },
  dash: { range: 5, radius: 1, windup: .25, recovery: .5, damage: 12 },
  heal: { range: 0, radius: 0, windup: 1.2, recovery: .6, damage: 0 },
  frenzy: { range: 0, radius: 0, windup: .7, recovery: .5, damage: 0 },
  spear: { range: 10, radius: 1, windup: .6, recovery: .5, damage: 24 },
  volley: { range: 10, radius: 3, windup: .65, recovery: .65, damage: 14 },
  meteor: { range: 12, radius: 3.5, windup: 1.4, recovery: .8, damage: 32 },
  cataclysm: { range: 7, radius: 7, windup: 1.5, recovery: 1, damage: 30 },
  bolt: { range: 12, radius: .65, windup: .45, recovery: .4, damage: 18 },
  field: { range: 10, radius: 4, windup: .8, recovery: .6, damage: 10 },
  imbue: { range: 0, radius: 0, windup: .7, recovery: .4, damage: 0 },
  blink: { range: 5, radius: 0, windup: .4, recovery: .5, damage: 0 },
});
