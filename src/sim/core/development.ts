import type { AttributeId, Attributes, Person, SkillId } from './types';
import type { World } from './world';
import { ATTRIBUTE_IDS, clamp, NORMAL_CEILING, individualRng } from './human';
import type { PracticedSkillId } from './martialTypes';

export interface DevelopmentStimulus {
  weights: Partial<Attributes>;
  /** Actual credited activity, or documented standard-work-equivalent seconds at batch hooks. */
  seconds: number;
  intensity: number;
  instruction?: number;
  causeEventId?: string;
  /** The foundation level this activity actually demands. A body adapts to what challenges it:
   * once a foundation meets the demand, the same activity stops developing it (see challengeFactor).
   * Omitted means an unbounded demand (legacy hooks, explicit fixtures). */
  challenge?: number;
}
const HOUR = 3600, DAY = 86400;
/**
 * Effective hours for one point at the ordinary reference (8 with potential 10). Calibrated for
 * Living Alpha (was 500, which measured as ~30,000 effective hours from 8 to 15 — unreachable).
 * What keeps exceptional foundations rare is now the challenge ceiling of ordinary activity, not
 * a timescale no life could reach. See docs/LIVING_ALPHA_PROGRESSION.md for the calibration.
 */
export const DEVELOPMENT_HOURS = 0.6;
/** Adaptation each foundation can absorb per world day. Recovery bounds each system separately:
 * a day of hauling does not use up the attention that tracking game develops. */
export const MAX_DAILY_EXPOSURE = 8 * HOUR;

/** One curve for all seven foundations. Potential is resistance, never a cap. */
export function developmentRate(current: number, potential: number): number {
  if (current >= NORMAL_CEILING) return 0;
  return Math.exp(clamp((potential - current - 2) * 0.35, -12, 1))
    / (DEVELOPMENT_HOURS * HOUR * Math.pow(Math.max(1, current) / 8, 2));
}
/** How much an activity demanding `challenge` still develops a foundation at `current`:
 * 0.88 one point below the demand, 0.12 at it, 0.0025 one point beyond. Never exactly zero. */
export function challengeFactor(current: number, challenge = Infinity): number {
  if (!Number.isFinite(challenge)) return 1;
  return 1 / (1 + Math.exp((current + 0.5 - challenge) * 4));
}

/** A canonical activity hook, not an autonomous progression controller. Bounded per-person cost.
 * The per-day physiological exposure budget prevents concurrent bodies/work hooks multiplying time.
 * Neither job labels, injuries, birthdays nor stored stress call this function. */
export function develop(world: World, p: Person, s: DevelopmentStimulus): void {
  if (!p.alive || !['Normal', 'Iron'].includes(p.ontology.stage) || !Number.isFinite(s.seconds) || s.seconds <= 0 || !Number.isFinite(s.intensity) || s.intensity <= 0) return;
  if (!ATTRIBUTE_IDS.some(id => Number.isFinite(s.weights[id]) && s.weights[id]! > 0)) return;
  const bodies = p.bodies.map(id => world.body(id)).filter(b => b && !b.dead && b.present);
  if (!bodies.length) return;
  const health = Math.max(...bodies.map(b => b!.health / b!.maxHealth));
  const physiology = clamp(Math.min(p.physiology.energy, p.physiology.hydration) * 2, 0, 1)
    * clamp(1 - p.physiology.fatigue * 0.5 - p.physiology.sleepDebt / 48, 0, 1) * clamp(health, 0, 1);
  if (physiology <= 0) return;
  const d = p.development, day = Math.floor(world.now / DAY);
  if (day !== d.day) { d.day = day; d.dailyExposure = 0; d.dailyByFoundation = {}; }
  const daily = d.dailyByFoundation ??= {};
  const intensity = clamp(s.intensity, 0, 1), instruction = clamp(s.instruction ?? 1, 0.5, 1.6);
  for (const id of ATTRIBUTE_IDS) {
    const weight = clamp(s.weights[id] ?? 0, 0, 1);
    if (!weight || !Number.isFinite(weight)) continue;
    // Vitality is healthy conditioning, never pain/injury adaptation or a damage award.
    if (id === 'vitality' && (health < 0.9 || p.physiology.fatigue > 0.6 || p.physiology.sleepDebt > 4 || Math.min(p.physiology.energy, p.physiology.hydration) < 0.5)) continue;
    const seconds = Math.min(s.seconds, MAX_DAILY_EXPOSURE - (daily[id] ?? 0));
    if (seconds <= 0) continue;
    daily[id] = (daily[id] ?? 0) + seconds;
    d.dailyExposure = Math.max(d.dailyExposure, daily[id]!);
    const exposure = seconds * intensity * weight;
    d.exposure[id] += exposure;
    let remaining = exposure * physiology * instruction;
    // Integrate exactly at integer boundaries; a large dose cannot leap over diminishing returns.
    while (remaining > 0 && p.attributes[id] < NORMAL_CEILING) {
      const rate = developmentRate(p.attributes[id], p.attributePotential[id]) * challengeFactor(p.attributes[id], s.challenge);
      const needed = (1 - d.progress[id]) / rate;
      if (remaining < needed) { d.progress[id] += remaining * rate; break; }
      remaining -= needed; d.progress[id] = 0; p.attributes[id]++;
      if (p.attributes[id] === 15) world.emit('attribute_developed', { actor: p.id, category: 'history', significance: 0.65,
        causes: s.causeEventId ? [s.causeEventId] : [], data: { attribute: id, value: 15, exposureSeconds: d.exposure[id] }, summary: `${p.name} developed an exceptional ${id} foundation` });
    }
    if (p.attributes[id] >= NORMAL_CEILING) { p.attributes[id] = NORMAL_CEILING; d.progress[id] = 0; }
    considerImprint(world, p, id, exposure * physiology, s.causeEventId);
  }
}

function considerImprint(world: World, p: Person, id: AttributeId, seconds: number, cause?: string): void {
  if (seconds <= 0 || p.attributes[id] < Math.max(15, p.attributePotential[id] + 3)) return;
  const day = Math.floor(world.now / DAY);
  let e = p.development.exceptional[id];
  if (!e) {
    const ev = world.emit('attribute_developed', { actor: p.id, category: 'history', significance: 0.65, causes: cause ? [cause] : [],
      data: { attribute: id, value: p.attributes[id], potential: p.attributePotential[id], exposureSeconds: p.development.exposure[id], adaptation: 'sustained observation begins' },
      summary: `${p.name}'s practiced ${id} substantially exceeded natural potential` });
    e = p.development.exceptional[id] = { firstAt: world.now, lastAt: world.now, seconds: 0, days: 0, lastDay: -1, qualificationEventId: ev.id };
  }
  e.lastAt = world.now; e.seconds += seconds;
  if (day !== e.lastDay) { e.days++; e.lastDay = day; }
  if (e.assessed || e.seconds < 8000 * HOUR || e.days < 1500 || e.lastAt - e.firstAt < 10 * 365 * DAY) return;
  // One assessment per attribute per life. Failure is not re-rolled every work action/year.
  e.assessed = true;
  if (individualRng(world.seed, `${p.id}:${id}:imprint`).next() >= 0.08) return;
  const ev = world.emit('lineage_imprint', { actor: p.id, category: 'history', significance: 0.95,
    causes: [...new Set([e.qualificationEventId, ...(cause ? [cause] : [])])],
    data: { attribute: id, magnitude: 2, potential: p.attributePotential[id], developed: p.attributes[id], exposureSeconds: e.seconds, activeDays: e.days, since: e.firstAt },
    summary: `${p.name}'s sustained exceptional adaptation formed a ${id} lineage imprint` });
  p.lineage.imprints.push({ id: ev.id, originPersonId: p.id, attribute: id, magnitude: 2, originatingEventId: ev.id,
    transmissibility: 0.85, generationDistance: 0, transmissionEventId: ev.id });
  // A founder can have at most one new imprint per attribute; inheritance keeps at most seven.
}

/** Mapping describes physical practice, not occupations. A credited batch is a standardized
 * minute of exposure; construction supplies measured credited minutes. No INT for routine work.
 * PER requires actual discrimination (hunting/herbalism), WILL prolonged completed work. */
const PRACTICE: Partial<Record<PracticedSkillId, Partial<Attributes>>> = {
  unarmed: { strength: 0.4, dexterity: 0.8, endurance: 0.7, vitality: 0.1, will: 0.2 },
  'one-handed-blade': { strength: 0.4, dexterity: 0.8, endurance: 0.6, vitality: 0.1, will: 0.2 },
  polearm: { strength: 0.6, dexterity: 0.7, endurance: 0.7, vitality: 0.1, will: 0.2 },
  hauling: { strength: 1, endurance: 0.8, vitality: 0.1, will: 0.15 },
  quarrying: { strength: 1, endurance: 0.8, dexterity: 0.2, vitality: 0.1, will: 0.15 },
  woodcutting: { strength: 0.8, endurance: 0.7, dexterity: 0.4, vitality: 0.1, will: 0.15 },
  construction: { strength: 0.6, endurance: 0.5, dexterity: 0.6, vitality: 0.1, will: 0.2 },
  sawing: { strength: 0.5, endurance: 0.5, dexterity: 0.5, vitality: 0.1 },
  // Fitting and making demand looking closely and understanding how parts go together.
  crafting: { dexterity: 1, perception: 0.5, intellect: 0.3, endurance: 0.2 },
  hunting: { perception: 0.8, dexterity: 0.5, endurance: 0.6, will: 0.2 },
  herbalism: { perception: 0.7, dexterity: 0.3 },
  milling: { strength: 0.5, endurance: 0.4, dexterity: 0.2 },
  baking: { dexterity: 0.4, endurance: 0.3 }, cooking: { dexterity: 0.5 },
  // Holding one's own calm against another's alarm: will first, then attention to the subject.
  veilcraft: { will: 0.9, perception: 0.5, intellect: 0.3 },
};
/** The foundation level each practice ordinarily demands. Routine trades plateau near 11;
 * dangerous or disciplined practice demands more. Callers may state a real, higher demand. */
const PRACTICE_CHALLENGE: Partial<Record<PracticedSkillId, number>> = {
  hauling: 11, quarrying: 11.5, woodcutting: 11, construction: 11, sawing: 11, milling: 10.5, baking: 10.5, cooking: 10,
  crafting: 12, herbalism: 12, hunting: 13, unarmed: 12, 'one-handed-blade': 12, polearm: 12, veilcraft: 14,
};
export function practiceProfile(id: PracticedSkillId): Partial<Attributes> | undefined { return PRACTICE[id]; }
/** The foundations an Iron path through this practice demands most: every foundation it weights at
 * 0.5 or more, and never fewer than its two strongest. A skill without a profile demands them all. */
export function ironFoundationsFor(id: PracticedSkillId): AttributeId[] {
  const weights = PRACTICE[id]; if (!weights) return [...ATTRIBUTE_IDS];
  const ranked = (Object.entries(weights) as [AttributeId, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const strong = ranked.filter(([, w]) => w >= 0.5).map(([id]) => id);
  return strong.length >= 2 ? strong : ranked.slice(0, 2).map(([id]) => id);
}
export function developThroughPractice(world: World, p: Person, id: PracticedSkillId, amount: number, instruction = 1, challenge?: number): void {
  const weights = PRACTICE[id]; if (!weights) return;
  develop(world, p, { weights, seconds: amount * 60, intensity: 0.7, instruction, challenge: challenge ?? PRACTICE_CHALLENGE[id] ?? 11 });
}

/**
 * Conditioning from sustained physical load, from the same per-minute activity classification that
 * charges energy, water and fatigue (core/physiology.ts). The body adapts to what it actually does
 * for as long as it does it, and only up to what that work demands: carrying loads makes an
 * ordinary person stronger, but not exceptionally so. Seconds are world seconds. Routine load is
 * a slow stimulus (weeks of labour per point); faster growth needs deliberate, demanding practice.
 */
const EXERTION: Record<string, { weights: Partial<Attributes>; intensity: number; challenge: number }> = {
  walk: { weights: { endurance: 0.5, vitality: 0.3 }, intensity: 0.025, challenge: 9.5 },
  haul: { weights: { strength: 0.8, endurance: 0.6, vitality: 0.2 }, intensity: 0.04, challenge: 11 },
  chop: { weights: { strength: 0.7, endurance: 0.6, dexterity: 0.3, vitality: 0.2 }, intensity: 0.04, challenge: 11 },
  quarry: { weights: { strength: 0.8, endurance: 0.6, vitality: 0.2 }, intensity: 0.045, challenge: 11.5 },
  construct: { weights: { strength: 0.4, dexterity: 0.5, endurance: 0.4 }, intensity: 0.03, challenge: 10.5 },
  craft: { weights: { dexterity: 0.5, perception: 0.2 }, intensity: 0.025, challenge: 10 },
};
export function developThroughExertion(world: World, p: Person, activity: string, worldHours: number): void {
  const e = EXERTION[activity]; if (!e || !(worldHours > 0)) return;
  develop(world, p, { weights: e.weights, seconds: worldHours * HOUR, intensity: e.intensity, challenge: e.challenge });
}

/** Only nontrivial newly acquired understanding/experiments can credit conceptual development.
 * Callers first check new knowledge/evidence. Recent familiarity also survives ordinary forgetting.
 * Bounded retention avoids both an infinite biography and a lifetime ceiling on learning. */
export function developThroughUnderstanding(world: World, p: Person, key: string, complexity: number, seconds: number, cause?: string): void {
  const fingerprint = individualRng(0, key).state().toString(16);
  if (complexity < 2 || p.development.studied.includes(fingerprint)) return;
  p.development.studied.push(fingerprint);
  if (p.development.studied.length > 128) p.development.studied.shift();
  develop(world, p, { weights: { intellect: 1, will: 0.3 }, seconds, intensity: clamp(complexity / 6, 0.2, 1), causeEventId: cause });
}
