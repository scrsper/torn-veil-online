import type { EntityId, EventId } from '../core/types';
import type { World } from '../core/world';
import type { ChainStage, ObjectiveKind, ObjectiveSource, QuestOrigin } from './types';

/**
 * The quest ledger: John Smith's archive of every quest one person has had, system or emergent.
 *
 * It is not where quests come from. Emergent entries are copied from what `deriveObjectives`
 * reads in the World; system entries are written when John Smith's catalogue finds its named
 * world condition true (quests/johnSmith.ts). What the ledger adds is memory that outlives event
 * compaction, the lifecycle of each quest, and the single reward claim that makes payment
 * idempotent: an entry's `claim` is written in the same step that pays, and nothing pays an
 * entry whose claim exists.
 *
 * Persisted on `World.questLedgers` (additive save field).
 */
export type QuestState =
  /** Issued and not yet ended. */
  | 'active'
  /** Met, with the player credited; `claim` records what was paid. */
  | 'completed'
  /** Its cause ended without the player (someone else met the need, the threat died to another hand). */
  | 'resolved'
  /** Its cause went away unmet (request withdrawn or expired, concern faded). */
  | 'lapsed';
export const QUEST_STATES: readonly QuestState[] = ['active', 'completed', 'resolved', 'lapsed'];

export interface QuestRewardClaim {
  /** Silver actually transferred (0 when nothing was owed or the payer had nothing). */
  paid: number;
  from: EntityId | 'john_smith' | null;
  at: number;
  /** The canonical event of the transfer: `request_completed` for emergent, `system_quest_reward` for system. */
  eventId: EventId | null;
}
export interface QuestLedgerEntry {
  /** Same id as the Objective it projects to. */
  id: string;
  origin: QuestOrigin;
  source: ObjectiveSource;
  kind: ObjectiveKind;
  stage: ChainStage;
  title: string;
  detail: string;
  state: QuestState;
  /** World seconds. */
  issuedAt: number;
  endedAt: number | null;
  /** The canonical event that ended it, when one did. May later be compacted out of history. */
  endedBy: EventId | null;
  /** Canonical events it rests on: how the player knew (emergent), or what made the condition true (system). */
  basis: EventId[];
  /** Measured world facts the system text was written from (system entries); kept for inspection. */
  facts: Record<string, string | number>;
  reward: { offered: number; from: EntityId | 'john_smith' | null };
  /** Written exactly once, when the entry is completed. */
  claim: QuestRewardClaim | null;
}
export interface QuestLedger {
  version: 1;
  personId: EntityId;
  /** John Smith's finite reward reserve for this person: fixed at creation, only ever drawn down. */
  reserve: { initial: number; remaining: number };
  /** Issue order, oldest first. */
  entries: QuestLedgerEntry[];
}

export function questLedger(w: World, personId: EntityId): QuestLedger | undefined { return w.questLedgers?.[personId]; }

/** Every entry, for the journal. */
export function questJournal(w: World, personId: EntityId): QuestLedgerEntry[] { return questLedger(w, personId)?.entries ?? []; }

const ORIGINS: readonly QuestOrigin[] = ['emergent', 'system'];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Structural check plus the archivist's invariant: the reserve drawn equals the system silver paid. */
export function validQuestLedgers(w: World, data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  for (const [personId, l] of Object.entries(data as Record<string, QuestLedger>)) {
    if (!l || l.version !== 1 || l.personId !== personId || !w.person(personId)) return false;
    if (!finite(l.reserve?.initial) || !finite(l.reserve?.remaining) || l.reserve.remaining < 0 || l.reserve.remaining > l.reserve.initial) return false;
    if (!Array.isArray(l.entries)) return false;
    const ids = new Set<string>(); let systemPaid = 0;
    for (const e of l.entries) {
      if (!e || typeof e.id !== 'string' || ids.has(e.id) || !ORIGINS.includes(e.origin) || !QUEST_STATES.includes(e.state) || !e.source || typeof e.title !== 'string' || !Array.isArray(e.basis)) return false;
      ids.add(e.id);
      if (e.claim !== null && (!e.claim || !finite(e.claim.paid) || e.claim.paid < 0 || e.state !== 'completed')) return false;
      if (e.origin === 'system' && e.claim) systemPaid += e.claim.paid;
    }
    if (Math.abs(l.reserve.initial - l.reserve.remaining - systemPaid) > 1e-9) return false;
  }
  return true;
}
