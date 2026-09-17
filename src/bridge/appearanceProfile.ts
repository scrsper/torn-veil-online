import type { Appearance, Person } from '../sim/core/types';

/**
 * Presentation-side character appearance resolution (Slice 3 Part 1).
 *
 * Canonical simulation owns WHO someone is: `Person.id`, `Person.slug`, species, sex/gender,
 * life stage, occupation, wealth and the canonical `Appearance` colour/scale record. It must
 * never learn that a renderer exists, so nothing here is ever written back into `src/sim/`,
 * and — per the Slice 3 architecture rule — **no engine/marketplace asset path appears in this
 * module or in canonical state**. This layer resolves canonical facts into a *semantic* slot
 * vocabulary (`body_adult_f`, `apron_smith`, `hair_tied_back`, …). A renderer-side catalogue
 * owned by the Unreal project maps those tokens onto whatever character library is actually
 * installed on a given machine; swapping that library changes no canonical state and no code
 * here.
 *
 * Two resolution paths, as required by the slice:
 *
 *   AUTHORED — a person whose `slug` is registered in the presentation catalogue resolves to a
 *   single `characterKey`. The renderer is expected to have a unique modelled character for
 *   that key. Slots are still emitted so an authored character degrades to modular parts when
 *   its bespoke asset is missing.
 *
 *   MODULAR — everyone else resolves to a reusable combination drawn deterministically from
 *   the token pools below.
 *
 * Stability: every variant draw is a pure function of the canonical, save-stable `Person.id`
 * (plus a per-slot salt). No simulation RNG stream is touched — presentation must not perturb
 * canonical determinism — and no state is stored, so the same person resolves to the same
 * appearance before and after a save/reload, in a fresh process, and on another machine.
 */

export type AppearanceSlotKind =
  | 'body' | 'head' | 'hair' | 'facialHair' | 'skin'
  | 'torso' | 'legs' | 'feet' | 'outerwear' | 'headwear' | 'accessory';

/** One resolved semantic slot. `token` is renderer vocabulary, never an asset path. */
export interface AppearanceSlot {
  kind: AppearanceSlotKind;
  token: string;
  /** Canonical colour for this slot where the simulation actually carries one, else undefined. */
  tint?: number;
  /** Which canonical field this slot was derived from — presentation provenance, not cognition. */
  from: string;
}

export type SexPresentation = 'male' | 'female' | 'unspecified';

export interface AppearanceProfile {
  personId: string;
  bodyId: string;
  /** Canonical species. 'human' today; a future species resolves its own token pools. */
  species: string;
  /** Canonical sex/body presentation where the simulation already represents one. */
  sex: SexPresentation;
  lifeStage: string;
  /** Canonical scalar body proportions; the renderer applies them to whichever mesh it picks. */
  height: number;
  build: number;
  /** Set for an AUTHORED character, null for a MODULAR one. */
  characterKey: string | null;
  authored: boolean;
  slots: AppearanceSlot[];
  /** Stable content hash of everything above. The transport sends a full profile only when
   * this changes; the renderer caches its built character against it. */
  signature: string;
}

/** Presentation catalogue of authored characters, keyed by canonical `Person.slug`.
 * Deliberately empty in the repository: an authored character is a real modelled asset, and
 * claiming one that no machine has would be a fabricated appearance. The Unreal project
 * registers the keys it can actually satisfy (see
 * `Content/TornVeil/Presentation/AshfordAppearanceProfiles.json` → `namedOverrides`). */
const authoredCharacters = new Map<string, string>();

export function registerAuthoredCharacter(slug: string, characterKey: string): void {
  authoredCharacters.set(slug, characterKey);
}
export function clearAuthoredCharacters(): void { authoredCharacters.clear(); }
export function authoredCharacterKey(slug: string | null | undefined): string | null {
  return slug ? authoredCharacters.get(slug) ?? null : null;
}

// ---------------------------------------------------------------- deterministic variant draws

/** FNV-1a over `${key}|${salt}`. Deliberately not `sim/core/rng.ts`: presentation must never
 * consume a canonical RNG stream, and this must stay reproducible from the person id alone. */
function variantHash(key: string, salt: string): number {
  let h = 0x811c9dc5;
  const s = `${key}|${salt}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function pick<T>(pool: readonly T[], key: string, salt: string): T {
  return pool[variantHash(key, salt) % pool.length];
}

// ---------------------------------------------------------------- semantic token vocabulary

const HAIR_STYLES = ['short_crop', 'tied_back', 'long_loose', 'braided', 'topknot', 'shaved'] as const;
const FACIAL_HAIR = ['none', 'stubble', 'short_beard', 'full_beard', 'moustache'] as const;
/** Canonical `Appearance.skin` luminance tiers. The exact canonical colour still rides along as
 * `tint`, so the renderer can drive a material parameter rather than snap to a tier. */
const SKIN_TIERS = ['deep', 'brown', 'tan', 'olive', 'light', 'fair'] as const;
const HEAD_VARIANTS = 4;

/** Occupation → work garment + the accessory that reads as the trade at a glance. Only
 * occupations the simulation actually generates appear here; anything else falls through to the
 * wealth-tier tunic, which is the honest answer for a person with no distinguishing dress. */
const OCCUPATION_DRESS: Record<string, { torso: string; accessory?: string; feet?: string }> = {
  smith:      { torso: 'apron_smith',    accessory: 'tool_hammer',   feet: 'boots_work' },
  blacksmith: { torso: 'apron_smith',    accessory: 'tool_hammer',   feet: 'boots_work' },
  baker:      { torso: 'apron_baker',    accessory: 'tool_peel' },
  miller:     { torso: 'apron_dusty',    accessory: 'sack_grain',    feet: 'boots_work' },
  farmer:     { torso: 'tunic_work',     accessory: 'tool_hoe',      feet: 'boots_work' },
  woodcutter: { torso: 'tunic_work',     accessory: 'tool_axe',      feet: 'boots_work' },
  hunter:     { torso: 'jerkin_travel',  accessory: 'bow',           feet: 'boots_travel' },
  guard:      { torso: 'gambeson_guard', accessory: 'spear',         feet: 'boots_travel' },
  captain:    { torso: 'gambeson_officer', accessory: 'sword',       feet: 'boots_travel' },
  merchant:   { torso: 'coat_merchant',  accessory: 'ledger',        feet: 'shoes_soft' },
  innkeeper:  { torso: 'vest_tavern',    accessory: 'tray' },
  priest:     { torso: 'robe_ceremonial', accessory: 'prayer_beads', feet: 'shoes_soft' },
  healer:     { torso: 'robe_healer',    accessory: 'satchel',       feet: 'shoes_soft' },
  traveler:   { torso: 'jerkin_travel',  accessory: 'pack',          feet: 'boots_travel' },
};

/** Canonical wealth → dress tier. A tier is a *claim about canonical wealth*, so the thresholds
 * live here rather than being guessed per-slot. */
function wealthTier(wealth: number): 'destitute' | 'plain' | 'modest' | 'comfortable' | 'fine' {
  if (wealth < 5) return 'destitute';
  if (wealth < 20) return 'plain';
  if (wealth < 60) return 'modest';
  if (wealth < 160) return 'comfortable';
  return 'fine';
}

function sexOf(person: Person): SexPresentation {
  const g = (person as { gender?: string }).gender;
  return g === 'm' ? 'male' : g === 'f' ? 'female' : 'unspecified';
}

function bodyToken(species: string, sex: SexPresentation, lifeStage: string): string {
  const stage = lifeStage === 'infant' || lifeStage === 'child' ? 'child'
    : lifeStage === 'adolescent' ? 'adolescent'
    : lifeStage === 'elder' ? 'elder' : 'adult';
  // Children are not sexed in presentation: the simulation carries the fact, but no installed
  // human library distinguishes it at that age, and inventing the distinction would be a
  // renderer claiming something it cannot show.
  const suffix = stage === 'child' || sex === 'unspecified' ? '' : `_${sex === 'male' ? 'm' : 'f'}`;
  return `body_${species}_${stage}${suffix}`;
}

function skinTier(skin: number): string {
  const r = (skin >> 16) & 0xff, g = (skin >> 8) & 0xff, b = skin & 0xff;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const index = Math.min(SKIN_TIERS.length - 1, Math.max(0, Math.floor(luma * SKIN_TIERS.length)));
  return `skin_${SKIN_TIERS[index]}`;
}

function signatureOf(profile: Omit<AppearanceProfile, 'signature'>): string {
  const parts = [profile.species, profile.sex, profile.lifeStage,
    profile.height.toFixed(3), profile.build.toFixed(3), profile.characterKey ?? '-',
    ...profile.slots.map(s => `${s.kind}:${s.token}:${s.tint ?? ''}`)];
  return variantHash(parts.join('|'), 'signature').toString(36);
}

// ---------------------------------------------------------------- resolution

/**
 * Resolve one canonical person into a renderer-neutral appearance profile.
 *
 * `bodyId` is passed explicitly rather than read from `person.bodies[0]`: the ontology supports
 * zero-or-many bodies per entity (AGENTS.md §9), and every body of the same person shares this
 * one appearance — the profile describes the *person*, keyed to the body being presented.
 */
export function appearanceProfile(person: Person, bodyId: string): AppearanceProfile {
  const look: Appearance = person.appearance;
  const key = person.id;
  const sex = sexOf(person);
  const species = person.species || 'human';
  const lifeStage = person.lifeStage ?? 'adult';
  const characterKey = authoredCharacterKey(person.slug);
  const occupation = (person.occupation ?? '').toLowerCase();
  const dress = OCCUPATION_DRESS[occupation];
  const tier = wealthTier(person.wealth ?? 0);
  const juvenile = lifeStage === 'infant' || lifeStage === 'child';

  const slots: AppearanceSlot[] = [
    { kind: 'body', token: bodyToken(species, sex, lifeStage), from: 'species/gender/lifeStage' },
    { kind: 'head', token: `head_${sex === 'unspecified' ? 'n' : sex[0]}_${variantHash(key, 'head') % HEAD_VARIANTS}`, from: 'person.id' },
    { kind: 'skin', token: skinTier(look.skin), tint: look.skin, from: 'appearance.skin' },
    { kind: 'hair', token: `hair_${pick(HAIR_STYLES, key, 'hair')}`, tint: look.hair, from: 'appearance.hair + person.id' },
    { kind: 'torso', token: dress?.torso ?? `tunic_${tier}`, tint: look.shirt, from: dress ? 'occupation' : 'wealth tier' },
    { kind: 'legs', token: `trousers_${tier}`, tint: look.pants, from: 'appearance.pants + wealth tier' },
    { kind: 'feet', token: dress?.feet ?? (tier === 'destitute' ? 'barefoot' : tier === 'fine' ? 'shoes_fine' : 'shoes_soft'), from: dress?.feet ? 'occupation' : 'wealth tier' },
  ];

  // Facial hair is a real adult-male-presenting distinction the simulation already half-carries
  // via `Appearance.beard`; where it does not, the variant draw supplies one. Never for a child.
  if (!juvenile && sex === 'male') {
    const style = look.beard !== undefined && look.beard > 0
      ? (look.beard > 0.66 ? 'full_beard' : look.beard > 0.33 ? 'short_beard' : 'stubble')
      : pick(FACIAL_HAIR, key, 'beard');
    if (style !== 'none') slots.push({ kind: 'facialHair', token: `beard_${style}`, tint: look.hair, from: look.beard !== undefined ? 'appearance.beard' : 'person.id' });
  }

  // Canonical headwear. `hatStyle: 'none'` means canonically bare-headed — not "pick one".
  if (look.hatStyle && look.hatStyle !== 'none') {
    slots.push({ kind: 'headwear', token: `headwear_${look.hatStyle}`, tint: look.hat, from: 'appearance.hatStyle' });
  }
  // Canonical apron is a distinct garment layer, not a re-skin of the torso.
  if (look.apron !== undefined) {
    slots.push({ kind: 'outerwear', token: 'apron_plain', tint: look.apron, from: 'appearance.apron' });
  }
  if (dress?.accessory) {
    slots.push({ kind: 'accessory', token: dress.accessory, from: 'occupation' });
  }

  const base = {
    personId: person.id, bodyId, species, sex, lifeStage,
    height: look.height ?? 1, build: look.build ?? 1,
    characterKey, authored: characterKey !== null, slots,
  };
  return { ...base, signature: signatureOf(base) };
}
