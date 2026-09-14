import type { BodyRegion, SkillId } from './types';

/** Staged extension of SkillId while core/types.ts is reserved by parallel combat work.
 * These keys live in Person.skills and use the ordinary skill curve, never another XP map. */
export type WeaponFamily = 'unarmed' | 'one-handed-blade' | 'polearm';
export type PracticedSkillId = SkillId | WeaponFamily;
export type TechniqueId = string;
export type MartialInput = 'Light' | 'Heavy' | 'Dodge' | 'Duck';
export type MartialStance = 'neutral' | 'guarded' | 'extended' | 'crouched';
export type MartialMotion = 'punch' | 'kick' | 'shove' | 'cover' | 'duck' | 'sidestep' | 'backstep';
export interface TechniqueDefinition {
  techniqueId: TechniqueId;
  name: string;
  family: WeaponFamily;
  category: 'strike' | 'evasion' | 'guard' | 'transition';
  /** Absent on original v1 discoveries means learned, never innate. */
  availability?: 'innate' | 'learned';
  selection?: { input: MartialInput; motion: MartialMotion; regions: readonly BodyRegion[];
    stances: readonly MartialStance[]; endStance: MartialStance; entry: boolean; priority: number };
  /** Specific learned movement connection, with its own knowledge and mastery. */
  transition?: { from: TechniqueId; to: TechniqueId; minimumMastery: number };
  prerequisites: { proficiency: number; techniques: readonly TechniqueId[] };
  parentId?: TechniqueId;
  components: readonly string[];
  complexity: number;
  revision: 1;
  creatorId?: string;
  originEventId?: string;
}
export type MartialMode = 'practice' | 'spar' | 'lesson' | 'experiment';
export interface MartialSession {
  id: string;
  mode: MartialMode;
  techniqueId: TechniqueId;
  bodyId: string;
  partnerId?: string;
  partnerBodyId?: string;
  lastPhysicalAt: number;
  startedAt: number;
  seconds: number;
  requiredSeconds: number;
  effort: number;
  originEventId: string;
}
export interface MartialState {
  mastery: Record<TechniqueId, { value: number; seconds: number; lastEventId?: string }>;
  /** A single chronological activity ledger per mind also prevents multiple bodies
   * or a replayed combat report crediting the same elapsed practice twice. */
  creditedThrough: number;
  session?: MartialSession;
}
declare module './types' {
  interface Person { martial?: MartialState; }
}
declare module './world' {
  interface World { martialDefinitions?: Record<TechniqueId, TechniqueDefinition>; }
}
/** The current combat action remains the sole previous-action truth. Its producer will
 * record selected identity here at merge integration; no separate combo counter exists. */
declare module '../physical/combatActionTypes' {
  interface CombatAction { techniqueId?: TechniqueId; transitionTechniqueId?: TechniqueId; }
}
