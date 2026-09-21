import type { ProjectedAppearanceDescription } from '../sim/core/appearance';
import type { FoundrySlot } from './catalogue';

/**
 * The Character Foundry manifest: how a canonical description of a person becomes a *request* for
 * physical parts.
 *
 * This file is committed and contains no asset paths, because it is not about any particular
 * content pack. It says things like "this person needs a long, bound, feminine hair asset" — and
 * `resolve.ts` then matches that against whatever the local machine actually installed
 * (`catalogue.ts`). Swapping content packs changes the catalogue and the audit's classification;
 * it should not change one line here.
 *
 * ## Requirements versus preferences
 *
 * A **requirement** is a tag an asset must carry or it is simply wrong for this person — a child's
 * body for a child, a female-cut garment where the pack distinguishes. A **preference** is a tag
 * that makes an asset a better fit but whose absence is survivable. Resolution filters on
 * requirements and ranks on preferences, so a sparse content pack still dresses everybody; it just
 * dresses them more approximately, and says so in its diagnostics.
 *
 * ## Relaxation
 *
 * Each rule carries an ordered `relax` list: requirement tags to drop, one step at a time, when
 * nothing matches. This is what makes a thin pack degrade gracefully instead of leaving a person
 * naked — and each step taken is reported, so "everyone is in the same tunic" shows up as a
 * measurement rather than as a mystery in a screenshot.
 */

export interface SlotRule {
  slot: FoundrySlot;
  /** Tags an asset must have. */
  required: string[];
  /** Tags that rank a candidate higher. */
  preferred: string[];
  /**
   * Tags that disqualify a candidate outright. A preference can only ever say "this would be
   * nicer"; some mismatches are not a matter of degree. Somebody who can afford not to wear
   * tatters does not wear tatters, however well the rest of the asset scores.
   */
  forbidden: string[];
  /** Requirement tags to drop, in order, when nothing matches. */
  relax: string[];
  /** False when a person is incomplete without it (body, head). */
  optional: boolean;
}

/** Presentation -> the cut a pack distinguishes. `unisex` is always acceptable. */
const PRESENTATION_TAG: Record<string, string> = { feminine: 'female', masculine: 'male', androgynous: 'unisex' };

/** Age band -> body/head proportion tag. */
const AGE_TAG: Record<string, string> = {
  child: 'child', adolescent: 'child', young_adult: 'adult', adult: 'adult', middle_aged: 'adult', elder: 'elder',
};

/** Canonical frame -> the build vocabulary content packs actually ship. */
const FRAME_TAG: Record<string, string> = {
  slight: 'slim', lean: 'slim', average: 'average', sturdy: 'muscular', powerful: 'muscular', heavy: 'heavy',
};

/**
 * Canonical garment silhouette -> what the upper and lower body are actually wearing. `robe` means
 * one piece covers both, so the lower slot is skipped; `armor` layers over an upper garment.
 */
interface GarmentShape { upper: string[]; lower: string[]; robe?: string[]; armor?: string[] }
const GARMENT_SHAPE: Record<string, GarmentShape> = {
  work_kimono: { upper: ['kimono', 'work'], lower: ['hakama', 'work'] },
  // Layered and formal dress asks for a *wrapped* lower layer, not a divided one. This is read
  // straight off the reference sheets: the fighting and working figures (kaito, the ronin, the
  // monk) wear pleated hakama, and the layered and ceremonial ones (hana, yuki, the kitsune) wear
  // a single length that falls unbroken to the ankle. Asking both for `hakama` put every woman at
  // a festival in a warrior's trousers.
  layered_kimono: { upper: ['kimono', 'layered'], lower: ['skirt', 'layered'] },
  formal_kimono: { upper: ['kimono', 'formal'], lower: ['skirt', 'formal'] },
  hakama_set: { upper: ['kimono'], lower: ['hakama'] },
  dancer_wrap: { upper: ['wrap', 'light'], lower: ['skirt', 'light'] },
  travel_coat: { upper: ['coat'], lower: ['trousers'] },
  lamellar_armour: { upper: ['tunic'], lower: ['trousers'], armor: ['armor', 'lamellar'] },
  // No `robe` entry on any Ashford silhouette. A one-piece robe is a shape this culture does not
  // wear -- all eight reference figures are dressed in an upper layer over a separate lower one --
  // and requesting one alongside an upper and a lower would resolve all three and stack two
  // garments on the same torso, because `covers` is only honoured from the body entry. The field
  // stays in `GarmentShape` for a culture that does wear one.
  ceremonial_robe: { upper: ['robe', 'formal'], lower: ['robe', 'skirt'] },
  apron_over_tunic: { upper: ['tunic'], lower: ['trousers'] },
  tunic_trousers: { upper: ['tunic'], lower: ['trousers'] },
  // Note: no `rags` tag here. Shape is this table's business and quality is the station's — a
  // modest woodcutter wears rough layered workwear, not a beggar's tatters, and `STATUS_TAG`
  // already contributes `rags` for anyone actually destitute.
  ragged_layers: { upper: ['tunic', 'worn'], lower: ['trousers', 'worn'] },
  fur_mantle: { upper: ['coat', 'fur'], lower: ['trousers'] },
  ascetic_wrap: { upper: ['robe', 'wrap'], lower: ['robe', 'skirt'] },
};
const DEFAULT_GARMENT: GarmentShape = { upper: ['tunic'], lower: ['trousers'] };

/** Canonical hair style -> the shape vocabulary a hair pack ships. */
const HAIR_SHAPE: Record<string, string[]> = {
  shaved: [], cropped: ['short'], short_swept: ['short'], topknot: ['bound', 'topknot'],
  warrior_bun: ['bound', 'bun'], tied_back: ['bound', 'medium'], ponytail: ['bound', 'ponytail'],
  loose_long: ['long', 'loose'], wavy_long: ['long', 'loose', 'wavy'], braided: ['bound', 'braid'],
  twin_braid: ['bound', 'braid'], updo_ornamented: ['bound', 'updo'], bob: ['short', 'loose'],
};

/** Station -> the quality register a pack distinguishes, where it does. */
const STATUS_TAG: Record<string, string> = {
  destitute: 'rags', poor: 'peasant', modest: 'peasant', comfortable: 'common', affluent: 'noble', noble: 'noble',
};

/** Accessory / role-cue token -> what an accessory asset would be tagged. Absent = not realizable. */
export const ACCESSORY_TAG: Record<string, string> = {
  prayer_beads: 'beads', walking_staff: 'staff', scabbard: 'sword', fan: 'fan', travel_pack: 'pack',
  gold_filigree: 'jewelry', hair_ornament: 'hairpin', ear_drops: 'jewelry', fur_stole: 'stole',
  travel_scarf: 'scarf', waist_cord: 'belt', hood: 'hood', helm: 'helm', wide_hat: 'hat',
  hammer: 'hammer', hoe: 'hoe', spear: 'spear', sword: 'sword', bow: 'bow', axe: 'axe',
  satchel: 'satchel', ledger: 'book', tray: 'tray', bread_basket: 'basket', grain_sack: 'sack', apron: 'apron',
};

/** Footwear follows the costume family rather than the trade: sandals with a kimono, boots on the road. */
const FOOTWEAR_TAG: Record<string, string> = {
  work_kimono: 'sandals', layered_kimono: 'sandals', formal_kimono: 'sandals', hakama_set: 'sandals',
  ascetic_wrap: 'sandals', dancer_wrap: 'sandals', ceremonial_robe: 'sandals',
  travel_coat: 'boots', lamellar_armour: 'boots', fur_mantle: 'boots',
  tunic_trousers: 'shoes', apron_over_tunic: 'shoes', ragged_layers: 'shoes',
};

const compact = (values: (string | undefined)[]): string[] => values.filter((v): v is string => !!v);

/**
 * Turn one person's canonical description into a part request per slot. Pure, and deliberately
 * ignorant of what is installed — that is `resolve.ts`'s problem.
 */
export function slotRules(traits: ProjectedAppearanceDescription): SlotRule[] {
  const cut = PRESENTATION_TAG[traits.presentation] ?? 'unisex';
  const age = AGE_TAG[traits.agePresentation] ?? 'adult';
  const frame = FRAME_TAG[traits.frame] ?? 'average';
  const station = STATUS_TAG[traits.status] ?? 'common';
  const garment = GARMENT_SHAPE[traits.garmentSilhouette] ?? DEFAULT_GARMENT;
  const hair = HAIR_SHAPE[traits.hairStyle] ?? ['short'];
  const worn = traits.wear >= 0.6 ? 'worn' : undefined;
  // Quality bounds, both ways round: tatters are only for people with nothing, and a pack's
  // ornate/noble pieces are not handed to someone who could not own them. Both are disqualifying
  // rather than merely unpreferred — this is the rule that stops a settlement sample reading as
  // nonsense role/status combinations.
  const destitute = traits.status === 'destitute' || traits.status === 'poor';
  const wellOff = traits.status === 'affluent' || traits.status === 'noble';
  // `modern` joins them. Ashford is pre-industrial in every reference sheet it has, so a blazer
  // is not a worse match for a farmer than a kosode is -- it is the wrong world. Left as a
  // preference it lost a coin flip and put one resident in a business skirt under her own apron.
  // Disqualifying tags are dropped only after every relaxation step, so a machine whose only
  // installed clothing is modern still dresses the whole settlement, and says that it did.
  const quality = compact([destitute ? undefined : 'rags', wellOff ? undefined : 'noble', 'modern']);
  // A trade's own kit and the person's own accessories both hang off the same slot.
  const carried = [...traits.roleCues, ...traits.accessories]
    .map(token => ACCESSORY_TAG[token]).filter((tag): tag is string => !!tag);
  // In a wrapped costume the sash *is* the belt, and it is requested below whether or not the
  // person's description happens to mention a waist cord. Leaving `belt` in as well resolved the
  // same obi twice and hung two of them on five of the thirty-three residents in the sample.
  const wrapped = garment.upper.includes('kimono') || garment.upper.includes('robe')
    || garment.upper.includes('wrap');
  const accessories = wrapped ? carried.filter(tag => tag !== 'belt') : carried;

  const rules: SlotRule[] = [
    // The body and head are the two parts a person cannot be missing; both relax all the way down
    // to "any body at all" rather than ever resolving to nothing.
    //
    // `placeholder` is the engine's grey template mannequin. Forbidding it is not the same as
    // removing it: `resolveSlot` gives up forbidden tags only after every relaxation step, so a
    // machine whose only installed body is a mannequin still gets one. What it stops is a coin
    // flip against real content — Quinn is as honestly `female`+`slim` as a City Sample body is,
    // the two tie, and the tie-break sent about a third of a settlement to a grey dummy.
    { slot: 'body', required: [age], preferred: compact([cut, frame]), forbidden: ['placeholder'], relax: [age], optional: false },
    { slot: 'head', required: [age], preferred: compact([cut, traits.faceShape, traits.skinTone]), forbidden: ['placeholder'], relax: [age], optional: false },
    ...(hair.length
      ? [{ slot: 'hair' as const, required: [hair[0]], preferred: compact([...hair.slice(1), cut, traits.hairColor]), forbidden: [], relax: [hair[0]], optional: true }]
      : []),
    ...(traits.accessories.includes('beard')
      ? [{ slot: 'facialHair' as const, required: ['beard'], preferred: compact([traits.hairColor]), forbidden: [], relax: ['beard'], optional: true }]
      : []),
  ];

  // A robe covers the body in one piece; anything else dresses the halves separately.
  if (garment.robe) {
    rules.push({ slot: 'robe', required: [garment.robe[0]], preferred: compact([...garment.robe.slice(1), cut, station, worn]), forbidden: quality, relax: [garment.robe[0]], optional: true });
  }
  rules.push(
    { slot: 'upperGarment', required: [garment.upper[0]], preferred: compact([...garment.upper.slice(1), cut, station, worn]), forbidden: quality, relax: [garment.upper[0]], optional: true },
    { slot: 'lowerGarment', required: [garment.lower[0]], preferred: compact([...garment.lower.slice(1), cut, station, worn]), forbidden: quality, relax: [garment.lower[0]], optional: true },
  );
  if (garment.armor) {
    rules.push({ slot: 'armor', required: [garment.armor[0]], preferred: compact([...garment.armor.slice(1), station]), forbidden: quality, relax: [garment.armor[0]], optional: true });
  }
  const footwear = FOOTWEAR_TAG[traits.garmentSilhouette];
  if (footwear) rules.push({ slot: 'footwear', required: [footwear], preferred: compact([station, worn]), forbidden: quality, relax: [footwear], optional: true });

  // The sash is not an ornament somebody might happen to own. Every one of the eight reference
  // figures wears a broad one, and on every one of them it is the brightest thing they have on --
  // it is how this costume is *fastened*. So a wrapped silhouette asks for one directly rather
  // than waiting for a `waist_cord` accessory to turn up in the person's description, and it does
  // not relax: an obi or nothing, never a random belt standing in for one.
  if (wrapped) {
    rules.push({ slot: 'accessory', required: ['obi'], preferred: compact([station, worn]), forbidden: quality, relax: [], optional: true });
  }

  // Accessories resolve independently, so a missing hat never costs somebody their beads.
  for (const tag of [...new Set(accessories)]) {
    rules.push({ slot: 'accessory', required: [tag], preferred: compact([station]), forbidden: quality, relax: [], optional: true });
  }
  return rules;
}

/**
 * Continuous shaping to apply wherever a body mesh exposes morph targets. Named by intent; the
 * resolver only emits the ones a chosen mesh actually has, so a pack without morphs simply gets
 * the discrete mesh choice and the uniform scale, with no missing-parameter warnings.
 */
export function morphIntents(traits: ProjectedAppearanceDescription): Record<string, number> {
  const heavy = { slight: 0, lean: 0.15, average: 0.35, sturdy: 0.55, powerful: 0.6, heavy: 0.85 }[traits.frame] ?? 0.35;
  const muscular = { slight: 0.05, lean: 0.25, average: 0.35, sturdy: 0.7, powerful: 0.9, heavy: 0.5 }[traits.frame] ?? 0.35;
  const tall = { short: 0, below_average: 0.25, average: 0.5, above_average: 0.75, tall: 1 }[traits.stature] ?? 0.5;
  const aged = { child: 0, adolescent: 0.05, young_adult: 0.1, adult: 0.3, middle_aged: 0.6, elder: 0.95 }[traits.agePresentation] ?? 0.3;
  return { heavy, muscular, tall, aged, feminine: traits.presentation === 'feminine' ? 1 : traits.presentation === 'androgynous' ? 0.5 : 0 };
}
