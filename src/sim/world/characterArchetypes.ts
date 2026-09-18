import type {
  BodyFrameId, EyeColorId, FaceShapeId, GarmentSilhouetteId, HairColorId, HairStyleId,
  PresentationId, SkinToneId, StatureId,
} from '../core/appearance';
import type { Occupation } from '../core/types';

/**
 * Reference-derived character archetypes.
 *
 * ## What these are
 *
 * The five committed reference sheets in `art/reference/cultures/ashford/characters/` are the
 * only authored visual statement Torn Veil has about what its people look like. This file is the
 * deliberate, hand-written interpretation layer that turns them into structured data the
 * simulation can generate from. There is no image analysis here and there should never be: the
 * sheets were read by a person, and what was read is written down below in editable form.
 *
 * ## What an archetype is NOT
 *
 * An archetype is a *stylistic family*, not a costume and not a character. `shogun` does not mean
 * "this person is a warlord"; it means "this person's look descends from the black-and-gold
 * dragon-silk family on that sheet". Station is a separate axis (`GarmentStatusId`, from means)
 * and role is a third (`OCCUPATION_CUES`, from occupation). That separation is what lets a
 * dirt-poor farmer and a village captain both belong to the `shogun` family and still read as a
 * farmer and a captain — and it is why the five images influence the *whole* population rather
 * than producing five bespoke dead-end NPCs.
 *
 * Each archetype therefore carries two registers:
 * - `dressPalettes` / `dressSilhouettes` — what this family wears when it can afford to.
 * - `workPalettes` / `workSilhouettes` — the same family in everyday working clothes.
 *
 * ## Extending this
 *
 * Adding a culture means adding archetypes with a new `culture` id and, if needed, new palette
 * entries in `core/appearance.ts`. Nothing else in the pipeline is Ashford-specific.
 */

export type ArchetypeId =
  | 'hana' | 'yuki' | 'kaito' | 'shogun' | 'ren' | 'ayami' | 'shiro' | 'ascetic';

export interface ArchetypeFit {
  /** Restrict to these canonical genders. Absent = any. */
  gender?: ('m' | 'f')[];
  minAge?: number;
  maxAge?: number;
  /** Occupations this family is especially at home in; they get `affinityWeight` instead. */
  affinityOccupations?: Occupation[];
  /** Relative likelihood among all archetypes that fit a person at all. */
  weight: number;
  /** Relative likelihood when the person holds one of `affinityOccupations`. */
  affinityWeight: number;
}

export interface CharacterArchetype {
  id: ArchetypeId;
  /** Display name for docs, traces and the editor. Never shown to a player as-is. */
  name: string;
  culture: string;
  /** Repository path of the sheet this was read from. Kept so provenance stays checkable. */
  reference: string;
  /** Which part of that sheet, and what was actually taken from it. */
  referenceNote: string;
  presentation: PresentationId[];
  fits: ArchetypeFit;
  skinTones: SkinToneId[];
  hairColors: HairColorId[];
  eyeColors: EyeColorId[];
  hairStyles: HairStyleId[];
  frames: BodyFrameId[];
  statures: StatureId[];
  faceShapes: FaceShapeId[];
  dressPalettes: string[];
  workPalettes: string[];
  dressSilhouettes: GarmentSilhouetteId[];
  workSilhouettes: GarmentSilhouetteId[];
  /** Worn by everyone in this family — the part that keeps the family recognisable. */
  coreAccessories: string[];
  /** Drawn from to build an individual loadout, so siblings of a family differ. */
  optionalAccessories: string[];
  culturalTags: string[];
  /** Inclusive grooming band this family keeps itself to, before station adjusts it. */
  grooming: [number, number];
}

export const ASHFORD_REFERENCE_DIR = 'art/reference/cultures/ashford/characters';

export const CHARACTER_ARCHETYPES: readonly CharacterArchetype[] = [
  {
    id: 'hana',
    name: 'Hana — festival silk',
    culture: 'ashford',
    reference: `${ASHFORD_REFERENCE_DIR}/hana.png`,
    referenceNote:
      'Full sheet: a warm tan-skinned woman in a crimson-and-black cherry-blossom kimono worn off ' +
      'the shoulder, a wide patterned obi, long wavy honey-blonde hair held with blossom ornaments ' +
      'and beaded drops, heavy gold filigree at throat, ears and ankle, raised sandals, a fox at ' +
      'her side. Taken as the festival/celebrant register of Ashford dress: crimson ground, black ' +
      'under-layer, gold trim, ornamented loose hair.',
    presentation: ['feminine'],
    fits: { gender: ['f'], minAge: 15, affinityOccupations: ['server', 'innkeeper', 'merchant', 'cook'], weight: 10, affinityWeight: 24 },
    skinTones: ['fair', 'warm', 'tan', 'olive', 'bronze'],
    hairColors: ['blond', 'honey', 'chestnut', 'auburn', 'brown'],
    eyeColors: ['amber', 'hazel', 'brown', 'green'],
    hairStyles: ['wavy_long', 'loose_long', 'updo_ornamented', 'braided', 'ponytail'],
    frames: ['slight', 'lean', 'average'],
    statures: ['below_average', 'average', 'above_average'],
    faceShapes: ['heart', 'oval', 'round'],
    dressPalettes: ['festival_crimson', 'blossom_violet'],
    workPalettes: ['earth_work', 'undyed_hemp', 'indigo_work'],
    dressSilhouettes: ['formal_kimono', 'layered_kimono'],
    workSilhouettes: ['work_kimono', 'apron_over_tunic'],
    coreAccessories: ['hair_ornament'],
    optionalAccessories: ['gold_filigree', 'ear_drops', 'waist_cord', 'tassel', 'anklets'],
    culturalTags: ['ashford', 'festival_silk', 'blossom_motif'],
    grooming: [0.6, 0.95],
  },
  {
    id: 'yuki',
    name: 'Yuki — blossom court',
    culture: 'ashford',
    reference: `${ASHFORD_REFERENCE_DIR}/yuki.png`,
    referenceNote:
      'Full sheet: a black-haired woman in a violet-and-pink blossom kimono over a black under-' +
      'layer, red braided cord at the waist, kanzashi hair ornaments with red tassels, gold ' +
      'earrings, a folding fan. Taken as the courtly/performer register: violet ground, pink ' +
      'blossom, red cord, very long straight dark hair, fan in hand.',
    presentation: ['feminine'],
    fits: { gender: ['f'], minAge: 14, affinityOccupations: ['server', 'acolyte', 'merchant', 'herbalist'], weight: 10, affinityWeight: 22 },
    skinTones: ['porcelain', 'pale', 'fair', 'warm', 'tan'],
    hairColors: ['black', 'blue_black', 'brown', 'chestnut'],
    eyeColors: ['brown', 'black', 'amber', 'violet'],
    hairStyles: ['loose_long', 'updo_ornamented', 'twin_braid', 'braided', 'bob'],
    frames: ['slight', 'lean', 'average'],
    statures: ['short', 'below_average', 'average'],
    faceShapes: ['oval', 'heart', 'long'],
    dressPalettes: ['blossom_violet', 'festival_crimson', 'merchant_plum'],
    workPalettes: ['indigo_work', 'undyed_hemp', 'earth_work'],
    dressSilhouettes: ['formal_kimono', 'layered_kimono'],
    workSilhouettes: ['work_kimono', 'apron_over_tunic'],
    coreAccessories: ['hair_ornament'],
    optionalAccessories: ['fan', 'ear_drops', 'waist_cord', 'tassel', 'gold_filigree'],
    culturalTags: ['ashford', 'court_silk', 'blossom_motif'],
    grooming: [0.6, 0.95],
  },
  {
    id: 'kaito',
    name: 'Kaito — young retainer',
    culture: 'ashford',
    reference: `${ASHFORD_REFERENCE_DIR}/kaito.png`,
    referenceNote:
      'Full sheet: a young man with black hair in a loose topknot, dark lamellar shoulder and arm ' +
      'plate over a black patterned kimono, deep red sash and torn banner cloth at the hip, dark ' +
      'scarf at the throat, split sandals, a katana carried high. Taken as the young ' +
      'retainer/watch register: near-black ground, brown leather, one red accent, tied-up hair.',
    presentation: ['masculine'],
    fits: { gender: ['m'], minAge: 14, maxAge: 52, affinityOccupations: ['guard', 'captain', 'apprentice', 'hunter', 'bandit'], weight: 12, affinityWeight: 26 },
    skinTones: ['fair', 'warm', 'tan', 'olive'],
    hairColors: ['black', 'blue_black', 'brown', 'chestnut'],
    eyeColors: ['brown', 'black', 'grey', 'amber'],
    hairStyles: ['topknot', 'warrior_bun', 'tied_back', 'short_swept', 'cropped'],
    frames: ['lean', 'average', 'sturdy'],
    statures: ['average', 'above_average', 'tall'],
    faceShapes: ['angular', 'square', 'oval'],
    dressPalettes: ['ronin_charcoal', 'watch_vermilion', 'warlord_gold'],
    workPalettes: ['indigo_work', 'earth_work', 'ronin_charcoal'],
    dressSilhouettes: ['lamellar_armour', 'hakama_set', 'layered_kimono'],
    workSilhouettes: ['work_kimono', 'tunic_trousers', 'apron_over_tunic'],
    coreAccessories: [],
    optionalAccessories: ['travel_scarf', 'waist_cord', 'scabbard', 'arm_wrap', 'hood'],
    culturalTags: ['ashford', 'retainer', 'lamellar'],
    grooming: [0.45, 0.85],
  },
  {
    id: 'shogun',
    name: 'Shogun — dragon silk',
    culture: 'ashford',
    reference: `${ASHFORD_REFERENCE_DIR}/shogun.png`,
    referenceNote:
      'Full sheet: a heavy-set bearded man, cropped dark hair, an open black kimono with gold ' +
      'dragon and blossom work over a red-lined hakama, thick red waist cord, sleeve tattoos, ' +
      'geta sandals, a katana thrust through the sash. Taken as the authority/elder-strength ' +
      'register: black ground, gold figure work, red lining, powerful build, full beard.',
    presentation: ['masculine'],
    fits: { gender: ['m'], minAge: 26, affinityOccupations: ['smith', 'captain', 'elder', 'woodcutter', 'miller', 'innkeeper'], weight: 11, affinityWeight: 26 },
    skinTones: ['fair', 'warm', 'tan', 'olive', 'bronze'],
    hairColors: ['black', 'brown', 'chestnut', 'grey'],
    eyeColors: ['brown', 'black', 'hazel', 'amber'],
    hairStyles: ['cropped', 'topknot', 'warrior_bun', 'short_swept', 'tied_back'],
    frames: ['sturdy', 'heavy', 'powerful', 'average'],
    statures: ['average', 'above_average', 'tall'],
    faceShapes: ['square', 'angular', 'round'],
    dressPalettes: ['warlord_gold', 'ronin_charcoal', 'merchant_plum'],
    workPalettes: ['earth_work', 'indigo_work', 'undyed_hemp'],
    dressSilhouettes: ['hakama_set', 'layered_kimono', 'formal_kimono'],
    workSilhouettes: ['work_kimono', 'apron_over_tunic', 'tunic_trousers'],
    coreAccessories: ['beard'],
    optionalAccessories: ['tattoo_sleeve', 'waist_cord', 'scabbard', 'tassel'],
    culturalTags: ['ashford', 'dragon_silk', 'authority'],
    grooming: [0.4, 0.8],
  },
  {
    id: 'ren',
    name: 'Ren — exiled swordsman',
    culture: 'ashford',
    reference: `${ASHFORD_REFERENCE_DIR}/-ren-ayami-shiro.png`,
    referenceNote:
      'Panel "NPC 6 — THE RONIN, exiled swordsman" (top right of the four-up sheet): silver-white ' +
      'hair tied back, weathered dark travel armour over layered greys, a hooded cowl, a long red ' +
      'sash and torn red cloth, heavy boots, katana. Taken as the wanderer/outsider register: ' +
      'ash-grey ground, brown leather, one blood-red accent, pale hair, visible wear.',
    presentation: ['masculine', 'androgynous'],
    fits: { gender: ['m'], minAge: 22, affinityOccupations: ['hunter', 'vagrant', 'traveler', 'bandit', 'guard', 'woodcutter'], weight: 9, affinityWeight: 24 },
    skinTones: ['porcelain', 'pale', 'fair', 'warm'],
    hairColors: ['silver', 'white', 'ash', 'grey', 'black'],
    eyeColors: ['grey', 'blue', 'green', 'amber'],
    hairStyles: ['tied_back', 'topknot', 'unkempt', 'ponytail', 'short_swept'],
    frames: ['lean', 'average', 'sturdy'],
    statures: ['average', 'above_average', 'tall'],
    faceShapes: ['angular', 'long', 'square'],
    dressPalettes: ['exile_ash', 'ronin_charcoal', 'outlaw_soot'],
    workPalettes: ['exile_ash', 'moss_hunt', 'earth_work'],
    dressSilhouettes: ['travel_coat', 'lamellar_armour', 'hakama_set'],
    workSilhouettes: ['travel_coat', 'ragged_layers', 'tunic_trousers'],
    coreAccessories: ['travel_scarf'],
    optionalAccessories: ['hood', 'scabbard', 'arm_wrap', 'waist_cord', 'travel_pack', 'beard'],
    culturalTags: ['ashford', 'wanderer', 'weathered'],
    grooming: [0.2, 0.6],
  },
  {
    id: 'ayami',
    name: 'Ayami — desert rose',
    culture: 'ashford',
    reference: `${ASHFORD_REFERENCE_DIR}/-ren-ayami-shiro.png`,
    referenceNote:
      'Panel "NPC 7 — THE DANCER, desert rose" (bottom left of the four-up sheet): deep brown ' +
      'skin, dark hair worked into an ornamented updo, a red-and-gold layered dancer wrap with ' +
      'open drapes, very heavy gold jewellery at brow, throat, arms, waist and ankles. Taken as ' +
      'the travelling-performer register: crimson ground, gold everywhere, bare arms, ornament as ' +
      'the defining silhouette.',
    presentation: ['feminine'],
    fits: { gender: ['f'], minAge: 15, affinityOccupations: ['server', 'traveler', 'vagrant', 'merchant'], weight: 8, affinityWeight: 20 },
    skinTones: ['bronze', 'brown', 'deep', 'olive'],
    hairColors: ['black', 'blue_black', 'brown', 'chestnut'],
    eyeColors: ['brown', 'amber', 'black', 'hazel'],
    hairStyles: ['updo_ornamented', 'braided', 'twin_braid', 'ponytail', 'loose_long'],
    frames: ['slight', 'lean', 'average'],
    statures: ['below_average', 'average', 'above_average'],
    faceShapes: ['heart', 'oval', 'angular'],
    dressPalettes: ['desert_rose', 'festival_crimson'],
    workPalettes: ['earth_work', 'undyed_hemp', 'desert_rose'],
    dressSilhouettes: ['dancer_wrap', 'layered_kimono'],
    workSilhouettes: ['dancer_wrap', 'work_kimono', 'ragged_layers'],
    coreAccessories: ['gold_filigree'],
    optionalAccessories: ['anklets', 'ear_drops', 'hair_ornament', 'waist_cord', 'tassel'],
    culturalTags: ['ashford', 'travelling_troupe', 'gold_ornament'],
    grooming: [0.5, 0.9],
  },
  {
    id: 'shiro',
    name: 'Shiro — snow moon',
    culture: 'ashford',
    reference: `${ASHFORD_REFERENCE_DIR}/-ren-ayami-shiro.png`,
    referenceNote:
      'Panel "NPC 8 — THE KITSUNE, snow moon" (bottom right of the four-up sheet): white hair, ' +
      'very pale skin, a pale blue-and-white kimono with snowflake and blossom work, a heavy ' +
      'white fur mantle, blue-white ornaments. The sheet\'s fox ears and tails are deliberately ' +
      'NOT taken: Torn Veil has no canonical non-human humanoid, and inventing one for a costume ' +
      'would be renderer truth outrunning simulation truth. What is taken is the winter register: ' +
      'pale ground, deep blue accent, white hair, fur.',
    presentation: ['feminine', 'androgynous'],
    fits: { gender: ['f'], minAge: 16, affinityOccupations: ['herbalist', 'acolyte', 'priest'], weight: 6, affinityWeight: 18 },
    skinTones: ['porcelain', 'pale', 'fair'],
    hairColors: ['white', 'silver', 'ash', 'blond'],
    eyeColors: ['blue', 'grey', 'violet', 'amber'],
    hairStyles: ['loose_long', 'updo_ornamented', 'braided', 'tied_back'],
    frames: ['slight', 'lean', 'average'],
    statures: ['below_average', 'average', 'above_average'],
    faceShapes: ['oval', 'heart', 'long'],
    dressPalettes: ['snow_moon', 'temple_slate'],
    workPalettes: ['undyed_hemp', 'temple_slate', 'indigo_work'],
    dressSilhouettes: ['fur_mantle', 'formal_kimono', 'layered_kimono'],
    workSilhouettes: ['work_kimono', 'ceremonial_robe', 'layered_kimono'],
    coreAccessories: [],
    optionalAccessories: ['hair_ornament', 'fur_stole', 'ear_drops', 'hood', 'waist_cord'],
    culturalTags: ['ashford', 'snow_moon', 'winter_silk'],
    grooming: [0.6, 0.95],
  },
  {
    id: 'ascetic',
    name: 'Wandering ascetic',
    culture: 'ashford',
    reference: `${ASHFORD_REFERENCE_DIR}/-ren-ayami-shiro.png`,
    referenceNote:
      'Panel "NPC 5 — THE MONK, wandering ascetic" (top left of the four-up sheet). The sheet\'s ' +
      'filename lists only three of its four names, so this one is keyed by role rather than by a ' +
      'name the reference does not give. Read: shaved head, heavy black beard, extensive dark ' +
      'tattoo work over a powerful build, a cream/bone robe worn off one shoulder over a dark ' +
      'under-layer, red cord, prayer beads, sandals, a ringed staff. Taken as the devotional ' +
      'register: bone ground, near-black under-layer, one red accent, shaved head, beads.',
    presentation: ['masculine', 'androgynous'],
    fits: { gender: ['m'], minAge: 20, affinityOccupations: ['priest', 'acolyte', 'elder', 'herbalist', 'vagrant'], weight: 6, affinityWeight: 22 },
    skinTones: ['warm', 'tan', 'olive', 'bronze', 'brown'],
    hairColors: ['black', 'brown', 'grey', 'chestnut'],
    eyeColors: ['brown', 'black', 'hazel'],
    hairStyles: ['shaved', 'cropped'],
    frames: ['average', 'sturdy', 'powerful', 'lean'],
    statures: ['below_average', 'average', 'above_average'],
    faceShapes: ['square', 'round', 'angular'],
    dressPalettes: ['ascetic_bone', 'temple_slate'],
    workPalettes: ['ascetic_bone', 'undyed_hemp', 'earth_work'],
    dressSilhouettes: ['ascetic_wrap', 'ceremonial_robe'],
    workSilhouettes: ['ascetic_wrap', 'work_kimono', 'ragged_layers'],
    coreAccessories: ['prayer_beads'],
    optionalAccessories: ['tattoo_sleeve', 'beard', 'waist_cord', 'walking_staff'],
    culturalTags: ['ashford', 'devotional', 'ascetic'],
    grooming: [0.35, 0.8],
  },
];

export const ARCHETYPES_BY_ID: ReadonlyMap<string, CharacterArchetype> =
  new Map(CHARACTER_ARCHETYPES.map(a => [a.id, a]));

/**
 * Archetypes a person could plausibly belong to. Children are excluded from every adult family by
 * `minAge` and fall through to `childArchetypes` below, because a nine-year-old in lamellar plate
 * is a bug, not variation.
 */
export function fittingArchetypes(culture: string, gender: 'm' | 'f', age: number): CharacterArchetype[] {
  return CHARACTER_ARCHETYPES.filter(a =>
    a.culture === culture &&
    (!a.fits.gender || a.fits.gender.includes(gender)) &&
    age >= (a.fits.minAge ?? 0) && age <= (a.fits.maxAge ?? 200));
}

/**
 * What a child of this culture wears. A child still belongs to a stylistic family — they are
 * somebody's child, and they will grow into that family's adult register — so the archetype is
 * chosen from the adult set as if they were grown, and only the realized clothing is scaled down
 * to a child's station by the generator. This function supplies the fallback used when no adult
 * family accepts the age at all.
 */
export function childFallbackArchetypes(culture: string, gender: 'm' | 'f'): CharacterArchetype[] {
  const relaxed = CHARACTER_ARCHETYPES.filter(a =>
    a.culture === culture && (!a.fits.gender || a.fits.gender.includes(gender)) && a.hairStyles.some(s => s !== 'shaved'));
  return relaxed.length ? relaxed : [...CHARACTER_ARCHETYPES];
}

export function archetypeWeight(archetype: CharacterArchetype, occupation: Occupation): number {
  return archetype.fits.affinityOccupations?.includes(occupation) ? archetype.fits.affinityWeight : archetype.fits.weight;
}
