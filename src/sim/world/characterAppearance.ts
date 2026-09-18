import {
  FRAME_BUILD, OCCUPATION_CUES, STATURE_HEIGHT, STATUS_RANK,
  appearanceFromTraits, greyedHairColor, nearestGarmentPalette, nearestHairColor, nearestSkinTone,
  statusForMeans, wearableSilhouettes,
} from '../core/appearance';
import type {
  AppearanceDescription, BodyFrameId, GarmentStatusId, HairStyleId, PresentationId, StatureId,
} from '../core/appearance';
import { individualRng } from '../core/human';
import type { RNG } from '../core/rng';
import type { Appearance, Occupation } from '../core/types';
import {
  archetypeWeight, childFallbackArchetypes, fittingArchetypes, ARCHETYPES_BY_ID,
} from './characterArchetypes';
import type { CharacterArchetype } from './characterArchetypes';

/**
 * Procedural embodied appearance: how one canonical person gets a look.
 *
 * Three rules hold this together, and they are the reason a village of a hundred people can be
 * visually distinct without anybody authoring a hundred characters:
 *
 * 1. **Archetype is family, not costume.** The reference sheets supply stylistic families
 *    (world/characterArchetypes.ts). A person is assigned one; what they actually wear inside it
 *    is decided by their station and their trade.
 * 2. **Variation is individual, not random.** Every draw comes from `individualRng(seed,
 *    identity)` — a stream keyed to this one person, forked off the world seed and never shared.
 *    It consumes no world RNG, so adding appearance variation cannot perturb a single behavioural
 *    outcome, and the same person in the same world always looks the same.
 * 3. **Authored beats generated, and the description follows the authored value.** A named
 *    character may pin exact colours; when they do, the structured token is snapped to whatever
 *    they pinned, so `traits` never describes a person who isn't there.
 */

export const DEFAULT_CULTURE = 'ashford';

export interface AppearanceResolution {
  /** World seed. Together with `identity` this fixes the whole result. */
  seed: number;
  /** Stable per-person identity: a `slug` where one exists, otherwise the entity id. */
  identity: string;
  age: number;
  gender: 'm' | 'f';
  occupation: Occupation;
  /** Canonical means at generation time. Decides the clothing register, nothing else. */
  wealth: number;
  /**
   * The means this person is actually dressed out of, when their own purse is not it — a child's
   * household. Falls back to `wealth`.
   */
  means?: number;
  culture?: string;
  /** Force a specific stylistic family (named characters, tests, future culture placement). */
  archetype?: string;
  /**
   * Extra entropy from the caller's own generator, for callers that want residents of different
   * settlements to differ even where identity strings collide. Optional and never required for
   * determinism: the same salt is reproduced by the same world generation.
   */
  salt?: number;
  /** Authored colour/scale pins. Always win over the generated value.  */
  authored?: Partial<Appearance>;
}

/** Wear per clothing register, before trade and individual variation. */
const STATUS_WEAR: Record<GarmentStatusId, number> = {
  destitute: 0.85, poor: 0.62, modest: 0.42, comfortable: 0.26, affluent: 0.13, noble: 0.05,
};
/** Trades that visibly wear clothes out. Derived from occupation, not stored as its own fact. */
const LABOURING: ReadonlySet<string> = new Set(['smith', 'farmer', 'woodcutter', 'miller', 'hunter', 'baker', 'apprentice', 'vagrant', 'bandit']);
/** Hair a child is not put in. A nine-year-old is not a shaved ascetic or a topknotted retainer. */
const ADULT_ONLY_HAIR: ReadonlySet<HairStyleId> = new Set<HairStyleId>(['shaved', 'topknot', 'warrior_bun', 'updo_ornamented']);

const FRAME_ORDER: BodyFrameId[] = ['slight', 'lean', 'average', 'sturdy', 'powerful', 'heavy'];
const STATURE_ORDER: StatureId[] = ['short', 'below_average', 'average', 'above_average', 'tall'];
/** Assumed household means for a child whose caller did not supply the household's own. */
export const CHILD_MEANS_FLOOR = 26;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
function step<T>(order: T[], value: T, by: number): T {
  const index = order.indexOf(value);
  if (index < 0) return value;
  return order[Math.max(0, Math.min(order.length - 1, index + by))];
}

/**
 * How grown a body is, as a multiplier on the adult stature/frame this person will have. Keeping
 * growth separate from stature is what lets `stature: 'tall'` mean "tall for their age" on a
 * child and still mean "tall" on the adult they become.
 */
export function growthScaleFor(age: number): { height: number; build: number } {
  if (age >= 18) return { height: 1, build: 1 };
  const t = clamp01(Math.max(0, age) / 18);
  return { height: 0.34 + 0.66 * t, build: 0.55 + 0.45 * t };
}

function weightedArchetype(rng: RNG, candidates: CharacterArchetype[], occupation: Occupation): CharacterArchetype {
  const total = candidates.reduce((sum, a) => sum + archetypeWeight(a, occupation), 0);
  let draw = rng.next() * total;
  for (const candidate of candidates) {
    draw -= archetypeWeight(candidate, occupation);
    if (draw < 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

/** Which stylistic family this person belongs to, and why. Exported for traces and tests. */
export function selectArchetype(rng: RNG, o: { culture: string; gender: 'm' | 'f'; age: number; occupation: Occupation; archetype?: string }): CharacterArchetype {
  const forced = o.archetype ? ARCHETYPES_BY_ID.get(o.archetype) : undefined;
  if (forced) return forced;
  const fitting = fittingArchetypes(o.culture, o.gender, o.age);
  const candidates = fitting.length ? fitting : childFallbackArchetypes(o.culture, o.gender);
  return weightedArchetype(rng, candidates, o.occupation);
}

function pickLoadout(rng: RNG, options: readonly string[], count: number): string[] {
  if (count <= 0 || !options.length) return [];
  const pool = rng.shuffle([...options]);
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * The structured description of one person, before any authored pin is applied. Pure in its
 * inputs: the rng is the person's own stream, so nothing here depends on generation order.
 */
export function generateAppearanceDescription(rng: RNG, o: AppearanceResolution & { culture: string }): AppearanceDescription {
  const archetype = selectArchetype(rng, { culture: o.culture, gender: o.gender, age: o.age, occupation: o.occupation, archetype: o.archetype });
  const child = o.age < 16;
  const presentation: PresentationId = archetype.presentation.length > 1 && rng.chance(0.15)
    ? archetype.presentation[1] : archetype.presentation[0];

  // A child is dressed out of their household, not out of their own empty purse, and one register
  // below it: hand-me-downs, not a small adult in formal silk. `means` lets a caller that knows
  // the household (demographics.ts passes the parent's) say so; `CHILD_MEANS_FLOOR` is what a
  // child is assumed to be kept at when nobody does.
  const means = child ? Math.max(o.means ?? o.wealth, CHILD_MEANS_FLOOR) : (o.means ?? o.wealth);
  const status = child ? lowerStatus(statusForMeans(means)) : statusForMeans(means);
  const formal = STATUS_RANK[status] >= STATUS_RANK.comfortable;
  const register = formal ? 'dress' : 'work';
  const silhouettes = wearableSilhouettes(formal ? archetype.dressSilhouettes : archetype.workSilhouettes, o.occupation, register);

  const hairStyles = child ? archetype.hairStyles.filter(s => !ADULT_ONLY_HAIR.has(s)) : archetype.hairStyles;
  const baseHair = rng.pick(archetype.hairColors);

  let frame = rng.pick(archetype.frames);
  let stature = rng.pick(archetype.statures);
  if (child) { frame = step(FRAME_ORDER, frame, -1); stature = step(STATURE_ORDER, stature, -1); }
  else if (o.age >= 70) { frame = step(FRAME_ORDER, frame, -1); stature = step(STATURE_ORDER, stature, -1); }
  // Heavy trades build the people who work them; this is the same fact the body already carries.
  else if (LABOURING.has(o.occupation) && o.age >= 20 && rng.chance(0.5)) frame = step(FRAME_ORDER, frame, 1);

  const grooming = clamp01(rng.range(archetype.grooming[0], archetype.grooming[1]) + (STATUS_RANK[status] - 2) * 0.05);
  const wear = clamp01(STATUS_WEAR[status] + (LABOURING.has(o.occupation) ? 0.14 : 0) + rng.range(-0.08, 0.08));

  const accessories = new Set<string>(archetype.coreAccessories);
  for (const item of pickLoadout(rng, archetype.optionalAccessories, Math.max(0, Math.round(STATUS_RANK[status] / 2) + rng.int(0, 1)))) accessories.add(item);
  if (child) { accessories.delete('beard'); accessories.delete('scabbard'); accessories.delete('tattoo_sleeve'); }
  // Facial hair tracks presentation, age and how kempt someone keeps themselves.
  if (!child && presentation === 'masculine' && o.age >= 20 && rng.chance(0.55 - grooming * 0.3)) accessories.add('beard');
  else if (child || presentation === 'feminine') accessories.delete('beard');

  return {
    archetype: archetype.id,
    culture: archetype.culture,
    presentation,
    skinTone: rng.pick(archetype.skinTones),
    faceShape: rng.pick(archetype.faceShapes),
    hairStyle: hairStyles.length ? rng.pick(hairStyles) : 'cropped',
    hairColor: greyedHairColor(baseHair, o.age, rng.next()),
    eyeColor: rng.pick(archetype.eyeColors),
    frame, stature,
    garmentSilhouette: rng.pick(silhouettes),
    garmentPalette: rng.pick(formal ? archetype.dressPalettes : archetype.workPalettes),
    accessories: [...accessories],
    culturalTags: [...archetype.culturalTags],
    grooming, wear, status,
  };
}

function lowerStatus(status: GarmentStatusId): GarmentStatusId {
  const order: GarmentStatusId[] = ['destitute', 'poor', 'modest', 'comfortable', 'affluent', 'noble'];
  return order[Math.max(0, STATUS_RANK[status] - 1)];
}

function nearestBand<T extends string>(order: T[], table: Record<T, number>, value: number): T {
  let best = order[0], bestDistance = Infinity;
  for (const key of order) {
    const distance = Math.abs(table[key] - value);
    if (distance < bestDistance) { bestDistance = distance; best = key; }
  }
  return best;
}

/**
 * Produce the canonical `Appearance` for one person: the structured description plus the realized
 * channels every existing renderer already reads. Callers pass whatever the author pinned; the
 * result keeps those pins exactly and makes the description agree with them.
 */
export function resolveAppearance(o: AppearanceResolution): Appearance {
  const culture = o.culture ?? DEFAULT_CULTURE;
  const rng = individualRng(o.seed ^ ((o.salt ?? 0) >>> 0), `appearance:${o.identity}`);
  const description = generateAppearanceDescription(rng, { ...o, culture });
  const roleCues = OCCUPATION_CUES[o.occupation] ?? [];
  const realized = appearanceFromTraits(description, roleCues);
  const growth = growthScaleFor(o.age);
  realized.height *= growth.height;
  realized.build *= growth.build;

  const authored = o.authored ?? {};
  const appearance: Appearance = {
    skin: authored.skin ?? realized.skin,
    hair: authored.hair ?? realized.hair,
    shirt: authored.shirt ?? realized.shirt,
    pants: authored.pants ?? realized.pants,
    height: authored.height ?? realized.height,
    build: authored.build ?? realized.build,
    hatStyle: authored.hatStyle ?? realized.hatStyle,
    description,
  };
  // A pinned style with no pinned colour still needs something on the head: fall back to the
  // costume family's under-layer, or to the watch's steel for a helm.
  if (appearance.hatStyle !== 'none') appearance.hat = authored.hat ?? realized.hat ?? (appearance.hatStyle === 'helm' ? 0x8a8a90 : appearance.pants);
  const beard = authored.beard ?? realized.beard;
  if (beard !== undefined) appearance.beard = beard;
  const apron = authored.apron ?? realized.apron;
  if (apron !== undefined) appearance.apron = apron;

  // Make the description agree with whatever the author actually pinned. Only pinned channels are
  // snapped: re-deriving an unpinned token from its own weathered output would quietly undo the
  // wear that produced it.
  if (authored.skin !== undefined) description.skinTone = nearestSkinTone(authored.skin);
  if (authored.hair !== undefined) description.hairColor = nearestHairColor(authored.hair);
  if (authored.shirt !== undefined) description.garmentPalette = nearestGarmentPalette(authored.shirt);
  if (authored.height !== undefined) description.stature = nearestBand(STATURE_ORDER, STATURE_HEIGHT, authored.height / growth.height);
  if (authored.build !== undefined) description.frame = nearestBand(FRAME_ORDER, FRAME_BUILD, authored.build / growth.build);
  if (appearance.beard !== undefined) description.accessories = [...new Set([...description.accessories, 'beard'])];
  else description.accessories = description.accessories.filter(a => a !== 'beard');
  if (appearance.apron !== undefined && !roleCues.includes('apron')) description.accessories = [...new Set([...description.accessories, 'apron'])];
  if (authored.hatStyle !== undefined) {
    const worn = { helm: 'helm', hood: 'hood', cap: 'cap', wide: 'wide_hat', none: null }[authored.hatStyle];
    description.accessories = description.accessories.filter(a => !['helm', 'hood', 'cap', 'wide_hat', 'straw_hat', 'travel_hood'].includes(a));
    if (worn && !roleCues.includes(worn)) description.accessories.push(worn);
  }
  return appearance;
}
