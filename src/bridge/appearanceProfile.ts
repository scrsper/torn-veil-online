import { projectAppearanceDescription } from '../sim/core/appearance';
import type { ProjectedAppearanceDescription } from '../sim/core/appearance';
import type { Person } from '../sim/core/types';
import { EMPTY_CATALOGUE } from '../foundry/catalogue';
import type { CharacterCatalogue } from '../foundry/catalogue';
import { realizeCharacter } from '../foundry/resolve';
import type { CharacterRealization } from '../foundry/resolve';

/**
 * Presentation envelope for one canonical person's physical realization.
 *
 * Appearance semantics are not invented here. `Person.appearance.description` is the sole answer
 * to "what does this person look like"; `projectAppearanceDescription` adds only fields derived
 * from other canonical state, and the Character Foundry maps that description onto the local
 * machine's audited Unreal catalogue. Asset paths therefore exist only in `realization`, never in
 * canonical simulation state.
 */
export interface AppearanceProfile {
  personId: string;
  bodyId: string;
  description: ProjectedAppearanceDescription;
  realization: CharacterRealization;
  /** Stable content hash used to delta-send the profile to Unreal. */
  signature: string;
}

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Resolve canonical appearance through the one shared Character Foundry resolver.
 *
 * Older saves may legitimately have no structured description. Returning `null` preserves their
 * existing fail-soft mannequin/tint path instead of reverse-engineering a second description from
 * occupation, wealth or identity. The function is pure and never mutates the Person or catalogue.
 */
export function appearanceProfile(
  person: Person,
  bodyId: string,
  catalogue: CharacterCatalogue = EMPTY_CATALOGUE,
  worldSeed = 0,
): AppearanceProfile | null {
  const canonical = person.appearance.description;
  if (!canonical) return null;

  const description = projectAppearanceDescription(canonical, person.age, person.occupation);
  const realization = realizeCharacter({
    entityId: person.id,
    identity: person.slug ?? person.id,
    seed: worldSeed,
    traits: description,
    appearance: {
      skin: person.appearance.skin,
      hair: person.appearance.hair,
      shirt: person.appearance.shirt,
      pants: person.appearance.pants,
      ...(person.appearance.apron !== undefined ? { apron: person.appearance.apron } : {}),
      height: person.appearance.height ?? 1,
      build: person.appearance.build ?? 1,
    },
  }, catalogue);

  const signature = hash(JSON.stringify({ personId: person.id, bodyId, description, realization }));
  return { personId: person.id, bodyId, description, realization, signature };
}
