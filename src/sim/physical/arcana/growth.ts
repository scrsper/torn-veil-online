import type { Body, Person, WorldEvent } from '../../core/types';
import type { World } from '../../core/world';
import { ONTOLOGICAL_STAGES } from '../../core/stages';
import { syncNeeds } from '../../core/physiology';
import { ARCANE_DEFINITIONS } from './definitions';
import { equippedItems } from '../equipment';
import { earnedStanding, featsAtLeast, onBreakthrough } from '../../progression/experience';
import { SOURCE_DIAMOND } from '../../progression/levels';

export interface ArcaneGrowth {
  version: 1;
  victories: Record<string, { eventId: string; quality: number; receivedEventIds: string[] }>;
  demonstrations: Record<string, Record<string, string>>;
  transformation?: { eventId: string; amplitude: number; aperture: number; reserve: number };
}
/** Authored essence-transformation rules, separate from the unchanged multi-day
 * embodied-practice path. These components change physical effects; rank does not.
 * Time, floor counters, kill totals without sources, and empty casts grant nothing. */
export const TRANSFORMATIONS = [
  { stage: 'Iron', victories: 48, forms: 1, essences: 1, materials: 1, amplitude: 1.6, aperture: 1.2, reserve: 120 },
  { stage: 'Bronze', victories: 180, forms: 2, essences: 2, materials: 2, amplitude: 2.8, aperture: 2, reserve: 150 },
  { stage: 'Silver', victories: 600, forms: 3, essences: 3, materials: 3, amplitude: 7, aperture: 5, reserve: 220 },
  { stage: 'Gold', victories: 1280, forms: 6, essences: 6, materials: 4, amplitude: 20, aperture: 12, reserve: 320 },
  // Diamond also demands the leveled ladder (diamondExperience): a full Gold track and victories
  // over opponents at Gold-band level. All eight damaging forms must be demonstrated.
  { stage: 'Diamond', victories: 2000, forms: 8, essences: 8, materials: 5, amplitude: 45, aperture: 20, reserve: 480 },
] as const;
export const SOURCE_GROWTH_POLICY = 2;
/** Sustained bodily control required from Gold upward (mean victory quality). */
export const CONTROL_STAGES: readonly string[] = ['Gold', 'Diamond'];
/** The experience half of source Diamond: peak Gold, and credited feats at Gold-band level. */
export function diamondExperience(w: World, p: Person) {
  const s = earnedStanding(p), feats = featsAtLeast(w, p, SOURCE_DIAMOND.featLevel);
  return { peak: p.ontology.stage === 'Gold' && !!s?.peak, label: s?.label ?? p.ontology.stage, rankXp: Math.floor(s?.rankXp ?? 0), peakXp: s?.peakXp ?? 0, feats };
}
/** Historical receipts remain valid. This table is only for save validation;
 * current assessment and integration always use TRANSFORMATIONS above. */
export const LEGACY_TRANSFORMATIONS = [
  { stage: 'Iron', victories: 12, forms: 1, essences: 1, materials: 1, amplitude: 1.6, aperture: 1.2, reserve: 120 },
  { stage: 'Bronze', victories: 80, forms: 2, essences: 2, materials: 2, amplitude: 2.8, aperture: 2, reserve: 150 },
  { stage: 'Silver', victories: 360, forms: 3, essences: 3, materials: 3, amplitude: 7, aperture: 5, reserve: 220 },
  { stage: 'Gold', victories: 1000, forms: 6, essences: 6, materials: 4, amplitude: 20, aperture: 12, reserve: 320 },
] as const;
export function arcaneCapacity(p: Person, w?: World, b?: Body) {
  const own = p.arcana?.growth?.transformation ?? { amplitude: 1, aperture: 1, reserve: 100 };
  const sources = w && b ? equippedItems(w, p, b).flatMap(i => i.arcaneFocus && (i.condition ?? 1) > 0 ? [i.arcaneFocus] : []) : [];
  // Physical aids do not stack multiplicatively and cannot satisfy transformation gates.
  return sources.reduce((a, s) => ({ amplitude: Math.max(a.amplitude, s.amplitude), aperture: Math.max(a.aperture, s.aperture),
    reserve: Math.max(a.reserve, s.reserve) }), { amplitude: own.amplitude, aperture: own.aperture, reserve: own.reserve });
}
function growth(p: Person): ArcaneGrowth {
  p.arcana ??= { version: 1, learned: {} };
  return p.arcana.growth ??= { version: 1, victories: {}, demonstrations: {} };
}
/** Called after the shared hit resolver, for players and NPCs alike. An agreed
 * opponent or witnessed aggressor must really be overcome. One body counts once,
 * including after recovery, reload, new conflicts, or a different manifestation. */
export function recordArcaneEncounter(w: World, p: Person, b: Body, target: Body, e: WorldEvent): void {
  if (!p.arcana || e.type !== 'attack' || e.actor !== p.id || e.target !== target.ownerId || !(e.data.damage > 0)) return;
  const opponent = w.person(target.ownerId); if (!opponent) return;
  const agreed = p.combatTrial?.id && p.combatTrial.id === opponent.combatTrial?.id
    && p.combatTrial.opponents.includes(opponent.id) && !p.combatTrial.endedEventId && !opponent.combatTrial?.endedEventId;
  const conflict = w.conflicts.find(c => c.id === e.data.conflictId);
  const resisted = agreed || !!conflict && w.events.some(ev => ev.type === 'attack' && ev.actor === opponent.id && ev.target === p.id && ev.tick >= conflict.startedAt);
  if (!resisted || target.maxHealth < 40) return;
  const g = growth(p), cast = typeof e.data.arcaneEventId === 'string' ? w.event(e.data.arcaneEventId) : undefined;
  if (cast?.type === 'arcane_cast' && cast.actor === p.id && p.arcana.learned[cast.data.abilityId]) {
    const d = g.demonstrations[cast.data.abilityId] ??= {};
    if (!d[target.id] && Object.keys(d).length < 64) d[target.id] = e.id;
  }
  if ((target.dead || conflict?.downed?.who === target.ownerId && conflict.downed.by === p.id) && e.data.health <= 0 && !g.victories[target.ownerId] && Object.keys(g.victories).length < 2048) {
    const contribution = w.events.filter(ev => ev.type === 'attack' && ev.actor === p.id && ev.target === target.ownerId
      && ev.data.conflictId === e.data.conflictId).reduce((sum, ev) => sum + Math.max(0, Number(ev.data.damage) || 0), 0);
    if (contribution < target.maxHealth * .5) return; // A last tap on another fighter's victory is not mastery.
    const received = w.events.filter(ev => ev.type === 'attack' && ev.actor === target.ownerId && ev.target === p.id
      && ev.data.conflictId === e.data.conflictId && ev.data.damage > 0);
    // Healing between blows does not erase the cost of an encounter. Pin its actual
    // attack receipts, including after compaction/reload, instead of sampling final HP.
    const cost = received.reduce((sum, ev) => sum + ev.data.damage, 0);
    // Control is measured against the original body, so a vessel's larger health does not soften
    // the unchanged Gold control gate.
    g.victories[target.ownerId] = { eventId: e.id, quality: Math.max(0, 1 - cost / (p.vessel?.base[b.id] ?? b.maxHealth)), receivedEventIds: received.map(e => e.id) };
  }
}
export function assessArcaneTransformation(w: World, p: Person, b: Body) {
  const next = TRANSFORMATIONS.find(t => ONTOLOGICAL_STAGES.indexOf(t.stage) === ONTOLOGICAL_STAGES.indexOf(p.ontology.stage) + 1);
  const g = p.arcana?.growth, victories = Object.values(g?.victories ?? {});
  const demonstrated = Object.entries(g?.demonstrations ?? {}).filter(([, targets]) => Object.keys(targets).length >= 3);
  const forms = new Set(demonstrated.map(([id]) => ARCANE_DEFINITIONS.get(id)?.kernel)).size;
  const essences = Object.keys(p.arcana?.learned ?? {}).filter(id => ARCANE_DEFINITIONS.get(id)?.source === 'essence').length;
  const materials = p.inventory.flatMap(id => { const i = w.item(id); return i?.arcaneSource?.kind === 'essence'
    && i.holderId === p.id && !i.containerId && i.quantity > 0 && (i.condition ?? 1) > 0 ? [i] : []; }).sort((a, b) => a.id.localeCompare(b.id));
  const quality = victories.length ? victories.reduce((sum, v) => sum + v.quality, 0) / victories.length : 0;
  const reasons: string[] = [];
  if (!next) reasons.push('No further essence transformation is implemented; the full ladder remains distinct.');
  else {
    if (victories.length < next.victories) reasons.push(`${victories.length}/${next.victories} distinct opposed victories`);
    if (forms < next.forms) reasons.push(`${forms}/${next.forms} forms applied against three distinct opponents each`);
    if (essences < next.essences) reasons.push(`${essences}/${next.essences} different essences learned from real sources`);
    if (materials.reduce((n, i) => n + i.quantity, 0) < next.materials) reasons.push(`${next.materials} spare essence sources must be consumed`);
    if (CONTROL_STAGES.includes(next.stage) && quality < .97) reasons.push(`Sustained bodily control ${Math.round(quality * 100)}% / 97%`);
    if (next.stage === 'Diamond') {
      const x = diamondExperience(w, p);
      if (!x.peak) reasons.push(`Peak Gold is required (now ${x.label}, ${x.rankXp}/${x.peakXp} experience)`);
      if (x.feats.length < SOURCE_DIAMOND.feats) reasons.push(`${x.feats.length}/${SOURCE_DIAMOND.feats} opposed victories over Gold-band threats (level ${SOURCE_DIAMOND.featLevel}+)`);
    }
  }
  if (!p.alive || b.dead || !b.present || b.ownerId !== p.id || !p.bodies.includes(b.id) || b.health < b.maxHealth * .7
    || ['sleep', 'downed'].includes(b.pose) || b.subduedUntil > w.physicalTime || p.surrender || p.custody?.active) reasons.push('A conscious recovered manifestation is required');
  if (p.physiology.fatigue > .5 || Math.min(p.physiology.energy, p.physiology.hydration) < .35) reasons.push('Rest, food or water is needed');
  if (b.combatAction && b.combatAction.completeAt > w.physicalTime || b.arcana?.cast && b.arcana.cast.completeAt > w.physicalTime) reasons.push('Finish the committed action');
  const threat = w.nearbyBodies(b.pos, 10).some(other => other.ownerId !== p.id && other.pose !== 'downed'
    && w.person(other.ownerId)?.combatTrial?.id === p.combatTrial?.id && !w.person(other.ownerId)?.combatTrial?.endedEventId);
  if (p.combatTrial && !p.combatTrial.endedEventId && threat) reasons.push('Break contact before integrating sources');
  return { eligible: !reasons.length, next, reasons, victories: victories.length, forms, essences, quality, materials };
}
/** Inspectable evidence and requirements, shared by city, Tower and Observatory.
 * Count thresholds are policy parameters, not measured hours or population rarity. */
export function arcaneProgress(w: World, p: Person, b: Body) {
  const a = assessArcaneTransformation(w,p,b);
  return { eligible:a.eligible, next:a.next?.stage, reasons:a.reasons, victories:a.victories, forms:a.forms,
    essences:a.essences, quality:a.quality, materials:a.materials.reduce((n,i)=>n+i.quantity,0),
    requirements:a.next?{victories:a.next.victories,forms:a.next.forms,essences:a.next.essences,materials:a.next.materials,
      quality:CONTROL_STAGES.includes(a.next.stage)?.97:null,
      experience:a.next.stage==='Diamond'?{peak:'Gold',feats:SOURCE_DIAMOND.feats,featLevel:SOURCE_DIAMOND.featLevel}:null}:null,
    demonstrations:Object.entries(p.arcana?.growth?.demonstrations??{}).map(([id,targets])=>({id,kernel:ARCANE_DEFINITIONS.get(id)?.kernel,opponents:Object.keys(targets).length})),
    capacity:arcaneCapacity(p,w,b), intrinsicCapacity:arcaneCapacity(p),
    learned:Object.keys(p.arcana?.learned??{}).map(id=>({id,name:ARCANE_DEFINITIONS.get(id)?.name??id})),
    sources:p.inventory.flatMap(id=>{const i=w.item(id);return i?.arcaneSource&&i.quantity>0?[{id,name:i.name,abilityId:i.arcaneSource.abilityId}]:[];}) };
}
/** Explicit paid body-bound action. No healing, attribute fabrication, calendar
 * acceleration, legacy XP or rank-dependent combat resolution occurs here. */
export function integrateArcaneSources(w: World, p: Person, b: Body): string {
  const a = assessArcaneTransformation(w, p, b); if (!a.eligible || !a.next) return 'not_ready';
  const next = a.next, g = growth(p), feats = next.stage === 'Diamond' ? diamondExperience(w, p).feats.map(f => f.eventId) : [];
  const causes = [...Object.values(g.victories).map(v => v.eventId),
    ...Object.values(g.demonstrations).flatMap(d => Object.values(d)), ...Object.values(p.arcana!.learned).map(l => l.eventId), ...feats];
  const event = w.emit('ontological_advancement', { actor: p.id, pos: { ...b.pos }, category: 'history', significance: 1,
    causes: [...new Set(causes)], data: { from: p.ontology.stage, to: next.stage, adaptation: 'source-integrated arcane capacity',
      bodyId: b.id, growthPolicy: SOURCE_GROWTH_POLICY, amplitude: next.amplitude, aperture: next.aperture, reserve: next.reserve, materialIds: [] as string[], materialAmounts: [] as number[],
      ...(feats.length ? { experience: { peak: true, feats } } : {}) },
    summary: `${p.name} integrated earned essence sources into ${next.stage} arcane capacity` });
  let remaining = next.materials;
  for (const i of a.materials) {
    const amount = Math.min(remaining, i.quantity); i.quantity -= amount; remaining -= amount;
    i.provenance.push({ tick: w.now, eventId: event.id, from: p.id, to: null, how: 'essence integrated into embodied capacity' });
    event.data.materialIds.push(i.id); event.data.materialAmounts.push(amount); if (!remaining) break;
  }
  g.transformation = { eventId: event.id, amplitude: next.amplitude, aperture: next.aperture, reserve: next.reserve };
  p.ontology = { stage: next.stage, breakthroughEventId: event.id };
  onBreakthrough(w, p, event);
  p.physiology.energy -= .1; p.physiology.hydration -= .1; p.physiology.fatigue = Math.min(1, p.physiology.fatigue + .08); syncNeeds(p);
  return 'accepted';
}
