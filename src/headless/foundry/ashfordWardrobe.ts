import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { GARMENT_PALETTES, projectAppearanceDescription } from '../../sim/core/appearance';
import type { Person } from '../../sim/core/types';
import { newWorld } from '../../sim/persist/save';
import { DEFAULT_CATALOGUE_PATH, loadCatalogue } from '../../foundry/load';
import { realizeCharacter } from '../../foundry/resolve';
import type { CharacterRealization, RealizationInput } from '../../foundry/resolve';

/**
 * `npm run ashford:wardrobe -- [seed] [count] [cataloguePath] [outDir]`
 *
 * What the Ashford wardrobe did to a population, measured rather than photographed.
 *
 * `foundry:report` already answers "did every resident resolve". This answers the questions that
 * only matter once a culture's own clothing exists:
 *
 * - how many residents are still in another culture's clothes, and which garment;
 * - how many distinct outfits there are, and how big the largest identical group is, because a
 *   settlement of thirty-three people in one kimono is not an improvement on thirty-three people
 *   in one business suit;
 * - whether occupation still reads -- a smith and a priest should not resolve to the same thing;
 * - how much of the palette is in use, since the whole point of tinting per person is that the
 *   crowd is not monochrome.
 *
 * A screenshot can show a good frame. None of this can be cropped.
 */
const seed = Number(process.argv[2] ?? 1337);
const count = Number(process.argv[3] ?? 0);
const cataloguePath = process.argv[4] ?? DEFAULT_CATALOGUE_PATH;
const outDir = process.argv[5] ?? '.debug/character-foundry';

const ASHFORD = '/Game/TornVeil/Characters/Ashford/';
const GARMENT_SLOTS = ['upperGarment', 'lowerGarment', 'footwear', 'robe', 'armor'];

const loaded = loadCatalogue(cataloguePath);
const { world } = newWorld(seed);
const everyone = world.persons().filter((p: Person) => p.alive && p.appearance.description);
const people = count > 0 ? everyone.slice(0, count) : everyone;

/** `SKM_TV_Kosode_Work_female_nrw` -> `Kosode_Work`: the garment, not the fit variant. */
const piece = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!name.startsWith('SKM_TV_')) return name;
  const parts = name.slice('SKM_TV_'.length).split('_');
  return parts.slice(0, Math.max(1, parts.length - 2)).join('_');
};

const rows = people.map((person: Person) => {
  const traits = projectAppearanceDescription(person.appearance.description!, person.age, person.occupation);
  const input: RealizationInput = {
    entityId: person.id,
    identity: person.slug ?? person.id,
    seed: world.seed,
    traits,
    appearance: {
      skin: person.appearance.skin, hair: person.appearance.hair,
      shirt: person.appearance.shirt, pants: person.appearance.pants,
      ...(person.appearance.apron !== undefined ? { apron: person.appearance.apron } : {}),
      height: person.appearance.height, build: person.appearance.build,
    },
  };
  const realization: CharacterRealization = realizeCharacter(input, loaded.catalogue);
  const worn = realization.slots.filter(s => GARMENT_SLOTS.includes(s.slot) || s.slot === 'accessory');
  const ashford = worn.filter(s => s.package.startsWith(ASHFORD));
  // Only *garment* slots count as foreign clothing. A body from another pack is not a wardrobe
  // failure, and the bodies that carry their own baked-in clothing are counted separately below.
  const foreign = realization.slots
    .filter(s => GARMENT_SLOTS.includes(s.slot) && !s.package.startsWith(ASHFORD));
  const body = realization.slots.find(s => s.slot === 'body');
  const entry = body && loaded.catalogue?.entries.find(e => e.package === body.package);
  return {
    identity: person.slug ?? person.id,
    occupation: person.occupation,
    station: traits.status,
    silhouette: traits.garmentSilhouette,
    palette: traits.garmentPalette,
    presentation: traits.presentation,
    fitFamily: entry?.fitFamily,
    // A body whose clothing is part of the body mesh declares it, and no garment is ever requested
    // for such a person -- so they are not dressed in modern clothes, they are simply not dressable
    // by any wardrobe at all until that pack is replaced.
    dressable: !(entry?.covers ?? []).some(slot => GARMENT_SLOTS.includes(slot)),
    pieces: [...new Set(ashford.map(s => piece(s.package)))].sort(),
    foreignGarments: foreign.map(s => s.name),
    complete: realization.complete,
  };
});

const dressable = rows.filter(r => r.dressable);
const outfits = new Map<string, number>();
for (const row of dressable) {
  const key = row.pieces.join('+') || '(none)';
  outfits.set(key, (outfits.get(key) ?? 0) + 1);
}
const byOccupation = new Map<string, Set<string>>();
for (const row of dressable) {
  const set = byOccupation.get(row.occupation) ?? new Set<string>();
  set.add(row.pieces.join('+'));
  byOccupation.set(row.occupation, set);
}

const summary = {
  seed,
  people: rows.length,
  complete: rows.filter(r => r.complete).length,
  dressable: dressable.length,
  notDressable: rows.length - dressable.length,
  notDressableReason: 'body mesh declares `covers` for its garment slots; no garment is requested',
  wearingAshford: dressable.filter(r => r.pieces.length > 0).length,
  wearingForeignGarments: rows.filter(r => r.foreignGarments.length > 0).length,
  foreignGarmentsByPerson: Object.fromEntries(
    rows.filter(r => r.foreignGarments.length).map(r => [r.identity, r.foreignGarments])),
  distinctOutfits: outfits.size,
  largestIdenticalGroup: Math.max(0, ...outfits.values()),
  outfitCounts: Object.fromEntries([...outfits].sort((a, b) => b[1] - a[1])),
  palettesInUse: [...new Set(dressable.map(r => r.palette))].sort(),
  palettesAvailable: Object.keys(GARMENT_PALETTES).length,
  presentationCoverage: Object.fromEntries(
    [...new Set(dressable.map(r => r.presentation))].map(p =>
      [p, dressable.filter(r => r.presentation === p).length])),
  fitFamiliesInUse: Object.fromEntries(
    [...new Set(dressable.map(r => r.fitFamily).filter(Boolean))].map(f =>
      [f as string, dressable.filter(r => r.fitFamily === f).length])),
  pieceUsage: Object.fromEntries(
    [...new Set(dressable.flatMap(r => r.pieces))].sort().map(p =>
      [p, dressable.filter(r => r.pieces.includes(p)).length])),
  // One outfit shared by two occupations is fine; a settlement where every trade resolves to the
  // same thing is the clone problem wearing a kimono.
  occupationsWithOwnOutfit: [...byOccupation].filter(([, set]) => set.size > 0).length,
  occupations: Object.fromEntries([...byOccupation].map(([k, v]) => [k, [...v]])),
  people_: rows,
};

mkdirSync(dirname(`${outDir}/x`), { recursive: true });
const path = `${outDir}/ashford-wardrobe-${rows.length}.json`;
writeFileSync(path, JSON.stringify(summary, null, 1));

console.log(`Ashford wardrobe, seed ${seed}, ${rows.length} residents`);
console.log(`  complete                 ${summary.complete}/${summary.people}`);
console.log(`  dressable by a wardrobe  ${summary.dressable} (${summary.notDressable} carry their own clothing)`);
console.log(`  wearing Ashford          ${summary.wearingAshford}/${summary.dressable}`);
console.log(`  wearing foreign garments ${summary.wearingForeignGarments}`);
console.log(`  distinct outfits         ${summary.distinctOutfits}, largest identical group ${summary.largestIdenticalGroup}`);
console.log(`  palettes in use          ${summary.palettesInUse.length}/${summary.palettesAvailable}`);
console.log(`  presentation             ${JSON.stringify(summary.presentationCoverage)}`);
console.log(`  fit families             ${JSON.stringify(summary.fitFamiliesInUse)}`);
console.log(`  pieces                   ${JSON.stringify(summary.pieceUsage)}`);
console.log(`wrote ${path}`);
