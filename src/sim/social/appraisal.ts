import type { ConcernKind, EntityId, ItemType, KnowledgeItem, Person, SituationKind } from '../core/types';
import type { World } from '../core/world';
import { crimeSeverity, isCrime } from '../mind/knowledge';
import { disposition, isClose, isFamily } from '../mind/relationships';
import { tradeMakes, tradeNeeds } from '../world/supply';

/**
 * APPRAISAL — "what does this mean to ME?" (v0.9 §A).
 *
 * The same canonical event must land differently on the victim, the victim's spouse, the
 * victim's employer, a guard, the attacker's friend, and a stranger passing through. Before
 * this module, significance was one number carried on the event itself plus two ad-hoc
 * multipliers at the perception site (`isVictim ? 1.4 : victimClose ? 1.2 : 1`) — which is why
 * everyone reacted to everything at roughly the same volume.
 *
 * This computes personal significance from the general facts a mind actually has:
 * direct involvement, relationships (to BOTH parties), institutional/occupational role, material
 * stake (my property, my workplace, the person my work depends on), traits, and the confidence
 * and provenance of the belief itself. It names no individual and no storyline; it reads only
 * generic structure. Everything downstream — which concerns form, what gets mentioned in
 * conversation, how hard a goal competes — reads the result rather than re-deriving its own
 * private notion of "how much does this matter to this person."
 */

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** Roles are generic structural positions, not character types. */
export type AppraisalRole =
  | 'victim' | 'actor' | 'owner'
  | 'kin_of_subject' | 'close_to_subject' | 'knows_subject'
  | 'kin_of_actor' | 'close_to_actor' | 'afraid_of_actor' | 'aggrieved_by_actor'
  | 'institutional' | 'pastoral' | 'healer'
  | 'coworker' | 'employer' | 'employee'
  | 'neighbour' | 'at_my_place' | 'bystander'
  // Causal Society — structural positions relative to a MATERIAL, read off the public trades
  // table (world/supply.ts). None of them names a person or a place.
  /** My own trade cannot be carried out without the thing that has run out. */
  | 'livelihood'
  /** What they could not make is what my trade needs next. The shortage is coming for me. */
  | 'downstream'
  /** Supplying that material is MY trade — the failure is at my end of the chain. */
  | 'supplier'
  /** I hold a belief that this event is why my own living was disrupted. Formed only by
   * inference (mind/inference.ts), never by seeing the event itself. */
  | 'materially_affected';

export interface Appraisal {
  /** 0..1 — how much this matters to this person. */
  weight: number;
  roles: AppraisalRole[];
  reasons: string[];
  /** 0..1 — how much of the weight is MATERIAL (my property, my livelihood) rather than
   * relational. Used to tell "I am upset for him" from "this costs me". */
  stake: number;
  kind: SituationKind | null;
  /** Whether the belief describes an actual crime (`mind/knowledge.ts`'s `isCrime`) as opposed to
   * harm in general — a guard's lawful subdual hurts someone without being a wrong to answer for. */
  crime: boolean;
  subjectId?: EntityId;
  actorId?: EntityId;
  itemId?: EntityId;
  /** Causal Society: the MATERIAL this is about, for a stoppage. Its presence is also what tells
   * a material disruption apart from a personal one — 'disruption' covers both. */
  resource?: ItemType;
  placeId?: EntityId;
}

/** Causal Society: what a mind has separately CONCLUDED about an event, which the event itself
 * cannot tell it. Supplied only by `mind/inference.ts`, at the moment a cause-belief forms. */
export interface AppraisalContext {
  /** 0..1 — how much of this person's own living they believe this event cost them. */
  materialStake?: number;
  /** Grounded, human-readable justification for that stake. */
  reason?: string;
}

const KIND_BY_TYPE: Record<string, SituationKind> = {
  attack: 'harm', kill: 'harm', death: 'grief', theft: 'property', item_missing: 'loss',
  absence_noticed: 'disruption', dispute: 'obligation', debt: 'obligation', heal: 'harm',
  // Causal Society: a trade standing idle for want of its input is a disruption in exactly the
  // sense `absence_noticed` already is — something that ought to be happening is not. The two
  // are told apart downstream by whether the appraisal carries a `resource`.
  work_blocked: 'disruption',
  // v0.10 §II: a responsibility someone took on toward me and then broke. Not a crime — nobody
  // is arrested for it — but genuinely an unsettled matter between two people, which is exactly
  // what the pre-existing 'obligation' kind already means.
  obligation_failed: 'obligation',
};

/** Occupations whose ROLE gives them an institutional stake in wrongdoing. Not a name list —
 * an occupation list, exactly as `mind/agent.ts` already treats guard/captain. */
const LAW_ROLES = new Set(['guard', 'captain']);
/** Occupations whose role gives them a duty of care toward the hurt or bereaved. */
const PASTORAL_ROLES = new Set(['priest', 'acolyte', 'elder']);
const HEALER_ROLES = new Set(['herbalist']);

export function appraiseClaim(world: World, p: Person, k: KnowledgeItem, ctx?: AppraisalContext): Appraisal {
  const c = k.claim;
  const roles: AppraisalRole[] = [];
  const reasons: string[] = [];
  const kind = (KIND_BY_TYPE[c.type as string] ?? null) as SituationKind | null;
  const subjectId = (c.type === 'item_missing' ? (c.actor as EntityId | undefined) : (c.target as EntityId | undefined));
  const actorId = c.actorUnknown ? undefined : (c.actor as EntityId | undefined);
  const itemId = c.item as EntityId | undefined;

  const resource = c.need as ItemType | undefined;
  const making = c.making as ItemType | undefined;
  const crime = k.kind === 'event' && isCrime(c.type as string, c.intent as string | undefined);
  const severity = crime ? crimeSeverity(c.type as string) : clamp(c.significance ?? 0.3);
  let weight = severity * 0.35;
  let stake = 0;
  const add = (amount: number, role: AppraisalRole | null, reason: string) => {
    weight += amount;
    if (role && !roles.includes(role)) roles.push(role);
    if (reason) reasons.push(reason);
  };

  // ---- direct involvement
  if (subjectId === p.id) { add(0.5, 'victim', 'this happened to me'); stake += 0.5; }
  if (actorId === p.id) { add(0.35, 'actor', 'I did this'); }
  if (itemId) {
    const item = world.item(itemId);
    if (item && item.ownerId === p.id) { add(0.4, 'owner', `${item.name} is mine`); stake += 0.5; }
  }

  // ---- relationship to the person it happened to
  if (subjectId && subjectId !== p.id) {
    const rel = p.relationships[subjectId];
    if (isFamily(p, subjectId)) {
      const tag = rel?.tags.find(t => ['spouse', 'child', 'parent', 'sibling', 'foster'].includes(t)) ?? 'kin';
      add(0.45, 'kin_of_subject', `${world.nameOf(subjectId)} is my ${tag}`);
    } else if (isClose(p, subjectId)) {
      add(0.3, 'close_to_subject', `${world.nameOf(subjectId)} is dear to me`);
    } else if (rel && rel.familiarity > 0.05) {
      const d = disposition(p, subjectId);
      add(clamp(rel.familiarity * 0.15 + Math.max(0, d) * 0.15, 0, 0.22), 'knows_subject', `I know ${world.nameOf(subjectId)}`);
    }
  }

  // ---- relationship to the person responsible (the attacker's friend must NOT read this the
  // same way a stranger does — it matters to them precisely because they are tied to him)
  if (actorId && actorId !== p.id) {
    const rel = p.relationships[actorId];
    if (isFamily(p, actorId)) add(0.3, 'kin_of_actor', `${world.nameOf(actorId)} is my kin`);
    else if (isClose(p, actorId)) add(0.24, 'close_to_actor', `${world.nameOf(actorId)} is a friend of mine`);
    if (rel && rel.fear > 0.25) add(clamp(rel.fear * 0.3, 0, 0.3), 'afraid_of_actor', `${world.nameOf(actorId)} frightens me`);
    if (rel && (rel.grudge > 0.25 || (rel.grievance ?? 0) > 0)) add(clamp(rel.grudge * 0.25, 0, 0.25), 'aggrieved_by_actor', `I have my own history with ${world.nameOf(actorId)}`);
  }

  // ---- institutional / occupational role
  if (crime && LAW_ROLES.has(p.occupation)) add(0.4, 'institutional', 'keeping the peace is my charge');
  if ((kind === 'harm' || kind === 'grief') && PASTORAL_ROLES.has(p.occupation)) add(0.2, 'pastoral', 'the hurt and the grieving are my charge');
  if (kind === 'harm' && HEALER_ROLES.has(p.occupation)) add(0.2, 'healer', 'I am the one people come to when they are hurt');

  // ---- material stake: does this touch my livelihood?
  if (subjectId && subjectId !== p.id) {
    const subject = world.person(subjectId);
    if (subject && p.workId && subject.workId === p.workId) { add(0.25, 'coworker', `${subject.name} and I work at ${world.nameOf(p.workId)}`); stake += 0.35; }
    const rel = p.relationships[subjectId];
    if (rel?.tags.includes('employee')) { add(0.28, 'employer', `${world.nameOf(subjectId)} works for me`); stake += 0.4; }
    if (rel?.tags.includes('employer')) { add(0.25, 'employee', `I work for ${world.nameOf(subjectId)}`); stake += 0.4; }
    if (subject && p.householdId && subject.householdId === p.householdId) { add(0.2, 'neighbour', 'we share a roof'); stake += 0.2; }
  }
  const placeId = c.placeId as EntityId | undefined;
  if (placeId && (placeId === p.workId || placeId === p.homeId)) { add(0.15, 'at_my_place', `it happened at ${world.nameOf(placeId)}`); stake += 0.2; }

  // ---- material stake: does this shortage reach MY trade? Read off world/supply.ts's public
  // table of who makes what out of what — never off a private fact about anyone. A miller who
  // hears the bakery has no flour is not a bystander; nor is the baker who hears the mill has no
  // grain, because that is his flour a day from now.
  if (resource) {
    if (tradeNeeds(p.occupation, resource)) { add(0.3, 'livelihood', `I cannot work without ${resource} either`); stake += 0.4; }
    if (tradeMakes(p.occupation, resource)) { add(0.22, 'supplier', `${resource} is what my trade puts out`); stake += 0.25; }
  }
  if (making && tradeNeeds(p.occupation, making)) { add(0.25, 'downstream', `${making} is what my own work runs on`); stake += 0.35; }

  // ---- what I have separately concluded about this event (mind/inference.ts). A beating I never
  // witnessed, done to somebody I barely knew, is a different matter to me once I believe it is
  // the reason my own trade has stopped.
  if (ctx?.materialStake) {
    add(Math.min(0.4, ctx.materialStake * 0.5), 'materially_affected', ctx.reason ?? 'this is why my own living stopped');
    stake += Math.min(0.5, ctx.materialStake);
  }

  if (!roles.length) { roles.push('bystander'); reasons.push('it did not touch me'); }

  // ---- traits: an honest person weighs wrongdoing more; a cowardly one weighs danger more.
  if (crime) weight += (p.traits.honesty - 0.5) * 0.12;
  if (crime && actorId) weight += (0.5 - p.traits.courage) * 0.08;

  // ---- epistemics: a half-believed third-hand rumour does not land like something you saw.
  const provenance = k.confidence * (k.source.type === 'witnessed' || k.source.type === 'self' ? 1 : k.source.type === 'heard' ? 0.85 : 0.8);
  const hopPenalty = 1 - Math.min(0.35, k.hops * 0.12);
  weight *= provenance * hopPenalty;
  if (k.hops > 0) reasons.push(`${k.hops === 1 ? 'second-hand' : `${k.hops} hops away`} (confidence ${k.confidence.toFixed(2)})`);

  return { weight: clamp(weight), roles, reasons, stake: clamp(stake), kind, crime, subjectId, actorId, itemId, resource, placeId };
}

/**
 * Which concerns an appraisal justifies — the single generic mapping from "what this means to
 * me" to "what I now carry around about it". One table, six kinds, no per-event-type handlers.
 * Returned in priority order; `mind/concern.ts` turns them into real `Concern` records.
 */
export interface ConcernProposal { kind: ConcernKind; subjectId?: EntityId; aboutId?: EntityId; itemId?: EntityId; resource?: ItemType; placeId?: EntityId; intensity: number; reasons: string[]; }

export function proposeConcerns(world: World, p: Person, ap: Appraisal): ConcernProposal[] {
  const out: ConcernProposal[] = [];
  const has = (...r: AppraisalRole[]) => r.some(x => ap.roles.includes(x));
  const w = ap.weight;
  if (w < 0.12) return out;

  // WELFARE — someone I have reason to care about has come to harm, or has gone missing from
  // where they should be. Covers spouse, kin, friend, coworker, employer, and the pastoral /
  // healing occupations, through the same rule.
  // Causal Society: `!ap.resource` keeps a MATERIAL disruption out of this rule. That the baker
  // could not bake is not evidence that anything has befallen the baker, and reading it as such
  // would have every stockout generate spurious worry about whoever happened to be on shift.
  if ((ap.kind === 'harm' || ap.kind === 'grief' || (ap.kind === 'disruption' && !ap.resource))
    && ap.subjectId && ap.subjectId !== p.id
    && has('kin_of_subject', 'close_to_subject', 'coworker', 'employer', 'employee', 'neighbour', 'pastoral', 'healer')) {
    out.push({ kind: 'welfare', subjectId: ap.subjectId, aboutId: ap.actorId, intensity: w, reasons: ap.reasons.slice(0, 3) });
  }
  // GRIEF — a death of someone close is its own thing, not merely a welfare concern that can
  // never be discharged.
  if (ap.kind === 'grief' && ap.subjectId && ap.subjectId !== p.id && has('kin_of_subject', 'close_to_subject')) {
    out.push({ kind: 'grief', subjectId: ap.subjectId, intensity: w, reasons: ap.reasons.slice(0, 2) });
  }
  // SAFETY — there is someone about who hurts people, and I have reason to think it could be me
  // or mine next. Gated on `crime` for the same reason JUSTICE is: the watch subduing a bandit
  // is violence, but it is not a reason for ordinary people to start fearing the watch.
  if (ap.crime && ap.kind === 'harm' && ap.actorId && ap.actorId !== p.id
    && has('victim', 'afraid_of_actor', 'kin_of_subject', 'close_to_subject', 'neighbour', 'at_my_place')) {
    out.push({ kind: 'safety', aboutId: ap.actorId, subjectId: ap.subjectId, intensity: w * 0.9, reasons: ap.reasons.slice(0, 2) });
  }
  // JUSTICE — this ought to be answered for. Gated on the belief actually describing a CRIME:
  // `KIND_BY_TYPE` maps every attack to 'harm' (a guard's lawful subdual really does hurt the
  // person subdued, and a bystander may well worry about them), but only a crime is something
  // to be answered for. Without this gate the watch's own lawful arrests generated justice
  // concerns AGAINST the watch — the same conflation `mind/knowledge.ts`'s `isCrime` exists to
  // prevent for beliefs, arriving by a different door.
  if (ap.crime && (ap.kind === 'harm' || ap.kind === 'property')
    && (has('institutional') || has('victim', 'owner', 'kin_of_subject', 'close_to_subject') || (p.traits.honesty > 0.55 && w > 0.3))) {
    out.push({ kind: 'justice', aboutId: ap.actorId, subjectId: ap.subjectId, intensity: w * (has('institutional') ? 1 : 0.8), reasons: ap.reasons.slice(0, 2) });
  }
  // PROPERTY — something of mine is gone.
  if ((ap.kind === 'property' || ap.kind === 'loss') && has('victim', 'owner')) {
    out.push({ kind: 'property', subjectId: p.id, aboutId: ap.actorId, itemId: ap.itemId, intensity: w, reasons: ap.reasons.slice(0, 2) });
  }
  // BROKEN RESPONSIBILITY — someone took on work for me and did not do it. The consequence is a
  // WORK concern (the thing still needs doing, and now I am the one short-handed), never a
  // justice concern: a broken promise is not a crime and must not send anyone toward the watch or
  // toward the person who broke it. Same discipline as the JUSTICE gate directly above.
  if (ap.kind === 'obligation' && ap.subjectId === p.id && ap.actorId && ap.actorId !== p.id) {
    out.push({ kind: 'work', subjectId: ap.actorId, intensity: w * 0.7, reasons: ap.reasons.slice(0, 2) });
  }
  // WORK — the work I depend on, or that depends on me, has been disturbed. Same `!ap.resource`
  // discipline as WELFARE above: a shortage is not short-handedness, and it has its own kind.
  if (((ap.kind === 'disruption' && !ap.resource) || ap.kind === 'harm') && has('coworker', 'employer', 'employee') && ap.subjectId !== p.id) {
    out.push({ kind: 'work', subjectId: ap.subjectId, intensity: w * 0.85, reasons: ap.reasons.filter(r => /work|roof/i.test(r)).slice(0, 2) });
  }
  // SUPPLY — the material I depend on is not to be had. Deliberately gated on a real STRUCTURAL
  // stake rather than on merely having heard about it: the whole village learning that the mill
  // is idle must not put the whole village to work on flour. Whoever the shortage actually
  // reaches — the one it stopped, the ones who work there, the trade that needs it, the trade
  // that should have supplied it — is exactly who ends up carrying it.
  if (ap.kind === 'disruption' && ap.resource
    && has('victim', 'livelihood', 'downstream', 'supplier', 'coworker', 'employer', 'employee', 'at_my_place')) {
    // A supply worry's reasons must be about the MATERIAL. The appraisal's own reason list is
    // ordered by how the weight was arrived at, and for a colleague's stoppage that leads with
    // the colleague ("Mara is my child") — true, and a completely misleading account of why this
    // person is worried about flour. So the material fact is stated first, and only the reasons
    // that actually bear on it are kept after it.
    const where = ap.placeId ? ` at ${world.nameOf(ap.placeId)}` : '';
    const material = new RegExp(`\\b${ap.resource}\\b`);
    out.push({
      kind: 'supply', resource: ap.resource, placeId: ap.placeId, subjectId: ap.subjectId,
      intensity: w,
      reasons: [`there is no ${ap.resource}${where}`, ...ap.reasons.filter(r => material.test(r) || /happened at|work at/.test(r))].slice(0, 3),
    });
  }
  return out;
}
