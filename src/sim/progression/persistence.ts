import type { World } from '../core/world';
import { ATTRIBUTE_IDS, NORMAL_CEILING } from '../core/human';
import { EMBODIED_TRIALS, isLeveledRank, LEVELED_RANKS, MAX_LEVEL, peakXp, rankIndex, VESSELS } from './levels';
import { achievementInfo, FEAT_EVENTS, MAX_ACHIEVEMENTS, MAX_DEFEATED, MAX_FEATS, MAX_RECEIPTS, MAX_TALLY } from './experience';

const finite = (n: unknown, low = 0): n is number => typeof n === 'number' && Number.isFinite(n) && n >= low;
const record = (o: unknown): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o);
const KINDS = ['defeat', 'practice', 'foundation', 'tower', 'learning', 'achievement'];
const ADAPTATIONS = ['embodied capability', 'source-integrated arcane capacity'];
/** A vessel names the advancement that made it. Source receipts are checked by arcana/persistence;
 * an embodied trial beyond Iron must carry its own: the rank below, peak, and its distinct feats. */
function validAdvancementReceipt(w: World, e: NonNullable<ReturnType<World['event']>>): boolean {
  if (!ADAPTATIONS.includes(e.data.adaptation)) return false;
  if (e.data.adaptation !== 'embodied capability' || e.data.to === 'Iron') return true;
  const trial = EMBODIED_TRIALS[e.data.to as keyof typeof EMBODIED_TRIALS], feats = e.data.feats;
  return !!trial && e.data.from === LEVELED_RANKS[LEVELED_RANKS.indexOf(e.data.to) - 1] && e.data.peak === true
    && Array.isArray(feats) && feats.length >= trial.feats && new Set(feats).size === feats.length
    && feats.every((id: string) => e.causes.includes(id) && FEAT_EVENTS.includes(w.event(id)?.type ?? ''));
}

/** Fail closed on malformed experience or vessels. Schema-31 and older people have neither and
 * load unchanged; their next breakthrough or credited deed opens them. Recent receipts are an
 * informational window and are not pinned; feats, achievements and vessels name real events. */
export function validProgressionWorld(w: World, saveVersion: number): boolean {
  for (const p of w.persons()) {
    const l = p.experience;
    if (l) {
      if (saveVersion < 32 || !record(l) || l.version !== 1 || !isLeveledRank(l.stage)
        || isLeveledRank(p.ontology.stage) && rankIndex(l.stage) > rankIndex(p.ontology.stage)) return false;
      if (!finite(l.rankXp) || l.rankXp > peakXp(l.stage) + 1e-6 || !finite(l.lifetimeXp) || l.lifetimeXp + 1e-6 < l.rankXp || !finite(l.overflowXp)
        || (l.trackEventId !== undefined && typeof l.trackEventId !== 'string')) return false;
      if (!record(l.foundations) || Object.entries(l.foundations).some(([id, v]) => !ATTRIBUTE_IDS.includes(id as never) || !Number.isInteger(v) || v < 0 || v > 1000)) return false;
      if (!Array.isArray(l.defeated) || l.defeated.length > MAX_DEFEATED || new Set(l.defeated).size !== l.defeated.length || l.defeated.some(id => typeof id !== 'string')) return false;
      if (!Array.isArray(l.feats) || l.feats.length > MAX_FEATS || l.feats.some(f => {
        const e = w.event(f?.eventId);
        // A surrender is a feat too: the yielding person is the event's actor.
        const victim = !e || !FEAT_EVENTS.includes(e.type) ? undefined : e.type === 'attack' ? e.target : e.actor;
        return !e || victim !== f.victimId || !l.defeated.includes(f.victimId) || !Number.isInteger(f.level) || f.level < 1 || f.level > MAX_LEVEL || !finite(f.tick);
      }) || new Set(l.feats.map(f => f.eventId)).size !== l.feats.length || new Set(l.feats.map(f => f.victimId)).size !== l.feats.length) return false;
      if (!record(l.achievements) || Object.keys(l.achievements).length > MAX_ACHIEVEMENTS) return false;
      for (const [id, a] of Object.entries(l.achievements)) {
        const e = record(a) ? w.event(a.eventId) : undefined;
        const recognised = e?.actor === p.id && (e.type === 'achievement_earned' && e.data.achievement === id
          || e.type === 'ontological_advancement' && id === `breakthrough:${e.data.to}`);
        if (!achievementInfo(id) || !recognised || !finite(a.xp) || !finite(a.tick)) return false;
      }
      if (!Array.isArray(l.receipts) || l.receipts.length > MAX_RECEIPTS
        || l.receipts.some(r => !record(r) || !KINDS.includes(r.kind) || !finite(r.xp) || !finite(r.tick))) return false;
      if (!record(l.tally) || ![l.tally.defeats, l.tally.practiceSeconds, l.tally.levelUps].every(n => finite(n))) return false;
    }
    const v = p.vessel;
    if (v) {
      const rule = record(v) && isLeveledRank(v.stage) ? VESSELS[v.stage] : undefined, e = record(v) ? w.event(v.eventId) : undefined;
      if (saveVersion < 32 || !rule || v.version !== 1 || v.stage !== p.ontology.stage || p.ontology.breakthroughEventId !== v.eventId
        || v.resilience !== rule.resilience || v.force !== rule.force || v.ceiling !== rule.ceiling
        || e?.type !== 'ontological_advancement' || e.actor !== p.id || e.data.to !== v.stage
        || e.data.vessel?.resilience !== rule.resilience || e.data.vessel?.force !== rule.force || e.data.vessel?.ceiling !== rule.ceiling) return false;
      if (!record(v.base) || Object.entries(v.base).some(([id, hp]) => w.body(id)?.ownerId !== p.id || !finite(hp, 1e-6))) return false;
      if (!validAdvancementReceipt(w, e)) return false;
    }
    // From schema 32 every foundation is bounded by the person's ceiling (20 without a vessel).
    const ceiling = v?.ceiling ?? NORMAL_CEILING;
    if (saveVersion >= 32 && ATTRIBUTE_IDS.some(id => p.attributes[id] > ceiling)) return false;
  }
  for (const b of w.bodies()) {
    const t = b.encounter; if (!t) continue;
    // Lapsed entries are pruned when the body is next struck, so old timestamps are legitimate.
    const time = (at: unknown) => finite(at) && (at as number) <= w.physicalTime + 1e-6;
    if (saveVersion < 32 || !record(t) || t.version !== 1 || !record(t.dealt) || !record(t.struck) || !Number.isInteger(t.presented) || t.presented < 0 || t.presented > MAX_LEVEL
      || Object.keys(t.dealt).length > MAX_TALLY || Object.keys(t.struck).length > MAX_TALLY
      || Object.values(t.dealt).some(d => !record(d) || !finite(d.damage) || !finite(d.arcane) || d.arcane > d.damage + 1e-6 || !time(d.at))
      || Object.values(t.struck).some(at => !time(at))) return false;
  }
  return true;
}
