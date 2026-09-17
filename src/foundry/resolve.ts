import { GARMENT_PALETTES, HAIR_COLORS, SKIN_TONES } from '../sim/core/appearance';
import type { ProjectedAppearanceTraits } from '../sim/core/appearance';
import { individualRng } from '../sim/core/human';
import type { RNG } from '../sim/core/rng';
import { SKELETAL_SLOTS, animatableSkeletons } from './catalogue';
import type { CatalogueEntry, CharacterCatalogue, FoundrySlot } from './catalogue';
import { morphIntents, slotRules } from './manifest';
import type { SlotRule } from './manifest';

/**
 * The Character Foundry: canonical semantics in, a concrete physical configuration out.
 *
 * ```text
 * Person (canonical)  ->  AppearanceTraits  ->  slotRules()  ->  [ this ]  ->  CharacterRealization
 *                                                                   ^
 *                                             machine-local CharacterCatalogue
 * ```
 *
 * Three properties matter more than the matching itself:
 *
 * 1. **The simulation does not depend on this succeeding.** A realization is a projection-time
 *    product, like `agePresentation`. If the catalogue is empty, stale, or missing the very asset
 *    a person needs, the person is unchanged, the simulation is unchanged, and what comes back is
 *    a realization with holes in it and a diagnostic saying which holes and why.
 * 2. **No asset path ever travels inward.** Nothing here writes to `Person`, and nothing canonical
 *    reads a realization.
 * 3. **It is deterministic.** Selection draws from the person's own identity stream, so the same
 *    person on the same machine with the same catalogue is assembled from the same parts on every
 *    PIE start and after every reload.
 */

export interface ResolvedSlot {
  slot: FoundrySlot;
  /** Machine-local Unreal package path. */
  package: string;
  name: string;
  /** Which required tag the match was made on, for diagnostics. */
  matchedOn: string;
  /** How many preference tags this candidate satisfied. */
  score: number;
  /** Requirement tags that had to be dropped to find anything at all. */
  relaxed: string[];
  materialSlots: string[];
}

export type FoundryProblemKind =
  | 'no-catalogue' | 'slot-empty' | 'no-match' | 'relaxed' | 'skeleton-incompatible' | 'required-slot-unresolved';

export interface FoundryProblem {
  kind: FoundryProblemKind;
  slot: FoundrySlot;
  /** What was being asked for, so a report names the gap rather than just the slot. */
  wanted: string[];
  detail: string;
}

export interface CharacterRealization {
  /** Canonical entity id. The only canonical thing in here, and it is a key, not a description. */
  entityId: string;
  /** Skeleton every skeletal part of this character is on. Absent when nothing resolved. */
  skeleton?: string;
  slots: ResolvedSlot[];
  /** Morph target values, filtered to those the chosen body actually exposes. */
  morphs: Record<string, number>;
  /** Uniform scale, straight from canonical stature and build. Always present. */
  scale: { height: number; build: number };
  /** Material parameters, straight from the realized canonical colours. Always present. */
  materials: { skin: number; hair: number; garmentPrimary: number; garmentSecondary: number; garmentAccent: number; wear: number; grooming: number };
  /** Everything the Foundry could not do, and why. Empty means a complete character. */
  problems: FoundryProblem[];
  /** True when body and head both resolved — i.e. this is a person, not a fallback mannequin. */
  complete: boolean;
}

export interface RealizationInput {
  entityId: string;
  /** Stable identity for the selection stream: a slug where one exists, else the entity id. */
  identity: string;
  seed: number;
  traits: ProjectedAppearanceTraits;
  /** Realized canonical colours and scale, as the bridge already projects them. */
  appearance: { skin: number; hair: number; shirt: number; pants: number; apron?: number; height: number; build: number };
}

/** Rank candidates by satisfied preferences; ties are broken by the person's own stream, not by order. */
function chooseCandidate(rng: RNG, candidates: CatalogueEntry[], preferred: string[]): { entry: CatalogueEntry; score: number } {
  let best: CatalogueEntry[] = [], bestScore = -1;
  for (const entry of candidates) {
    const tags = new Set(entry.tags);
    let score = 0;
    for (const tag of preferred) if (tags.has(tag)) score++;
    if (score > bestScore) { bestScore = score; best = [entry]; }
    else if (score === bestScore) best.push(entry);
  }
  // Sorting first makes the pick independent of catalogue ordering, so two machines that scanned
  // their packs in a different order still assemble the same person.
  best.sort((a, b) => (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
  return { entry: best[Math.floor(rng.next() * best.length)], score: bestScore };
}

/**
 * Find one part. Filters to the slot, to skeletons this project can actually animate, and to the
 * rule's required tags; then relaxes requirements one at a time until something matches or the
 * rule runs out of things to give up.
 */
function resolveSlot(rng: RNG, rule: SlotRule, pool: CatalogueEntry[], problems: FoundryProblem[]): ResolvedSlot | null {
  const inSlot = pool.filter(entry => entry.slot === rule.slot);
  if (!inSlot.length) {
    problems.push({ kind: 'slot-empty', slot: rule.slot, wanted: rule.required, detail: `no ${rule.slot} assets in catalogue` });
    return null;
  }
  const relaxed: string[] = [];
  let required = [...rule.required];
  // Disqualifying tags are dropped only as the very last resort: a pack containing nothing but
  // tatters should still dress people, but it should be the final concession, not the first.
  let forbidden = [...rule.forbidden];
  for (let attempt = 0; ; attempt++) {
    const matches = inSlot.filter(entry =>
      required.every(tag => entry.tags.includes(tag)) && !forbidden.some(tag => entry.tags.includes(tag)));
    if (matches.length) {
      const { entry, score } = chooseCandidate(rng, matches, rule.preferred);
      if (relaxed.length) {
        problems.push({ kind: 'relaxed', slot: rule.slot, wanted: rule.required, detail: `dropped [${relaxed.join(', ')}] to match ${entry.name}` });
      }
      return { slot: rule.slot, package: entry.package, name: entry.name, matchedOn: required.join('+') || 'any', score, relaxed: [...relaxed], materialSlots: entry.materialSlots ?? [] };
    }
    const next = rule.relax[attempt];
    if (next === undefined) {
      if (!forbidden.length) break;
      relaxed.push(...forbidden.map(tag => `!${tag}`));
      forbidden = [];
      continue;
    }
    if (required.includes(next)) { required = required.filter(tag => tag !== next); relaxed.push(next); }
  }
  // Everything in this slot was rejected: report what was asked for, not just that it failed.
  problems.push({ kind: 'no-match', slot: rule.slot, wanted: rule.required, detail: `${inSlot.length} ${rule.slot} asset(s) present, none carrying [${rule.required.join(', ')}]` });
  return null;
}

/**
 * Assemble one person. Never throws, never mutates its inputs, and always returns a usable
 * realization — `materials` and `scale` come straight from canonical appearance and are correct
 * even when not a single mesh resolved, which is exactly the state a machine with no content packs
 * should be in.
 */
export function realizeCharacter(input: RealizationInput, catalogue: CharacterCatalogue): CharacterRealization {
  const { traits, appearance } = input;
  const palette = GARMENT_PALETTES[traits.garmentPalette];
  const realization: CharacterRealization = {
    entityId: input.entityId,
    slots: [],
    morphs: {},
    scale: { height: appearance.height, build: appearance.build },
    materials: {
      skin: appearance.skin, hair: appearance.hair,
      garmentPrimary: appearance.shirt, garmentSecondary: appearance.pants,
      garmentAccent: appearance.apron ?? palette?.accent ?? appearance.pants,
      wear: traits.wear, grooming: traits.grooming,
    },
    problems: [],
    complete: false,
  };
  if (!catalogue.entries.length) {
    realization.problems.push({ kind: 'no-catalogue', slot: 'body', wanted: [], detail: 'no character catalogue on this machine; presentation falls back to the base mannequin and canonical tints' });
    return realization;
  }

  // Only parts that can animate are eligible. A beautiful body mesh on a skeleton this project has
  // no retargeter for is a character that cannot walk, which is worse than a plain one that can.
  const animatable = animatableSkeletons(catalogue);
  const skeletal = new Set<string>(SKELETAL_SLOTS);
  const pool = catalogue.entries.filter(entry => {
    if (!skeletal.has(entry.slot)) return true;
    if (!entry.skeleton) return true; // unbound (static/groom) parts are attached, not skinned
    if (!animatable.size || animatable.has(entry.skeleton)) return true;
    return false;
  });
  const rejected = catalogue.entries.length - pool.length;
  if (rejected > 0) {
    realization.problems.push({ kind: 'skeleton-incompatible', slot: 'body', wanted: [...animatable], detail: `${rejected} asset(s) skipped: skeleton not animatable by this project` });
  }

  const rules = slotRules(traits);
  for (const rule of rules) {
    // Each slot draws from its OWN stream, keyed by what it is asking for. A shared sequential
    // stream would make every later slot depend on whether an earlier one found anything, so
    // uninstalling one hair pack would silently re-roll a person's clothes and props. Fail-soft
    // has to mean "lose that part", not "become a different person".
    const rng = individualRng(input.seed, `foundry:${input.identity}:${rule.slot}:${rule.required.join('+')}`);
    const resolved = resolveSlot(rng, rule, pool, realization.problems);
    if (resolved) realization.slots.push(resolved);
    else if (!rule.optional) {
      realization.problems.push({ kind: 'required-slot-unresolved', slot: rule.slot, wanted: rule.required, detail: `${rule.slot} is required; falling back to the base mannequin` });
    }
  }

  const body = realization.slots.find(slot => slot.slot === 'body');
  const head = realization.slots.find(slot => slot.slot === 'head');
  realization.complete = !!body && !!head;
  if (body) {
    const entry = catalogue.entries.find(candidate => candidate.package === body.package);
    if (entry?.skeleton) realization.skeleton = entry.skeleton;
    // Only ask for morphs the mesh actually has, so a pack without them produces no noise.
    const available = new Set(entry?.morphTargets ?? []);
    for (const [name, value] of Object.entries(morphIntents(traits))) if (available.has(name)) realization.morphs[name] = value;
  }
  return realization;
}

export interface PopulationReport {
  people: number;
  complete: number;
  /** Distinct slot-package combinations — the real measure of whether a crowd looks like a crowd. */
  distinctConfigurations: number;
  distinctBodies: number;
  distinctHeads: number;
  distinctOutfits: number;
  problemsByKind: Record<string, number>;
  /** Every distinct unmet request, so a content gap reads as a shopping list. */
  unmet: string[];
}

/** Measure a realized population. Used by the foundry CLI and by the diversity tests. */
export function reportPopulation(realizations: CharacterRealization[]): PopulationReport {
  const signature = (r: CharacterRealization) => r.slots.map(s => `${s.slot}=${s.package}`).sort().join('|');
  const outfit = (r: CharacterRealization) => r.slots.filter(s => s.slot !== 'body' && s.slot !== 'head').map(s => `${s.slot}=${s.package}`).sort().join('|');
  const pick = (r: CharacterRealization, slot: FoundrySlot) => r.slots.find(s => s.slot === slot)?.package ?? '-';
  const problemsByKind: Record<string, number> = {};
  const unmet = new Set<string>();
  for (const realization of realizations) {
    for (const problem of realization.problems) {
      problemsByKind[problem.kind] = (problemsByKind[problem.kind] ?? 0) + 1;
      if (problem.kind === 'no-match' || problem.kind === 'slot-empty') unmet.add(`${problem.slot}:[${problem.wanted.join(',')}]`);
    }
  }
  return {
    people: realizations.length,
    complete: realizations.filter(r => r.complete).length,
    distinctConfigurations: new Set(realizations.map(signature)).size,
    distinctBodies: new Set(realizations.map(r => pick(r, 'body'))).size,
    distinctHeads: new Set(realizations.map(r => pick(r, 'head'))).size,
    distinctOutfits: new Set(realizations.map(outfit)).size,
    problemsByKind,
    unmet: [...unmet].sort(),
  };
}

/** Exported for the contact sheet and diagnostics: the colours a realization drives. */
export const realizationColours = (realization: CharacterRealization) => ({
  ...realization.materials,
  skinToken: Object.entries(SKIN_TONES).find(([, value]) => value === realization.materials.skin)?.[0],
  hairToken: Object.entries(HAIR_COLORS).find(([, value]) => value === realization.materials.hair)?.[0],
});
