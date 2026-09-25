import type { Body, Creature, Person } from '../core/types';
import type { World } from '../core/world';
import { syncNeeds } from '../core/physiology';
import { instructionFactor, practiceSkill, techniqueKey, skillOf } from '../core/skills';
import { develop, practiceProfile } from '../core/development';
import { recordCapabilityPractice } from '../core/capability';
import { isExternallyControlled } from '../runtime/controllers';

/**
 * The veil hush — this world's one implemented supernatural art (Living Alpha v0.1).
 *
 * What it does: a person who has been taught the technique reaches through the veil and stills
 * another creature's or person's alarm. A defending animal breaks off and keeps away from that
 * place for a while; a person's non-lethal hostility (confronting, attacking to injure) lapses.
 *
 * Canonical costs and limits (the same for anyone, player or not):
 *  - requires `technique:veilcraft` knowledge — taught, with provenance — and a conscious,
 *    unrestrained body; range 10 m with a clear line of sight;
 *  - every attempt costs fatigue, energy and hydration and builds veil strain, which recovers
 *    slowly (faster asleep); strain beyond capacity refuses the attempt ("too strained");
 *  - success is not certain: skill and will against the target's arousal. A creature mid-strike,
 *    or a person intent on killing, cannot be hushed;
 *  - it is visible: onlookers see the gesture and its effect, and the target knows something was
 *    done to them, so it has social consequences through ordinary perception.
 * Practice (a real attempt, recorded as the `veil_hush` event) is the only way the skill grows.
 */
export const VEIL_SKILL = 'veilcraft' as const;
export const HUSH_RANGE_M = 10;
const STRAIN_PER_USE = 0.28;
const STRAIN_RECOVERY_PER_HOUR = 0.35;
const COOLDOWN_S = 6;

export function knowsVeil(p: Person): boolean {
  const k = p.knowledge[techniqueKey(VEIL_SKILL)];
  return !!k && k.kind === 'technique' && (k.confidence ?? 0) >= 0.4;
}
/** Current strain. Recovery runs on lived (world) time like any bodily recovery; faster asleep. */
export function veilStrain(world: World, p: Person): number {
  const v = p.veil; if (!v) return 0;
  const body = world.primaryBody(p.id), asleep = body?.pose === 'sleep';
  const hours = Math.max(0, world.physicalTime - v.strainAt) * (world.clock.timeScale || 1) / 3600;
  return Math.max(0, v.strain - hours * STRAIN_RECOVERY_PER_HOUR * (asleep ? 2 : 1));
}
/** A practiced hand spends less of itself on each attempt. */
function strainPerUse(p: Person): number { return STRAIN_PER_USE * (1 - 0.4 * skillOf(p, VEIL_SKILL)); }

/** World seconds of one sitting of veil meditation (half an hour). */
export const MEDITATION_SECONDS = 1800;
/**
 * Veil meditation: someone who holds the technique sits and practises holding their own quiet.
 * It develops will and attention (and the skill) but only as far as solitary discipline demands
 * (challenge 13); beyond that only real use against real alarm develops them. It eases strain.
 * It is not capability evidence: no one was hushed.
 */
export function meditateOnVeil(world: World, p: Person, worldSeconds = MEDITATION_SECONDS): boolean {
  if (!p.alive || !knowsVeil(p)) return false;
  const body = world.primaryBody(p.id);
  if (!body || body.dead || !body.present || body.pose === 'downed') return false;
  const strain = veilStrain(world, p);
  p.veil = { strain: Math.max(0, strain - 0.2), strainAt: world.physicalTime, lastAt: p.veil?.lastAt ?? -Infinity };
  world.emit('veil_meditation', { actor: p.id, pos: { ...body.pos }, placeId: world.placeAt(body.pos)?.id, category: 'world', significance: 0.05,
    visibility: 6, loudness: 0, data: { seconds: worldSeconds }, summary: `${p.name} sat very still, eyes half closed` });
  // The sitting develops will and attention for its whole length (up to what solitary discipline
  // demands); the art itself is learned from use, so the skill gains only a minute's credit.
  develop(world, p, { weights: practiceProfile(VEIL_SKILL) ?? { will: 1 }, seconds: worldSeconds, intensity: 0.6, instruction: instructionFactor(p, VEIL_SKILL), challenge: 13 });
  practiceSkill(p, VEIL_SKILL, 1, world, 13);
  return true;
}

export type HushResult = 'calmed' | 'resisted' | 'unknown_technique' | 'too_strained' | 'exhausted' | 'cooldown' | 'invalid_target' | 'out_of_reach' | 'incapacitated';

export function attemptHush(world: World, p: Person, targetBodyId: string): HushResult {
  const body = world.primaryBody(p.id), tb = world.body(targetBodyId);
  if (!p.alive || !body || body.dead || !body.present || ['downed', 'sleep'].includes(body.pose) || p.custody?.active || p.surrender) return 'incapacitated';
  if (!knowsVeil(p)) return 'unknown_technique';
  if (!tb || tb.dead || !tb.present || tb.ownerId === p.id) return 'invalid_target';
  const target = world.get(tb.ownerId) as Person | Creature | undefined;
  if (!target || (target.kind !== 'person' && target.kind !== 'creature')) return 'invalid_target';
  const d = Math.hypot(tb.pos.x - body.pos.x, tb.pos.z - body.pos.z);
  if (d > HUSH_RANGE_M || !world.grid.lineOfSight({ ...body.pos, y: body.pos.y + 1.6 }, { ...tb.pos, y: tb.pos.y + 0.8 }, HUSH_RANGE_M + 1)) return 'out_of_reach';
  const now = world.physicalTime;
  if (p.veil && now - p.veil.lastAt < COOLDOWN_S) return 'cooldown';
  const strain = veilStrain(world, p);
  const cost = strainPerUse(p);
  if (strain + cost > 1) return 'too_strained';
  if (p.physiology.fatigue > 0.85 || p.physiology.energy < 0.1) return 'exhausted';
  // Cost is paid whether or not it works.
  p.veil = { strain: strain + cost, strainAt: now, lastAt: now };
  p.physiology.fatigue = Math.min(1, p.physiology.fatigue + 0.08);
  p.physiology.energy = Math.max(0, p.physiology.energy - 0.03);
  p.physiology.hydration = Math.max(0, p.physiology.hydration - 0.02);
  syncNeeds(p);
  // Arousal of the target: how hard its alarm is to still.
  // A calm or merely wary subject is easiest; a displaying, charging or provoked one much harder.
  let arousal = 0.1, immune = false;
  if (target.kind === 'creature') {
    const st = target.wildlife?.embodiments[tb.id];
    const mode = st?.defense?.mode;
    if (mode === 'strike') immune = true;
    arousal += mode === 'charge' ? 0.35 : mode === 'warn' ? 0.15 : 0;
    if (st?.provokedBy && st.provokedBy.until > now) arousal += 0.2;
  } else {
    const goal = target.mind.goal;
    if (goal?.data?.intent === 'kill' || target.mind.plan.some(a => a.data?.intent === 'kill')) immune = true;
    arousal += (goal && ['attack', 'confront', 'rob'].includes(goal.type) ? 0.3 : 0) + target.mind.alarm * 0.15 + target.traits.courage * 0.1;
  }
  const skill = skillOf(p, VEIL_SKILL), will = p.attributes.will ?? 8;
  const chance = immune ? 0 : Math.max(0.05, Math.min(0.95, 0.4 + skill * 0.6 + (will - 8) * 0.03 - arousal));
  const success = world.rng.next() < chance;
  const ev = world.emit('veil_hush', { actor: p.id, target: target.id, pos: { ...body.pos }, placeId: world.placeAt(body.pos)?.id,
    category: 'world', significance: success ? 0.35 : 0.2, visibility: 14, loudness: 2,
    data: { targetBodyId: tb.id, targetKind: target.kind, success, chance: Math.round(chance * 100) / 100, distance: Math.round(d * 10) / 10 },
    summary: success ? `${p.name} made a slow, stilling gesture toward ${world.nameOf(target.id)}, which went quiet` : `${p.name} made a strange gesture toward ${world.nameOf(target.id)}; nothing happened` });
  if (target.kind === 'person' && !ev.perceivedBy.some(x => x.who === target.id)) ev.perceivedBy.push({ who: target.id, how: 'saw', tick: world.now });
  // Practice: an actual attempt, proven by its event. Failure still teaches a little.
  recordCapabilityPractice(world, p, { skill: VEIL_SKILL, sourceEventId: ev.id, outcome: success ? 'success' : 'failure' });
  if (!success) return 'resisted';
  if (target.kind === 'creature') calmCreature(world, target, tb, body);
  else calmPerson(world, target, p);
  return 'calmed';
}

function calmCreature(world: World, animal: Creature, tb: Body, from: Body): void {
  const st = animal.wildlife?.embodiments[tb.id]; if (!st) return;
  const spec = world.ecology?.species[animal.species];
  st.provokedBy = undefined;
  st.defense = { mode: 'retreat', targetBodyId: from.id, since: world.physicalTime };
  // Keep away from where it was calmed for about three world days (world time runs faster than physical).
  const scale = world.geography?.spec.timeScale ?? 1;
  st.avoid = { pos: { ...tb.pos }, radiusM: 60, until: world.physicalTime + 3 * 86400 / scale };
  if (st.encounter) st.encounter.threat = { bodyId: '', pos: { ...from.pos }, seenAt: world.physicalTime };
  void spec;
}

function calmPerson(world: World, target: Person, by: Person): void {
  target.mind.alarm = 0;
  const goal = target.mind.goal;
  if (goal && ['attack', 'confront', 'rob'].includes(goal.type) && goal.data?.intent !== 'kill') { target.mind.goal = null; target.mind.plan = []; }
  const tb = world.primaryBody(target.id); if (tb?.combatAction && tb.combatAction.kind === 'attack' && tb.combatAction.phase === 'preparation') tb.combatAction.outcome = 'cancelled';
  // Being reached into is unsettling: the hushed person is wary of the one who did it.
  if (!isExternallyControlled(target)) {
    const rel = target.relationships[by.id];
    if (rel) rel.fear = Math.min(1, (rel.fear ?? 0) + 0.1);
  }
}
