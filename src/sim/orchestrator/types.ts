import type { EntityId, EventId, Vec3 } from '../core/types';

/**
 * John Smith's canonical record (Constitution §16–18). Lives on `World.johnSmith`, beside the
 * world rather than inside any mind: no goal, perception, combat, economy or knowledge path reads
 * it. Every field is bounded; see the MAX_* limits in `state.ts`.
 */
export interface JohnSmithState {
  version: 1;
  /** Numeric part of the last canonical event id (`e_<n>`) the watch has read. */
  cursor: number;
  /** The cursor when John Smith arrived. Nothing at or before it is ever rewarded. */
  origin: number;
  /** Physical seconds of the last periodic pass, attention reading and renown census. */
  passAt: number;
  attentionAt: number;
  renownAt: number;
  /** Bumped on every holder-visible change; projections refresh from it. */
  revision: number;
  noticeSeq: number;
  attention: Record<EntityId, Attention>;
  ledgers: Record<EntityId, Ledger>;
  items: Record<EntityId, ItemDeeds>;
  holders: Record<EntityId, HolderRecord>;
  caches: CacheRecord[];
}

export const CACHE_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Legendary', 'Celestial'] as const;
export type CacheTierName = typeof CACHE_TIERS[number];
/** The finite reserve per world. Authored policy, fixed by the seed; nobody makes more. */
export const RESERVE_STOCK: readonly number[] = Object.freeze([240, 96, 36, 12, 4, 1]);

export const ATTENTION_TIERS = ['Unremarked', 'Noted', 'Watched', 'Followed', 'Studied', 'Fixated'] as const;
/** Lifetime historical significance at which each attention tier begins. */
export const ATTENTION_THRESHOLDS: readonly number[] = Object.freeze([0, 1, 5, 25, 100, 400]);

export interface Attention {
  tier: number;
  /** World seconds the current tier began. */
  since: number;
  significance: number;
}

/** Per-entity deed counters read by feats. Counters only rise; they summarize events. */
export interface Ledger {
  counts: Record<string, number>;
  feats: Record<string, FeatRecord>;
  lastAt: number;
  /** The Tower floor this person is currently being measured on, for flawless/near-death. */
  floor?: { runId: string; floor: number; taken: number };
}
export interface FeatRecord { at: number; tier: number; eventId?: EventId; cacheId?: string | null }

/** John Smith's archive of a weapon's deeds. Rarity is history. */
export interface ItemDeeds {
  hits: number;
  downs: number;
  kills: number;
  damage: number;
  wielders: EntityId[];
  firstAt: number;
  lastAt: number;
}

export type QuestKind = 'trial' | 'award' | 'coffer' | 'study' | 'veil' | 'landmark' | 'recover' | 'reclaim' | 'protect' | 'work'
  | 'tend' | 'justice' | 'repay' | 'fight';
export type QuestStatus = 'open' | 'completed' | 'failed' | 'moot' | 'faded';
export interface QuestObjective { id: string; text: string; done: boolean; have?: number; need?: number }
/** A waypoint, present only when the holder holds the location belief it comes from. */
export interface QuestTarget { pos: Vec3; label: string }
export interface QuestOutcome { code: string; text: string; eventId?: EventId }
export interface Quest {
  id: string;
  /** Identity of the matter (kind + source); one quest per key, ever. */
  key: string;
  kind: QuestKind;
  status: QuestStatus;
  title: string;
  summary: string;
  source: { kind: string; id: string };
  subjectId?: EntityId;
  itemId?: EntityId;
  /** The holder's knowledge keys this quest rests on: its provenance. */
  basisKeys: string[];
  objectives: QuestObjective[];
  target?: QuestTarget;
  recognizedAt: number;
  /** World seconds the matter was last seen open in the holder's evidence. */
  seenAt: number;
  updatedAt: number;
  closedAt?: number;
  outcome?: QuestOutcome;
  /** Cache tier granted on completion, or -1. */
  rewardTier: number;
  cacheId?: string | null;
  /** Interface preferences. Not canonical acts. */
  watched: boolean;
  dismissed: boolean;
}

export type NoticeKind = 'attention' | 'feat' | 'cache' | 'quest' | 'objective' | 'reserve' | 'archive';
export interface Notice { seq: number; at: number; kind: NoticeKind; title: string; text: string; tier?: number; ref?: string }
export interface ArchiveEntry { at: number; kind: string; text: string; eventId?: EventId }

/** Everything John Smith keeps for one interface holder. */
export interface HolderRecord {
  quests: Quest[];
  notices: Notice[];
  archive: ArchiveEntry[];
  /** Realm wards (`realm:district`) this holder has physically walked. */
  wards: string[];
  /** Landmarks (place ids, `portal:<realm>`) the holder has been close enough to see. */
  seen: string[];
  /** Landmarks the holder has entered. */
  entered: string[];
  /** First-occurrence event ids of the holder's own deeds, keyed by deed (`realm_crossed`,
   * `returned:<itemId>`, `gift:<itemId>`). Self-knowledge for quest judgements. */
  marks: Record<string, EventId>;
  /** Highest Tower floor whose trial this holder has completed. A milestone pays only above it. */
  bestTrial?: number;
  renown: number;
  questSeq: number;
  /** Last safety verdict shown for opening caches, so a change refreshes the projection. */
  safety: string;
}

export interface CacheRecord {
  id: string;
  tier: number;
  /** The tier the recognition asked for, before any substitution for a spent tier. */
  requested: number;
  recipientId: EntityId;
  reason: string;
  featId?: string;
  questId?: string;
  grantedAt: number;
  grantEventId: EventId;
  openedAt?: number;
  openEventId?: EventId;
  cofferId?: EntityId;
  itemIds?: EntityId[];
  /** Set when the emptied coffer has been withdrawn from the physical world. */
  withdrawnAt?: number;
}

export type JohnSmithCommand =
  | { type: 'open_cache'; cacheId: string }
  | { type: 'watch_quest'; questId: string; watch: boolean }
  | { type: 'dismiss_quest'; questId: string; dismiss: boolean };
