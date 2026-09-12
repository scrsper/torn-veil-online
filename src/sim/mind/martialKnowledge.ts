import type { KnowledgeItem, Person, Source, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import type { MartialState, TechniqueDefinition } from '../core/martialTypes';
import { techniqueDefinition } from '../core/martialDefinitions';
import { skillOf } from '../core/skills';
import { clamp, cognitiveCapability } from '../core/human';
import { getPhysicalCapability } from '../core/attributes';
import { learn } from './knowledge';

export const martialKey = (id: string): string => `martial:${id}`;
export function martialState(p: Person): MartialState {
  return p.martial ??= { mastery: {}, creditedThrough: 0 };
}
export function masteryOf(p: Person, id: string): number { return p.martial?.mastery[id]?.value ?? 0; }
export function techniqueKnowledge(p: Person, id: string): KnowledgeItem | undefined {
  const k = p.knowledge[martialKey(id)];
  return k?.kind === 'technique' && k.claim.martialTechnique === id ? k : undefined;
}
export function knowsTechnique(p: Person, id: string): boolean {
  const k = techniqueKnowledge(p, id);
  return !!k && Number.isFinite(k.claim.understanding) && k.claim.understanding >= 0.6 && k.confidence >= 0.4;
}
/** Mechanics may validate prerequisites against canonical definitions; this never teaches
 * the definition, prerequisites or a lineage to the mind doing the action. */
export function physicallyAvailableTechnique(world: World, p: Person, d: TechniqueDefinition, bodyId?: string): boolean {
  return p.alive && (bodyId ? [bodyId] : p.bodies).some(id => {
    const b = world.body(id);
    return p.bodies.includes(id) && b?.ownerId === p.id && b.present && !b.dead && b.shape === 'humanoid'
      && b.subduedUntil <= world.physicalTime && getPhysicalCapability(p, world, { body: b }).currentExertionCapacity > 0.1
      && (d.selection?.regions ?? ['arm', 'leg', 'torso']).every(region => (b.injuries?.[region as 'arm' | 'leg' | 'torso'] ?? 0) < 0.85);
  });
}
export function canExecuteTechnique(world: World, p: Person, id: string, bodyId?: string): boolean {
  const d = techniqueDefinition(world, id);
  return !!d && physicallyAvailableTechnique(world, p, d, bodyId)
    && (d.availability === 'innate' || (knowsTechnique(p, id) && skillOf(p, d.family) >= d.prerequisites.proficiency
      && d.prerequisites.techniques.every(parent => {
        const prerequisite = techniqueDefinition(world, parent);
        return prerequisite?.availability === 'innate' ? physicallyAvailableTechnique(world, p, prerequisite, bodyId) : knowsTechnique(p, parent);
      })));
}
/** The supplied claim is the actual communicated/read/observed content, not a lookup of
 * canonical truth. All routes use ordinary KnowledgeItem merge/source/retention behavior. */
export function learnTechnique(world: World, p: Person, claim: Record<string, any>, confidence: number, source: Source, hops = 0): KnowledgeItem | null {
  if (typeof claim.martialTechnique !== 'string' || !Number.isFinite(claim.understanding)
    || !Number.isFinite(confidence) || (source.type !== 'prior' && (!source.viaEvent || !world.event(source.viaEvent)))) return null;
  return learn(world, p, { key: martialKey(claim.martialTechnique), kind: 'technique', claim: structuredClone(claim),
    confidence: clamp(confidence, 0, 1), source, hops, cause: source.viaEvent,
    summary: `Understanding of ${claim.martialTechnique}` });
}
/** Authored/regression background only. Runtime learning routes never call this. */
export function seedMartialBackground(world: World, p: Person, id: string, proficiency: number, mastery: number): void {
  const d = techniqueDefinition(world, id); if (!d) throw new Error(`Unknown technique ${id}`);
  if (d.availability === 'innate') throw new Error('Innate motor availability must not be seeded as learned knowledge');
  learnTechnique(world, p, definitionClaim(d, 0.9), 0.9, { type: 'prior' });
  Object.assign(p.skills, { [d.family]: clamp(proficiency, 0, 1) });
  martialState(p).mastery[id] = { value: clamp(mastery, 0, 1), seconds: 0 };
}
export function definitionClaim(d: TechniqueDefinition, understanding: number): Record<string, any> {
  return { martialTechnique: d.techniqueId, name: d.name, family: d.family, components: [...d.components], complexity: d.complexity,
    parentId: d.parentId, originEventId: d.originEventId, creatorId: d.creatorId,
    transition: d.transition ? structuredClone(d.transition) : undefined, understanding, significance: 0.65 };
}

/** A completed visible action exposes motion, not its practitioner's private teacher,
 * lineage, prerequisites or mental model. Caller is the canonical physical producer. */
export function demonstratedClaim(p: Person, id: string): Record<string, any> | undefined {
  const k = techniqueKnowledge(p, id); if (!k) return;
  return { martialTechnique: id, family: k.claim.family, complexity: k.claim.complexity,
    components: structuredClone(k.claim.components ?? []), significance: 0.55 };
}
/** Only an ordinary recorded sighting of a recent completed demonstration can teach.
 * A per-belief chronological watermark makes observations non-replayable, including saves. */
export function observeTechnique(world: World, observer: Person, eventId: string): KnowledgeItem | null {
  const ev = world.event(eventId), claim = ev?.data.martialDemonstration;
  if (!ev || !claim || !observer.alive || ev.actor === observer.id || world.now - ev.tick > 60
    || ev.tick > world.now || !ev.perceivedBy.some(v => v.who === observer.id && v.how === 'saw')) return null;
  const old = techniqueKnowledge(observer, claim.martialTechnique);
  if (old && (old.claim.observedThrough ?? -1) >= ev.tick) return null;
  const quality = clamp(Number(ev.data.feedback ?? 0), 0, 1);
  if (!(quality > 0)) return null;
  const gain = Math.min(0.22, 0.16 * quality * cognitiveCapability(observer).observation / Math.sqrt(Math.max(1, claim.complexity ?? 1)));
  const understanding = Math.min(0.75, (old?.claim.understanding ?? 0) + gain);
  // Never overwrite a better taught/read understanding with a fleeting observation.
  if (old && old.claim.understanding >= understanding) return null;
  return learnTechnique(world, observer, { ...old?.claim, ...structuredClone(claim), understanding, observedThrough: ev.tick, eventId: ev.id },
    Math.min(0.75, 0.35 + understanding * 0.5), { type: 'witnessed', from: ev.actor, viaEvent: ev.id });
}
export function instructionClaim(teacher: Person, id: string, event: WorldEvent): Record<string, any> | undefined {
  const k = techniqueKnowledge(teacher, id);
  return k ? { ...structuredClone(k.claim), teacherId: teacher.id, eventId: event.id,
    understanding: Math.min(0.85, k.claim.understanding), instruction: true } : undefined;
}
