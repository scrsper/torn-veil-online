import type { BodyState } from '../net/messages';

type AppearanceIdentity = Pick<BodyState, 'presentationSex' | 'appearance'>;
type BaseIdentity = AppearanceIdentity & Pick<BodyState, 'bodyId' | 'entityId'> & { presentationSpecies?: string };

/** Canonical sex wins over descriptive presentation; no random sex substitutions. */
export function appearanceBodyPreset(body: AppearanceIdentity): 'female' | 'male' | null {
  if (body.presentationSex === 'f') return 'female';
  if (body.presentationSex === 'm') return 'male';
  const presentation = body.appearance?.description?.presentation;
  return presentation === 'feminine' ? 'female' : presentation === 'masculine' ? 'male' : null;
}

/** Routing contract only. Eligibility is neither asset availability nor artwork approval.
 * Species comes from the host, never a garment tag or invented race mechanic. Humans and
 * elves share the same base; no elf-specific artwork exists, so none is claimed.
 */
export function resolveCharacterBase(body: BaseIdentity) {
  const race = body.presentationSpecies ?? null;
  const bodyPreset = appearanceBodyPreset(body);
  const age = body.appearance?.description?.agePresentation ?? null;
  let variationSeed = 2166136261;
  for (const c of `${body.entityId}\0${body.bodyId}`) variationSeed = Math.imul(variationSeed ^ c.charCodeAt(0), 16777619);
  const reason = race !== 'human' && race !== 'elf' ? 'unsupported-species'
    : !['young_adult', 'adult', 'middle_aged', 'elder'].includes(age ?? '') ? 'not-confirmed-adult'
    : !bodyPreset ? 'unknown-body-preset' : 'eligible';
  return { race, bodyPreset, age, variationSeed: variationSeed >>> 0,
    eligible: reason === 'eligible', reason, elfArtworkSupported: false as const };
}

export type CharacterBaseSelection = ReturnType<typeof resolveCharacterBase>;
/** Studio base only for an eligible selection whose sex actually loaded; otherwise the
 * existing credited fallback, with the exact reason. Never substitutes the other sex. */
export function chooseCharacterPresentation(selection: CharacterBaseSelection, available: readonly ('female' | 'male')[], unavailableReason: string) {
  if (!selection.eligible || !selection.bodyPreset) return { studio: null, fallbackReason: selection.reason };
  if (!available.includes(selection.bodyPreset)) return { studio: null, fallbackReason: unavailableReason === 'loaded' ? `studio-${selection.bodyPreset}-unavailable` : unavailableReason };
  return { studio: selection.bodyPreset, fallbackReason: null };
}
