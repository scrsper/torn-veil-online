import type { AttributeId, Body, Creature, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { ATTRIBUTE_IDS } from '../core/human';
import { develop } from '../core/development';
import { WILDLIFE_SPECIES } from '../ecology/species';
import {
  defeatXp, floorLevel, foundationDemand, foundationXp, gapFactor, isLeveledRank, MAX_LEVEL, peakXp, PRACTICE_XP_PER_HOUR,
  rankIndex, rankOfLevel, standing, VESSELS, xpToNext, type LeveledRank, type LevelStanding,
} from './levels';
import { creatureThreat, personThreat } from './threat';

/**
 * Earned experience: one shared ledger for players and NPCs, fed only by canonical receipts.
 *
 * Sources are explicit adapters over things that really happened: a defeating blow in the
 * shared hit resolver (opposed people and wild animals), credited capability practice, a newly
 * developed foundation point, a cleared canonical Tower floor, a newly learned arcane form and
 * recognised achievements. No caller supplies an amount; each source event pays a person once.
 *
 * Experience fills the current rank's track. A full track ("peak") cannot level further and
 * later experience is recorded as overflow, not banked: only a breakthrough opens the next rank
 * (the DotF bottleneck). Every breakthrough path calls `onBreakthrough`, which remakes the body
 * (the rank vessel) and opens the new rank at "<rank> 0" (HWFWM). Levels gate only the new
 * post-Iron breakthroughs; they never enter combat, perception or existing Iron/source gates.
 */
export type ExperienceKind = 'defeat' | 'practice' | 'foundation' | 'tower' | 'learning' | 'achievement';
export interface ExperienceReceipt { kind: ExperienceKind; xp: number; tick: number; eventId?: string; key?: string }
/** A credited opposed victory over an opponent of Iron-band threat or above. */
export interface ExperienceFeat { eventId: string; victimId: string; level: number; tick: number }
export interface ExperienceLedger {
  version: 1;
  /** The rank this track measures; it reopens at 0 when the person's stage advances. */
  stage: LeveledRank;
  rankXp: number; lifetimeXp: number; overflowXp: number;
  trackEventId?: string;
  /** Highest foundation value already credited; values held when the ledger opened are not paid. */
  foundations: Partial<Record<AttributeId, number>>;
  /** Distinct opponents already credited. One body, person or animal pays once, ever. */
  defeated: string[];
  feats: ExperienceFeat[];
  achievements: Record<string, { eventId: string; xp: number; tick: number }>;
  receipts: ExperienceReceipt[];
  tally: { defeats: number; practiceSeconds: number; levelUps: number };
}
export interface RankVessel {
  version: 1; stage: LeveledRank; eventId: string; resilience: number; force: number; ceiling: number;
  /** Each body's maximum health before any vessel, so later ranks multiply the original body. */
  base: Record<string, number>;
}

export const MAX_DEFEATED = 4096, MAX_FEATS = 64, MAX_RECEIPTS = 48, MAX_ACHIEVEMENTS = 96;
const SCAN_EVENTS = 1500, MIN_CONTRIBUTION = 0.25, TOWER_SHARE = 0.25, LEARNING_SHARE = 0.3;

const ACHIEVEMENTS: Record<string, { title: string; text: string; levels: number }> = {
  'first-blood': { title: 'First Blood', text: 'Overcame a resisting opponent for the first time.', levels: 0.5 },
  'giant-slayer': { title: 'Giant Slayer', text: 'Overcame an opponent five or more levels above you.', levels: 1 },
  'rank-breaker': { title: 'Rank Breaker', text: 'Overcame an opponent whose threat lies in a rank above your own.', levels: 1.5 },
  untouched: { title: 'Untouched', text: 'Overcame an equal or stronger opponent without taking a blow from them.', levels: 0.5 },
  'last-stand': { title: 'Last Stand', text: 'Delivered a defeating blow with less than a sixth of your health left.', levels: 0.5 },
  awakened: { title: 'Awakened', text: 'Learned a first arcane form from a real source.', levels: 0.5 },
  exceptional: { title: 'Exceptional Foundation', text: 'Developed a foundation to 15 through lived activity.', levels: 0.5 },
  ...Object.fromEntries([1, 10, 25, 50, 75, 100].map(n => [`tower:${n}`, { title: `Trial ${n}`, text: `Cleared floor ${n} of the Tower of Chrysanthus.`, levels: n === 1 ? 0.5 : n >= 75 ? 1.5 : 1 }])),
  // A breakthrough is credited on its own advancement event and stays below one level, so it
  // opens the new rank without emitting anything after the transition itself.
  ...Object.fromEntries(['Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'].map(r => [`breakthrough:${r}`, { title: `${r} Rank`, text: `Broke through to ${r}.`, levels: 0.5 }])),
  ...Object.fromEntries(['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'].map(r => [`peak:${r}`, { title: `Peak ${r}`, text: `Filled the ${r} track; only a breakthrough leads on.`, levels: 0 }])),
};
export function achievementInfo(id: string): { title: string; text: string; levels: number } | null {
  if (ACHIEVEMENTS[id]) return ACHIEVEMENTS[id];
  const species = id.startsWith('quarry:') ? id.slice(7) : '';
  return species && species.length <= 64 ? { title: `Quarry: ${WILDLIFE_SPECIES[species]?.name ?? species}`, text: `Brought down a ${WILDLIFE_SPECIES[species]?.name ?? species} oneself.`, levels: 0.25 } : null;
}

/** The ledger opens lazily at the person's current rank; foundations already held are baseline. */
export function experienceLedger(p: Person): ExperienceLedger | null {
  if (!isLeveledRank(p.ontology.stage)) return null;
  return p.experience ??= { version: 1, stage: p.ontology.stage, rankXp: 0, lifetimeXp: 0, overflowXp: 0,
    foundations: Object.fromEntries(ATTRIBUTE_IDS.map(id => [id, p.attributes[id]])), defeated: [], feats: [], achievements: {}, receipts: [],
    tally: { defeats: 0, practiceSeconds: 0, levelUps: 0 } };
}
function syncTrack(p: Person, l: ExperienceLedger): void {
  if (l.stage === p.ontology.stage || !isLeveledRank(p.ontology.stage)) return;
  // A stage reached by any path opens its own track; nothing carries across the breakthrough.
  l.stage = p.ontology.stage; l.rankXp = 0; l.trackEventId = p.ontology.breakthroughEventId;
}
/** Self-knowledge of one's own growth. Null beyond Diamond, where levels do not apply. */
export function earnedStanding(p: Person): LevelStanding | null {
  if (!isLeveledRank(p.ontology.stage)) return null;
  const l = p.experience;
  return standing(p.ontology.stage, l && l.stage === p.ontology.stage ? l.rankXp : 0);
}
export function earnedLevel(p: Person): number { return earnedStanding(p)?.level ?? MAX_LEVEL; }
/** The level an opponent is worth: a person's earned level or actual equipped threat, whichever
 * is higher (a kitted Tower warden with no history is still dangerous); an animal's threat. */
export function effectiveLevel(w: World, b: Body): number {
  const owner = w.get<Person | Creature>(b.ownerId);
  if (owner?.kind === 'person') return Math.max(earnedLevel(owner as Person), personThreat(w, owner as Person, b).level);
  if (owner?.kind === 'creature') return creatureThreat(w, owner as Creature, b).level;
  return 1;
}

export interface ExperienceCredit { kind: ExperienceKind; xp: number; eventId?: string; key?: string }
/** The single entry point. Returns experience actually credited (stored or overflow). */
export function creditExperience(w: World, p: Person, c: ExperienceCredit): number {
  if (!p.alive || !Number.isFinite(c.xp) || c.xp <= 0) return 0;
  const l = experienceLedger(p); if (!l) return 0;
  const source = c.eventId ? w.event(c.eventId) : undefined;
  if (c.eventId && (!source || source.data.experienceCredits?.[p.id] !== undefined)) return 0;
  syncTrack(p, l);
  const before = standing(l.stage, l.rankXp), stored = Math.min(c.xp, Math.max(0, peakXp(l.stage) - l.rankXp));
  l.rankXp += stored; l.lifetimeXp += c.xp; l.overflowXp += c.xp - stored;
  if (source) source.data.experienceCredits = { ...(source.data.experienceCredits ?? {}), [p.id]: c.xp };
  l.receipts = [...l.receipts, { kind: c.kind, xp: c.xp, tick: w.now, ...(c.eventId ? { eventId: c.eventId } : {}), ...(c.key ? { key: c.key } : {}) }].slice(-MAX_RECEIPTS);
  const after = standing(l.stage, l.rankXp);
  if (after.sub > before.sub || after.peak && !before.peak) {
    l.tally.levelUps += after.sub - before.sub;
    const b = w.primaryBody(p.id);
    w.emit('level_attained', { actor: p.id, pos: b ? { ...b.pos } : undefined, causes: c.eventId ? [c.eventId] : [], category: 'world', significance: 0.35,
      data: { stage: l.stage, from: before.sub, to: after.sub, level: after.level, peak: after.peak, kind: c.kind },
      summary: after.peak ? `${p.name} reached peak ${l.stage}` : `${p.name} reached ${after.label} (level ${after.level})` });
    if (after.peak) achieve(w, p, `peak:${l.stage}`, c.eventId ? [c.eventId] : []);
  }
  return c.xp;
}
/** Recognise an achievement once. Its reward scales with the current level so that it stays
 * meaningful at any rank. `onEvent` credits an existing event instead of emitting a new one. */
export function achieve(w: World, p: Person, id: string, causes: string[], onEvent?: WorldEvent): boolean {
  const info = achievementInfo(id), l = experienceLedger(p);
  if (!info || !l || !p.alive || l.achievements[id] || Object.keys(l.achievements).length >= MAX_ACHIEVEMENTS) return false;
  syncTrack(p, l);
  const xp = Math.round(info.levels * xpToNext(standing(l.stage, l.rankXp).level));
  const ev = onEvent ?? w.emit('achievement_earned', { actor: p.id, causes: [...new Set(causes)].filter(id => w.event(id)), category: 'world', significance: 0.45,
    data: { achievement: id, title: info.title, xp }, summary: `${p.name} earned ${info.title}` });
  l.achievements[id] = { eventId: ev.id, xp, tick: w.now };
  if (xp > 0) creditExperience(w, p, { kind: 'achievement', xp, eventId: ev.id, key: id });
  return true;
}

const MELEE_WEIGHTS = { strength: 0.6, dexterity: 0.8, endurance: 0.7, vitality: 0.2, will: 0.3, perception: 0.3 };
const ARCANE_WEIGHTS = { will: 0.9, perception: 0.6, intellect: 0.5, endurance: 0.2 };
/** Called by the shared hit resolver after every applied blow, for players and NPCs alike. Only a
 * defeating blow pays. A person must really have resisted each credited contributor (an agreed
 * trial, or they struck that contributor during the encounter); an animal must be wild and
 * killed. Conflicts are pairwise, so the encounter spans every unresolved conflict involving the
 * victim. Everyone who dealt a quarter of the victim's health shares by damage; a last tap on
 * someone else's fight pays nothing. */
export function recordDefeatExperience(w: World, attacker: Person, ab: Body, tb: Body, ev: WorldEvent): void {
  if (ev.type !== 'attack' || ev.actor !== attacker.id || !(ev.data.damage > 0) || !(ev.data.health <= 0)) return;
  const owner = w.get<Person | Creature>(tb.ownerId); if (!owner || owner.id !== ev.target) return;
  const person = owner.kind === 'person' ? owner as Person : null, animal = owner.kind === 'creature' ? owner as Creature : null;
  if (person ? !(tb.dead || tb.pose === 'downed') : !(animal?.wildlife && tb.dead)) return;
  const conflict = person ? w.conflicts.find(c => c.id === ev.data.conflictId) : undefined;
  if (person && !conflict) return;
  const open = person ? w.conflicts.filter(c => c.participants.includes(owner.id) && (c.status !== 'resolved' || c.id === conflict!.id)) : [];
  // Bounded recent scan of this encounter's blows: who hurt the victim, and who it hurt.
  const dealt = new Map<string, { damage: number; arcane: number }>(), struck = new Set<string>();
  const since = person ? Math.min(...open.map(c => c.startedAt)) : ev.tick - 3600;
  for (let i = w.events.length - 1, n = 0; i >= 0 && n < SCAN_EVENTS; i--, n++) {
    const e = w.events[i]; if (e.tick < since) break;
    if (e.type !== 'attack') continue;
    if (e.target === owner.id && e.data.targetBodyId === tb.id && e.actor && e.data.damage > 0) {
      const d = dealt.get(e.actor) ?? { damage: 0, arcane: 0 }; d.damage += e.data.damage; if (e.data.arcaneEventId) d.arcane += e.data.damage; dealt.set(e.actor, d);
    }
    if (e.actor === owner.id && e.target) struck.add(e.target);
  }
  const total = [...dealt.values()].reduce((n, d) => n + d.damage, 0); if (total <= 0) return;
  const victimLevel = person ? Math.max(earnedLevel(person), personThreat(w, person, tb).level) : creatureThreat(w, animal!, tb).level;
  for (const [id, d] of [...dealt].sort((a, b) => a[0].localeCompare(b[0]))) {
    const q = w.person(id);
    if (!q?.alive || q.id === owner.id || d.damage < tb.maxHealth * MIN_CONTRIBUTION) continue;
    if (person) {
      const agreed = !!q.combatTrial?.id && q.combatTrial.id === person.combatTrial?.id && q.combatTrial.opponents.includes(person.id) && !q.combatTrial.endedEventId;
      if (!agreed && !struck.has(q.id)) continue;
    }
    const l = experienceLedger(q); if (!l || l.defeated.includes(owner.id) || l.defeated.length >= MAX_DEFEATED) continue;
    syncTrack(q, l);
    const share = d.damage / total, own = earnedLevel(q);
    l.defeated.push(owner.id); l.tally.defeats++;
    if (victimLevel >= floorLevel('Iron')) {
      l.feats = [...l.feats, { eventId: ev.id, victimId: owner.id, level: victimLevel, tick: w.now }]
        .sort((a, b) => b.level - a.level || b.tick - a.tick || a.eventId.localeCompare(b.eventId)).slice(0, MAX_FEATS);
    }
    creditExperience(w, q, { kind: 'defeat', xp: defeatXp(victimLevel, own) * share, eventId: ev.id });
    const causes = [ev.id];
    if (person) achieve(w, q, 'first-blood', causes);
    if (animal) achieve(w, q, `quarry:${animal.species}`, causes);
    if (victimLevel >= own + 5) achieve(w, q, 'giant-slayer', causes);
    if (rankIndex(rankOfLevel(victimLevel)) > rankIndex(q.ontology.stage)) achieve(w, q, 'rank-breaker', causes);
    if (victimLevel >= own && share >= 0.5 && !struck.has(q.id)) achieve(w, q, 'untouched', causes);
    if (q.id === attacker.id && ab.health > 0 && ab.health <= ab.maxHealth / 6) achieve(w, q, 'last-stand', causes);
    // A real fight against a stronger opponent is the only stimulus that demands foundations
    // beyond ordinary work (levels.foundationDemand); the shared develop() limits still apply.
    if (person) develop(w, q, { weights: d.arcane * 2 > d.damage ? ARCANE_WEIGHTS : MELEE_WEIGHTS, seconds: 600 * share, intensity: 0.8,
      challenge: foundationDemand(victimLevel), causeEventId: ev.id });
  }
}

/** Capability practice already credited by core/capability.ts (its own event dedupe and limits). */
export function recordPracticeExperience(w: World, p: Person, sourceEventId: string, effectiveSeconds: number): void {
  const l = experienceLedger(p); if (!l || !(effectiveSeconds > 0)) return;
  l.tally.practiceSeconds += effectiveSeconds;
  creditExperience(w, p, { kind: 'practice', xp: effectiveSeconds / 3600 * PRACTICE_XP_PER_HOUR, eventId: sourceEventId });
}
/** A newly reached integer foundation value from core/development.ts. Each value pays once. */
export function recordFoundationExperience(w: World, p: Person, id: AttributeId, value: number, cause?: string): void {
  const opened = !p.experience, l = experienceLedger(p); if (!l) return;
  if (opened) l.foundations[id] = value - 1;
  if (value <= (l.foundations[id] ?? value)) return;
  l.foundations[id] = value;
  creditExperience(w, p, { kind: 'foundation', xp: foundationXp(value), key: `foundation:${id}:${value}` });
  if (value === 15) achieve(w, p, 'exceptional', cause ? [cause] : []);
}
/** A cleared canonical Tower floor: a share of its wardens' level, plus milestone trials. */
export function recordTowerExperience(w: World, p: Person, cleared: WorldEvent, wardenBodyIds: string[]): void {
  const bodies = wardenBodyIds.map(id => w.body(id)).filter((b): b is Body => !!b); if (!bodies.length || !experienceLedger(p)) return;
  const level = Math.round(bodies.reduce((n, b) => n + effectiveLevel(w, b), 0) / bodies.length);
  creditExperience(w, p, { kind: 'tower', xp: TOWER_SHARE * xpToNext(level) * gapFactor(level, earnedLevel(p)), eventId: cleared.id });
  const floor = cleared.data.floor;
  if ([1, 10, 25, 50, 75, 100].includes(floor)) achieve(w, p, `tower:${floor}`, [cleared.id]);
}
/** A newly learned arcane form (HWFWM: absorbing an essence is the start of power). */
export function recordLearningExperience(w: World, p: Person, learned: WorldEvent): void {
  const l = experienceLedger(p); if (!l) return;
  creditExperience(w, p, { kind: 'learning', xp: LEARNING_SHARE * xpToNext(earnedLevel(p)), eventId: learned.id });
  achieve(w, p, 'awakened', [learned.id]);
}

/** Called by every breakthrough path after `p.ontology` names the new stage. Remakes the body
 * (health fraction preserved: nothing is healed or wounded by it), opens the new rank's track and
 * recognises the breakthrough on the advancement event itself. */
export function onBreakthrough(w: World, p: Person, event: WorldEvent): void {
  const stage = p.ontology.stage; if (!isLeveledRank(stage)) return;
  const v = VESSELS[stage], base: Record<string, number> = {};
  for (const id of p.bodies) {
    const b = w.body(id); if (!b) continue;
    base[id] = p.vessel?.base[id] ?? b.maxHealth;
    if (b.dead) continue;
    const max = Math.round(base[id] * v.resilience), fraction = b.maxHealth > 0 ? b.health / b.maxHealth : 1;
    b.maxHealth = max; b.health = Math.min(max, fraction * max);
  }
  p.vessel = { version: 1, stage, eventId: event.id, resilience: v.resilience, force: v.force, ceiling: v.ceiling, base };
  event.data.vessel = { resilience: v.resilience, force: v.force, ceiling: v.ceiling };
  const l = experienceLedger(p)!;
  l.stage = stage; l.rankXp = 0; l.trackEventId = event.id;
  achieve(w, p, `breakthrough:${stage}`, [], event);
}

/** The person's own recent level-ups, achievements and breakthroughs, newest last, phrased as the
 * Dungeon Crawler Carl "System" would announce them. Only events this person was the actor of. */
export function recentAnnouncements(w: World, p: Person, limit = 6): { id: string; kind: 'level' | 'achievement' | 'breakthrough'; text: string }[] {
  const out: { id: string; kind: 'level' | 'achievement' | 'breakthrough'; text: string }[] = [];
  for (let i = w.events.length - 1, n = 0; i >= 0 && n < 600 && out.length < limit; i--, n++) {
    const e = w.events[i]; if (e.actor !== p.id) continue;
    if (e.type === 'level_attained') out.push({ id: e.id, kind: 'level', text: e.data.peak
      ? `Peak ${e.data.stage}. Your track is full: only a breakthrough leads on.`
      : `Level up: ${e.data.stage} ${e.data.to} (level ${e.data.level}).` });
    else if (e.type === 'achievement_earned') { const info = achievementInfo(e.data.achievement);
      out.push({ id: e.id, kind: 'achievement', text: `Achievement: ${e.data.title}. ${info?.text ?? ''}${e.data.xp > 0 ? ` +${e.data.xp} experience.` : ''}`.trim() }); }
    else if (e.type === 'ontological_advancement' && e.data.vessel) out.push({ id: e.id, kind: 'breakthrough',
      text: `Breakthrough: ${e.data.to} rank. Your body is remade: ×${e.data.vessel.resilience} resilience, ×${e.data.vessel.force} force, foundations to ${e.data.vessel.ceiling}.` });
  }
  return out.reverse();
}

/** The person's own view of their growth: journal, HUD and developer inspection. */
export function experienceSummary(w: World, p: Person) {
  const s = earnedStanding(p), l = p.experience && p.experience.stage === p.ontology.stage ? p.experience : undefined;
  return {
    stage: p.ontology.stage, leveled: !!s, label: s?.label ?? p.ontology.stage, level: s?.level ?? null, sub: s?.sub ?? null,
    xpIntoLevel: Math.floor(s?.xpIntoLevel ?? 0), xpForLevel: s?.xpForLevel ?? 0, rankXp: Math.floor(s?.rankXp ?? 0), peakXp: s?.peakXp ?? 0, peak: !!s?.peak,
    lifetimeXp: Math.floor(p.experience?.lifetimeXp ?? 0), overflowXp: Math.floor(p.experience?.overflowXp ?? 0),
    defeats: p.experience?.tally.defeats ?? 0, feats: (p.experience?.feats ?? []).filter(f => w.event(f.eventId)).map(f => ({ level: f.level, rank: rankOfLevel(f.level) })),
    recent: (l?.receipts ?? []).slice(-8).reverse().map(r => ({ kind: r.kind, xp: Math.round(r.xp) })),
    achievements: Object.entries(p.experience?.achievements ?? {}).sort((a, b) => a[1].tick - b[1].tick || a[0].localeCompare(b[0]))
      .map(([id, a]) => ({ id, title: achievementInfo(id)?.title ?? id, xp: a.xp })),
    vessel: p.vessel ? { stage: p.vessel.stage, resilience: p.vessel.resilience, force: p.vessel.force, ceiling: p.vessel.ceiling } : null,
  };
}
export type ExperienceSummary = ReturnType<typeof experienceSummary>;
