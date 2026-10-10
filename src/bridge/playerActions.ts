import type { Item, Person } from '../sim/core/types';
import type { Simulation } from '../sim/mind/agent';
import { butcheryLaborSeconds, type HandInteraction } from '../sim/physical/hand';
import { actionsForCarriedItem, describeCarried } from '../sim/core/interaction';
import { canReadRecord } from '../sim/mind/records';
import { knowsVeil, veilStrain } from '../sim/physical/veil';
import { availableForMartial } from '../sim/mind/martialPractice';
import { assessAdvancement } from '../sim/core/advancement';

/**
 * What the player may do with what they carry, and which of their own capacities they can use
 * right now — derived from canonical state and the simulation's existing action rules, never
 * a client-side rules engine. Every row is advisory: execution revalidates canonically.
 *
 * `request` names the ordinary intent that would perform it (`interact` with the interaction id,
 * or a `person_action`). An unavailable row carries a reason the character can actually know.
 */
export interface PlayerActionRow {
  id: string; kind: string; label: string; detail?: string; grave?: boolean;
  available: boolean; reason?: string;
  request?: { type: 'interact'; interactionId: string } | { type: 'person_action'; intent: Record<string, string> };
}
export interface CarriedItemRow { id: string; name: string; type: string; quantity: number; description: string[]; actions: PlayerActionRow[]; }

function bodyUnable(sim: Simulation, p: Person): string | undefined {
  const b = sim.world.primaryBody(p.id);
  if (!p.alive || !b || b.dead) return 'You are dead.';
  if (b.pose === 'sleep') return 'You are asleep.';
  if (b.pose === 'downed' || b.subduedUntil > sim.world.physicalTime) return 'You are down and cannot act.';
  if (p.custody?.active || p.surrender) return 'You are restrained.';
  return undefined;
}

export function carriedItemRows(sim: Simulation, p: Person, interactions: HandInteraction[]): CarriedItemRow[] {
  const w = sim.world, offered = new Set(interactions.map(a => a.id)), unable = bodyUnable(sim, p);
  const rows: CarriedItemRow[] = [];
  for (const id of p.inventory) {
    const it = w.item(id);
    if (!it || it.holderId !== p.id || it.quantity <= 0) continue;
    const description = describeCarried(w, p, it).filter(Boolean);
    const actions: PlayerActionRow[] = [];
    for (const a of actionsForCarriedItem(w, p, it)) {
      if (a.kind === 'inspect') { if (a.detail) description.push(a.detail === 'you do not know what this is good for' ? 'You do not know what this is good for.' : `Good for: ${a.detail}`); continue; }
      // No player intent hands an item to someone yet; offering it would promise an action the
      // server cannot perform.
      if (a.kind === 'give') continue;
      const interactionId = a.kind === 'drop' ? `drop:${it.id}` : a.kind === 'eat' || a.kind === 'drink' ? `consume:${it.id}` : '';
      if (!interactionId) continue;
      const available = offered.has(interactionId);
      actions.push({ id: interactionId, kind: a.kind, label: a.label, detail: a.detail, grave: a.grave, available,
        reason: available ? undefined : unable ?? (a.kind === 'drop' ? 'There is no clear ground at your feet to set it down.' : 'You cannot do that right now.'),
        request: { type: 'interact', interactionId } });
    }
    for(const kind of ['equip','unequip'] as const){const interactionId=`${kind}:${it.id}`;if(offered.has(interactionId))actions.push({id:interactionId,kind,label:`${kind==='equip'?'Equip':'Unequip'} ${it.name}`,available:!unable,reason:unable,request:{type:'interact',interactionId}});}
    if(it.equipped)description.push('Equipped: '+it.equipped.slot);
    if(it.type==='armor')description.push('Physical fitting prototype; protection and catalog abilities are descriptive.');
    if (it.record) actions.push(readRow(sim, p, it, unable));
    rows.push({ id: it.id, name: it.name || it.type, type: it.type, quantity: it.quantity, description, actions });
  }
  return rows;
}

function readRow(sim: Simulation, p: Person, it: Item, unable?: string): PlayerActionRow {
  const available = !unable && canReadRecord(sim.world, p, it);
  let reason = unable;
  // What a reader can tell for themselves: the marks are not ones they know, or the page is spoiled.
  if (!available && !reason) reason = (it.condition ?? 1) <= 0 || !it.record?.notation ? 'It is too damaged to make out.' : 'You cannot read these marks.';
  return { id: `read:${it.id}`, kind: 'read', label: `Read ${it.name || 'the record'}`, available, reason, request: { type: 'person_action', intent: { kind: 'read', itemId: it.id } } };
}

/** Timed work the player is doing right now, as they would experience it: what, how far along,
 * and that moving stops it. Read from their own action and the thing being worked on. */
export function currentWork(sim: Simulation, p: Person): { kind: string; label: string; progress: number; remainingSeconds: number; stop: string } | null {
  const a = p.mind.plan[0], w = sim.world;
  if (!a || a.status === 'failed' || a.status === 'done') return null;
  if (a.type === 'butcher') {
    const carcass = w.body(a.targetEntity!); if (!carcass) return null;
    const needed = butcheryLaborSeconds(w, carcass), done = Math.min(needed, carcass.butcheredSeconds ?? 0);
    return { kind: 'butcher', label: `Dressing the ${w.nameOf(carcass.ownerId)} carcass`, progress: done / needed, remainingSeconds: needed - done, stop: 'move to stop; the work done stays with the carcass' };
  }
  if (a.type === 'meditate') {
    const total = a.duration ?? 0, done = Math.max(0, w.now - (a.startedAt ?? w.now));
    return total > 0 ? { kind: 'meditate', label: 'Meditating on the veil', progress: Math.min(1, done / total), remainingSeconds: Math.max(0, total - done), stop: 'move to stop' } : null;
  }
  return null;
}

/** The player's own capacities: learned techniques and ordinary bodily actions, with readiness. */
export function abilityRows(sim: Simulation, p: Person): PlayerActionRow[] {
  const w = sim.world, body = w.primaryBody(p.id), unable = bodyUnable(sim, p), rows: PlayerActionRow[] = [];
  const phys = p.physiology;
  const bodyReason = (): string | undefined => {
    if (unable) return unable;
    if (phys.energy <= 0.3) return 'You are too hungry and spent to practise.';
    if (phys.hydration <= 0.3) return 'You are too thirsty to practise.';
    if (phys.fatigue >= 0.75 || phys.sleepDebt >= 8) return 'You are too tired to practise.';
    if (body && body.health / body.maxHealth <= 0.6) return 'You are too badly hurt to practise.';
    return 'You cannot practise right now.';
  };
  if (knowsVeil(p)) {
    const strain = veilStrain(w, p);
    const detail = `strain ${Math.round(strain * 100)}%${strain > 0.7 ? ' — rest before reaching again' : ''}`;
    rows.push({ id: 'hush', kind: 'hush', label: 'Hush (the nearest creature or person you face)', detail, available: !unable, reason: unable });
    rows.push({ id: 'meditate', kind: 'meditate', label: 'Meditate on the veil (about half an hour)', detail: 'eases strain; steadies will and attention',
      available: !unable, reason: unable, request: { type: 'person_action', intent: { kind: 'meditate' } } });
  }
  const trainable = !!body && !p.custody?.active && availableForMartial(w, p, body.id);
  rows.push({ id: 'train', kind: 'train', label: 'Train bodily technique alone (a few rounds)', detail: 'drills strike and footwork; ask someone to spar for harder practice',
    available: trainable, reason: trainable ? undefined : bodyReason(), request: { type: 'person_action', intent: { kind: 'train' } } });
  const assessment = assessAdvancement(w, p);
  if (p.ontology.stage === 'Normal') rows.push({ id: 'advance', kind: 'advance', label: 'Attempt the Iron breakthrough',
    detail: assessment.path ? `path: ${assessment.path.skill}` : undefined,
    available: assessment.eligible, reason: assessment.eligible ? undefined : assessment.reasons.slice(0, 3).join('; '),
    request: { type: 'person_action', intent: { kind: 'advance' } } });
  const asleep = body?.pose === 'sleep';
  rows.push({ id: asleep ? 'wake' : 'rest', kind: asleep ? 'wake' : 'rest', label: asleep ? 'Wake up' : 'Lie down and sleep here',
    available: !!body && !body.dead && body.pose !== 'downed' && !p.custody?.active, reason: body?.pose === 'downed' ? 'You are down and cannot act.' : undefined,
    request: { type: 'person_action', intent: { kind: asleep ? 'wake' : 'rest' } } });
  return rows;
}
