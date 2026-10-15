import type { ConcernKind, EntityId, EventId, RequestType, Vec3 } from '../core/types';

/** What the objective asks of the player, as a verb for the HUD. */
export type ObjectiveKind = 'deliver' | 'hunt' | 'work' | 'tend' | 'reach_floor';
/**
 * Where an objective comes from. There are only three sources, all canonical:
 *  - `request`: a Request a simulated person raised for their own reasons and the player knows of
 *    (heard it asked, or took it on);
 *  - `concern`: a worry the player character's own mind formed from what it perceived or was told;
 *  - `tower_run`: the player's own canonical Tower run and its floor-clear receipts.
 */
export type ObjectiveSource =
  | { type: 'request'; requestId: EntityId; requestType: RequestType }
  | { type: 'concern'; concernId: string; concernKind: ConcernKind }
  | { type: 'tower_run'; floor: number; runId: string | null };
/** First-hour chain order: town → forest → Tower floors 1–5. A display order, not a gate. */
export type ChainStage = 'town' | 'forest' | 'tower';
export const CHAIN_STAGES: readonly ChainStage[] = ['town', 'forest', 'tower'];
export const FIRST_HOUR_TOWER_FLOORS = 5;

export interface ObjectiveTarget {
  personId?: EntityId; bodyIds?: EntityId[]; species?: string; floor?: number; pos?: Vec3 | null;
}
export interface Objective {
  /** Stable for the life of its source: `request:<id>`, `concern:<id>` or `tower:floor:<n>`. */
  id: string;
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
  /** What the asker offered from their own wealth; paid, if at all, by the request's own settlement. */
  reward: { silver: number; from: EntityId | null };
  /** The first objective in chain order; presentation emphasis only. */
  tracked: boolean;
}
/** A completion, read straight from canonical history: `request_completed`, `concern_resolved` or `tower_floor_cleared`. */
export interface ObjectiveReceipt {
  objectiveId: string; eventId: EventId; tick: number; silver: number; payerId: EntityId | null;
}
