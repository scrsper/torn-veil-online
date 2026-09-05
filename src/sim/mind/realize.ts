import type { KnowledgeItem, Person, EntityId } from '../core/types';
import type { World } from '../core/world';
import { disposition } from './relationships';
import { isCrime, describeClaim } from './knowledge';

/**
 * Natural-language SYNTHESIS for player-facing dialogue — the last step of the Constitution's
 * own chain (§5): CANONICAL TRUTH → perception → knowledge/evidence → belief → memory →
 * interpretation → NATURAL-LANGUAGE PRESENTATION. Every function here only rearranges and
 * paraphrases fields already present on a `KnowledgeItem` (claim/source/confidence/hops) and the
 * SPEAKER's own real relationship state toward the people named in it — it never introduces an
 * entity, event, or fact that is not already grounded in `k.claim`/`k.source`. This is what
 * `mind/knowledge.ts`'s `describeClaim` deliberately is NOT: `describeClaim` stays a precise,
 * literal fact-string (used for the Inspector, internal event summaries, agent reasoning — all
 * contexts where exactness matters more than how it sounds); this module is specifically for
 * what an NPC actually SAYS out loud, where a flat "X attacked Y at Z. Q told me." event-log dump
 * reads like database output rather than a person talking.
 *
 * Variation is chosen deterministically from a stable hash of the claim's own key plus the
 * speaker's id — the same NPC always phrases the same fact the same way (no incoherent
 * flip-flopping across a conversation), different NPCs/facts vary — never `Math.random()`, so
 * a run stays fully deterministic.
 */
function stableIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
}
function pick<T>(pool: T[], seed: string): T { return pool[stableIndex(seed, pool.length)]; }

function who(world: World, id: EntityId | undefined, unknown?: boolean): string {
  return unknown ? 'someone' : id ? world.nameOf(id) : 'someone';
}

/** Variant core-fact phrasings for the event types most likely to actually come up as spoken
 * "news"/gossip. Deliberately NOT exhaustive — every OTHER event kind/type falls back to
 * `describeClaim`'s exact literal string (still fully grounded, just without extra phrasing
 * variety). Each entry only ever plugs in `who(...)`/`world.nameOf(...)` — the same identifiers
 * `describeClaim` itself would use — so no variant can name someone or somewhere `describeClaim`
 * would not also have named. */
const FACT_VARIANTS: Partial<Record<string, (world: World, c: Record<string, any>) => string[]>> = {
  attack: (world, c) => { const a = who(world, c.actor, c.actorUnknown); const t = who(world, c.target); const w = c.placeId ? ` near ${world.nameOf(c.placeId)}` : ''; return [`${a} attacked ${t}${w}`, `${a} went after ${t}${w}`, `${a} came to blows with ${t}${w}`]; },
  kill: (world, c) => { const a = who(world, c.actor, c.actorUnknown); const t = who(world, c.target); const w = c.placeId ? ` near ${world.nameOf(c.placeId)}` : ''; return [`${a} killed ${t}${w}`, `${a} took ${t}'s life${w}`]; },
  theft: (world, c) => { const a = who(world, c.actor, c.actorUnknown); const t = who(world, c.target); const it = c.item ? world.nameOf(c.item) : 'something'; return [`${a} stole ${it} from ${t}`, `${a} made off with ${it} that belonged to ${t}`, `${it} went missing, and ${a} is the one who took it from ${t}`]; },
  dispute: (world, c) => { const a = who(world, c.actor); const t = who(world, c.target); const about = c.about ? ` over ${c.about}` : ''; return [`${a} and ${t} quarrelled${about}`, `there's bad blood between ${a} and ${t}${about ? `, something${about}` : ''}`]; },
  death: (world, c) => { const t = who(world, c.target); const w = c.placeId ? ` near ${world.nameOf(c.placeId)}` : ''; return [`${t} died${w}`, `${t} is gone${w}`]; },
  arrest_attempt: (world, c) => { const a = who(world, c.actor); const t = who(world, c.target); return [`${a} tried to arrest ${t}`, `${a} came for ${t}, badge out`]; },
  confrontation: (world, c) => { const a = who(world, c.actor); const t = who(world, c.target); return [`${a} confronted ${t}`, `${a} had words with ${t}`]; },
  threat_spotted: (world, c) => { const a = who(world, c.actor, c.actorUnknown); const w = c.placeId ? ` near ${world.nameOf(c.placeId)}` : ''; return [`${a} was seen prowling${w}`, `${a} was skulking about${w}`]; },
};

/** How the speaker came to know it — the attribution clause, varied but never claiming a
 * different provenance than `k.source` actually records. */
function attribution(world: World, k: KnowledgeItem, seed: string): string {
  const src = k.source;
  if (src.type === 'witnessed') return pick(['I saw it myself', 'I watched it happen', 'I was there'], seed);
  if (src.type === 'heard') return pick(['I heard as much', 'word reached me', "that's what's being said"], seed);
  if (src.type === 'inferred') return pick(['I worked it out myself', 'I put it together myself'], seed);
  if (src.type === 'prior') return pick(["I've known that a good while", "that's old news to me"], seed);
  if (src.type === 'told' && src.from) { const name = world.nameOf(src.from); return pick([`${name} told me`, `${name} says so`, `I had it from ${name}`], seed + name); }
  return 'so they say';
}

/** A confidence hedge — only ever added when `k.confidence` genuinely says the speaker is not
 * sure; never invents doubt that isn't in the belief, and never hides real doubt either. */
function hedge(k: KnowledgeItem, seed: string): string {
  if (k.confidence >= 0.6) return '';
  return pick([', though I only half believe it', ", but I wouldn't swear to it", ", if it's even true"], seed);
}

/** Relational colour — grounded strictly in the SPEAKER's own real relationship toward the
 * claim's actor (never the player, never a third party not named in the claim). Only offered
 * for claims that are actually about wrongdoing (`isCrime`) — a marriage announcement doesn't
 * get "watch yourself around them". Absent entirely when the speaker has no meaningful opinion
 * of that person (familiarity 0, no disposition either way) — silence is more honest than
 * manufactured commentary. */
function relationalPrefix(world: World, speaker: Person, k: KnowledgeItem, seed: string): string {
  const c = k.claim;
  if (k.kind !== 'event' || !isCrime(c.type, c.intent) || !c.actor || c.actorUnknown) return '';
  const rel = speaker.relationships[c.actor];
  if (!rel || rel.familiarity <= 0) return '';
  const d = disposition(speaker, c.actor);
  const fear = rel.fear ?? 0;
  const name = world.nameOf(c.actor);
  if (fear > 0.4 || d < -0.3) return pick([`I'd stay clear of ${name}.`, `Watch yourself around ${name}.`, `${name}'s trouble, if you ask me.`], seed + name) + ' ';
  return '';
}

/** Recency/social-currency suffix — grounded in the claim's own recorded significance, never a
 * fabricated sense of importance. Returned as a comma-led fragment (no terminal punctuation) so
 * it can be folded into the same sentence as the fact/attribution rather than starting a new,
 * awkwardly-capitalized one. */
function socialCurrency(world: World, k: KnowledgeItem, seed: string): string {
  const sig = k.claim.significance ?? 0;
  const recentEnough = k.claim.tick !== undefined && world.now - k.claim.tick < 3600 * 24 * 3; // within 3 world-days
  if (sig < 0.5 || !recentEnough) return '';
  return ', ' + pick(['and people are still talking about it', "though it's all anyone's spoken of lately", 'and half the village has an opinion on it'], seed);
}

/**
 * The main entry point: turn one grounded `KnowledgeItem` into one natural spoken line. Falls
 * back to `describeClaim`'s literal phrasing for any event type not in `FACT_VARIANTS` (still
 * fully grounded — just without extra phrasing variety, a disclosed, bounded scope limit rather
 * than a silent gap).
 */
export function realizeClaim(world: World, speaker: Person, k: KnowledgeItem): string {
  const seed = `${speaker.id}:${k.key}`;
  const c = k.claim;
  const variants = k.kind === 'event' ? FACT_VARIANTS[c.type as string] : undefined;
  let fact: string;
  if (variants) fact = pick(variants(world, c), seed);
  else fact = describeClaim(world, k);
  const prefix = relationalPrefix(world, speaker, k, seed);
  const attrib = attribution(world, k, seed);
  // hedge/socialCurrency are comma-led fragments (or empty) — exactly one terminal period, added
  // once here, so a run of doubt/social-currency clauses never produces "...told me. and..."
  const tail = hedge(k, seed) + socialCurrency(world, k, seed) + '.';
  return `${prefix}${fact}, ${attrib}${tail}`;
}
