/**
 * Ontology creator bodies (tools/ontology): the current Human family and the seeded appearance its editor applies.
 *
 * The variation math mirrors tools/ontology/src/visual/resolver.ts (`variation`, resolver 1.1.0) and
 * tools/ontology/src/visual/appearance.ts (`appearancePlan`); tests/creator-appearance.test.ts holds them equal.
 * Only what the editor supports is applied, exactly as its viewport does: the male v2 `TV_JawWidth` morph and the
 * seeded linen/leather palettes. The female v1 body has no authored variants, so nothing is applied to it, and that
 * is reported rather than imitated.
 *
 * Identity: the editor seeds from an ontology entity (`id`, `appearanceSeed`). Arena and Tower people have no ontology
 * entity, so callers pass an explicit adapter identity (for the Tower hero, its persistent climber id with seed 0).
 * That is the same seeding function on a different identity source, not the editor's full resolver semantics.
 */
export type CreatorLook = 'creator_male' | 'creator_female';
export interface CreatorBody {
  look: CreatorLook; assetId: string; file: string; sex: 'male' | 'female'; nativeHeightM: number; appearanceSupported: boolean;
  /** The body's own hair mesh (MPFB proxy name in the GLB); hiding it is a real geometry choice. */
  hairMesh: string;
}
export const CREATOR_BODIES: Record<CreatorLook, CreatorBody> = {
  creator_male: { look: 'creator_male', assetId: 'tv-human-male-v2', file: 'tv-human-male-v2.glb', sex: 'male', nativeHeightM: 1.8, appearanceSupported: true, hairMesh: 'short02' },
  creator_female: { look: 'creator_female', assetId: 'tv-human-female-v1', file: 'tv-human-female-v1.glb', sex: 'female', nativeHeightM: 1.73, appearanceSupported: false, hairMesh: 'braid01' },
};

/**
 * Player customization of the creator hero, saved in this browser (separate from expedition checkpoints).
 * Every control maps to real geometry or material the body has; anything a body lacks is reported, never imitated:
 * - body: which creator body (applies from the next climb or reload)
 * - height: uniform scale of the whole body, 0.95-1.05; held equipment scales with it. Presentation only: reach,
 *   collision and damage are unchanged.
 * - hair: show or hide the body's own hair mesh
 * - jaw: the male v2 `TV_JawWidth` morph, 0-1, or null for the identity's seeded value (female: no morph)
 * - seed: appearance seed for the seeded jaw and linen/leather palette (male; re-roll changes it)
 */
export interface CreatorCustomization { body: 'male' | 'female'; height: number; hair: boolean; jaw: number | null; seed: number }
export const CUSTOMIZATION_KEY = 'tv.tower.appearance.v1';
export const DEFAULT_CUSTOMIZATION: CreatorCustomization = { body: 'male', height: 1, hair: true, jaw: null, seed: 0 };
export const HEIGHT_RANGE = [.95, 1.05] as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Validate stored or URL data: unknown fields are dropped, numbers clamped, wrong types fall back to defaults. */
export function parseCustomization(raw: unknown): CreatorCustomization {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  return {
    body: o.body === 'female' ? 'female' : 'male',
    height: num(o.height) === null ? 1 : clamp(num(o.height)!, HEIGHT_RANGE[0], HEIGHT_RANGE[1]),
    hair: typeof o.hair === 'boolean' ? o.hair : true,
    jaw: num(o.jaw) === null ? null : clamp(num(o.jaw)!, 0, 1),
    seed: num(o.seed) === null ? 0 : Math.trunc(clamp(num(o.seed)!, 0, 4294967295)),
  };
}
export const bodyLook = (c: CreatorCustomization): CreatorLook => c.body === 'female' ? 'creator_female' : 'creator_male';
/** Which controls the chosen body actually supports. */
export function supportedControls(look: CreatorLook): { height: true; hair: true; jaw: boolean; reroll: boolean } {
  const b = CREATOR_BODIES[look]; return { height: true, hair: true, jaw: b.appearanceSupported, reroll: b.appearanceSupported };
}
export const isCreatorLook = (l: string): l is CreatorLook => Object.hasOwn(CREATOR_BODIES, l);

export const RESOLVER_VERSION = '1.1.0';
export function hash32(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export interface CreatorIdentity { id: string; appearanceSeed: number }
export const variation = (e: CreatorIdentity, channel: string) => hash32(`${RESOLVER_VERSION}|${e.id}|${e.appearanceSeed}|${channel}`) / 4294967296;

export interface CreatorAppearance { supported: boolean; jaw: number; linen: [number, number, number]; leather: [number, number, number] }
export function creatorAppearance(e: CreatorIdentity, body: CreatorBody): CreatorAppearance {
  const tint = variation(e, 'linen-tint');
  return {
    supported: body.appearanceSupported, jaw: variation(e, 'jaw-width'),
    linen: [.82 + tint * .16, .78 + tint * .12, .69 + tint * .10],
    leather: [.12 + variation(e, 'leather-tone') * .08, .055, .025],
  };
}
/** Material and morph names the editor's viewport sets (tools/ontology/src/rendering/viewport.ts applyAppearance). */
export const CREATOR_CHANNELS = { jawMorph: 'TV_JawWidth', linenMaterial: 'TV woven linen shirt', leatherMaterial: 'TV worn brown leather' } as const;
