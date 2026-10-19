import { arcaneCapacity } from './growth';
import { recordLearningExperience } from '../../progression/experience';
import { physicalResidents } from '../../world/interiors/residency';
import type { Body, ConflictIntent, Item, Person, Vec3, WorldEvent } from '../../core/types';
import type { World } from '../../core/world';
import { canSpendExertion, spendExertion } from '../exertion';
import { ARCANE_DEFINITIONS, KERNEL_GEOMETRY } from './definitions';
import type { ArcaneBody, ArcaneCast, ArcaneEffect } from './types';
import type { Rider } from './catalogue';

export type ArcaneHit = (p: Person, body: Body, target: Body, damage: number, intent: ConflictIntent, sourceEventId: string) => WorldEvent | null;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finitePoint = (p: Vec3) => !!p && [p.x, p.y, p.z].every(Number.isFinite);
const eye = (b: Body) => ({ ...b.pos, y: b.pos.y + 1.2 });
function capable(w: World, p: Person, b: Body | undefined): b is Body {
  return !!b && p.alive && b.ownerId === p.id && p.bodies.includes(b.id) && b.present && !b.dead && b.health > 0
    && !['sleep', 'downed'].includes(b.pose) && b.subduedUntil <= w.physicalTime && !p.surrender && !p.custody?.active;
}
function carried(p: Person, i: Item | undefined): i is Item {
  return !!i && i.holderId === p.id && p.inventory.includes(i.id) && i.quantity > 0 && !i.containerId && i.condition !== 0;
}
function clear(w: World, a: Vec3, b: Vec3): boolean { return w.grid.lineOfPassage(a, b, distance(a, b) + .1); }
export function arcaneBody(w: World, b: Body): ArcaneBody {
  b.arcana ??= { version: 1, mana: 100, sampledAt: w.physicalTime, cooldowns: {}, effects: [] };
  const a = b.arcana, p = w.person(b.ownerId), elapsed = Math.max(0, w.physicalTime - a.sampledAt);
  // Embodied reserve, not an extra health/energy system. Recovery requires a conscious,
  // nourished living body; clocks and reloads cannot award negative or repeated time.
  if (p && capable(w, p, b) && p.physiology.energy >= .25 && p.physiology.hydration >= .25)
    a.mana = Math.min(arcaneCapacity(p, w, b).reserve, a.mana + elapsed * 1.6);
  a.sampledAt = w.physicalTime;
  a.effects = a.effects.filter(e => e.until > w.physicalTime && e.strength > 0);
  return a;
}

/** Idempotent permanent learning from an ordinary held source; the book is not fabricated
 * or consumed. An essence is a finite consumed item. Old scoped checkpoints are never read. */
export function learnArcaneSource(w: World, p: Person, bodyId: string, itemId: string): string {
  const b = w.body(bodyId), i = w.item(itemId);
  if (!capable(w, p, b)) return 'incapacitated';
  if (!carried(p, i) || !i.arcaneSource || i.arcaneSource.kind === 'scroll') return 'invalid_source';
  const def = ARCANE_DEFINITIONS.get(i.arcaneSource.abilityId);
  if (!def || def.source === 'scroll') return 'invalid_source';
  if (p.arcana?.learned[def.id]) return 'accepted';
  const causes = i.provenance.flatMap(v => v.eventId && w.event(v.eventId) ? [v.eventId] : []).slice(-4);
  const ev = w.emit('arcane_learned', { actor: p.id, item: i.id, pos: { ...b.pos }, causes, visibility: 5,
    category: 'world', significance: .25, data: { abilityId: def.id, bodyId, source: i.arcaneSource.kind }, summary: `${p.name} learned ${def.name} from ${i.name}` });
  p.arcana ??= { version: 1, learned: {} };
  p.arcana.learned[def.id] = { eventId: ev.id, itemId: i.id, applications: 0 };
  if (i.arcaneSource.kind === 'essence') {
    i.quantity--;
    i.provenance.push({ tick: w.now, eventId: ev.id, from: p.id, to: null, how: 'essence absorbed' });
  }
  arcaneBody(w, b);
  recordLearningExperience(w, p, ev);
  return 'accepted';
}

export interface CastIntent { bodyId: string; abilityId: string; target?: Vec3; scrollItemId?: string; intent?: ConflictIntent; }
/** Acceptance freezes timing/geometry. Hits are rechecked when the canonical windup ends.
 * A controller supplies an aim, never a hit, amount, cooldown, rank or recipient list. */
export function requestArcaneCast(w: World, p: Person, input: CastIntent): string {
  const b = w.body(input.bodyId), d = ARCANE_DEFINITIONS.get(input.abilityId);
  if (!capable(w, p, b)) return 'incapacitated';
  if (!d) return 'unknown_ability';
  const learned = p.arcana?.learned[d.id], source = input.scrollItemId ? w.item(input.scrollItemId) : undefined;
  if (input.scrollItemId) {
    if (!carried(p, source) || source.arcaneSource?.kind !== 'scroll' || source.arcaneSource.abilityId !== d.id) return 'invalid_source';
  } else if (!learned || w.event(learned.eventId)?.type !== 'arcane_learned' || w.event(learned.eventId)?.actor !== p.id) return 'unknown_ability';
  const base = KERNEL_GEOMETRY[d.kernel], capacity = arcaneCapacity(p, w, b), g = { ...base, range: base.range * capacity.aperture, radius: base.radius * Math.sqrt(capacity.aperture) }, target = input.target ?? { x: b.pos.x - Math.sin(b.yaw) * g.range, y: b.pos.y, z: b.pos.z - Math.cos(b.yaw) * g.range };
  if (!finitePoint(target) || distance(b.pos, target) > g.range + .01 || Math.abs(target.y - b.pos.y) > 3) return 'out_of_reach';
  if (g.range && !clear(w, eye(b), { ...target, y: target.y + 1.2 })) return 'obstructed';
  const a = arcaneBody(w, b), now = w.physicalTime;
  if (a.cast && a.cast.completeAt > now || b.combatAction && b.combatAction.completeAt > now) return 'busy';
  if ((a.cooldowns[d.id] ?? -1) > now) return 'cooldown';
  const manaCost = d.mana ?? (d.source === 'scroll' ? 0 : d.cost), exertion = d.source === 'scroll' ? .025 : .02 + d.cost / 1000;
  if (a.mana < manaCost || p.physiology.energy < .1 || p.physiology.hydration < .1 || !canSpendExertion(p, b, exertion)) return 'exhausted';
  if ((d.kernel === 'dash' || d.kernel === 'blink') && !safeDestination(w, b, target)) return 'obstructed';
  const ev = w.emit('arcane_cast', { actor: p.id, item: source?.id, pos: { ...b.pos },
    causes: learned ? [learned.eventId] : source!.provenance.flatMap(v => v.eventId && w.event(v.eventId) ? [v.eventId] : []).slice(-4),
    category: 'world', significance: .2, visibility: 18, loudness: 8,
    data: { abilityId: d.id, bodyId: b.id, kernel: d.kernel, target: { ...target }, manaCost, activeAt: now + g.windup, completeAt: now + g.windup + g.recovery }, summary: `${p.name} began ${d.name}` });
  a.mana -= manaCost; a.cooldowns[d.id] = now + d.cooldown;
  ev.data.effort = spendExertion(w, p, b, exertion);
  if (source) { source.quantity--; source.provenance.push({ tick: w.now, eventId: ev.id, from: p.id, to: null, how: 'scroll expended' }); }
  const power = d.power * (1 + Math.min(1, p.skills.veilcraft ?? 0) * .35) * capacity.amplitude;
  a.cast = { id: ev.id, eventId: ev.id, bodyId: b.id, abilityId: d.id, kernel: d.kernel, riders: [...d.riders],
    target: { ...target }, facing: b.yaw, intent: input.intent ?? 'injure', startedAt: now, activeAt: now + g.windup,
    completeAt: now + g.windup + g.recovery, range: g.range, radius: g.radius, power, damage: g.damage * power, resolved: false, cancelled: false };
  b.path = null; b.pathGoal = null; b.vel = { x: 0, y: 0, z: 0 };
  return 'accepted';
}
export function cancelArcaneCast(w: World, b: Body): boolean {
  const c = b.arcana?.cast; if (!c || c.resolved || c.cancelled) return false;
  c.cancelled = true; c.completeAt = w.physicalTime;
  w.emit('arcane_resolved', { actor: b.ownerId, causes: [c.eventId], pos: { ...b.pos }, data: { bodyId: b.id, abilityId: c.abilityId, outcome: 'cancelled' }, summary: `${w.nameOf(b.ownerId)} stopped shaping ${c.abilityId}` });
  return true;
}

function safeDestination(w: World, b: Body, to: Vec3): boolean {
  const d = distance(b.pos, to), steps = Math.max(1, Math.ceil(d / .25));
  for (let n = 1; n <= steps; n++) {
    const t = n / steps, x = b.pos.x + (to.x - b.pos.x) * t, z = b.pos.z + (to.z - b.pos.z) * t;
    for (const dx of [-.3, .3]) for (const dz of [-.3, .3]) {
      const fx = Math.floor(x + dx), fz = Math.floor(z + dz), y = w.nav.floorY(fx, fz);
      if (!w.nav.isWalkable(fx, fz) || Math.abs(y - b.pos.y) > .5) return false;
      for (let h = 0; h < 1.8; h += .4) if (w.grid.isSolidAt(x + dx, y + h, z + dz)) return false;
    }
  }
  return !w.nearbyPhysicalBodies(to, .7).some(other => other.id !== b.id);
}
function effect(w: World, b: Body, cast: ArcaneCast, kind: ArcaneEffect['kind'], duration: number, strength: number, rider?: Rider) {
  const a = arcaneBody(w, b);
  // One strongest instance per kind, never an unbounded effect pile or additive exploit.
  const old = a.effects.find(e => e.kind === kind);
  if (old && old.strength > strength) return;
  a.effects = a.effects.filter(e => e.kind !== kind);
  a.effects.push({ kind, strength, rider, sourceEventId: cast.eventId, sourceBodyId: cast.bodyId, until: w.physicalTime + duration });
}
function targetSet(w: World, b: Body, c: ArcaneCast): Body[] {
  const centered = ['meteor', 'sigil', 'field'].includes(c.kernel), origin = centered ? c.target : b.pos;
  const all = w.nearbyPhysicalBodies(origin, centered ? c.radius : c.range)
    .filter(t => t.ownerId !== b.ownerId && t.pose !== 'downed' && t.pose !== 'sleep')
    .filter(t => clear(w, eye(b), eye(t)) && (!centered || clear(w, { ...origin, y: origin.y + 1.2 }, eye(t))))
    .sort((a, z) => distance(a.pos, origin) - distance(z.pos, origin) || a.id.localeCompare(z.id));
  const dx = c.target.x - b.pos.x, dz = c.target.z - b.pos.z, len = Math.hypot(dx, dz), ux = len ? dx / len : -Math.sin(c.facing), uz = len ? dz / len : -Math.cos(c.facing);
  const line = ['bolt', 'spear', 'dash'].includes(c.kernel), cone = ['cone', 'wave', 'volley', 'chain'].includes(c.kernel);
  return all.filter(t => {
    const x = t.pos.x - b.pos.x, z = t.pos.z - b.pos.z, along = x * ux + z * uz, side = Math.abs(x * uz - z * ux);
    return line ? along >= 0 && side <= c.radius : cone ? along > 0 && side <= Math.max(.6, along * .65) : true;
  }).slice(0, c.kernel === 'bolt' ? 1 : c.kernel === 'chain' ? 4 :
    Math.min(256, Math.ceil(24 * Math.max(1, c.radius / Math.max(.1, KERNEL_GEOMETRY[c.kernel].radius)))));
}

/** Called by the ordinary physical scheduler, never by an animation callback. Each accepted
 * cast resolves once; persisted resolved/cancelled flags prevent replay after reload. */
export function stepArcana(w: World, hit: ArcaneHit): void {
  for (const b of physicalResidents(w).filter(b => !!b.arcana).sort((a, z) => a.id.localeCompare(z.id))) {
    const a = arcaneBody(w, b), c = a.cast, p = w.person(b.ownerId);
    if (!c || c.resolved || c.cancelled) continue;
    if (!p || !capable(w, p, b) || b.lastHitAt > c.startedAt && b.lastHitAt < c.activeAt) { cancelArcaneCast(w, b); continue; }
    if (w.physicalTime + 1e-9 < c.activeAt) continue;
    c.resolved = true;
    let affected = 0, restoredHealth = 0;
    const hits: string[] = [];
    if (c.kernel === 'heal') {
      // Restores health, never erases injury, death, fatigue or expended items.
      restoredHealth = Math.min(b.maxHealth - b.health, b.maxHealth * .25 * c.power);
      b.health += restoredHealth; affected = restoredHealth > 0 ? 1 : 0;
    } else if (c.kernel === 'ward') { effect(w, b, c, 'ward', 10, 28 * c.power); affected = 1; }
    else if (c.kernel === 'frenzy') { effect(w, b, c, 'frenzy', 8, .25 * c.power); affected = 1; }
    else if (c.kernel === 'imbue') { effect(w, b, c, 'imbue', 12, 5 * c.power, c.riders[0]); affected = 1; }
    else {
      const targets = targetSet(w, b, c);
      if (c.kernel === 'dash' || c.kernel === 'blink') {
        if (safeDestination(w, b, c.target)) { b.pos = { ...c.target }; b.vel = { x: 0, y: 0, z: 0 }; affected++; }
        else targets.length = 0;
      }
      if (c.kernel !== 'blink') for (const t of targets) {
        const before = t.health, ev = hit(p!, b, t, c.damage, c.intent, c.eventId);
        if (!ev) continue;
        hits.push(ev.id); affected++;
        const actual = Math.max(0, Math.min(before, ev.data.damage ?? 0));
        if (c.riders.includes('frost') || c.riders.includes('time') || c.riders.includes('gravity')) effect(w, t, c, 'chill', 4, c.riders.includes('time') ? .65 : .35);
        if (c.riders.includes('water')) effect(w, t, c, 'wet', 6, 1);
        if (c.riders.includes('blood') || c.riders.includes('verdance')) { const gain = Math.min(b.maxHealth - b.health, actual * .12); b.health += gain; restoredHealth += gain; }
        if (c.riders.includes('swift')) effect(w, b, c, 'haste', 4, .2);
      }
    }
    const ev = w.emit('arcane_resolved', { actor: p.id, pos: { ...b.pos }, causes: [c.eventId, ...hits], visibility: 22, loudness: 12,
      category: 'world', significance: affected ? .3 : .05, data: { bodyId: b.id, abilityId: c.abilityId, outcome: affected ? 'applied' : 'miss', affected, restoredHealth, target: c.target },
      summary: `${p.name}'s ${ARCANE_DEFINITIONS.get(c.abilityId)?.name ?? c.abilityId} ${affected ? 'took effect' : 'found no target'}` });
    // Count demonstrated applications, not key presses, elapsed idle time or legacy XP.
    if (affected && p.arcana?.learned[c.abilityId]) p.arcana.learned[c.abilityId].applications++;
    void ev;
  }
}
