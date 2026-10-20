import type { AttributeId, Body, Creature, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { ATTRIBUTE_IDS } from '../core/human';
import { develop } from '../core/development';
import { WILDLIFE_SPECIES } from '../ecology/species';
import {
  defeatXp, floorLevel, foundationDemand, foundationXp, gapFactor, isLeveledRank, LEVELED_RANKS, MAX_LEVEL, peakXp, PRACTICE_XP_PER_HOUR,
  rankIndex, rankOfLevel, standing, VESSELS, xpToNext, type LeveledRank, type LevelStanding,
} from './levels';
import { abilityLevel, creatureThreat, personThreat } from './threat';

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

export const MAX_DEFEATED = 4096, MAX_FEATS = 64, MAX_RECEIPTS = 12, MAX_ACHIEVEMENTS = 96;
/** How a full track reads: Diamond is the summit, every other peak waits on a breakthrough. */
export function peakText(stage: string): string {
  return stage === 'Diamond' ? 'Peak Diamond: the summit of the leveled ladder.' : `Peak ${stage}: only a breakthrough leads on.`;
}
/** The events a feat may name: the defeating blow, or the opponent's own surrender. */
export const FEAT_EVENTS: readonly string[] = ['attack', 'entity_surrendered'];
/** Credited feats at or above a level, still backed by their canonical event. */
export function featsAtLeast(w: World, p: Person, level: number): ExperienceFeat[] {
  return (p.experience?.feats ?? []).filter(f => f.level >= level && FEAT_EVENTS.includes(w.event(f.eventId)?.type ?? ''));
}
const MIN_CONTRIBUTION = 0.25, TOWER_SHARE = 0.25, LEARNING_SHARE = 0.3;

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
  ...Object.fromEntries(['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'].map(r => [`peak:${r}`, { title: `Peak ${r}`,
    text: r === 'Diamond' ? 'Filled the Diamond track: the summit of the leveled ladder.' : `Filled the ${r} track; only a breakthrough leads on.`, levels: 0 }])),
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
/** Recognise an achievement once. Its reward is priced by the deed: a share of the level cost of
 * the smaller of the person's own level and `deedLevel`, so a trivial first saved for a high rank
 * (a hare at Gold, a first form) stays small. `onEvent` credits an existing event instead of
 * emitting a new one. */
export function achieve(w: World, p: Person, id: string, causes: string[], opts: { onEvent?: WorldEvent; deedLevel?: number } = {}): boolean {
  const info = achievementInfo(id), l = experienceLedger(p);
  if (!info || !l || !p.alive || l.achievements[id] || Object.keys(l.achievements).length >= MAX_ACHIEVEMENTS) return false;
  syncTrack(p, l);
  const own = standing(l.stage, l.rankXp).level, xp = Math.round(info.levels * xpToNext(Math.min(own, opts.deedLevel ?? own)));
  const ev = opts.onEvent ?? w.emit('achievement_earned', { actor: p.id, causes: [...new Set(causes)].filter(id => w.event(id)), category: 'world', significance: 0.45,
    data: { achievement: id, title: info.title, xp }, summary: `${p.name} earned ${info.title}` });
  l.achievements[id] = { eventId: ev.id, xp, tick: w.now };
  if (xp > 0) creditExperience(w, p, { kind: 'achievement', xp, eventId: ev.id, key: id });
  return true;
}

/** The current encounter of one body, kept by the shared hit resolver (players, NPCs and animals):
 * effective damage each attacker dealt it, whom it struck, and the strongest threat it presented
 * while actually striking. Entries lapse after ENCOUNTER_SECONDS without a blow; a defeat or a
 * surrender closes the encounter. It replaces scanning the global event log, which missed long
 * fights in a busy world and could not tell overkill from real damage. */
export interface EncounterTally {
  version: 1;
  dealt: Record<string, { damage: number; arcane: number; at: number }>;
  struck: Record<string, number>;
  /** Highest threat level this body presented while delivering a blow (0 = has not struck). */
  presented: number;
}
export const ENCOUNTER_SECONDS = 600, MAX_TALLY = 16;
function tally(w: World, b: Body): EncounterTally {
  const t = b.encounter ??= { version: 1, dealt: {}, struck: {}, presented: 0 }, cutoff = w.physicalTime - ENCOUNTER_SECONDS;
  for (const [id, d] of Object.entries(t.dealt)) if (d.at < cutoff) delete t.dealt[id];
  for (const [id, at] of Object.entries(t.struck)) if (at < cutoff) delete t.struck[id];
  if (!Object.keys(t.struck).length) t.presented = 0;
  return t;
}
function bound<T>(record: Record<string, T>, at: (v: T) => number): void {
  const keys = Object.keys(record); if (keys.length <= MAX_TALLY) return;
  for (const id of keys.sort((a, b) => at(record[a]) - at(record[b]) || a.localeCompare(b)).slice(0, keys.length - MAX_TALLY)) delete record[id];
}
/** Called by Simulation.applyHit for every applied blow. A body already down, surrendered, subdued
 * or held (`out`) gains no contribution: finishing someone who is out of the fight is not
 * overcoming them. Damage beyond the health the victim had left is not counted. */
export function noteBlow(w: World, attacker: Person, ab: Body, tb: Body, damage: number, healthBefore: number, out: boolean, arcane: boolean): void {
  const strike = tally(w, ab);
  strike.struck[tb.ownerId] = w.physicalTime; bound(strike.struck, at => at);
  strike.presented = Math.max(strike.presented, personThreat(w, attacker, ab).level);
  if (out || !(damage > 0)) return;
  const effective = Math.min(damage, Math.max(0, healthBefore)); if (effective <= 0) return;
  const t = tally(w, tb), d = t.dealt[attacker.id] ??= { damage: 0, arcane: 0, at: w.physicalTime };
  d.damage += effective; if (arcane) d.arcane += effective; d.at = w.physicalTime; bound(t.dealt, x => x.at);
}
/** A wild animal's defensive strike (ecology/defense.ts), so fighting back is resistance. */
export function noteCreatureStrike(w: World, animal: Creature, ab: Body, tb: Body): void {
  const t = tally(w, ab);
  t.struck[tb.ownerId] = w.physicalTime; bound(t.struck, at => at);
  t.presented = Math.max(t.presented, creatureThreat(w, animal, ab).level);
}

const MELEE_WEIGHTS = { strength: 0.6, dexterity: 0.8, endurance: 0.7, vitality: 0.2, will: 0.3, perception: 0.3 };
const ARCANE_WEIGHTS = { will: 0.9, perception: 0.6, intellect: 0.5, endurance: 0.2 };
/** Called by the shared hit resolver after every applied blow, for players and NPCs alike. Only a
 * defeating blow on someone still in the fight pays. A person must really have resisted each
 * credited contributor (an agreed trial, or they struck that contributor this encounter); an
 * animal must be wild and killed. Everyone who dealt a quarter of the victim's health shares by
 * effective damage; a last tap on someone else's fight pays nothing. */
export function recordDefeatExperience(w: World, attacker: Person, ab: Body, tb: Body, ev: WorldEvent, out = false): void {
  if (out || ev.type !== 'attack' || ev.actor !== attacker.id || !(ev.data.damage > 0) || !(ev.data.health <= 0)) return;
  const owner = w.get<Person | Creature>(tb.ownerId); if (!owner || owner.id !== ev.target) return;
  if (owner.kind === 'person' ? !(tb.dead || tb.pose === 'downed') : !((owner as Creature).wildlife && tb.dead)) return;
  creditDefeat(w, owner as Person | Creature, tb, ev, { attacker, ab });
}
/** Yielding to an opponent is being overcome: the contributors share it as a defeat, once. */
export function recordSurrenderExperience(w: World, who: Person, ev: WorldEvent): void {
  const b = w.primaryBody(who.id); if (b && ev.type === 'entity_surrendered' && ev.actor === who.id) creditDefeat(w, who, b, ev);
}
function creditDefeat(w: World, owner: Person | Creature, tb: Body, ev: WorldEvent, finisher?: { attacker: Person; ab: Body }): void {
  const t = tb.encounter; if (!t) return;
  tally(w, tb);
  const person = owner.kind === 'person' ? owner as Person : null, animal = owner.kind === 'creature' ? owner as Creature : null;
  const dealt = Object.entries(t.dealt).sort((a, b) => a[0].localeCompare(b[0])), total = dealt.reduce((n, [, d]) => n + d.damage, 0);
  // The encounter is over either way; a recovered body starts a new one.
  const struck = { ...t.struck }; delete tb.encounter;
  if (total <= 0) return;
  // Capability is truth: an opponent is worth the threat it actually presented while striking,
  // else what it stood ready with; never its rank label or its own earned level.
  const victimLevel = person ? (t.presented || personThreat(w, person, tb).level) : creatureThreat(w, animal!, tb).level;
  const fights = !!person || creatureThreat(w, animal!, tb).offense > 0;
  for (const [id, d] of dealt) {
    const q = w.person(id);
    if (!q?.alive || q.id === owner.id || d.damage < tb.maxHealth * MIN_CONTRIBUTION) continue;
    if (person) {
      const agreed = !!q.combatTrial?.id && q.combatTrial.id === person.combatTrial?.id && q.combatTrial.opponents.includes(person.id) && !q.combatTrial.endedEventId;
      if (!agreed && struck[q.id] === undefined) continue;
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
    const causes = [ev.id], deed = { deedLevel: victimLevel };
    if (person) achieve(w, q, 'first-blood', causes, deed);
    if (animal) achieve(w, q, `quarry:${animal.species}`, causes, deed);
    if (victimLevel >= own + 5) achieve(w, q, 'giant-slayer', causes, deed);
    if (rankIndex(rankOfLevel(victimLevel)) > rankIndex(q.ontology.stage)) achieve(w, q, 'rank-breaker', causes, deed);
    if (fights && victimLevel >= own && share >= 0.5 && struck[q.id] === undefined) achieve(w, q, 'untouched', causes, deed);
    if (finisher?.attacker.id === q.id && finisher.ab.health > 0 && finisher.ab.health <= finisher.ab.maxHealth / 6) achieve(w, q, 'last-stand', causes, deed);
    // A real fight against an opponent beyond ordinary mortal threat is the only stimulus that
    // demands foundations beyond ordinary work (levels.foundationDemand); ordinary brawls keep
    // their existing effect on village life. The shared develop() limits still apply.
    if (person && victimLevel >= floorLevel('Iron')) develop(w, q, { weights: d.arcane * 2 > d.damage ? ARCANE_WEIGHTS : MELEE_WEIGHTS, seconds: 600 * share, intensity: 0.8,
      challenge: foundationDemand(victimLevel), causeEventId: ev.id });
  }
}

/** Capability practice already credited by core/capability.ts (its own event dedupe and limits). */
export function recordPracticeExperience(w: World, p: Person, sourceEventId: string, effectiveSeconds: number): void {
  const l = experienceLedger(p); if (!l || !(effectiveSeconds > 0)) return;
  l.tally.practiceSeconds += effectiveSeconds;
  creditExperience(w, p, { kind: 'practice', xp: effectiveSeconds / 3600 * PRACTICE_XP_PER_HOUR, eventId: sourceEventId });
}
/** A newly reached integer foundation value from core/development.ts. Each value pays once, and
 * only when the development has a canonical cause (a fight, credited practice, a meditation, an
 * understanding): ordinary labour and growing up make a body stronger without levelling it. */
export function recordFoundationExperience(w: World, p: Person, id: AttributeId, value: number, cause?: string): void {
  if (!cause || !w.event(cause)) { if (p.experience) p.experience.foundations[id] = Math.max(p.experience.foundations[id] ?? 0, value); return; }
  const opened = !p.experience, l = experienceLedger(p); if (!l) return;
  if (opened) l.foundations[id] = value - 1;
  if (value <= (l.foundations[id] ?? value)) return;
  l.foundations[id] = value;
  creditExperience(w, p, { kind: 'foundation', xp: foundationXp(value), key: `foundation:${id}:${value}` });
  // An exceptional mortal foundation is a Normal-band deed at any rank.
  if (value === 15) achieve(w, p, 'exceptional', cause ? [cause] : [], { deedLevel: floorLevel('Iron') - 1 });
}
/** A cleared canonical Tower floor: a share of its wardens' level, plus milestone trials. */
export function recordTowerExperience(w: World, p: Person, cleared: WorldEvent, wardenBodyIds: string[]): void {
  const bodies = wardenBodyIds.map(id => w.body(id)).filter((b): b is Body => !!b); if (!bodies.length || !experienceLedger(p)) return;
  const level = Math.round(bodies.reduce((n, b) => n + effectiveLevel(w, b), 0) / bodies.length);
  creditExperience(w, p, { kind: 'tower', xp: TOWER_SHARE * xpToNext(level) * gapFactor(level, earnedLevel(p)), eventId: cleared.id });
  const floor = cleared.data.floor;
  if ([1, 10, 25, 50, 75, 100].includes(floor)) achieve(w, p, `tower:${floor}`, [cleared.id], { deedLevel: level });
}
/** A newly learned arcane form (HWFWM: absorbing an essence is the start of power), priced by the
 * form's own grade so a basic form learned late is worth what it is. */
export function recordLearningExperience(w: World, p: Person, learned: WorldEvent): void {
  const l = experienceLedger(p); if (!l) return;
  const form = abilityLevel(learned.data.abilityId);
  creditExperience(w, p, { kind: 'learning', xp: LEARNING_SHARE * xpToNext(Math.min(earnedLevel(p), form)), eventId: learned.id });
  achieve(w, p, 'awakened', [learned.id], { deedLevel: form });
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
  achieve(w, p, `breakthrough:${stage}`, [], { onEvent: event });
}

/** The person's own recent level-ups, achievements and breakthroughs, newest last, phrased as the
 * Dungeon Crawler Carl "System" would announce them. Only events this person was the actor of. */
export function recentAnnouncements(w: World, p: Person, limit = 6): { id: string; kind: 'level' | 'achievement' | 'breakthrough'; text: string }[] {
  const out: { id: string; kind: 'level' | 'achievement' | 'breakthrough'; text: string }[] = [];
  for (let i = w.events.length - 1, n = 0; i >= 0 && n < 600 && out.length < limit; i--, n++) {
    const e = w.events[i]; if (e.actor !== p.id) continue;
    if (e.type === 'level_attained') out.push({ id: e.id, kind: 'level', text: e.data.peak ? peakText(e.data.stage)
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
    stage: p.ontology.stage, leveled: !!s, label: s?.label ?? p.ontology.stage, level: s?.level ?? null, sub: s?.sub ?? null, peakText: peakText(p.ontology.stage),
    xpIntoLevel: Math.floor(s?.xpIntoLevel ?? 0), xpForLevel: s?.xpForLevel ?? 0, rankXp: Math.floor(s?.rankXp ?? 0), peakXp: s?.peakXp ?? 0, peak: !!s?.peak,
    lifetimeXp: Math.floor(p.experience?.lifetimeXp ?? 0), overflowXp: Math.floor(p.experience?.overflowXp ?? 0),
    // Aggregate counts only: the levels of individual defeated people are not projected.
    defeats: p.experience?.tally.defeats ?? 0, bandVictories: Object.fromEntries(LEVELED_RANKS.slice(1).map(r => [r, featsAtLeast(w, p, floorLevel(r)).length])),
    achievements: Object.entries(p.experience?.achievements ?? {}).sort((a, b) => a[1].tick - b[1].tick || a[0].localeCompare(b[0]))
      .map(([id, a]) => ({ id, title: achievementInfo(id)?.title ?? id, xp: a.xp })),
    vessel: p.vessel ? { stage: p.vessel.stage, resilience: p.vessel.resilience, force: p.vessel.force, ceiling: p.vessel.ceiling } : null,
  };
}
export type ExperienceSummary = ReturnType<typeof experienceSummary>;
