import type { ConcernKind, EntityId, EventId, RequestType, Vec3 } from '../core/types';

/** What the objective asks of the player, as a verb for the HUD. */
export type ObjectiveKind = 'deliver' | 'hunt' | 'work' | 'tend' | 'reach_floor';
/** Emergent quests are raised inside the world; system quests are issued by John Smith above it. */
export type QuestOrigin = 'emergent' | 'system';
/**
 * Where an objective comes from. Emergent sources are things the world already holds that the
 * player character knows of:
 *  - `request`: a Request a simulated person raised for their own reasons (heard it asked, or took it on);
 *  - `concern`: a worry the player character's own mind formed from what it perceived or was told.
 * The system source is John Smith (quests/johnSmith.ts): an authored quest he issued because a
 * named world condition held, never a cause he created.
 */
export type ObjectiveSource =
  | { type: 'request'; requestId: EntityId; requestType: RequestType }
  | { type: 'concern'; concernId: string; concernKind: ConcernKind }
  | { type: 'system'; questId: string; issuer: 'john_smith' };
/** First-hour chain order: town → forest → Tower floors 1–5. A display order, not a gate. */
export type ChainStage = 'town' | 'forest' | 'tower';
export const CHAIN_STAGES: readonly ChainStage[] = ['town', 'forest', 'tower'];
export const FIRST_HOUR_TOWER_FLOORS = 5;

export interface ObjectiveTarget {
  personId?: EntityId; bodyIds?: EntityId[]; species?: string; floor?: number; pos?: Vec3 | null;
}
export interface Objective {
  /** Stable for the life of its source: `request:<id>`, `concern:<id>` or `system:<questId>`. */
  id: string;
  origin: QuestOrigin;
  kind: ObjectiveKind;
  source: ObjectiveSource;
  stage: ChainStage;
  title: string;
  detail: string;
  /** The person who asked, when someone did. Never inferred. */
  giverId: EntityId | null;
  giverName: string | null;
  target: ObjectiveTarget;
  progress: { current: number; required: number };
  /** How the player's character knows: the perceived or accepted events this rests on. */
  knownVia: EventId[];
  /** Emergent: what the asker offered from their own wealth, paid by the request's own settlement.
   * System: what John Smith's finite reserve offers, paid once by the ledger. */
  reward: { silver: number; from: EntityId | 'john_smith' | null };
  /** The first objective in chain order; presentation emphasis only. */
  tracked: boolean;
}
/** A completion: `request_completed`, `concern_resolved`, or the event that met a system quest. */
export interface ObjectiveReceipt {
  objectiveId: string; eventId: EventId; tick: number; silver: number; payerId: EntityId | 'john_smith' | null;
}
