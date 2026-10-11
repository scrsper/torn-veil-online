import { describe, it, expect, vi } from 'vitest';
// The ontology's schema module needs zod, which only tools/ontology installs (the root CI job does not). The parity
// below only exercises its seeding math, so the schema is passed through.
vi.mock('../tools/ontology/src/ontology/schema', () => ({ HumanFamilySchema: { parse: (x: unknown) => x }, EntitySchema: { parse: (x: unknown) => x } }));
import { readFileSync } from 'node:fs';
import { CREATOR_BODIES, DEFAULT_CUSTOMIZATION, bodyLook, creatorAppearance, isCreatorLook, parseCustomization, supportedControls, variation } from '../src/web/actors/creatorAppearance';

// The ontology is a nested project with its own dependencies (zod), which the root project does not install or
// typecheck. Its modules are loaded at test run time through non-literal paths, so root `tsc` does not follow them;
// the shapes used here are declared locally.
type Plan = { supported: boolean; jaw: number; linen: number[]; leather: number[] };
const ONTOLOGY = '../tools/ontology/src/visual/';
const { appearancePlan } = await import(/* @vite-ignore */ `${ONTOLOGY}appearance`) as { appearancePlan: (e: unknown, assetId?: string) => Plan };
const { variation: ontologyVariation } = await import(/* @vite-ignore */ `${ONTOLOGY}resolver`) as { variation: (e: unknown, channel: string) => number };

const family = JSON.parse(readFileSync('tools/ontology/ontology/morphology/human-family.json', 'utf8')) as { variants: { sex: string; assetId: string; heightM: number }[] };
const registry = JSON.parse(readFileSync('tools/ontology/assets/registry.json', 'utf8')) as { id: string; nativeHeightM?: number }[];
/** A minimal ontology entity; appearancePlan reads id, appearanceSeed, social and gameplay.equipment only. */
const entity = (id: string, appearanceSeed: number) => ({ id, appearanceSeed, social: {}, gameplay: { equipment: [] } }) as never;

describe('creator bodies and seeded appearance (parity with the ontology editor)', () => {
  it('selects exactly the bodies the current Human family selects', () => {
    for (const v of family.variants) {
      const b = Object.values(CREATOR_BODIES).find(x => x.sex === v.sex)!;
      expect(b.assetId).toBe(v.assetId); expect(b.nativeHeightM).toBe(registry.find(r => r.id === v.assetId)!.nativeHeightM);
    }
  });
  it('produces the same jaw and palettes as appearancePlan for many identities', () => {
    for (const [id, seed] of [['climber-a', 0], ['climber-b', 0], ['climber-a', 7], ['3f2c9a10-uuid', 0]] as const) {
      const ours = creatorAppearance({ id, appearanceSeed: seed }, CREATOR_BODIES.creator_male), theirs = appearancePlan(entity(id, seed), 'tv-human-male-v2');
      expect(ours.jaw).toBe(theirs.jaw); expect(ours.linen).toEqual(theirs.linen); expect(ours.leather).toEqual(theirs.leather); expect(ours.supported).toBe(theirs.supported);
      expect(variation({ id, appearanceSeed: seed }, 'face')).toBe(ontologyVariation(entity(id, seed), 'face'));
    }
  });
  it('gives different identities different male appearance, and reports the female body as unsupported', () => {
    const a = creatorAppearance({ id: 'climber-a', appearanceSeed: 0 }, CREATOR_BODIES.creator_male), b = creatorAppearance({ id: 'climber-b', appearanceSeed: 0 }, CREATOR_BODIES.creator_male);
    expect(a.jaw).not.toBe(b.jaw); expect(a.linen).not.toEqual(b.linen);
    expect(creatorAppearance({ id: 'climber-a', appearanceSeed: 0 }, CREATOR_BODIES.creator_female).supported).toBe(appearancePlan(entity('climber-a', 0), 'tv-human-female-v1').supported);
  });
  it('recognises only its own looks', () => {
    expect(isCreatorLook('creator_male')).toBe(true); expect(isCreatorLook('ranger')).toBe(false);
    expect(isCreatorLook('toString')).toBe(false); expect(isCreatorLook('constructor')).toBe(false);
  });
});

describe('saved creator customization', () => {
  it('validates stored data: clamps ranges, drops junk, defaults wrong types', () => {
    expect(parseCustomization(null)).toEqual(DEFAULT_CUSTOMIZATION);
    expect(parseCustomization({ body: 'female', height: 2, hair: false, jaw: -1, seed: 7.9, extra: 1 })).toEqual({ body: 'female', height: 1.05, hair: false, jaw: 0, seed: 7 });
    expect(parseCustomization({ body: 'toString', height: 'tall', hair: 'no', jaw: NaN, seed: -5 })).toEqual({ body: 'male', height: 1, hair: true, jaw: null, seed: 0 });
    expect(parseCustomization({ height: .9 }).height).toBe(.95);
  });
  it('maps bodies and offers only the controls each body supports', () => {
    expect(bodyLook(parseCustomization({ body: 'female' }))).toBe('creator_female');
    expect(supportedControls('creator_male')).toEqual({ height: true, hair: true, jaw: true, reroll: true });
    expect(supportedControls('creator_female')).toEqual({ height: true, hair: true, jaw: false, reroll: false });
  });
});
