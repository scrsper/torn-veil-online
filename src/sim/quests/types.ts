import type { EntityId, EventId, Vec3 } from '../core/types';

/** What the player is asked to do. The ask is authored; the reason it exists is not. */
export type ObjectiveKind = 'deliver' | 'gather' | 'hunt' | 'reach_floor';
/** The simulated condition that produced an objective. There is no other source. */
export type ObjectiveCause = 'npc_need' | 'resource_shortage' | 'wildlife_threat' | 'outlaw_threat' | 'tower_rumor';
/** First-hour chain order: town → forest → Tower floors 1–5. */
export type ChainStage = 'town' | 'forest' | 'tower';
export const CHAIN_STAGES: readonly ChainStage[] = ['town', 'forest', 'tower'];
export const FIRST_HOUR_TOWER_FLOORS = 5;

export interface ObjectiveTarget {
  personId?: EntityId; bodyIds?: EntityId[]; species?: string; floor?: number; resource?: 'food'; pos?: Vec3 | null;
}
export interface Objective {
  /** Stable while the cause persists: `${key}#${n}`, n = receipts already issued for the key. */
  id: string;
  key: string;
  kind: ObjectiveKind;
  cause: ObjectiveCause;
  stage: ChainStage;
  title: string;
  detail: string;
  giverId: EntityId | null;
  giverName: string | null;
  target: ObjectiveTarget;
  progress: { current: number; required: number };
  /** Completion evidence exists and no receipt has been issued yet. */
  complete: boolean;
  /** Canonical events proving completion (gift, kill, floor clear). */
  evidence: EventId[];
  /** Canonical events behind the cause, when the cause is an event rather than a standing state. */
  causes: EventId[];
  /** Measured sim facts the text was written from, kept for inspection and tests. */
  facts: Record<string, number | string>;
  /** Offered payment, paid from the giver's own conserved wealth and capped by it at settlement. */
  reward: { silver: number; from: EntityId | null };
  /** The one objective the chain currently points the player at. */
  tracked: boolean;
}
export interface ObjectiveReceipt {
  objectiveId: string; key: string; eventId: EventId; tick: number; silver: number; payerId: EntityId | null;
}
