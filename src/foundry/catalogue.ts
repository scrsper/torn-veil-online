/**
 * The Character Foundry's view of one machine's installed Unreal character assets.
 *
 * ## Why this is not in the repository
 *
 * The assets this describes are licensed Fab/Marketplace and engine content that lives only on a
 * developer's machine (`unreal/TornVeilOnline/Content/Characters/` and the Fab packs are
 * gitignored). Their paths are therefore *machine-local data*, produced by
 * `unreal/scripts/audit_character_assets.py` into `.debug/character-foundry/catalogue.json`, and
 * loaded at runtime by whoever is presenting. Nothing here is ever written into canonical `Person`
 * state, committed, or redistributed — exactly the boundary
 * `docs/playable-world-slice2-local-assets.md` already draws for environment content.
 *
 * ## Why the schema is prescriptive
 *
 * The audit script and this file are two halves of one contract: the script classifies whatever is
 * installed into these slots and tags, and the resolver matches against them. That lets the
 * matching rules be written, reviewed and tested before any particular asset pack exists, and lets
 * a different pack be swapped in without touching a line of resolution logic.
 */

/** Where a resolved asset goes on a character. Slots are physical, not semantic. */
export type FoundrySlot =
  | 'body' | 'head' | 'hair' | 'facialHair'
  | 'upperGarment' | 'lowerGarment' | 'robe' | 'armor' | 'footwear' | 'accessory';

export const FOUNDRY_SLOTS: readonly FoundrySlot[] = [
  'body', 'head', 'hair', 'facialHair', 'upperGarment', 'lowerGarment', 'robe', 'armor', 'footwear', 'accessory',
];

/** Slots whose asset must share the animation target skeleton, or be retargetable onto it. */
export const SKELETAL_SLOTS: readonly FoundrySlot[] = ['body', 'head', 'upperGarment', 'lowerGarment', 'robe', 'armor', 'footwear'];

export interface CatalogueEntry {
  /** Unreal package path. Machine-local; never persisted canonically. */
  package: string;
  name: string;
  /** Unreal asset class, e.g. `SkeletalMesh`, `StaticMesh`, `GroomAsset`, `MaterialInstance`. */
  assetClass: string;
  slot: FoundrySlot;
  /** Package path of the skeleton this mesh binds to, when it is skeletal. */
  skeleton?: string;
  /**
   * Descriptive tags the audit inferred from package path and asset name — `male`, `adult`,
   * `robe`, `heavy`, `leather`. Matching is entirely tag-driven, so improving classification is a
   * change to the audit script, never to the resolver.
   */
  tags: string[];
  /** Named material slots, so the presentation layer knows where to push skin/cloth tints. */
  materialSlots?: string[];
  /** Morph target names, used for continuous build/stature/age shaping where a mesh supports it. */
  morphTargets?: string[];
}

export interface CatalogueSkeleton {
  package: string;
  name: string;
  /** Stable family id the audit groups by, e.g. `manny`, `herotpp`. */
  family: string;
  /** How many skeletal meshes bind to it. */
  meshCount: number;
  /** How many animation assets target it. The animation target is normally the largest. */
  animCount: number;
}

export interface CatalogueRetargeter {
  package: string;
  sourceSkeleton?: string;
  targetSkeleton?: string;
}

export interface CharacterCatalogue {
  schema: 1;
  generatedAt: string;
  /** Machine identifier, so a stale catalogue from another box is obvious in a diagnostic. */
  machine?: string;
  /**
   * The skeleton every playable body should end up on. Animation, retargeting and the existing
   * combat/locomotion assets are all bound to one skeleton; a body mesh on any other is a
   * character that cannot move. The audit picks the skeleton with the most animations and the
   * most retargeters pointing at it.
   */
  animationTarget?: string;
  skeletons: CatalogueSkeleton[];
  retargeters: CatalogueRetargeter[];
  entries: CatalogueEntry[];
}

/** An empty catalogue is a legitimate state, not an error: it means "this machine has no packs". */
export const EMPTY_CATALOGUE: CharacterCatalogue = {
  schema: 1, generatedAt: '1970-01-01T00:00:00.000Z', skeletons: [], retargeters: [], entries: [],
};

export interface CatalogueProblem { kind: 'rejected' | 'dropped'; detail: string; }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const stringList = (value: unknown, limit = 32): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200).slice(0, limit) : [];

/**
 * Parse a catalogue that came off disk. A machine-local file written by a tool on another machine
 * is untrusted input: every malformed entry is dropped with a reported reason rather than
 * throwing, because a bad catalogue must degrade presentation, never stop a simulation running.
 */
export function parseCatalogue(raw: unknown): { catalogue: CharacterCatalogue; problems: CatalogueProblem[] } {
  const problems: CatalogueProblem[] = [];
  if (!isRecord(raw)) return { catalogue: EMPTY_CATALOGUE, problems: [{ kind: 'rejected', detail: 'catalogue is not an object' }] };
  if (raw.schema !== 1) return { catalogue: EMPTY_CATALOGUE, problems: [{ kind: 'rejected', detail: `unsupported catalogue schema ${String(raw.schema)}` }] };

  const slots = new Set<string>(FOUNDRY_SLOTS);
  const entries: CatalogueEntry[] = [];
  for (const candidate of Array.isArray(raw.entries) ? raw.entries : []) {
    if (!isRecord(candidate)) { problems.push({ kind: 'dropped', detail: 'entry is not an object' }); continue; }
    const pkg = candidate.package, slot = candidate.slot;
    if (typeof pkg !== 'string' || !pkg.startsWith('/')) { problems.push({ kind: 'dropped', detail: `entry has no usable package path: ${JSON.stringify(pkg)}` }); continue; }
    if (typeof slot !== 'string' || !slots.has(slot)) { problems.push({ kind: 'dropped', detail: `${pkg}: unknown slot ${JSON.stringify(slot)}` }); continue; }
    entries.push({
      package: pkg,
      name: typeof candidate.name === 'string' ? candidate.name : pkg.slice(pkg.lastIndexOf('/') + 1),
      assetClass: typeof candidate.assetClass === 'string' ? candidate.assetClass : 'Unknown',
      slot: slot as FoundrySlot,
      ...(typeof candidate.skeleton === 'string' ? { skeleton: candidate.skeleton } : {}),
      tags: stringList(candidate.tags),
      ...(Array.isArray(candidate.materialSlots) ? { materialSlots: stringList(candidate.materialSlots) } : {}),
      ...(Array.isArray(candidate.morphTargets) ? { morphTargets: stringList(candidate.morphTargets, 64) } : {}),
    });
  }

  const skeletons: CatalogueSkeleton[] = [];
  for (const candidate of Array.isArray(raw.skeletons) ? raw.skeletons : []) {
    if (!isRecord(candidate) || typeof candidate.package !== 'string') { problems.push({ kind: 'dropped', detail: 'skeleton has no package path' }); continue; }
    skeletons.push({
      package: candidate.package,
      name: typeof candidate.name === 'string' ? candidate.name : candidate.package,
      family: typeof candidate.family === 'string' ? candidate.family : 'unknown',
      meshCount: Number.isFinite(candidate.meshCount) ? Number(candidate.meshCount) : 0,
      animCount: Number.isFinite(candidate.animCount) ? Number(candidate.animCount) : 0,
    });
  }

  const retargeters: CatalogueRetargeter[] = [];
  for (const candidate of Array.isArray(raw.retargeters) ? raw.retargeters : []) {
    if (!isRecord(candidate) || typeof candidate.package !== 'string') continue;
    retargeters.push({
      package: candidate.package,
      ...(typeof candidate.sourceSkeleton === 'string' ? { sourceSkeleton: candidate.sourceSkeleton } : {}),
      ...(typeof candidate.targetSkeleton === 'string' ? { targetSkeleton: candidate.targetSkeleton } : {}),
    });
  }

  return {
    catalogue: {
      schema: 1,
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : EMPTY_CATALOGUE.generatedAt,
      ...(typeof raw.machine === 'string' ? { machine: raw.machine } : {}),
      ...(typeof raw.animationTarget === 'string' ? { animationTarget: raw.animationTarget } : {}),
      skeletons, retargeters, entries,
    },
    problems,
  };
}

/**
 * Which skeletons a body can be on and still animate: the animation target itself, plus anything a
 * retargeter can bring onto it. Stated explicitly because "it has a skeleton" and "it can play this
 * project's locomotion, sprint, dodge, combat and hit reactions" are very different claims.
 */
export function animatableSkeletons(catalogue: CharacterCatalogue): Set<string> {
  const target = catalogue.animationTarget;
  const usable = new Set<string>();
  if (target) usable.add(target);
  for (const retargeter of catalogue.retargeters) {
    if (retargeter.sourceSkeleton && (!target || retargeter.targetSkeleton === target)) usable.add(retargeter.sourceSkeleton);
  }
  return usable;
}

/** A per-slot count, for reporting what a machine can actually dress a population from. */
export function catalogueCoverage(catalogue: CharacterCatalogue): Record<FoundrySlot, number> {
  const coverage = Object.fromEntries(FOUNDRY_SLOTS.map(slot => [slot, 0])) as Record<FoundrySlot, number>;
  for (const entry of catalogue.entries) coverage[entry.slot]++;
  return coverage;
}
