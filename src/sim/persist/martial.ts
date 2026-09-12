import type { Person } from '../core/types';
import type { World } from '../core/world';
import type { TechniqueDefinition } from '../core/martialTypes';
import { UNARMED_TECHNIQUES } from '../core/martialDefinitions';
import { deserialize, serialize } from './save';

export interface MartialPersistence { version: 1; definitions: Record<string, TechniqueDefinition>; }
export function martialPersistenceState(world: World): MartialPersistence {
  return { version: 1, definitions: structuredClone(world.martialDefinitions ?? {}) };
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const unit = (n: unknown): n is number => finite(n) && n >= 0 && n <= 1;
const id = (n: unknown): n is string => typeof n === 'string' && /^[a-z0-9:_-]+$/.test(n);

/** Pure validator for the eventual save.ts hook; old saves without martial fields work.
 * The ordinary Person spread already persists skills, knowledge, mastery and action data. */
export function validMartialSave(data: any): boolean {
  const payload = data.martialLearning;
  if (payload && (payload.version !== 1 || !payload.definitions || typeof payload.definitions !== 'object' || Array.isArray(payload.definitions))) return false;
  const defs: Record<string, TechniqueDefinition> = payload?.definitions ?? {};
  const known = (key: unknown): key is string => id(key) && (Object.hasOwn(UNARMED_TECHNIQUES, key) || Object.hasOwn(defs, key));
  const events = new Map<string, any>((data.events ?? []).map((e: any) => [e.id, e]));
  for (const [key, d] of Object.entries(defs)) {
    if (!id(key) || Object.hasOwn(UNARMED_TECHNIQUES, key) || !d || d.techniqueId !== key || d.revision !== 1
      || !['unarmed', 'one-handed-blade', 'polearm'].includes(d.family) || !['strike', 'evasion'].includes(d.category)
      || typeof d.name !== 'string' || !finite(d.complexity) || d.complexity < 1 || d.complexity > 8
      || !Array.isArray(d.components) || !d.components.length || !d.components.every(c => typeof c === 'string')
      || !d.prerequisites || !unit(d.prerequisites.proficiency) || !Array.isArray(d.prerequisites.techniques) || !d.prerequisites.techniques.every(known)
      || !d.parentId || !known(d.parentId) || d.parentId === key || !d.creatorId || !d.originEventId || !events.has(d.originEventId)) return false;
    const visited = new Set<string>([key]);
    let parent: string | undefined = d.parentId;
    while (parent && Object.hasOwn(defs, parent)) {
      if (visited.has(parent)) return false;
      visited.add(parent); parent = defs[parent].parentId;
    }
    const origin = events.get(d.originEventId);
    if (origin.actor !== d.creatorId || origin.data?.discovery?.techniqueId !== key) return false;
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

/** Complete callable save path while save.ts remains reserved. The final merge adds
 * martialPersistenceState/validMartialSave/restoreMartialPersistence to its existing path. */
export function serializeMartial(world: World): string {
  const data = JSON.parse(serialize(world));
  data.martialLearning = martialPersistenceState(world);
  if (!validMartialSave(data)) throw new Error('Invalid martial learning state');
  return JSON.stringify(data);
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
export function deserializeMartial(raw: string): ReturnType<typeof deserialize> {
  try {
    const data = JSON.parse(raw); if (!validMartialSave(data)) return null;
    const loaded = deserialize(raw); if (!loaded) return null;
    restoreMartialPersistence(loaded.world, data);
    return loaded;
  } catch { return null; }
}
