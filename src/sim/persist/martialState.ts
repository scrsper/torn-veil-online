import type { Person } from '../core/types';
import type { World } from '../core/world';
import type { TechniqueDefinition } from '../core/martialTypes';
import { UNARMED_TECHNIQUES } from '../core/martialDefinitions';

export interface MartialPersistence { version: 1; definitions: Record<string, TechniqueDefinition>; }
export function martialPersistenceState(world: World): MartialPersistence {
  return { version: 1, definitions: structuredClone(world.martialDefinitions ?? {}) };
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const unit = (n: unknown): n is number => finite(n) && n >= 0 && n <= 1;
const id = (n: unknown): n is string => typeof n === 'string' && /^[a-z0-9:_-]+$/.test(n);

/** Pure validator used by ordinary persistence; old saves without martial fields work.
 * The ordinary Person spread already persists skills, knowledge, mastery and action data. */
export function validMartialSave(data: any): boolean {
  const payload = data.martialLearning;
  if (payload && (payload.version !== 1 || !payload.definitions || typeof payload.definitions !== 'object' || Array.isArray(payload.definitions))) return false;
  const defs: Record<string, TechniqueDefinition> = payload?.definitions ?? {};
  const known = (key: unknown): key is string => id(key) && (Object.hasOwn(UNARMED_TECHNIQUES, key) || Object.hasOwn(defs, key));
  const events = new Map<string, any>((data.events ?? []).map((e: any) => [e.id, e]));
  for (const [key, d] of Object.entries(defs)) {
    if (!id(key) || Object.hasOwn(UNARMED_TECHNIQUES, key) || !d || d.techniqueId !== key || d.revision !== 1
      || !['unarmed', 'one-handed-blade', 'polearm'].includes(d.family) || !['strike', 'evasion', 'guard', 'transition'].includes(d.category)
      || (d.availability !== undefined && d.availability !== 'learned')
      || typeof d.name !== 'string' || !finite(d.complexity) || d.complexity < 1 || d.complexity > 8
      || !Array.isArray(d.components) || !d.components.length || !d.components.every(c => typeof c === 'string')
      || !d.prerequisites || !unit(d.prerequisites.proficiency) || !Array.isArray(d.prerequisites.techniques) || !d.prerequisites.techniques.every(known)
      || !d.parentId || !known(d.parentId) || d.parentId === key || !d.creatorId || !d.originEventId || !events.has(d.originEventId)) return false;
    // New metadata is additive to v1. Missing fields retain the original learned
    // definition semantics; no old saved discovery becomes innate during migration.
    if (d.transition && (!known(d.transition.from) || !known(d.transition.to) || !unit(d.transition.minimumMastery))) return false;
    if (d.selection && (!['Light', 'Heavy', 'Dodge', 'Duck'].includes(d.selection.input)
      || !['punch', 'kick', 'shove', 'cover', 'duck', 'sidestep', 'backstep'].includes(d.selection.motion)
      || !Array.isArray(d.selection.regions) || !d.selection.regions.every(r => ['head', 'torso', 'arm', 'leg'].includes(r))
      || !Array.isArray(d.selection.stances) || !d.selection.stances.every(s => ['neutral', 'guarded', 'extended', 'crouched'].includes(s))
      || !['neutral', 'guarded', 'extended', 'crouched'].includes(d.selection.endStance)
      || typeof d.selection.entry !== 'boolean' || !finite(d.selection.priority))) return false;
    const visited = new Set<string>([key]);
    let parent: string | undefined = d.parentId;
    while (parent && Object.hasOwn(defs, parent)) {
      if (visited.has(parent)) return false;
      visited.add(parent); parent = defs[parent].parentId;
    }
    const origin = events.get(d.originEventId);
    if (origin.actor !== d.creatorId || origin.data?.discovery?.techniqueId !== key) return false;
  }
  for (const b of data.bodies ?? []) {
    const a=b.combatAction;if(!a)continue;
    if(a.techniqueId!==undefined&&!known(a.techniqueId))return false;
    if(a.previousTechniqueId!==undefined&&!known(a.previousTechniqueId))return false;
    if(a.transitionTechniqueId!==undefined){
      if(!known(a.transitionTechniqueId))return false;
      const edge=(UNARMED_TECHNIQUES[a.transitionTechniqueId]??defs[a.transitionTechniqueId])?.transition;
      if(!edge||edge.from!==a.previousTechniqueId||edge.to!==a.techniqueId)return false;
    }
    if(a.learningEventId!==undefined){
      const ev=events.get(a.learningEventId);
      if(!ev||ev.type!=='combat_action'||ev.data?.actionId!==a.id||ev.data?.actorBodyId!==b.id)return false;
    }
    if(a.martialDemonstration!==undefined&&(!a.martialDemonstration||typeof a.martialDemonstration!=='object'
      ||a.martialDemonstration.martialTechnique!==a.techniqueId||!Array.isArray(a.martialDemonstration.components)
      ||!a.martialDemonstration.components.every((c:unknown)=>typeof c==='string')))return false;
  }
  for (const p of data.persons ?? []) {
    for (const family of ['unarmed', 'one-handed-blade', 'polearm']) if (p.skills?.[family] !== undefined && !unit(p.skills[family])) return false;
    const m = p.martial; if (!m) continue;
    if (!finite(m.creditedThrough) || m.creditedThrough < 0 || m.creditedThrough > data.physicalTime
      || !m.mastery || typeof m.mastery !== 'object' || Array.isArray(m.mastery)) return false;
    for (const [key, raw] of Object.entries(m.mastery)) {
      const v = raw as any;
      if (!known(key) || !v || !unit(v.value) || !finite(v.seconds) || v.seconds < 0 || (v.lastEventId && !events.has(v.lastEventId))) return false;
    }
    for (const k of Object.values(p.knowledge ?? {}) as any[]) if (k.claim?.martialTechnique
      && (!unit(k.claim.understanding) || !unit(k.confidence))) return false;
    const s = m.session; if (!s) continue;
    const body = (data.bodies ?? []).find((b: any) => b.id === s.bodyId);
    if (!known(s.techniqueId) || !['practice', 'spar', 'lesson', 'experiment'].includes(s.mode)
      || !body || body.ownerId !== p.id || !p.bodies.includes(body.id) || !events.has(s.originEventId) || s.id !== s.originEventId
      || !finite(s.startedAt) || s.startedAt < 0 || !finite(s.lastPhysicalAt) || s.lastPhysicalAt < s.startedAt || s.lastPhysicalAt > data.physicalTime
      || !finite(s.seconds) || s.seconds < 0 || s.requiredSeconds !== 60 || s.seconds >= s.requiredSeconds
      || !finite(s.effort) || s.effort < 0 || s.effort > s.seconds
      || !p.mind?.plan?.some((a: any) => ['active', 'pending'].includes(a.status) && a.data?.martialSessionId === s.id && a.data?.martial === s.mode)) return false;
    if (s.partnerId) {
      const partner = (data.persons ?? []).find((q: any) => q.id === s.partnerId);
      const partnerBody = (data.bodies ?? []).find((b: any) => b.id === s.partnerBodyId);
      if (!partner || !partnerBody || partnerBody.ownerId !== partner.id || !partner.bodies.includes(partnerBody.id)) return false;
    } else if (s.mode === 'lesson' || s.mode === 'spar') return false;
  }
  return true;
}

export function restoreMartialPersistence(world: World, data: any): void {
  world.martialDefinitions = structuredClone(data.martialLearning?.definitions ?? {});
  for (const raw of data.persons ?? []) {
    const p = world.person(raw.id);
    // Ordinary saves intentionally drop transient plans; a partly paid martial session
    // is resumable canonical labor, so its exact owning plan must survive.
    if (p?.martial?.session) p.mind.plan = structuredClone(raw.mind.plan) as Person['mind']['plan'];
  }
}
