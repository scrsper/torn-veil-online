import type { Person, Place, PlaceType, Occupation } from '../../sim/core/types';
import type { RGB } from './geo';
import { mixRGB, rgb, shade } from './geo';

/**
 * The culture seam.
 *
 * The reference art this milestone targets has a strong East-Asian historical-fantasy
 * vocabulary, and this prototype leans into it — but "Japanese" is deliberately NOT a property
 * of Torn Veil's world ontology. The canonical simulation knows about a `house`, a `smith`, a
 * `priest`; it knows nothing about kawara tiles or an obi, and it never will. This file is the
 * one place where that gap is crossed, in two hops:
 *
 *   canonical PlaceType   →  BuildingArchetype  →  CultureId's building style pack
 *   canonical Occupation  →  AttireRole         →  CultureId's attire pack
 *
 * The middle terms are culture-free abstractions: a bakery and a general store are both
 * `vendor` anywhere; a smith and a baker are both `artisan` anywhere. Swapping in a second
 * culture is adding a second pack and a rule for which settlements use it — no simulation
 * change, no renderer change, no new canonical state. `cultureFor` is where that rule would go;
 * today it answers `veil-east` for everything, which is a prototype decision and not an
 * ontological one.
 */

export type CultureId = 'veil-east';

/** What a building IS, independent of who built it. */
export type BuildingArchetype = 'dwelling' | 'vendor' | 'workshop' | 'temple' | 'hall' | 'utility';

/** What a person's dress SIGNIFIES, independent of the culture expressing it. */
export type AttireRole =
  | 'labourer' | 'artisan' | 'merchant' | 'clergy' | 'warrior' | 'gentry' | 'outcast' | 'child' | 'traveler';

/** Which culture presents this place/person. The seam a second style pack would plug into. */
export function cultureFor(_place?: Place | null): CultureId { return 'veil-east'; }

const ARCHETYPE: Record<PlaceType, BuildingArchetype> = {
  house: 'dwelling', hut: 'dwelling', camp: 'dwelling',
  store: 'vendor', stall: 'vendor', bakery: 'vendor', tavern: 'vendor',
  smithy: 'workshop', mill: 'workshop', sawpit: 'workshop', quarry: 'workshop', construction: 'workshop',
  chapel: 'temple', shrine: 'temple', graveyard: 'temple',
  guardhouse: 'hall',
  farm: 'utility', square: 'utility', well: 'utility', bridge: 'utility', gate: 'utility', wilderness: 'utility',
};
export function archetypeOf(type: PlaceType): BuildingArchetype { return ARCHETYPE[type] ?? 'utility'; }

const ROLE: Record<Occupation, AttireRole> = {
  smith: 'artisan', apprentice: 'artisan', baker: 'artisan', cook: 'artisan', miller: 'artisan',
  innkeeper: 'merchant', server: 'merchant', merchant: 'merchant',
  priest: 'clergy', acolyte: 'clergy',
  guard: 'warrior', captain: 'warrior',
  farmer: 'labourer', woodcutter: 'labourer', hunter: 'labourer', herbalist: 'labourer',
  elder: 'gentry',
  vagrant: 'outcast', bandit: 'outcast',
  child: 'child', traveler: 'traveler',
};
export function roleOf(occupation: Occupation): AttireRole { return ROLE[occupation] ?? 'labourer'; }

/* --------------------------------- building style pack ------------------------------------ */

export interface BuildingStyle {
  /** Roof surface, its ridge caps and the round emblem at the ridge ends. */
  roof: RGB; ridge: RGB; mon: RGB;
  /** Frame and infill: the dark-timber-on-pale-plaster contrast the references are built on. */
  timber: RGB; plaster: RGB; plinth: RGB;
  /** The fabric hung under the entry lintel, and the banner on a pole beside it. */
  curtain: RGB;
  lantern: RGB;
  /** How far the eave oversails the wall, in blocks. Deep eaves are the signature. */
  overhang: number;
  /** How much the eave corners lift, in blocks. Subtle — this is a village, not a palace. */
  cornerLift: number;
  /** Extra height added to the ridge over the canonical roof top, exaggerating the pitch. */
  pitchLift: number;
  engawa: boolean;      // raised plank veranda along the entrance face
  curtainOverDoor: boolean;
  bannerPole: boolean;
  rafterTails: boolean;
  /** A second, smaller roof above the first. Not yet convincing on the shapes this world's
   * generator produces — left off until the tier can be derived from the footprint properly. */
  upperTier: boolean;
  stoneLanterns: boolean;
}

const EAST_BASE: Omit<BuildingStyle, 'engawa' | 'curtainOverDoor' | 'bannerPole' | 'rafterTails' | 'upperTier' | 'stoneLanterns' | 'curtain'> = {
  roof: rgb(0x39414b), ridge: rgb(0x2b323a), mon: rgb(0xc8a24a),
  timber: rgb(0x3a2d22), plaster: rgb(0xd8d0bd), plinth: rgb(0x6e6a63),
  lantern: rgb(0xffc774),
  overhang: 0.66, cornerLift: 0.2, pitchLift: 0.3,
};

/** The presentation of one archetype in one culture. */
export function buildingStyle(_culture: CultureId, archetype: BuildingArchetype): BuildingStyle {
  switch (archetype) {
    case 'dwelling':
      return { ...EAST_BASE, curtain: rgb(0x8c2f2c), engawa: true, curtainOverDoor: true, bannerPole: false, rafterTails: true, upperTier: false, stoneLanterns: false };
    case 'vendor':
      return { ...EAST_BASE, curtain: rgb(0x9c3330), engawa: true, curtainOverDoor: true, bannerPole: true, rafterTails: true, upperTier: false, stoneLanterns: false };
    case 'workshop':
      return { ...EAST_BASE, timber: rgb(0x312619), curtain: rgb(0x2f3a55), engawa: false, curtainOverDoor: true, bannerPole: true, rafterTails: true, upperTier: false, stoneLanterns: false };
    case 'temple':
      return { ...EAST_BASE, roof: rgb(0x333b45), timber: rgb(0x4a3324), mon: rgb(0xd8b25a), curtain: rgb(0x8e2b2c), overhang: 0.85, cornerLift: 0.34, pitchLift: 0.5, engawa: true, curtainOverDoor: true, bannerPole: true, rafterTails: true, upperTier: false, stoneLanterns: true };
    case 'hall':
      return { ...EAST_BASE, timber: rgb(0x33291f), curtain: rgb(0x27324a), engawa: true, curtainOverDoor: true, bannerPole: true, rafterTails: true, upperTier: false, stoneLanterns: true };
    default:
      return { ...EAST_BASE, curtain: rgb(0x7a3330), engawa: false, curtainOverDoor: false, bannerPole: false, rafterTails: true, upperTier: false, stoneLanterns: false };
  }
}

/* ------------------------------------- attire pack ---------------------------------------- */

/**
 * Everything the character renderer needs, derived — deterministically and read-only — from
 * canonical `Person` fields the simulation already maintains: occupation, gender, age, wealth,
 * traits, and the `Appearance` the world generator gave them. No gameplay state was invented to
 * make a person look a particular way, and nothing here is ever written back.
 */
export interface AttireSpec {
  role: AttireRole;
  base: RGB;       // the outer robe
  accent: RGB;     // sash, lining, hem band
  under: RGB;      // collar and under-robe showing at the chest
  trim: RGB;       // metal fittings, emblems
  leather: RGB;
  skin: RGB; hair: RGB; beard: RGB | null;
  build: number; height: number;
  /** garment layers */
  wideSleeves: boolean; sleeveFlare: number;
  robeLength: number;      // 0 = short tunic, 1 = ankle-length robe
  hemBand: boolean;        // contrasting band at the hem of the outer robe
  obiWidth: number;        // 0 disables the sash entirely
  sashTassel: boolean;
  hakama: boolean;         // wide split trousers rather than close leggings
  apron: boolean;
  /** equipment */
  shoulderPlates: boolean; chestPlate: boolean; bracers: boolean;
  monDisc: boolean; scabbard: boolean; strawHat: boolean; hood: boolean;
  hairStyle: 'topknot' | 'bun' | 'long' | 'loose' | 'short' | 'crop';
}

function h(seed: string, salt: number): number {
  let x = salt | 0;
  for (let i = 0; i < seed.length; i++) x = (Math.imul(x, 31) + seed.charCodeAt(i)) | 0;
  x = (x ^ (x >>> 13)) >>> 0; x = Math.imul(x, 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Tight, disciplined palettes: a dark ground, one saturated accent, gold. Per the references. */
const BASES = [0x22242c, 0x2a2119, 0x1e2630, 0x2d2622, 0x1b1f1e, 0x32281f, 0x24202b];
const ACCENTS = [0x8e2b2c, 0x6d2f4d, 0x2f4a6b, 0x7a4a1e, 0x3f5a3a, 0x5a2a38, 0x2f5158];
const UNDERS = [0xd8cfbb, 0xc9bda4, 0xbcb49f, 0xe0d8c4, 0xa89f8c];

export function attireFor(person: Person): AttireSpec {
  const a = person.appearance;
  const role = roleOf(person.occupation);
  const id = person.id;
  const wealth = person.wealth ?? 0;
  const rich = Math.min(1, wealth / 120);
  const female = person.gender === 'f';
  const young = person.age < 16;

  let base = rgb(BASES[Math.floor(h(id, 1) * BASES.length)]);
  let accent = rgb(ACCENTS[Math.floor(h(id, 2) * ACCENTS.length)]);
  const under = rgb(UNDERS[Math.floor(h(id, 3) * UNDERS.length)]);
  // The canonical shirt colour still shows through: it tints the robe rather than being ignored,
  // so a person the world generator dressed in blue is still recognisably that person.
  base = mixRGB(base, rgb(a.shirt), 0.3);
  accent = mixRGB(accent, rgb(a.pants), 0.18);
  const trim = mixRGB(rgb(0x9a7a3a), rgb(0xd8b45c), rich);
  const leather = rgb(0x4a3826);

  const spec: AttireSpec = {
    role, base, accent, under, trim, leather,
    skin: rgb(a.skin), hair: rgb(a.hair), beard: a.beard !== undefined ? rgb(a.beard) : null,
    build: a.build ?? 1, height: a.height ?? 1,
    wideSleeves: true, sleeveFlare: 1,
    robeLength: 0.55, hemBand: true,
    obiWidth: 0.2, sashTassel: false, hakama: false, apron: false,
    shoulderPlates: false, chestPlate: false, bracers: false,
    monDisc: rich > 0.5, scabbard: false, strawHat: false, hood: a.hatStyle === 'hood',
    hairStyle: female ? (h(id, 7) < 0.55 ? 'long' : 'bun') : (h(id, 7) < 0.6 ? 'topknot' : 'crop'),
  };

  switch (role) {
    case 'warrior':
      spec.base = mixRGB(base, rgb(0x1b1e24), 0.45);
      spec.wideSleeves = false; spec.sleeveFlare = 0.35;
      spec.robeLength = 0.5; spec.hakama = true;
      spec.shoulderPlates = true; spec.chestPlate = true; spec.bracers = true;
      spec.obiWidth = 0.22; spec.sashTassel = true; spec.scabbard = true; spec.monDisc = true;
      spec.hairStyle = female ? 'bun' : 'topknot';
      break;
    case 'clergy':
      spec.base = mixRGB(base, rgb(0x38312a), 0.4);
      spec.accent = mixRGB(accent, rgb(0x8e2b2c), 0.6);
      spec.robeLength = 0.95; spec.sleeveFlare = 1.35; spec.obiWidth = 0.16;
      spec.sashTassel = true; spec.monDisc = true;
      spec.hairStyle = person.occupation === 'priest' ? 'crop' : spec.hairStyle;
      break;
    case 'artisan':
      spec.robeLength = 0.34; spec.sleeveFlare = 0.55; spec.apron = true;
      spec.obiWidth = 0.18; spec.bracers = true; spec.hakama = false;
      break;
    case 'merchant':
      spec.robeLength = 0.72; spec.sleeveFlare = 1.15; spec.obiWidth = 0.24;
      spec.sashTassel = true; spec.monDisc = true;
      break;
    case 'labourer':
      spec.robeLength = 0.3; spec.sleeveFlare = 0.45; spec.obiWidth = 0.14;
      spec.strawHat = h(id, 11) < 0.5; spec.hemBand = false;
      break;
    case 'gentry':
      spec.robeLength = 0.92; spec.sleeveFlare = 1.4; spec.obiWidth = 0.22;
      spec.sashTassel = true; spec.monDisc = true; spec.hairStyle = female ? 'bun' : 'topknot';
      break;
    case 'outcast':
      spec.base = mixRGB(base, rgb(0x1a1a18), 0.55);
      spec.accent = shade(accent, 0.6);
      spec.robeLength = 0.48; spec.sleeveFlare = 0.7; spec.hemBand = false;
      spec.hood = true; spec.scabbard = true; spec.obiWidth = 0.13;
      break;
    case 'child':
      spec.robeLength = 0.4; spec.sleeveFlare = 0.9; spec.obiWidth = 0.2;
      spec.hemBand = true; spec.monDisc = false;
      break;
    case 'traveler':
      spec.base = mixRGB(base, rgb(0x27303c), 0.4);
      spec.robeLength = 0.55; spec.sleeveFlare = 0.6; spec.hakama = true;
      spec.obiWidth = 0.2; spec.sashTassel = true; spec.hood = true; spec.scabbard = true;
      spec.bracers = true;
      break;
  }
  if (young) { spec.shoulderPlates = false; spec.chestPlate = false; spec.scabbard = false; }
  if (female && spec.role !== 'warrior') spec.sleeveFlare *= 1.2;
  return spec;
}
