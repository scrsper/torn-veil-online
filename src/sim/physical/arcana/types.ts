import type { ConflictIntent, Vec3 } from '../../core/types';
import type { Kernel, Rider } from './catalogue';

/** Learned forms belong to the person; expenditure and active effects belong to a body.
 * No rank, mesh, animation or local Tower checkpoint grants any of these capabilities. */
export interface ArcaneKnowledge {
  version: 1;
  growth?: import('./growth').ArcaneGrowth;
  learned: Record<string, { eventId: string; itemId: string; applications: number }>;
}
export interface ArcaneCast {
  id: string; eventId: string; abilityId: string; kernel: Kernel; riders: Rider[];
  bodyId: string; target: Vec3; facing: number; intent: ConflictIntent;
  startedAt: number; activeAt: number; completeAt: number;
  range: number; radius: number; power: number; damage: number;
  resolved: boolean; cancelled: boolean;
}
export interface ArcaneEffect {
  kind: 'ward' | 'chill' | 'haste' | 'frenzy' | 'wet' | 'imbue';
  sourceEventId: string; sourceBodyId: string; until: number; strength: number; rider?: Rider;
}
export interface ArcaneBody {
  version: 1; mana: number; sampledAt: number;
  cooldowns: Record<string, number>;
  cast?: ArcaneCast;
  effects: ArcaneEffect[];
}
/** Authored contents of a real item. Reading a book teaches; a scroll is consumed by a
 * successful cast. The source may be carried by anyone, and remains in provenance/history. */
export interface ArcaneSource { version: 1; abilityId: string; kind: 'book' | 'essence' | 'scroll'; }
export interface PhysicalArmor { version: 1; coverage: ('head' | 'torso' | 'arm' | 'leg')[]; absorption: number; }
