import type { World } from '../core/world';
import { ATTRIBUTE_IDS, NORMAL_CEILING } from '../core/human';
import { isLeveledRank, MAX_LEVEL, peakXp, rankIndex, VESSELS } from './levels';
import { achievementInfo, MAX_ACHIEVEMENTS, MAX_DEFEATED, MAX_FEATS, MAX_RECEIPTS } from './experience';

const finite = (n: unknown, low = 0): n is number => typeof n === 'number' && Number.isFinite(n) && n >= low;
const record = (o: unknown): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o);
const KINDS = ['defeat', 'practice', 'foundation', 'tower', 'learning', 'achievement'];

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
        return !e || e.type !== 'attack' || e.target !== f.victimId || !Number.isInteger(f.level) || f.level < 1 || f.level > MAX_LEVEL || !finite(f.tick);
      })) return false;
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
    }
    const ceiling = v?.ceiling ?? NORMAL_CEILING;
    if (v && ATTRIBUTE_IDS.some(id => p.attributes[id] > ceiling)) return false;
  }
  return true;
}
