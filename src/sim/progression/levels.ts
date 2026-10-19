/** Deterministic, browser-safe level arithmetic. No World, clock, storage or random source.
 *
 * Torn Veil levels measure accumulated growth *within* a rank; the rank itself remains a
 * canonical breakthrough recorded by an ontological_advancement event (Constitution §13-15).
 * Each leveled rank has ten levels, shown HWFWM-style as "Bronze 4", and the whole ladder
 * is one global level 1..60 (DotF-style "level 25"). XP per level is exponential, so a rank
 * costs ~6x the one below it, and defeat XP is a share of the *victim's* level cost, so a
 * fixed number of same-level victories advances a level at any rank while weaker opponents
 * fade to nothing. Nothing here grants power: levels never enter combat resolution.
 * See docs/LEVELING_AND_RANKS.md for the calibration and its measured limits.
 */
export const LEVELED_RANKS = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'] as const;
export type LeveledRank = typeof LEVELED_RANKS[number];
export const LEVELS_PER_RANK = 10;
export const MAX_LEVEL = LEVELED_RANKS.length * LEVELS_PER_RANK;
export const XP_BASE = 100;
export const XP_GROWTH = 1.2;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export function isLeveledRank(stage: string): stage is LeveledRank { return (LEVELED_RANKS as readonly string[]).includes(stage); }
export function rankIndex(stage: string): number { return (LEVELED_RANKS as readonly string[]).indexOf(stage); }
export function nextRank(stage: LeveledRank): LeveledRank | null { return LEVELED_RANKS[rankIndex(stage) + 1] ?? null; }
/** Global level of "<rank> 0". */
export function floorLevel(rank: LeveledRank): number { return rankIndex(rank) * LEVELS_PER_RANK + 1; }
export function rankOfLevel(level: number): LeveledRank { return LEVELED_RANKS[clamp(Math.floor((level - 1) / LEVELS_PER_RANK), 0, LEVELED_RANKS.length - 1)]; }

/** Experience needed to complete global level `level` (1..60). */
export function xpToNext(level: number): number {
  return Math.round(XP_BASE * Math.pow(XP_GROWTH, clamp(Math.floor(level), 1, MAX_LEVEL) - 1));
}
/** Experience a rank's track holds when full: its ten levels, the last one completed ("peak"). */
export function peakXp(rank: LeveledRank): number {
  let total = 0; for (let s = 0; s < LEVELS_PER_RANK; s++) total += xpToNext(floorLevel(rank) + s);
  return total;
}

export interface LevelStanding {
  rank: LeveledRank; sub: number; level: number; label: string;
  /** Progress through the current level, and that level's full cost. */
  xpIntoLevel: number; xpForLevel: number;
  rankXp: number; peakXp: number;
  /** Track full: no further level until a breakthrough opens the next rank. */
  peak: boolean;
}
export function standing(rank: LeveledRank, rankXp: number): LevelStanding {
  const floor = floorLevel(rank), top = peakXp(rank);
  let remaining = clamp(Number.isFinite(rankXp) ? rankXp : 0, 0, top), sub = 0;
  while (sub < LEVELS_PER_RANK - 1 && remaining >= xpToNext(floor + sub)) { remaining -= xpToNext(floor + sub); sub++; }
  const need = xpToNext(floor + sub), peak = rankXp >= top;
  return { rank, sub, level: floor + sub, label: `${rank} ${sub}`, xpIntoLevel: Math.min(remaining, need), xpForLevel: need,
    rankXp: Math.min(rankXp, top), peakXp: top, peak };
}

/** Share of the victim's own level cost paid for one credited defeat: ~10 same-level
 * victories per level, at every rank. */
export const DEFEAT_SHARE = 0.1;
/** Level gap at and beyond which a weaker opponent teaches nothing ("grey"). */
export const GREY_GAP = 12;
export const MAX_GAP_BONUS = 2.5;
/** DotF-style level difference: overcoming a stronger opponent pays more (bounded); a weaker
 * one pays less on top of its already smaller level cost, and nothing once far below. */
export function gapFactor(victimLevel: number, victorLevel: number): number {
  const gap = victimLevel - victorLevel;
  return gap >= 0 ? Math.min(MAX_GAP_BONUS, 1 + 0.15 * gap) : Math.max(0, 1 + gap / GREY_GAP);
}
export function defeatXp(victimLevel: number, victorLevel: number): number {
  return DEFEAT_SHARE * xpToNext(victimLevel) * gapFactor(victimLevel, victorLevel);
}

/** Credited practice (capability-ledger effective hours) is worth a fixed amount at every
 * level. It carries a mortal through Normal and fades as the curve steepens: training alone
 * cannot make a Gold (HWFWM). */
export const PRACTICE_XP_PER_HOUR = 300;
/** Newly developed integer foundation value. Higher foundations are worth geometrically more. */
export function foundationXp(value: number): number { return Math.round(25 * Math.pow(XP_GROWTH, value - 8)); }

/** Threat scale: combat power relative to the ordinary unarmed adult reference (power 1 =
 * level 1). Calibrated so the implemented source ladder with its rank vessels places each
 * rank's capability near its own band (see the report). It summarizes, never resolves. */
export const POWER_PER_LEVEL = 1.135;
export function levelForPower(power: number): number {
  if (!(power > 0) || !Number.isFinite(power)) return 1;
  return clamp(Math.round(1 + Math.log(power) / Math.log(POWER_PER_LEVEL)), 1, MAX_LEVEL);
}
export function powerForLevel(level: number): number { return Math.pow(POWER_PER_LEVEL, clamp(level, 1, MAX_LEVEL) - 1); }
export function gradeLabel(level: number): string { return `${rankOfLevel(level)}-grade`; }

/** The body a breakthrough remakes (HWFWM rank-ups). Resilience multiplies each body's
 * pre-vessel maximum health; force multiplies the body's own strikes (the shared
 * embodiedStrikeMultiplier); the ceiling bounds every foundation. Applied once, by the
 * advancement event itself, and stored as a component: the label never supplies it. */
export const VESSELS: Readonly<Record<LeveledRank, { resilience: number; force: number; ceiling: number }>> = Object.freeze({
  Normal: { resilience: 1, force: 1, ceiling: 20 }, Iron: { resilience: 1.6, force: 1.5, ceiling: 26 },
  Bronze: { resilience: 2.5, force: 2.5, ceiling: 34 }, Silver: { resilience: 4, force: 4, ceiling: 44 },
  Gold: { resilience: 6.3, force: 6.3, ceiling: 56 }, Diamond: { resilience: 10, force: 10, ceiling: 70 },
});
/** Foundation level an opposed victory over an opponent of this level demands. Normal-band
 * opponents stay within the existing ordinary/boar/sparring demands; only stronger opponents
 * can develop a ranked body toward its ceiling. */
export function foundationDemand(level: number): number { return 10 + 0.9 * clamp(level, 1, MAX_LEVEL); }

/** Embodied breakthroughs beyond Iron (Iron itself remains core/advancement.ts). Each needs the
 * current rank's peak level, path foundations within the current vessel's ceiling, distinct
 * opposed victories over opponents at or above the current rank's band, and sustained practice. */
export const EMBODIED_TRIALS: Readonly<Record<'Bronze' | 'Silver' | 'Gold' | 'Diamond', {
  core: number; support: number; feats: number; featLevel: number; practiceHours: number; skill: number }>> = Object.freeze({
  Bronze: { core: 24, support: 18, feats: 8, featLevel: 11, practiceHours: 8, skill: 0.6 },
  Silver: { core: 32, support: 25, feats: 12, featLevel: 21, practiceHours: 24, skill: 0.68 },
  Gold: { core: 42, support: 33, feats: 16, featLevel: 31, practiceHours: 72, skill: 0.76 },
  Diamond: { core: 54, support: 43, feats: 24, featLevel: 41, practiceHours: 200, skill: 0.84 },
});
/** Source-path Diamond: the arcane transformation row adds this experience gate. */
export const SOURCE_DIAMOND = Object.freeze({ feats: 24, featLevel: 41 });
