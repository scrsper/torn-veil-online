/**
 * Physical sizing contract for held equipment. Presentation only: it never changes reach, damage or any canonical fact.
 *
 * Three quantities stay separate:
 * - **source metres**: an asset's authored length converted to metres by its source family (`metresPerUnit`).
 *   The metric item catalog and the Torn Veil Arsenal are authored in metres. KayKit gear is authored in KayKit
 *   character units, which have no metric meaning, so it is sized only from an explicit per-item target.
 * - **the grip anchor**: arsenal and KayKit gear keep their grip at the mesh origin. A fit scales about that origin,
 *   so the palm contact does not move. Anchors are never derived from the fitted size.
 * - **render units**: whatever the holder's parent chain multiplies (the Tower's people are drawn x1.22). Equipment
 *   inherits that scale from its hand slot; the contract never folds actor scale into an item's size.
 *
 * Targets come from the documented metric item catalog (web/public/items/v1.1/catalog.json, built on a 1.90 m adult)
 * where it has the type, and are otherwise explicit art decisions recorded here. Only an item whose authored metric
 * length exceeds its documented type maximum is fitted, down to that maximum; smaller and in-range items keep their
 * authored size, so intentionally different small and large equipment stays different.
 */
export type HeldCategory = 'longsword' | 'shortsword' | 'dagger' | 'axe' | 'maul' | 'polearm' | 'staff' | 'bow' | 'crossbow' | 'shield' | 'book' | 'projectile' | 'armor';
export type SourceFamily = 'catalog' | 'arsenal' | 'kaykit';

/** Metres per authored unit; null = the source has no metric meaning (an explicit target is then required). */
export const SOURCE_METRES_PER_UNIT: Record<SourceFamily, number | null> = {
  catalog: 1, // catalog.json dimensions_m, metric adult scale
  arsenal: 1, // arsenal/README.txt: "Coordinates: meters; asset-local origin at grip center"
  kaykit: null, // CC0 KayKit character-pack gear, sized to stylised ~2.17-unit KayKit bodies
};

/** Longest-dimension ranges (m) of the catalog's documented types; tests re-derive them from catalog.json. */
export const CATALOG_TYPE_RANGE_M = {
  longsword: [1.14, 1.82], dagger: [0.43, 0.69], axe: [0.74, 1.15], axeMedian: 0.97, hammer: [0.64, 1.04], polearm: [1.99, 2.40],
  bow: [1.15, 1.68], shield: [0.67, 1.15], shieldMedian: 0.83, closedBook: [0.30, 0.38], carbine: [1.06, 1.24],
} as const;

/** KayKit round shield: the handle bar the fist closes on lies this far behind the mesh origin (KayKit units). */
export const SHIELD_GRIP_BAR_DEPTH = .11;

export interface HeldItemSpec {
  source: SourceFamily; category: HeldCategory;
  /** The point (item-local, authored units) that stays in the hand when fitted; default the grip origin. */
  gripAnchor?: readonly [number, number, number];
  /**
   * For items whose authored origin is not a grip (catalog props stand on a ground origin): the item-local rotation
   * into the hand slot (quaternion x,y,z,w) and where in the slot the grip anchor goes. Measured per item.
   */
  mount?: {
    quat: readonly [number, number, number, number]; slotPoint: readonly [number, number, number];
    /**
     * 'fist': the hand's own fist slot (assets.ts handGrip, built per rig from its knuckles: +y runs pinky->index
     * through the closed fingers, +z is the back of the hand). Default: the KayKit-derived shield slot.
     */
    slot?: 'fist' | 'shield';
  };
  /**
   * Grip from a named part's loader-baked bounds (after the glTF root conversion): its x/y centre, and `depth` of the way
   * from the board-side end of the part to its free end (a handle bar standing off the back of a board).
   */
  gripPart?: { material: string; depth: number };
  /** A part on the item's face; the mount assumes the face is +z, and turns the item when the baked face is -z. */
  facePart?: string;
  /** Fit down to this length (m) when the authored metric length exceeds it, or the exact length for unit-less sources. */
  maxLength_m?: number; exactLength_m?: number;
  /** Why the authored size is kept although no catalog type covers it (an explicit art decision). */
  keep?: string;
  /** Where the class and the target come from. */
  ref: string;
}

/**
 * Every weapon mesh the arena can attach (arsenal and KayKit weapons.glb), whether or not a current fighter uses it.
 * Classes from docs/COMBAT_ARENA.md, items.ts and the measured meshes.
 */
export const HELD_ITEMS: Record<string, HeldItemSpec> = {
  'W_oathbreaker': { source: 'arsenal', category: 'longsword', maxLength_m: CATALOG_TYPE_RANGE_M.longsword[1], ref: 'COMBAT_ARENA.md greatsword; catalog Longsword' },
  'W_veilguard': { source: 'arsenal', category: 'longsword', maxLength_m: CATALOG_TYPE_RANGE_M.longsword[1], ref: 'items.ts blade; catalog Longsword' },
  'W_crimson-duel': { source: 'arsenal', category: 'longsword', maxLength_m: CATALOG_TYPE_RANGE_M.longsword[1], ref: 'items.ts blade; catalog Longsword' },
  'W_serpent-tooth': { source: 'arsenal', category: 'shortsword', keep: 'between catalog Dagger and Longsword; no catalog short-sword type', ref: 'items.ts blade' },
  'W_night-thorn': { source: 'arsenal', category: 'dagger', maxLength_m: CATALOG_TYPE_RANGE_M.dagger[1], ref: 'catalog Dagger' },
  'W_widow-cleaver': { source: 'arsenal', category: 'axe', maxLength_m: CATALOG_TYPE_RANGE_M.axe[1], ref: 'COMBAT_ARENA.md battleaxe; catalog Axe' },
  'W_bell-of-ruin': { source: 'arsenal', category: 'maul', keep: 'two-handed maul on the greatsword moveset; catalog Hammer covers one-handed hammers only (0.64-1.04 m)', ref: 'lineup render; items.ts heavy' },
  'W_execution-standard': { source: 'arsenal', category: 'polearm', maxLength_m: CATALOG_TYPE_RANGE_M.polearm[1], ref: 'COMBAT_ARENA.md halberd; catalog Polearm' },
  'W_elderroot': { source: 'arsenal', category: 'staff', keep: 'no catalog staff; within the catalog Polearm range', ref: 'foe caster weapon' },
  'W_ashwood-sentinel': { source: 'arsenal', category: 'bow', maxLength_m: CATALOG_TYPE_RANGE_M.bow[1], ref: 'items.ts bow; catalog Bow' },
  'W_briar-whisper': { source: 'arsenal', category: 'bow', maxLength_m: CATALOG_TYPE_RANGE_M.bow[1], ref: 'items.ts bow; catalog Bow' },
  'W_raven-mechanism': { source: 'arsenal', category: 'crossbow', keep: 'no catalog crossbow; within the catalog Pulse carbine range (1.06-1.24 m)', ref: 'COMBAT_ARENA.md crossbow' },
  'W_codex-of-the-veil': { source: 'arsenal', category: 'book', maxLength_m: CATALOG_TYPE_RANGE_M.closedBook[1], ref: 'catalog Closed book' },
  'W_shield_round': { source: 'kaykit', category: 'shield', exactLength_m: CATALOG_TYPE_RANGE_M.shieldMedian, gripAnchor: [0, 0, -SHIELD_GRIP_BAR_DEPTH], ref: 'catalog Shield median (KayKit units are not metric)' },
  // Project catalog shield (web/public/items/v1.1/glb/TV-081.glb, "Round Watch", Normal; catalog.json dimensions_m
  // 0.484 x 0.17858 x 0.6738, metric, kept exactly). Static ground origin, face +z (boss/crystal primitive at z 0.059-0.089);
  // its handle is primitive 3, a 0.17 x 0.03 m bar along x behind the board (x +-0.085, y 0.2245-0.2545, z 0.001 to -0.089).
  // Drawn as the Tower render variant I_TV-081v (CATALOG_RENDER_VARIANTS): the sword-and-shield clips hold a strap-style
  // grip (forearm across the body, fist vertical), while every catalog shield (TV-081/082/085/086) has a horizontal
  // centre-grip bar. The variant stands only the handle bar upright, so an upright board and a bar along the fist agree.
  // Grip: the bar's x/y centre, 67% of the way from the board to its free end, placed at the centre of the closed fist
  // (the rig's own fist slot, whose +y runs through the fingers). The upright bar lies along that +y; a half turn about
  // y puts the face (+z) on the slot's -z, away from the back of the hand toward the foe (measured in guard).
  'I_TV-081v': { source: 'catalog', category: 'shield', maxLength_m: CATALOG_TYPE_RANGE_M.shield[1],
    gripPart: { material: 'Oxblood hide', depth: .67 }, facePart: 'Veil quartz',
    mount: { quat: [0, 1, 0, 0], slotPoint: [0, 0, 0], slot: 'fist' }, ref: 'catalog TV-081 Round Watch; catalog Shield' },
  // Legacy KayKit gear (weapons.glb). Authored for stylised KayKit bodies, so every piece needs an explicit target.
  // One-handed pieces take the bottom of the matching catalog range; two-handed pieces keep their larger class.
  'W_sword': { source: 'kaykit', category: 'longsword', exactLength_m: CATALOG_TYPE_RANGE_M.longsword[0], ref: 'KayKit sword_1handed; catalog Longsword minimum (one-handed)' },
  'W_greatsword': { source: 'kaykit', category: 'longsword', exactLength_m: CATALOG_TYPE_RANGE_M.longsword[1], ref: 'KayKit sword_2handed; catalog Longsword maximum (two-handed)' },
  'W_sk_blade': { source: 'kaykit', category: 'longsword', exactLength_m: CATALOG_TYPE_RANGE_M.longsword[0], ref: 'KayKit Skeleton_Blade (one-handed); catalog Longsword minimum' },
  'W_axe': { source: 'kaykit', category: 'axe', exactLength_m: CATALOG_TYPE_RANGE_M.axeMedian, ref: 'KayKit axe_1handed; catalog Axe median' },
  'W_sk_axe': { source: 'kaykit', category: 'axe', exactLength_m: CATALOG_TYPE_RANGE_M.axeMedian, ref: 'KayKit Skeleton_Axe; catalog Axe median' },
  'W_greataxe': { source: 'kaykit', category: 'axe', exactLength_m: CATALOG_TYPE_RANGE_M.axe[1], ref: 'KayKit axe_2handed; catalog Axe maximum (two-handed)' },
  'W_sk_staff': { source: 'kaykit', category: 'staff', exactLength_m: CATALOG_TYPE_RANGE_M.polearm[0], ref: 'KayKit Skeleton_Staff; catalog Polearm minimum (no catalog staff)' },
  'W_crossbow': { source: 'kaykit', category: 'crossbow', exactLength_m: CATALOG_TYPE_RANGE_M.carbine[0], ref: 'KayKit crossbow_2handed; catalog Pulse carbine minimum (no catalog crossbow)' },
  'W_sk_crossbow': { source: 'kaykit', category: 'crossbow', exactLength_m: CATALOG_TYPE_RANGE_M.carbine[0], ref: 'KayKit Skeleton_Crossbow; catalog Pulse carbine minimum' },
  'W_shield_badge': { source: 'kaykit', category: 'shield', exactLength_m: CATALOG_TYPE_RANGE_M.shieldMedian, ref: 'KayKit shield_badge; catalog Shield median; grip anchor at its authored origin' },
  'W_sk_shield_large': { source: 'kaykit', category: 'shield', exactLength_m: CATALOG_TYPE_RANGE_M.shield[1], ref: 'KayKit Skeleton_Shield_Large_A; catalog Shield maximum' },
  'W_sk_shield_small': { source: 'kaykit', category: 'shield', exactLength_m: CATALOG_TYPE_RANGE_M.shield[0], ref: 'KayKit Skeleton_Shield_Small_A; catalog Shield minimum' },
  'W_sk_shield_small_b': { source: 'kaykit', category: 'shield', exactLength_m: CATALOG_TYPE_RANGE_M.shield[0], ref: 'KayKit Skeleton_Shield_Small_B; catalog Shield minimum' },
  'W_arrow': { source: 'kaykit', category: 'projectile', keep: 'projectile, not held; unchanged', ref: 'world shots' },
  'W_sk_arrow': { source: 'kaykit', category: 'projectile', keep: 'projectile, not held; unchanged', ref: 'world shots' },
};

/**
 * Render variants of catalog items, built at load time in memory; the catalog GLB is never modified. Each records its
 * source file and hash, exactly what is changed and why. Nothing here claims the source authored the change.
 */
export interface CatalogRenderVariant {
  sourceId: string; sourcePath: string; sourceSha256: string;
  /** Rotate one material's part about its own bounds centre (after the loader's root conversion), angle in radians. */
  rotatePart: { material: string; axis: 'x' | 'y' | 'z'; angle: number };
  purpose: string;
}
export const CATALOG_RENDER_VARIANTS: Record<string, CatalogRenderVariant> = {
  'I_TV-081v': {
    sourceId: 'TV-081', sourcePath: 'web/public/items/v1.1/glb/TV-081.glb', sourceSha256: '13982f492260cfa8337b9b21fd7333b490e726e0b928f0e00001c5d7ead43eca',
    rotatePart: { material: 'Oxblood hide', axis: 'z', angle: Math.PI / 2 },
    purpose: 'Tower vertical-grip render variant: only the handle bar is turned 90 deg about the board normal around its own centre, so the strap-style sword-and-shield fist closes along it with the board upright. Board, rim, boss and metric size are unchanged.',
  },
};

export type FitStatus = 'authored' | 'fitted' | 'kept' | 'unsupported' | 'unspecified';
export interface FitResult { key: string; status: FitStatus; scale: number; authoredLength_m: number | null; length_m: number | null; reason: string }

/** Longest authored extent (in source units) of an item's local bounding box. */
export const longestExtent = (extent: readonly [number, number, number]) => Math.max(extent[0], extent[1], extent[2]);

/**
 * The uniform scale to apply about the item's grip origin. Unknown items and armour are reported, never silently
 * resized: armour fitting onto bodies is not supported by rigid scaling.
 */
export function fitHeldItem(key: string, authoredExtentUnits: readonly [number, number, number], spec: HeldItemSpec | undefined = HELD_ITEMS[key]): FitResult {
  const longest = longestExtent(authoredExtentUnits);
  const none = (status: FitStatus, reason: string): FitResult => ({ key, status, scale: 1, authoredLength_m: null, length_m: null, reason });
  if (!spec) return none('unspecified', 'no physical spec; drawn as authored');
  if (spec.category === 'armor') return none('unsupported', 'armour fitting onto bodies is not a rigid scale; unsupported here');
  if (!authoredExtentUnits.every(v => Number.isFinite(v) && v >= 0) || !(longest > 0)) return none('unsupported', 'empty or invalid geometry extent');
  const mpu = SOURCE_METRES_PER_UNIT[spec.source];
  const authored = mpu === null ? null : longest * mpu;
  // An intentional exclusion is reported as kept whatever the source units.
  if (spec.keep) return { key, status: 'kept', scale: 1, authoredLength_m: authored, length_m: authored, reason: spec.keep };
  for (const t of [spec.exactLength_m, spec.maxLength_m]) if (t !== undefined && !(Number.isFinite(t) && t > 0)) return none('unsupported', `invalid target ${t}`);
  if (spec.exactLength_m !== undefined) {
    // Unit-less sources: one authored unit is drawn as one metre-equivalent before the fit, like metric ones.
    return { key, status: 'fitted', scale: spec.exactLength_m / (longest * (mpu ?? 1)), authoredLength_m: authored, length_m: spec.exactLength_m, reason: `explicit target ${spec.exactLength_m} m (${spec.ref})` };
  }
  if (authored === null) return none('unsupported', 'source has no metric units and no explicit target');
  if (spec.maxLength_m !== undefined && authored > spec.maxLength_m) return { key, status: 'fitted', scale: spec.maxLength_m / authored, authoredLength_m: authored, length_m: spec.maxLength_m, reason: `authored ${authored.toFixed(3)} m exceeds documented ${spec.category} maximum ${spec.maxLength_m} m (${spec.ref})` };
  return { key, status: 'authored', scale: 1, authoredLength_m: authored, length_m: authored, reason: `within documented ${spec.category} range (${spec.ref})` };
}

/**
 * Where to place a fitted item so its grip anchor stays where the unfitted anchor was: scaling by `s` about anchor `a`
 * is a scale about the origin plus a translation of a·(1−s).
 */
export function anchorOffset(scale: number, anchor: readonly [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!(Number.isFinite(scale) && scale > 0)) throw new Error(`invalid fit scale ${scale}`);
  return [anchor[0] * (1 - scale), anchor[1] * (1 - scale), anchor[2] * (1 - scale)];
}

/**
 * Local placement of a fitted item in its slot: position, and rotation (quaternion x,y,z,w; identity when the
 * authored origin is already the grip). With a mount, the grip anchor (scaled, rotated) lands on the mount's slot point.
 */
export function heldPlacement(spec: HeldItemSpec | undefined, scale: number): { position: [number, number, number]; quat: [number, number, number, number] | null } {
  if (!spec?.mount) return { position: anchorOffset(scale, spec?.gripAnchor), quat: null };
  const [qx, qy, qz, qw] = spec.mount.quat, a = (spec.gripAnchor ?? [0, 0, 0]).map(v => v * scale) as [number, number, number];
  // Rotate a by q: v' = v + 2w(q x v) + 2 q x (q x v).
  const cx = qy * a[2] - qz * a[1], cy = qz * a[0] - qx * a[2], cz = qx * a[1] - qy * a[0];
  const ddx = qy * cz - qz * cy, ddy = qz * cx - qx * cz, ddz = qx * cy - qy * cx;
  const r = [a[0] + 2 * (qw * cx + ddx), a[1] + 2 * (qw * cy + ddy), a[2] + 2 * (qw * cz + ddz)];
  const p = spec.mount.slotPoint;
  return { position: [p[0] - r[0], p[1] - r[1], p[2] - r[2]], quat: [qx, qy, qz, qw] };
}

export interface PartBounds { min: [number, number, number]; max: [number, number, number] }
/**
 * Resolve a part-referenced spec into concrete numbers from loader-baked part bounds: the grip anchor, and the mount
 * turned half about y when the face part sits on -z. Returns the spec unchanged when it names no parts; null when a
 * named part is missing (reported, never guessed).
 */
export function resolveParts(spec: HeldItemSpec, parts: Record<string, PartBounds> | undefined): { spec: HeldItemSpec; faceZ: number | null } | null {
  if (!spec.gripPart && !spec.facePart) return { spec, faceZ: null };
  const g = spec.gripPart ? parts?.[spec.gripPart.material] : undefined, f = spec.facePart ? parts?.[spec.facePart] : undefined;
  if ((spec.gripPart && !g) || (spec.facePart && !f)) return null;
  const faceZ = f ? (f.min[2] + f.max[2]) / 2 : null;
  let gripAnchor = spec.gripAnchor;
  if (g && spec.gripPart) {
    // The board side of the handle is the end nearer the face; the free end is the other one.
    const towardFace = faceZ === null || faceZ >= (g.min[2] + g.max[2]) / 2, board = towardFace ? g.max[2] : g.min[2], free = towardFace ? g.min[2] : g.max[2];
    gripAnchor = [(g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2, board + (free - board) * spec.gripPart.depth];
  }
  let mount = spec.mount;
  if (mount && faceZ !== null && faceZ < 0) {
    // q * (0,1,0,0): the mount rotation applied after a half turn about y.
    const [x, y, z, w] = mount.quat; mount = { ...mount, quat: [-z, w, x, -y] };
  }
  return { spec: { ...spec, gripAnchor, mount }, faceZ };
}

/**
 * Fist-slot calibration for fist-mounted catalog shields, per creator body (fist-slot units, metres at body scale).
 * The fist slot (assets.ts handGrip) places a grip at 55% wrist->middle knuckle, tuned for sword hafts; a shield's
 * handle bar closes deeper in the curled fingers. Measured with .debug grip-gap (shortest distance from the closed
 * middle/ring finger joints to the bar axis), mean of the guard (block idle) and ready idle poses: male v2 gaps 5.2 /
 * 7.1 cm, female v1 4.6 / 6.4 cm, all perpendicular to the bar. Bodies without an entry are drawn uncalibrated.
 */
export const SHIELD_FIST_FIT: Record<string, readonly [number, number, number]> = {
  creator_male: [.0581, 0, -.0201],
  creator_female: [.0507, 0, -.0208],
};

/** Render length of a metric item under a parent chain of uniform scale (equipment inherits its holder's scale). */
export const renderLength = (length_m: number, parentWorldScale: number) => length_m * parentWorldScale;
