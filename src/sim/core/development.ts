import type { AttributeId, Attributes, Person, SkillId } from './types';
import type { World } from './world';
import { ATTRIBUTE_IDS, clamp, NORMAL_CEILING, individualRng } from './human';

export interface DevelopmentStimulus {
  weights: Partial<Attributes>;
  /** Actual credited activity, or documented standard-work-equivalent seconds at batch hooks. */
  seconds: number;
  intensity: number;
  instruction?: number;
  causeEventId?: string;
}
const HOUR = 3600, DAY = 86400;
export const DEVELOPMENT_HOURS = 500;
export const MAX_DAILY_EXPOSURE = 8 * HOUR;

/** One curve for all seven foundations. Potential is resistance, never a cap. */
export function developmentRate(current: number, potential: number): number {
  if (current >= NORMAL_CEILING) return 0;
  return Math.exp(clamp((potential - current - 2) * 0.35, -12, 1))
    / (DEVELOPMENT_HOURS * HOUR * Math.pow(Math.max(1, current) / 8, 2));
}

/** A canonical activity hook, not an autonomous progression controller. Bounded per-person cost.
 * The per-day physiological exposure budget prevents concurrent bodies/work hooks multiplying time.
 * Neither job labels, injuries, birthdays nor stored stress call this function. */
export function develop(world: World, p: Person, s: DevelopmentStimulus): void {
  if (!p.alive || p.ontology.stage !== 'Normal' || !Number.isFinite(s.seconds) || s.seconds <= 0 || !Number.isFinite(s.intensity) || s.intensity <= 0) return;
  if (!ATTRIBUTE_IDS.some(id => Number.isFinite(s.weights[id]) && s.weights[id]! > 0)) return;
  const bodies = p.bodies.map(id => world.body(id)).filter(b => b && !b.dead && b.present);
  if (!bodies.length) return;
  const health = Math.max(...bodies.map(b => b!.health / b!.maxHealth));
  const physiology = clamp(Math.min(p.physiology.energy, p.physiology.hydration) * 2, 0, 1)
    * clamp(1 - p.physiology.fatigue * 0.5 - p.physiology.sleepDebt / 48, 0, 1) * clamp(health, 0, 1);
  if (physiology <= 0) return;
  const d = p.development, day = Math.floor(world.now / DAY);
  if (day !== d.day) { d.day = day; d.dailyExposure = 0; }
  const seconds = Math.min(s.seconds, MAX_DAILY_EXPOSURE - d.dailyExposure);
  if (seconds <= 0) return;
  d.dailyExposure += seconds;
  const intensity = clamp(s.intensity, 0, 1), instruction = clamp(s.instruction ?? 1, 0.5, 1.6);
  for (const id of ATTRIBUTE_IDS) {
    const weight = clamp(s.weights[id] ?? 0, 0, 1);
    if (!weight || !Number.isFinite(weight)) continue;
    // Vitality is healthy conditioning, never pain/injury adaptation or a damage award.
    if (id === 'vitality' && (health < 0.9 || p.physiology.fatigue > 0.6 || p.physiology.sleepDebt > 4 || Math.min(p.physiology.energy, p.physiology.hydration) < 0.5)) continue;
    const exposure = seconds * intensity * weight;
    d.exposure[id] += exposure;
    let remaining = exposure * physiology * instruction;
    // Integrate exactly at integer boundaries; a large dose cannot leap over diminishing returns.
    while (remaining > 0 && p.attributes[id] < NORMAL_CEILING) {
      const rate = developmentRate(p.attributes[id], p.attributePotential[id]);
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
const PRACTICE: Partial<Record<SkillId, Partial<Attributes>>> = {
  hauling: { strength: 1, endurance: 0.8, vitality: 0.1, will: 0.15 },
  quarrying: { strength: 1, endurance: 0.8, dexterity: 0.2, vitality: 0.1, will: 0.15 },
  woodcutting: { strength: 0.8, endurance: 0.7, dexterity: 0.4, vitality: 0.1, will: 0.15 },
  construction: { strength: 0.6, endurance: 0.5, dexterity: 0.6, vitality: 0.1, will: 0.2 },
  sawing: { strength: 0.5, endurance: 0.5, dexterity: 0.5, vitality: 0.1 },
  crafting: { dexterity: 1, endurance: 0.2 },
  hunting: { perception: 0.8, dexterity: 0.5, endurance: 0.6, will: 0.2 },
  herbalism: { perception: 0.7, dexterity: 0.3 },
  milling: { strength: 0.5, endurance: 0.4, dexterity: 0.2 },
  baking: { dexterity: 0.4, endurance: 0.3 }, cooking: { dexterity: 0.5 },
};
export function developThroughPractice(world: World, p: Person, id: SkillId, amount: number, instruction = 1): void {
  const weights = PRACTICE[id]; if (!weights) return;
  develop(world, p, { weights, seconds: amount * 60, intensity: 0.7, instruction });
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
