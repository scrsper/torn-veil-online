/**
 * Canonical persistent appearance traits.
 *
 * `Appearance` (core/types.ts) has always carried the *realized* projection channels a renderer
 * consumes directly — a skin colour, a shirt colour, a height multiplier. Those are useful and
 * every renderer already reads them, but they are the bottom of the pipeline: nothing above them
 * says WHY a person looks the way they do, so nothing can vary them meaningfully, age them,
 * re-dress them for a new station, or recognise two people as belonging to the same stylistic
 * family.
 *
 * `AppearanceTraits` is that missing layer: the structured, human-readable description of a
 * person's persistent look. It is canonical simulation data (it lives on the Person, it is
 * persisted, it survives reload), and it is deliberately renderer-neutral — tokens like
 * `'layered_kimono'` or `'warrior_bun'`, never mesh paths, material names or blueprint handles.
 * Each projection layer (Three.js in `src/game/`, Unreal in `unreal/`) owns its own mapping from
 * these tokens to whatever assets it actually has. See docs/CHARACTER_APPEARANCE_PIPELINE.md.
 *
 * Two deliberate boundaries:
 *
 * - Traits are the description; the numeric colour/scale fields on `Appearance` are the realized
 *   value. `appearanceFromTraits` derives the latter from the former, so procedurally generated
 *   people have exactly one authoring source. An authored character (docs/cast, a named NPC) may
 *   still pin an exact colour; in that case `nearestSkinTone`/`nearestHairColor` snap the token
 *   to whatever the realized colour actually is, so the two can never quietly disagree.
 * - Anything derivable from other canonical state is NOT stored here. Age presentation comes from
 *   `Person.age` and role cues come from `Person.occupation`, both computed at projection time by
 *   `projectAppearanceTraits` — storing them would be a second representation of a fact that is
 *   already canonical, and it would leave a person visually frozen at the age they were generated.
 */

export type SkinToneId = 'porcelain' | 'pale' | 'fair' | 'warm' | 'tan' | 'olive' | 'bronze' | 'brown' | 'deep';
export type HairColorId = 'black' | 'blue_black' | 'brown' | 'chestnut' | 'auburn' | 'red' | 'ash' | 'blond' | 'honey' | 'grey' | 'silver' | 'white';
export type EyeColorId = 'black' | 'brown' | 'hazel' | 'amber' | 'green' | 'grey' | 'blue' | 'violet';
export type BodyFrameId = 'slight' | 'lean' | 'average' | 'sturdy' | 'heavy' | 'powerful';
export type StatureId = 'short' | 'below_average' | 'average' | 'above_average' | 'tall';
export type FaceShapeId = 'round' | 'oval' | 'square' | 'heart' | 'long' | 'angular';
export type PresentationId = 'feminine' | 'masculine' | 'androgynous';
/** Derived from `Person.age` at projection time — never stored. See `agePresentationFor`. */
export type AgePresentationId = 'child' | 'adolescent' | 'young_adult' | 'adult' | 'middle_aged' | 'elder';
export type HairStyleId =
  | 'shaved' | 'cropped' | 'short_swept' | 'topknot' | 'warrior_bun' | 'tied_back'
  | 'loose_long' | 'wavy_long' | 'braided' | 'twin_braid' | 'updo_ornamented' | 'ponytail' | 'bob' | 'unkempt';
export type GarmentSilhouetteId =
  | 'work_kimono' | 'layered_kimono' | 'formal_kimono' | 'hakama_set' | 'dancer_wrap' | 'travel_coat'
  | 'lamellar_armour' | 'ceremonial_robe' | 'apron_over_tunic' | 'tunic_trousers' | 'ragged_layers' | 'fur_mantle' | 'ascetic_wrap';
/** How well-off the clothes are, not how much coin the person is holding. See `statusForMeans`. */
export type GarmentStatusId = 'destitute' | 'poor' | 'modest' | 'comfortable' | 'affluent' | 'noble';

/**
 * The persistent description of one person's look. Every field is stable across a save/load cycle
 * and across a PIE restart; only an in-world cause should ever change one.
 */
export interface AppearanceTraits {
  /** Which reference archetype this person's look descends from (world/characterArchetypes.ts). */
  archetype: string;
  /** Broad stylistic region this look belongs to, e.g. `'ashford'`. */
  culture: string;
  presentation: PresentationId;
  skinTone: SkinToneId;
  faceShape: FaceShapeId;
  hairStyle: HairStyleId;
  hairColor: HairColorId;
  eyeColor: EyeColorId;
  frame: BodyFrameId;
  stature: StatureId;
  garmentSilhouette: GarmentSilhouetteId;
  /** Names an entry in `GARMENT_PALETTES` — a costume family, not a single colour. */
  garmentPalette: string;
  /** Persistent worn items and markings: `'prayer_beads'`, `'wide_hat'`, `'tattoo_sleeve'`. */
  accessories: string[];
  /** Stylistic family markers a renderer may key off: `'ashford'`, `'festival_silk'`. */
  culturalTags: string[];
  /** 0 = unkempt and filthy, 1 = immaculately turned out. */
  grooming: number;
  /** 0 = new cloth, 1 = threadbare and patched. Darkens and dulls realized garment colour. */
  wear: number;
  status: GarmentStatusId;
}

/**
 * `AppearanceTraits` plus the fields derived from other canonical state at projection time. This
 * is what crosses the bridge to a renderer; it is never stored on the Person.
 */
export interface ProjectedAppearanceTraits extends AppearanceTraits {
  agePresentation: AgePresentationId;
  /** Occupation markers the renderer may dress or prop the character with. */
  roleCues: string[];
}

export const SKIN_TONES: Record<SkinToneId, number> = {
  porcelain: 0xf6e2d2, pale: 0xf0d5c0, fair: 0xe8c4a8, warm: 0xe0b48e, tan: 0xd9a988,
  olive: 0xc99a72, bronze: 0xb98055, brown: 0xa06a45, deep: 0x6b3f2a,
};
export const HAIR_COLORS: Record<HairColorId, number> = {
  black: 0x1a1512, blue_black: 0x141a24, brown: 0x4a2f1a, chestnut: 0x6b3f22, auburn: 0x7a3a22,
  red: 0xa8462a, ash: 0x5a5248, blond: 0xd8b56a, honey: 0xc79a52, grey: 0x9a9a9a, silver: 0xc8ccd4, white: 0xe6e6e6,
};
export const EYE_COLORS: Record<EyeColorId, number> = {
  black: 0x1a1414, brown: 0x4a2a16, hazel: 0x8a6a30, amber: 0xc08a32,
  green: 0x4a7a4a, grey: 0x8a9098, blue: 0x4a6a9a, violet: 0x7a5a9a,
};

export interface GarmentPalette {
  /** The dominant garment colour — realized as `Appearance.shirt`. */
  primary: number;
  /** The under/lower layer — realized as `Appearance.pants` and as hood/cap colour. */
  secondary: number;
  /** Trim, sash, embroidery, apron. Realized as `Appearance.apron` when one is worn. */
  accent: number;
}

/**
 * Costume families. The first eight are read directly off the committed reference sheets in
 * `art/reference/cultures/ashford/characters/`; the rest are the everyday village registers of
 * the same culture, so an ordinary farmer still reads as Ashford rather than as a different world.
 */
export const GARMENT_PALETTES: Record<string, GarmentPalette> = {
  // --- Reference-derived costume families (see world/characterArchetypes.ts for provenance) ---
  festival_crimson: { primary: 0x7a1a24, secondary: 0x1b1418, accent: 0xc9a227 },
  blossom_violet: { primary: 0x5a3a7a, secondary: 0x241826, accent: 0xd88aa8 },
  ronin_charcoal: { primary: 0x22222a, secondary: 0x3a2a24, accent: 0x8a2a2a },
  warlord_gold: { primary: 0x161218, secondary: 0x6a4e14, accent: 0xc9a227 },
  exile_ash: { primary: 0x2c2c30, secondary: 0x4a3c34, accent: 0x8a2f2a },
  desert_rose: { primary: 0x8a2230, secondary: 0x2a1a1c, accent: 0xd4a02a },
  snow_moon: { primary: 0xdfe6f0, secondary: 0x2a3a66, accent: 0x9ec4e8 },
  ascetic_bone: { primary: 0xe6dfcd, secondary: 0x2a2622, accent: 0x8a2a24 },
  // --- Everyday registers of the same culture ---
  indigo_work: { primary: 0x2f3a52, secondary: 0x3a3a38, accent: 0x7a6a4a },
  earth_work: { primary: 0x6a5a3a, secondary: 0x4a3a2a, accent: 0x8a7a50 },
  undyed_hemp: { primary: 0xcfc3a8, secondary: 0x6a5a48, accent: 0x8a7a60 },
  moss_hunt: { primary: 0x3a4a2a, secondary: 0x2a3320, accent: 0x6a5a34 },
  watch_vermilion: { primary: 0x8a2a2a, secondary: 0x3a3a3a, accent: 0x8a8a90 },
  temple_slate: { primary: 0x4a4a58, secondary: 0x2e2e38, accent: 0xb0a070 },
  merchant_plum: { primary: 0x5a2a3a, secondary: 0x2a2432, accent: 0xc0a050 },
  outlaw_soot: { primary: 0x22201e, secondary: 0x2e2422, accent: 0x5a3a2a },
};

/** Realized height multiplier per stature band. Bounded to the historical 0.85..1.10 envelope. */
export const STATURE_HEIGHT: Record<StatureId, number> = {
  short: 0.91, below_average: 0.96, average: 1, above_average: 1.04, tall: 1.09,
};
/** Realized build multiplier per frame band. Bounded to the historical 0.85..1.15 envelope. */
export const FRAME_BUILD: Record<BodyFrameId, number> = {
  slight: 0.87, lean: 0.93, average: 1, sturdy: 1.06, heavy: 1.14, powerful: 1.11,
};

/** Accessories that mean "something is on this person's head", in renderer-facing hat terms. */
const HAT_ACCESSORY: Record<string, 'helm' | 'hood' | 'cap' | 'wide'> = {
  helm: 'helm', hood: 'hood', travel_hood: 'hood', cap: 'cap', wide_hat: 'wide', straw_hat: 'wide',
};

const channel = (colour: number, shift: number) => (colour >> shift) & 0xff;
const compose = (r: number, g: number, b: number) =>
  ((Math.round(Math.max(0, Math.min(255, r))) << 16) | (Math.round(Math.max(0, Math.min(255, g))) << 8) | Math.round(Math.max(0, Math.min(255, b)))) >>> 0;
/** Linear blend in sRGB byte space. Good enough for costume tinting; not a colour-science claim. */
export function mixColour(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return compose(
    channel(a, 16) + (channel(b, 16) - channel(a, 16)) * k,
    channel(a, 8) + (channel(b, 8) - channel(a, 8)) * k,
    channel(a, 0) + (channel(b, 0) - channel(a, 0)) * k);
}

/**
 * Cloth that has been worn, washed and worn again: dulled toward a dusty neutral and darkened,
 * never brightened. This is why a destitute vagrant and a comfortable merchant in the *same*
 * costume family still read as different people at a glance, with no renderer change at all.
 */
export function weatheredColour(colour: number, wear: number): number {
  const w = Math.max(0, Math.min(1, wear));
  return mixColour(colour, 0x6b6558, w * 0.42);
}

/** Squared distance in sRGB byte space — only ever used to rank palette entries against a colour. */
function colourDistance(a: number, b: number): number {
  const dr = channel(a, 16) - channel(b, 16), dg = channel(a, 8) - channel(b, 8), db = channel(a, 0) - channel(b, 0);
  return dr * dr + dg * dg + db * db;
}
function nearestToken<K extends string>(table: Record<K, number>, colour: number, fallback: K): K {
  let best = fallback, bestDistance = Infinity;
  for (const key of Object.keys(table) as K[]) {
    const distance = colourDistance(table[key], colour);
    if (distance < bestDistance) { bestDistance = distance; best = key; }
  }
  return best;
}
/** Snap an authored skin colour onto the nearest schema token so the two cannot disagree. */
export const nearestSkinTone = (colour: number): SkinToneId => nearestToken(SKIN_TONES, colour, 'tan');
export const nearestHairColor = (colour: number): HairColorId => nearestToken(HAIR_COLORS, colour, 'brown');
/** Snap an authored garment colour onto the nearest costume family by its dominant colour. */
export function nearestGarmentPalette(colour: number): string {
  let best = 'earth_work', bestDistance = Infinity;
  for (const [id, palette] of Object.entries(GARMENT_PALETTES)) {
    const distance = colourDistance(palette.primary, colour);
    if (distance < bestDistance) { bestDistance = distance; best = id; }
  }
  return best;
}

/** Bands of `Person.age`. Derived every time it is needed; a person visibly ages for free. */
export function agePresentationFor(age: number): AgePresentationId {
  if (age < 13) return 'child';
  if (age < 18) return 'adolescent';
  if (age < 30) return 'young_adult';
  if (age < 45) return 'adult';
  if (age < 62) return 'middle_aged';
  return 'elder';
}

/**
 * The register of clothing a person's means put them in. Read from wealth at generation time and
 * then held: clothes do not flicker between registers because someone sold a loaf of bread.
 * Nothing reads this back as a measure of wealth — wealth remains the canonical fact.
 */
export function statusForMeans(wealth: number): GarmentStatusId {
  if (wealth < 5) return 'destitute';
  if (wealth < 20) return 'poor';
  if (wealth < 70) return 'modest';
  if (wealth < 160) return 'comfortable';
  if (wealth < 400) return 'affluent';
  return 'noble';
}
/** Ordering used to decide whether a station dresses in its costume family's formal register. */
export const STATUS_RANK: Record<GarmentStatusId, number> = {
  destitute: 0, poor: 1, modest: 2, comfortable: 3, affluent: 4, noble: 5,
};

/** Occupation markers. Orthogonal to archetype: a role is a job, not a stylistic family. */
export const OCCUPATION_CUES: Partial<Record<string, string[]>> = {
  smith: ['apron', 'hammer'], baker: ['apron', 'flour_dust'], cook: ['apron'], innkeeper: ['apron', 'tray'],
  server: ['apron'], apprentice: ['apron'], merchant: ['ledger'], miller: ['apron', 'grain_sack'],
  farmer: ['wide_hat', 'hoe'], woodcutter: ['axe'], hunter: ['hood', 'bow'], herbalist: ['hood', 'satchel'],
  guard: ['helm', 'spear'], captain: ['helm', 'sword'], priest: ['prayer_beads', 'hood'], acolyte: ['prayer_beads'],
  elder: ['walking_staff'], bandit: ['hood'], vagrant: [], traveler: ['travel_pack'], child: [], villager: [],
};

/**
 * Silhouettes a trade has to earn. A costume family offers a range; occupation decides which of
 * that range a given person could actually be wearing, so a merchant does not turn up in lamellar
 * plate and a captain of the watch does not turn up in rags. Anything absent from this table is
 * unrestricted — ordinary working dress is open to everyone.
 */
export const SILHOUETTE_REQUIRES: Partial<Record<GarmentSilhouetteId, readonly string[]>> = {
  lamellar_armour: ['guard', 'captain', 'bandit'],
  ceremonial_robe: ['priest', 'acolyte', 'elder'],
  ascetic_wrap: ['priest', 'acolyte', 'herbalist', 'elder', 'vagrant'],
  dancer_wrap: ['server', 'innkeeper', 'traveler', 'vagrant'],
  ragged_layers: ['vagrant', 'bandit', 'traveler', 'woodcutter'],
  fur_mantle: ['hunter', 'herbalist', 'traveler', 'elder'],
  travel_coat: ['hunter', 'traveler', 'vagrant', 'bandit', 'merchant', 'miller', 'woodcutter', 'guard', 'captain'],
  formal_kimono: ['elder', 'priest', 'captain', 'merchant', 'innkeeper', 'acolyte'],
};
/** Whatever is left when a family's whole range is out of a person's reach. */
const NEUTRAL_SILHOUETTE: Record<'dress' | 'work', GarmentSilhouetteId> = { dress: 'layered_kimono', work: 'work_kimono' };

/** Narrow a family's offered silhouettes to the ones this trade could plausibly be wearing. */
export function wearableSilhouettes(
  offered: readonly GarmentSilhouetteId[], occupation: string, register: 'dress' | 'work',
): GarmentSilhouetteId[] {
  const allowed = offered.filter(id => {
    const required = SILHOUETTE_REQUIRES[id];
    return !required || required.includes(occupation);
  });
  return allowed.length ? allowed : [NEUTRAL_SILHOUETTE[register]];
}

/** Everything a renderer needs that the sim can state without knowing a single asset name. */
export function projectAppearanceTraits(traits: AppearanceTraits, age: number, occupation: string): ProjectedAppearanceTraits {
  const cues = OCCUPATION_CUES[occupation] ?? [];
  return { ...traits, accessories: [...traits.accessories], culturalTags: [...traits.culturalTags],
    agePresentation: agePresentationFor(age), roleCues: [...cues] };
}

/** The realized colour/scale channels every existing renderer already consumes. */
export interface RealizedAppearance {
  skin: number; hair: number; shirt: number; pants: number;
  hat?: number; hatStyle: 'none' | 'helm' | 'hood' | 'cap' | 'wide';
  height: number; build: number; beard?: number; apron?: number;
}

/**
 * Derive the realized channels from the structured description. This is the single place where
 * "what this person is" becomes "what a renderer draws", and it is pure: same traits in, same
 * colours out, on every machine and every reload.
 */
export function appearanceFromTraits(traits: AppearanceTraits, roleCues: readonly string[] = []): RealizedAppearance {
  const palette = GARMENT_PALETTES[traits.garmentPalette] ?? GARMENT_PALETTES.earth_work;
  const hairColour = HAIR_COLORS[traits.hairColor] ?? HAIR_COLORS.brown;
  // A trade's own kit counts as worn without being stored twice: `roleCues` comes from
  // `Person.occupation`, so a baker's apron follows the job rather than the person.
  const worn = [...traits.accessories, ...roleCues];
  const hatAccessory = worn.find(a => HAT_ACCESSORY[a]);
  const hatStyle = hatAccessory ? HAT_ACCESSORY[hatAccessory] : 'none';
  const realized: RealizedAppearance = {
    skin: SKIN_TONES[traits.skinTone] ?? SKIN_TONES.tan,
    // A shaved head still has a scalp, but no hair mesh should read as bright blond stubble.
    hair: traits.hairStyle === 'shaved' ? mixColour(hairColour, SKIN_TONES[traits.skinTone] ?? SKIN_TONES.tan, 0.6) : hairColour,
    shirt: weatheredColour(palette.primary, traits.wear),
    pants: weatheredColour(palette.secondary, traits.wear),
    hatStyle,
    height: STATURE_HEIGHT[traits.stature] ?? 1,
    build: FRAME_BUILD[traits.frame] ?? 1,
  };
  if (hatStyle !== 'none') realized.hat = hatStyle === 'helm' ? 0x8a8a90 : weatheredColour(palette.secondary, traits.wear);
  if (worn.includes('apron')) realized.apron = weatheredColour(palette.accent, Math.min(1, traits.wear * 1.3));
  if (worn.includes('beard')) realized.beard = hairColour;
  return realized;
}

/**
 * Hair loses pigment with age, gradually and individually. `roll` is one draw from the person's
 * own identity stream, so two sixty-year-olds are not obliged to grey together. Applied once, at
 * generation, from canonical age; it only ever moves TOWARD grey, so an authored white-haired
 * priest stays white. Re-applying it as people age during play is future work
 * (docs/CHARACTER_APPEARANCE_PIPELINE.md, "What remains temporary").
 */
export function greyedHairColor(base: HairColorId, age: number, roll: number): HairColorId {
  if (base === 'grey' || base === 'white' || base === 'silver') return base;
  const greying = (age - 38) / 34; // nobody at 38, everybody by 72
  if (greying <= 0 || roll >= Math.min(1, greying)) return base;
  return age >= 62 ? 'white' : 'grey';
}
