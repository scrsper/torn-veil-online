import type { World } from './world';
import type { MartialInput, MartialMotion, MartialStance, TechniqueDefinition } from './martialTypes';
import type { BodyRegion } from './types';

const definition = (techniqueId: string, name: string, category: 'strike' | 'evasion', components: string[], complexity: number, proficiency = 0, techniques: string[] = []): TechniqueDefinition => ({
  techniqueId, name, family: 'unarmed', category, availability: 'learned', components, complexity, revision: 1,
  prerequisites: { proficiency, techniques },
});
/** Small mechanical vocabulary, deliberately independent of animation assets. */
const oldDefinitions = [
  definition('unarmed:straight-punch', 'Straight punch', 'strike', ['align-fist', 'extend-arm', 'recover-guard'], 1),
  definition('unarmed:slip', 'Slip', 'evasion', ['read-line', 'shift-balance', 'recover-guard'], 1),
  definition('unarmed:front-kick', 'Front kick', 'strike', ['single-leg-balance', 'extend-leg', 'recover-stance'], 2, 0.1),
  definition('unarmed:slip-counter', 'Slip counter', 'strike', ['read-line', 'shift-balance', 'extend-arm', 'recover-guard'], 3, 0.35, ['unarmed:slip', 'unarmed:straight-punch']),
];
const movement = (techniqueId: string, name: string, availability: 'innate' | 'learned', input: MartialInput, motion: MartialMotion,
  priority: number, options: { entry?: boolean; stances?: MartialStance[]; endStance?: MartialStance; complexity?: number; proficiency?: number } = {}): TechniqueDefinition => ({
  ...definition(techniqueId, name, ['duck', 'sidestep', 'backstep'].includes(motion) ? 'evasion' : 'strike',
    [motion, availability === 'innate' ? 'crude-recovery' : 'deliberate-recovery'], options.complexity ?? 1, options.proficiency ?? 0),
  availability, category: motion === 'cover' ? 'guard' : ['duck', 'sidestep', 'backstep'].includes(motion) ? 'evasion' : 'strike',
  selection: { input, motion, priority, regions: (['punch', 'shove', 'cover'].includes(motion) ? ['arm', 'torso'] : ['leg', 'torso']) as BodyRegion[],
    stances: options.stances ?? ['neutral', 'guarded', 'extended'], endStance: options.endStance ?? 'guarded', entry: options.entry ?? true },
});
const edge = (techniqueId: string, from: string, to: string, minimumMastery = 0): TechniqueDefinition => ({
  ...definition(techniqueId, `${from.split(':').at(-1)} to ${to.split(':').at(-1)}`, 'strike', ['weight-transfer', 'recover-balance', 'connect-movements'], minimumMastery ? 3 : 1,
    minimumMastery ? 0.25 : 0, [from, to]), category: 'transition', transition: { from, to, minimumMastery },
});
export const INNATE_TECHNIQUE_IDS = Object.freeze([
  'motor:basic-punch', 'motor:second-punch', 'motor:crude-kick', 'motor:shove', 'motor:cover', 'motor:duck', 'motor:sidestep', 'motor:backstep',
]);
export const UNARMED_TECHNIQUES: Readonly<Record<string, TechniqueDefinition>> = Object.freeze(Object.fromEntries([
  ...oldDefinitions,
  movement('motor:basic-punch', 'Basic punch', 'innate', 'Light', 'punch', 10),
  movement('motor:second-punch', 'Another basic punch', 'innate', 'Light', 'punch', 9),
  movement('motor:crude-kick', 'Crude kick', 'innate', 'Heavy', 'kick', 10, { endStance: 'extended' }),
  movement('motor:shove', 'Shove', 'innate', 'Heavy', 'shove', 5),
  movement('motor:cover', 'Basic cover', 'innate', 'Light', 'cover', 4),
  movement('motor:duck', 'Duck', 'innate', 'Duck', 'duck', 10, { endStance: 'crouched', stances: ['neutral', 'guarded', 'extended', 'crouched'] }),
  movement('motor:sidestep', 'Sidestep', 'innate', 'Dodge', 'sidestep', 10, { stances: ['neutral', 'guarded', 'extended', 'crouched'] }),
  movement('motor:backstep', 'Backstep', 'innate', 'Dodge', 'backstep', 9, { stances: ['neutral', 'guarded', 'extended', 'crouched'] }),
  movement('unarmed:jab', 'Jab', 'learned', 'Light', 'punch', 20),
  movement('unarmed:cross', 'Cross', 'learned', 'Light', 'punch', 18, { endStance: 'extended' }),
  movement('unarmed:low-kick', 'Basic low kick', 'learned', 'Heavy', 'kick', 20),
  movement('unarmed:basic-guard', 'Basic guard', 'learned', 'Light', 'cover', 18),
  edge('unarmed:jab-to-cross', 'unarmed:jab', 'unarmed:cross'),
  edge('unarmed:cross-to-low-kick', 'unarmed:cross', 'unarmed:low-kick'),
  edge('unarmed:step-to-jab', 'motor:sidestep', 'unarmed:jab'),
  movement('unarmed:hook', 'Hook', 'learned', 'Light', 'punch', 19, { complexity: 2, proficiency: 0.15 }),
  movement('unarmed:feint-counter', 'Feint counter', 'learned', 'Heavy', 'punch', 25, { complexity: 4, proficiency: 0.35, entry: false }),
  edge('unarmed:cross-to-feint-counter', 'unarmed:cross', 'unarmed:feint-counter', 0.35),
].map(d => [d.techniqueId, Object.freeze({ ...d, components: Object.freeze(d.components),
  selection: d.selection ? Object.freeze({ ...d.selection, regions: Object.freeze(d.selection.regions), stances: Object.freeze(d.selection.stances) }) : undefined,
  transition: d.transition ? Object.freeze(d.transition) : undefined,
  prerequisites: Object.freeze({ ...d.prerequisites, techniques: Object.freeze(d.prerequisites.techniques) }) })])));

export function techniqueDefinition(world: World, id: string): TechniqueDefinition | undefined {
  return Object.hasOwn(UNARMED_TECHNIQUES, id) ? UNARMED_TECHNIQUES[id]
    : world.martialDefinitions && Object.hasOwn(world.martialDefinitions, id) ? world.martialDefinitions[id] : undefined;
}
