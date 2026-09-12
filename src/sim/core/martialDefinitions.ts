import type { World } from './world';
import type { TechniqueDefinition } from './martialTypes';

const definition = (techniqueId: string, name: string, category: 'strike' | 'evasion', components: string[], complexity: number, proficiency = 0, techniques: string[] = []): TechniqueDefinition => ({
  techniqueId, name, family: 'unarmed', category, components, complexity, revision: 1,
  prerequisites: { proficiency, techniques },
});
/** Small mechanical vocabulary, deliberately independent of animation assets. */
export const UNARMED_TECHNIQUES: Readonly<Record<string, TechniqueDefinition>> = Object.freeze(Object.fromEntries([
  definition('unarmed:straight-punch', 'Straight punch', 'strike', ['align-fist', 'extend-arm', 'recover-guard'], 1),
  definition('unarmed:slip', 'Slip', 'evasion', ['read-line', 'shift-balance', 'recover-guard'], 1),
  definition('unarmed:front-kick', 'Front kick', 'strike', ['single-leg-balance', 'extend-leg', 'recover-stance'], 2, 0.1),
  definition('unarmed:slip-counter', 'Slip counter', 'strike', ['read-line', 'shift-balance', 'extend-arm', 'recover-guard'], 3, 0.35, ['unarmed:slip', 'unarmed:straight-punch']),
].map(d => [d.techniqueId, Object.freeze({ ...d, components: Object.freeze(d.components), prerequisites: Object.freeze({ ...d.prerequisites, techniques: Object.freeze(d.prerequisites.techniques) }) })])));

export function techniqueDefinition(world: World, id: string): TechniqueDefinition | undefined {
  return Object.hasOwn(UNARMED_TECHNIQUES, id) ? UNARMED_TECHNIQUES[id]
    : world.martialDefinitions && Object.hasOwn(world.martialDefinitions, id) ? world.martialDefinitions[id] : undefined;
}
