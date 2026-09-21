import { describe, expect, it } from 'vitest';
import { projectAppearanceDescription } from '../src/sim/core/appearance';
import type { ProjectedAppearanceDescription } from '../src/sim/core/appearance';
import type { Occupation, Person } from '../src/sim/core/types';
import { RNG } from '../src/sim/core/rng';
import { newWorld } from '../src/sim/persist/save';
import { CHARACTER_ARCHETYPES } from '../src/sim/world/characterArchetypes';
import { resolveAppearance } from '../src/sim/world/characterAppearance';
import { EMPTY_CATALOGUE, animatableSkeletons, catalogueCoverage, parseCatalogue } from '../src/foundry/catalogue';
import { slotRules } from '../src/foundry/manifest';
import { realizeCharacter, reportPopulation } from '../src/foundry/resolve';
import type { CharacterRealization, RealizationInput } from '../src/foundry/resolve';
import { FIXTURE_FOREIGN_SKELETON, FIXTURE_MOTION_RIG, foreignSkeletonCatalogue, mannequinOnlyCatalogue, placeholderAndRealCatalogue, richCatalogue, sparseCatalogue } from './fixtures/characterCatalogue';

const SEED = 4242;

function inputFor(person: Person): RealizationInput {
  return {
    entityId: person.id,
    identity: person.slug ?? person.id,
    seed: SEED,
    traits: projectAppearanceDescription(person.appearance.description!, person.age, person.occupation),
    appearance: {
      skin: person.appearance.skin, hair: person.appearance.hair,
      shirt: person.appearance.shirt, pants: person.appearance.pants,
      ...(person.appearance.apron !== undefined ? { apron: person.appearance.apron } : {}),
      height: person.appearance.height, build: person.appearance.build,
    },
  };
}

/** A synthetic person, for spanning combinations a single village does not happen to contain. */
function syntheticInput(o: { identity: string; age: number; gender: 'm' | 'f'; occupation: Occupation; wealth: number; archetype?: string }): RealizationInput {
  const appearance = resolveAppearance({ seed: SEED, identity: o.identity, age: o.age, gender: o.gender, occupation: o.occupation, wealth: o.wealth, archetype: o.archetype });
  return {
    entityId: o.identity, identity: o.identity, seed: SEED,
    traits: projectAppearanceDescription(appearance.description!, o.age, o.occupation),
    appearance: {
      skin: appearance.skin, hair: appearance.hair, shirt: appearance.shirt, pants: appearance.pants,
      ...(appearance.apron !== undefined ? { apron: appearance.apron } : {}),
      height: appearance.height, build: appearance.build,
    },
  };
}

const slotOf = (realization: CharacterRealization, slot: string) => realization.slots.find(s => s.slot === slot);

describe('audited modular geometry', () => {
  const input = () => syntheticInput({ identity: 'fit-check', age: 29, gender: 'f', occupation: 'baker', wealth: 40 });

  it('keeps clothing on its audited body build even when skeleton assets are shared', () => {
    const catalogue = richCatalogue();
    catalogue.entries = catalogue.entries.filter(e => e.slot !== 'body' || e.name === 'SKM_Body_F_Adult');
    catalogue.entries.find(e => e.slot === 'body')!.fitFamily = 'female-average';
    for (const entry of catalogue.entries.filter(e => e.slot === 'upperGarment')) entry.fits = ['male-heavy'];
    const shirt = catalogue.entries.find(e => e.slot === 'upperGarment')!;
    const fitting = { ...shirt, package: '/Game/Fixture/FittingShirt', fits: ['female-average'] };
    catalogue.entries.push(fitting);
    expect(slotOf(realizeCharacter(input(), catalogue), 'upperGarment')?.package).toBe(fitting.package);
    catalogue.entries = catalogue.entries.filter(e => e !== fitting);
    expect(slotOf(realizeCharacter(input(), catalogue), 'upperGarment')).toBeUndefined();
  });

  it('does not layer geometry over slots already included in a complete outfit', () => {
    const catalogue = mannequinOnlyCatalogue();
    const body = catalogue.entries.find(e => e.slot === 'body')!;
    body.covers = ['head', 'upperGarment', 'lowerGarment', 'footwear'];
    catalogue.entries = [body, ...richCatalogue().entries.filter(e => e.slot !== 'body')];
    const result = realizeCharacter(input(), catalogue);
    expect(result.complete).toBe(true);
    for (const slot of body.covers) expect(slotOf(result, slot)).toBeUndefined();
  });

  it('does not choose a fragment as a standalone body', () => {
    const catalogue = richCatalogue();
    for (const entry of catalogue.entries) if (entry.slot === 'body') entry.assemblyOnly = true;
    expect(realizeCharacter(input(), catalogue).complete).toBe(false);
  });

  it('requires an active adapter when the audit provides runtime compatibility', () => {
    const catalogue = foreignSkeletonCatalogue();
    catalogue.runtimeSkeletons = [];
    expect(animatableSkeletons(catalogue).has(FIXTURE_FOREIGN_SKELETON)).toBe(false);
    catalogue.runtimeSkeletons = [FIXTURE_FOREIGN_SKELETON];
    expect(animatableSkeletons(catalogue).has(FIXTURE_FOREIGN_SKELETON)).toBe(true);
  });

  it('retains fit and coverage metadata through catalogue parsing', () => {
    const catalogue = richCatalogue();
    Object.assign(catalogue.entries[0], { fitFamily: 'average', fits: ['average'], covers: ['head'], assemblyOnly: true });
    catalogue.runtimeSkeletons = [catalogue.animationTarget!];
    const parsed = parseCatalogue(catalogue).catalogue;
    expect(parsed.entries[0]).toMatchObject({ fitFamily: 'average', fits: ['average'], covers: ['head'], assemblyOnly: true });
    expect(parsed.runtimeSkeletons).toEqual(catalogue.runtimeSkeletons);
  });
});

describe('catalogue parsing', () => {
  it('drops malformed entries instead of throwing, and says which', () => {
    const { catalogue, problems } = parseCatalogue({
      schema: 1, generatedAt: 'x', skeletons: [], retargeters: [],
      entries: [
        { package: '/Game/Good', slot: 'body', tags: ['male'] },
        { package: '/Game/BadSlot', slot: 'spleen', tags: [] },
        { slot: 'body', tags: [] },
        'not an object',
      ],
    });
    expect(catalogue.entries).toHaveLength(1);
    expect(catalogue.entries[0].package).toBe('/Game/Good');
    expect(problems).toHaveLength(3);
    expect(problems.every(p => p.kind === 'dropped')).toBe(true);
  });

  it('rejects an unsupported schema without pretending to understand it', () => {
    const { catalogue, problems } = parseCatalogue({ schema: 99, entries: [{ package: '/Game/X', slot: 'body', tags: [] }] });
    expect(catalogue).toEqual(EMPTY_CATALOGUE);
    expect(problems[0].kind).toBe('rejected');
  });

  it('treats a non-object as an empty catalogue rather than a crash', () => {
    for (const bad of [null, undefined, 7, 'catalogue', []]) {
      expect(parseCatalogue(bad).catalogue.entries).toHaveLength(0);
    }
  });

  it('counts only skeletons this project can actually animate', () => {
    const rich = richCatalogue();
    expect(animatableSkeletons(rich).has(rich.animationTarget!)).toBe(true);
    expect(animatableSkeletons(rich).has(FIXTURE_FOREIGN_SKELETON)).toBe(false);
    const retargeted = { ...rich, retargeters: [{ package: '/Game/RTG', sourceSkeleton: FIXTURE_FOREIGN_SKELETON, targetSkeleton: rich.animationTarget }] };
    expect(animatableSkeletons(retargeted).has(FIXTURE_FOREIGN_SKELETON)).toBe(true);
  });

  it('accepts a retarget bridge authored in either direction', () => {
    const rich = richCatalogue();
    // Posing a foreign BODY from the driver is authored target-as-source; retargeting a motion
    // pack's CLIPS onto the driver is authored the other way round. Both are the same bone-chain
    // mapping, so either one makes that rig reachable.
    const driverToBody = { ...rich, retargeters: [{ package: '/Game/RTG', sourceSkeleton: rich.animationTarget, targetSkeleton: FIXTURE_FOREIGN_SKELETON }] };
    expect(animatableSkeletons(driverToBody).has(FIXTURE_FOREIGN_SKELETON)).toBe(true);
  });

  it('ignores a retargeter that does not involve the animation target', () => {
    const rich = richCatalogue();
    const unrelated = { ...rich, retargeters: [{ package: '/Game/RTG', sourceSkeleton: '/Game/A/SK_A', targetSkeleton: '/Game/B/SK_B' }] };
    const usable = animatableSkeletons(unrelated);
    expect(usable.has('/Game/A/SK_A')).toBe(false);
    expect(usable.has('/Game/B/SK_B')).toBe(false);
  });

  it('reaches a motion pack rig through the one retargeter the project owns', () => {
    expect(animatableSkeletons(mannequinOnlyCatalogue()).has(FIXTURE_MOTION_RIG)).toBe(true);
  });
});

describe('the manifest asks for parts, not assets', () => {
  it('never names an asset path', () => {
    const traits = projectAppearanceDescription(resolveAppearance({ seed: 1, identity: 'x', age: 40, gender: 'f', occupation: 'baker', wealth: 40 }).description!, 40, 'baker');
    for (const rule of slotRules(traits)) {
      for (const tag of [...rule.required, ...rule.preferred]) expect(tag).not.toContain('/Game/');
    }
  });

  it('always requires a body and a head, and never makes them optional', () => {
    const traits = projectAppearanceDescription(resolveAppearance({ seed: 1, identity: 'x', age: 9, gender: 'm', occupation: 'child', wealth: 0 }).description!, 9, 'child');
    const rules = slotRules(traits);
    expect(rules.find(r => r.slot === 'body')?.optional).toBe(false);
    expect(rules.find(r => r.slot === 'head')?.optional).toBe(false);
  });

  it('never lets an open over-layer be somebody\'s only upper garment', () => {
    // A haori is open at the front, and a City Sample body is hands only -- there is no torso
    // under it. One resolving as the upper garment is therefore a hole in the chest, which is
    // what the Ashford 33 had on a miller, a woodcutter and a bandit: it was answering `coat`
    // and `kimono` because those were honest tags for it. It is an accessory now, and the
    // travelling silhouettes take a kosode underneath.
    const base = resolveAppearance({ seed: 3, identity: 'woodcutter', age: 34, gender: 'm', occupation: 'woodcutter', wealth: 60 }).description!;
    const travelling: ProjectedAppearanceDescription = { ...projectAppearanceDescription(base, 34, 'woodcutter'), garmentSilhouette: 'travel_coat' };
    const rules = slotRules(travelling);
    const upper = rules.find(r => r.slot === 'upperGarment');
    expect(upper).toBeDefined();
    expect(upper!.required).not.toContain('haori');
    expect(rules.some(r => r.slot === 'accessory' && r.required.includes('haori'))).toBe(true);

    const input = syntheticInput({ identity: 'foundry:woodcutter', age: 34, gender: 'm', occupation: 'woodcutter', wealth: 60 });
    const realization = realizeCharacter({ ...input, traits: travelling }, richCatalogue());
    const upperMesh = realization.slots.find(s => s.slot === 'upperGarment');
    expect(upperMesh).toBeDefined();
    expect(upperMesh!.name.toLowerCase()).not.toContain('haori');
  });

  it('dresses even ceremonial wear as two pieces, and ties every wrapped silhouette', () => {
    // Ashford has no one-piece robe. All eight reference sheets show an upper layer over a
    // separate lower one, so no silhouette populates `GarmentShape.robe` and the `robe` slot is
    // never requested -- which also keeps a robe from resolving *alongside* an upper and a lower
    // and stacking two garments on one torso, since `covers` is honoured only from the body.
    const base = resolveAppearance({ seed: 1, identity: 'priest', age: 60, gender: 'm', occupation: 'priest', wealth: 200 }).description!;
    const robed: ProjectedAppearanceDescription = { ...projectAppearanceDescription(base, 60, 'priest'), garmentSilhouette: 'ceremonial_robe' };
    const tunicked: ProjectedAppearanceDescription = { ...robed, garmentSilhouette: 'tunic_trousers' };
    for (const traits of [robed, tunicked]) {
      expect(slotRules(traits).some(r => r.slot === 'robe')).toBe(false);
      expect(slotRules(traits).some(r => r.slot === 'upperGarment')).toBe(true);
      expect(slotRules(traits).some(r => r.slot === 'lowerGarment')).toBe(true);
    }
    // The sash is part of how a wrapped garment is fastened, not an ornament somebody might own.
    const obi = (traits: ProjectedAppearanceDescription) =>
      slotRules(traits).some(r => r.slot === 'accessory' && r.required.includes('obi'));
    expect(obi(robed)).toBe(true);
    expect(obi({ ...robed, garmentSilhouette: 'work_kimono' })).toBe(true);
    expect(obi(tunicked)).toBe(false);
  });
});

describe('stage B — one complete person', () => {
  const person = syntheticInput({ identity: 'foundry:one', age: 46, gender: 'm', occupation: 'smith', wealth: 80 });

  it('assembles a body, head, hair, clothing and footwear on the animation skeleton', () => {
    const catalogue = richCatalogue();
    const realization = realizeCharacter(person, catalogue);
    expect(realization.complete).toBe(true);
    expect(realization.skeleton).toBe(catalogue.animationTarget);
    for (const slot of ['body', 'head', 'hair', 'upperGarment', 'lowerGarment', 'footwear']) {
      expect(slotOf(realization, slot), slot).toBeDefined();
    }
    expect(realization.problems.filter(p => p.kind === 'no-match' || p.kind === 'slot-empty')).toHaveLength(0);
  });

  it('carries the trade\'s own prop', () => {
    const realization = realizeCharacter(person, richCatalogue());
    expect(realization.slots.filter(s => s.slot === 'accessory').map(s => s.name)).toContain('SM_Hammer');
  });

  it('drives materials and scale from canonical appearance, not from the catalogue', () => {
    const realization = realizeCharacter(person, richCatalogue());
    expect(realization.materials.skin).toBe(person.appearance.skin);
    expect(realization.materials.hair).toBe(person.appearance.hair);
    expect(realization.materials.garmentPrimary).toBe(person.appearance.shirt);
    expect(realization.scale).toEqual({ height: person.appearance.height, build: person.appearance.build });
    // The same values survive with no catalogue at all.
    const bare = realizeCharacter(person, EMPTY_CATALOGUE);
    expect(bare.materials).toEqual(realization.materials);
    expect(bare.scale).toEqual(realization.scale);
  });

  it('only requests morph targets the chosen body actually exposes', () => {
    const realization = realizeCharacter(person, richCatalogue());
    const body = slotOf(realization, 'body')!;
    const entry = richCatalogue().entries.find(e => e.package === body.package)!;
    for (const name of Object.keys(realization.morphs)) expect(entry.morphTargets).toContain(name);
    expect(Object.keys(realization.morphs).length).toBeGreaterThan(0);

    const withoutMorphs = { ...richCatalogue(), entries: richCatalogue().entries.map(e => ({ ...e, morphTargets: undefined })) };
    expect(realizeCharacter(person, withoutMorphs).morphs).toEqual({});
  });

  it('is deterministic across repeated realizations', () => {
    const catalogue = richCatalogue();
    expect(realizeCharacter(person, catalogue)).toEqual(realizeCharacter(person, catalogue));
  });

  it('does not depend on the order the catalogue was scanned in', () => {
    const forward = richCatalogue();
    const reversed = { ...forward, entries: [...forward.entries].reverse() };
    expect(realizeCharacter(person, reversed).slots).toEqual(realizeCharacter(person, forward).slots);
  });

  it('never combines leader-posed parts from different skeletons', () => {
    const catalogue = richCatalogue();
    catalogue.retargeters.push({ package: '/Game/RTG_Foreign', sourceSkeleton: FIXTURE_FOREIGN_SKELETON, targetSkeleton: catalogue.animationTarget });
    catalogue.entries = catalogue.entries.map(entry => entry.slot === 'head'
      ? { ...entry, skeleton: FIXTURE_FOREIGN_SKELETON }
      : entry);
    const realization = realizeCharacter(person, catalogue);
    expect(realization.slots.find(slot => slot.slot === 'body')).toBeDefined();
    expect(realization.slots.find(slot => slot.slot === 'head')).toBeUndefined();
    expect(realization.complete).toBe(false);
    expect(realization.problems.map(problem => problem.kind)).toContain('required-slot-unresolved');
  });
});

describe('stage C — ten visibly different residents', () => {
  const cohort: RealizationInput[] = [
    syntheticInput({ identity: 'c1', age: 9, gender: 'm', occupation: 'child', wealth: 0 }),
    syntheticInput({ identity: 'c2', age: 17, gender: 'f', occupation: 'server', wealth: 10 }),
    syntheticInput({ identity: 'c3', age: 24, gender: 'm', occupation: 'guard', wealth: 30, archetype: 'kaito' }),
    syntheticInput({ identity: 'c4', age: 31, gender: 'f', occupation: 'hunter', wealth: 35, archetype: 'ayami' }),
    syntheticInput({ identity: 'c5', age: 38, gender: 'm', occupation: 'captain', wealth: 180, archetype: 'shogun' }),
    syntheticInput({ identity: 'c6', age: 42, gender: 'f', occupation: 'merchant', wealth: 420, archetype: 'yuki' }),
    syntheticInput({ identity: 'c7', age: 47, gender: 'f', occupation: 'baker', wealth: 45, archetype: 'hana' }),
    syntheticInput({ identity: 'c8', age: 55, gender: 'm', occupation: 'vagrant', wealth: 1, archetype: 'ren' }),
    syntheticInput({ identity: 'c9', age: 63, gender: 'm', occupation: 'priest', wealth: 90, archetype: 'ascetic' }),
    syntheticInput({ identity: 'c10', age: 71, gender: 'f', occupation: 'herbalist', wealth: 12, archetype: 'shiro' }),
  ];

  it('realizes all ten completely', () => {
    const report = reportPopulation(cohort.map(person => realizeCharacter(person, richCatalogue())));
    expect(report.people).toBe(10);
    expect(report.complete).toBe(10);
  });

  it('gives them meaningfully different bodies, heads and outfits', () => {
    const realizations = cohort.map(person => realizeCharacter(person, richCatalogue()));
    const report = reportPopulation(realizations);
    expect(report.distinctConfigurations).toBe(10);
    expect(report.distinctOutfits).toBeGreaterThanOrEqual(8);
    expect(report.distinctBodies).toBeGreaterThanOrEqual(5);
    expect(report.distinctHeads).toBeGreaterThanOrEqual(5);
  });

  it('puts the child on a child body and the elders on elder bodies', () => {
    const [child] = cohort;
    expect(slotOf(realizeCharacter(child, richCatalogue()), 'body')!.name).toContain('Child');
    const elder = realizeCharacter(cohort[9], richCatalogue());
    expect(slotOf(elder, 'body')!.name).toContain('Elder');
  });

  it('never dresses anybody in a part their own description did not ask for', () => {
    for (const person of cohort) {
      const realization = realizeCharacter(person, richCatalogue());
      const wanted = new Set(slotRules(person.traits).map(rule => rule.slot));
      for (const slot of realization.slots) expect(wanted.has(slot.slot), `${person.identity}: ${slot.slot}`).toBe(true);
    }
  });
});

describe('stage D — an Ashford settlement sample', () => {
  const { world } = newWorld(1337);
  const people = world.persons().filter(p => p.alive && p.appearance.description);
  const realizations = people.map(person => realizeCharacter(inputFor(person), richCatalogue()));

  it('realizes every resident completely', () => {
    expect(people.length).toBeGreaterThan(20);
    const report = reportPopulation(realizations);
    expect(report.complete).toBe(report.people);
    expect(report.problemsByKind['no-match'] ?? 0).toBe(0);
    expect(report.problemsByKind['slot-empty'] ?? 0).toBe(0);
  });

  it('avoids a village of identical heads and repeated outfits', () => {
    const report = reportPopulation(realizations);
    // Configuration includes accessories and so should be near-unique...
    expect(report.distinctConfigurations / report.people).toBeGreaterThan(0.8);
    // ...while heads and outfits are drawn from a bounded pack and only need real spread.
    expect(report.distinctHeads).toBeGreaterThanOrEqual(6);
    expect(report.distinctOutfits / report.people).toBeGreaterThan(0.45);
  });

  it('never puts a farmer in fine lamellar or a captain in rags', () => {
    for (const [index, person] of people.entries()) {
      const realization = realizations[index];
      const names = realization.slots.map(s => s.name).join(' ');
      if (person.occupation === 'farmer') expect(names, person.name).not.toContain('Armor');
      if (realization.slots.some(s => s.name.includes('Rags'))) {
        expect(['destitute', 'poor']).toContain(person.appearance.description!.status);
      }
    }
  });

  it('keeps every resident on the one animation skeleton', () => {
    const target = richCatalogue().animationTarget;
    for (const realization of realizations) expect(realization.skeleton).toBe(target);
  });
});

describe('the grey template body is a floor, not a competitor', () => {
  /**
   * Found by looking at a PIE settlement rather than at a report: ten of thirty-three residents
   * were rendering as Epic's untextured mannequin while real character content sat unused in the
   * catalogue. Nothing had failed — Quinn genuinely carries `female`, `adult` and `slim`, so she
   * tied with a vendor's modular torso on every ranked preference and won the coin flip.
   */
  it('never picks a placeholder while a real body with the same tags exists', () => {
    const catalogue = placeholderAndRealCatalogue();
    // Across many identities, not one: the old behaviour was a tie-break, so a single person
    // proves nothing. Which real body a person gets is the rules' business and varies with their
    // generated frame and presentation; the claim under test is only that it is a real one.
    const chosen = new Set<string>();
    for (let index = 0; index < 40; index++) {
      for (const gender of ['f', 'm'] as const) {
        const person = syntheticInput({ identity: `villager-${gender}-${index}`, age: 34, gender, occupation: gender === 'f' ? 'baker' : 'smith', wealth: 40 });
        const body = slotOf(realizeCharacter(person, catalogue), 'body')!;
        expect(body.name.startsWith('SKM_')).toBe(false);
        expect(body.relaxed).not.toContain('!placeholder');
        chosen.add(body.name);
      }
    }
    // Both real bodies are still reachable, so this is a preference change, not a hard filter
    // that would have collapsed everyone onto one mesh.
    expect(chosen).toEqual(new Set(['SK_Villager_F', 'SK_Villager_M']));
  });

  it('still uses a placeholder when it is the only body installed', () => {
    // Forbidding is not removing: `resolveSlot` gives up forbidden tags only after every
    // relaxation step, so a machine with no character packs still puts a person on screen.
    const realization = realizeCharacter(
      syntheticInput({ identity: 'bare-machine', age: 34, gender: 'f', occupation: 'baker', wealth: 40 }),
      mannequinOnlyCatalogue());
    expect(slotOf(realization, 'body')!.name).toBe('SKM_Quinn_Simple');
    expect(realization.complete).toBe(true);
    // And it says out loud that it had to, so "everyone is a mannequin" stays measurable.
    expect(slotOf(realization, 'body')!.relaxed).toContain('!placeholder');
  });
});

describe('fallback — the simulation never depends on an asset existing', () => {
  const person = syntheticInput({ identity: 'fallback', age: 40, gender: 'f', occupation: 'baker', wealth: 45 });

  it('with no catalogue at all, still returns a usable realization and says why it is bare', () => {
    const realization = realizeCharacter(person, EMPTY_CATALOGUE);
    expect(realization.slots).toHaveLength(0);
    expect(realization.complete).toBe(false);
    expect(realization.problems.map(p => p.kind)).toContain('no-catalogue');
    expect(realization.materials.skin).toBe(person.appearance.skin);
  });

  it('with a sparse catalogue, relaxes requirements and reports each relaxation', () => {
    const realization = realizeCharacter(person, sparseCatalogue());
    expect(realization.complete).toBe(true);
    expect(slotOf(realization, 'body')!.name).toBe('SKM_Body_Generic');
    expect(realization.problems.some(p => p.kind === 'relaxed')).toBe(true);
    // The slots the thin pack simply does not have are named, not silently skipped.
    const missing = realization.problems.filter(p => p.kind === 'slot-empty').map(p => p.slot);
    expect(missing).toContain('footwear');
    expect(missing).toContain('hair');
  });

  it('treats a monolithic whole-body character as a finished person, not a headless one', () => {
    const realization = realizeCharacter(person, mannequinOnlyCatalogue());
    // A single-mesh character carries its own head, so completeness must not hinge on a separate
    // head asset that no pack could supply for this body.
    expect(realization.complete).toBe(true);
    expect(slotOf(realization, 'body')).toBeDefined();
    expect(slotOf(realization, 'head')).toBeUndefined();
    expect(realization.problems.some(p => p.slot === 'head')).toBe(false);
    // The genuine content gaps are still reported, because they are real and fillable.
    const missing = realization.problems.filter(p => p.kind === 'slot-empty').map(p => p.slot);
    expect(missing).toContain('hair');
    expect(missing).toContain('upperGarment');
  });

  it('still honours presentation when the only bodies are the two engine mannequins', () => {
    const catalogue = mannequinOnlyCatalogue();
    const woman = realizeCharacter(syntheticInput({ identity: 'w', age: 34, gender: 'f', occupation: 'baker', wealth: 40 }), catalogue);
    const man = realizeCharacter(syntheticInput({ identity: 'm', age: 34, gender: 'm', occupation: 'smith', wealth: 40 }), catalogue);
    expect(slotOf(woman, 'body')!.name).toBe('SKM_Quinn_Simple');
    expect(slotOf(man, 'body')!.name).toBe('SKM_Manny_Simple');
  });

  it('refuses assets on a skeleton this project cannot animate, and says so', () => {
    const realization = realizeCharacter(person, foreignSkeletonCatalogue());
    expect(realization.complete).toBe(false);
    expect(realization.problems.map(p => p.kind)).toContain('skeleton-incompatible');
    expect(realization.problems.map(p => p.kind)).toContain('required-slot-unresolved');
  });

  it('deliberately breaking one mapping loses that part and nothing else', () => {
    const intact = richCatalogue();
    const whole = realizeCharacter(person, intact);
    expect(slotOf(whole, 'hair')).toBeDefined();

    const broken = { ...intact, entries: intact.entries.filter(e => e.slot !== 'hair') };
    const damaged = realizeCharacter(person, broken);
    expect(slotOf(damaged, 'hair')).toBeUndefined();
    expect(damaged.complete).toBe(true);
    expect(damaged.problems.some(p => p.kind === 'slot-empty' && p.slot === 'hair')).toBe(true);
    // Every other slot resolves exactly as before: one missing pack does not reshuffle a person.
    // Compared as sets, because `accessory` legitimately appears several times over.
    const parts = (r: CharacterRealization) => r.slots.filter(s => s.slot !== 'hair').map(s => `${s.slot}=${s.package}`).sort();
    expect(parts(damaged)).toEqual(parts(whole));
  });

  it('leaves canonical state untouched no matter how bad the catalogue is', () => {
    const { world } = newWorld(999);
    const before = world.persons().map(p => JSON.stringify(p.appearance));
    for (const catalogue of [EMPTY_CATALOGUE, sparseCatalogue(), foreignSkeletonCatalogue(), richCatalogue()]) {
      for (const p of world.persons()) realizeCharacter(inputFor(p), catalogue);
    }
    expect(world.persons().map(p => JSON.stringify(p.appearance))).toEqual(before);
  });

  it('never draws from the world behaviour streams', () => {
    const { world } = newWorld(31337);
    const before = [world.rng.state(), world.weatherRng.state(), world.demographicRng.state()];
    for (const p of world.persons()) realizeCharacter(inputFor(p), richCatalogue());
    expect([world.rng.state(), world.weatherRng.state(), world.demographicRng.state()]).toEqual(before);
  });
});

describe('coverage reporting', () => {
  it('counts what a machine can dress a population from', () => {
    const coverage = catalogueCoverage(richCatalogue());
    expect(coverage.body).toBeGreaterThan(4);
    expect(coverage.accessory).toBeGreaterThan(10);
    expect(catalogueCoverage(EMPTY_CATALOGUE).body).toBe(0);
  });

  it('turns unmet requests into a shopping list rather than a mystery', () => {
    const rng = new RNG(7);
    const people = Array.from({ length: 40 }, (_, i) => syntheticInput({
      identity: `shop_${i}`, age: rng.int(8, 75), gender: rng.chance(0.5) ? 'm' : 'f',
      occupation: rng.pick(['farmer', 'guard', 'priest', 'merchant', 'server', 'hunter'] as Occupation[]), wealth: rng.int(0, 300),
    }));
    const report = reportPopulation(people.map(p => realizeCharacter(p, sparseCatalogue())));
    expect(report.unmet.length).toBeGreaterThan(0);
    for (const gap of report.unmet) expect(gap).toMatch(/^[a-zA-Z]+:\[/);
  });

  it('every archetype can be realized by the fixture pack', () => {
    for (const archetype of CHARACTER_ARCHETYPES) {
      const person = syntheticInput({
        identity: `arch_${archetype.id}`, age: 34,
        gender: archetype.fits.gender?.[0] ?? 'f', occupation: 'villager', wealth: 60, archetype: archetype.id,
      });
      const realization = realizeCharacter(person, richCatalogue());
      expect(realization.complete, archetype.id).toBe(true);
    }
  });
});
