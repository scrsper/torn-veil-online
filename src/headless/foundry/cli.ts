import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { projectAppearanceDescription } from '../../sim/core/appearance';
import type { Person } from '../../sim/core/types';
import { newWorld } from '../../sim/persist/save';
import { catalogueCoverage } from '../../foundry/catalogue';
import { DEFAULT_CATALOGUE_PATH, loadCatalogue } from '../../foundry/load';
import { realizeCharacter, reportPopulation } from '../../foundry/resolve';
import type { CharacterRealization, RealizationInput } from '../../foundry/resolve';

/**
 * `npm run foundry:report -- [seed] [cataloguePath] [outDir]`
 *
 * Runs the Character Foundry over a generated world and reports what it could and could not build.
 * On a machine with no catalogue this is still useful and still runs: it prints the empty-catalogue
 * state and the unmet requests, which together are the shopping list of what needs installing.
 *
 * Output is written under `.debug/` (gitignored) because the realizations contain machine-local
 * licensed asset paths.
 */
const seed = Number(process.argv[2] ?? 1337);
const cataloguePath = process.argv[3] ?? DEFAULT_CATALOGUE_PATH;
const outDir = process.argv[4] ?? '.debug/character-foundry';

const loaded = loadCatalogue(cataloguePath);
const { world } = newWorld(seed);
const people = world.persons().filter((p: Person) => p.alive && p.appearance.description);

const inputs: RealizationInput[] = people.map((person: Person) => ({
  entityId: person.id,
  identity: person.slug ?? person.id,
  seed: world.seed,
  traits: projectAppearanceDescription(person.appearance.description!, person.age, person.occupation),
  appearance: {
    skin: person.appearance.skin, hair: person.appearance.hair,
    shirt: person.appearance.shirt, pants: person.appearance.pants,
    ...(person.appearance.apron !== undefined ? { apron: person.appearance.apron } : {}),
    height: person.appearance.height, build: person.appearance.build,
  },
}));
const realizations: CharacterRealization[] = inputs.map(input => realizeCharacter(input, loaded.catalogue));
const report = reportPopulation(realizations);

const summary = {
  seed,
  catalogue: {
    path: loaded.path,
    present: loaded.present,
    machine: loaded.catalogue.machine ?? null,
    generatedAt: loaded.catalogue.generatedAt,
    animationTarget: loaded.catalogue.animationTarget ?? null,
    entries: loaded.catalogue.entries.length,
    skeletons: loaded.catalogue.skeletons.map(s => ({ name: s.name, family: s.family, meshes: s.meshCount, anims: s.animCount })),
    retargeters: loaded.catalogue.retargeters.length,
    coverage: catalogueCoverage(loaded.catalogue),
    problems: loaded.problems,
  },
  population: report,
};

mkdirSync(dirname(`${outDir}/x`), { recursive: true });
writeFileSync(`${outDir}/foundry-report.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${outDir}/realizations.json`, JSON.stringify(
  people.map((person: Person, index: number) => ({ name: person.name, slug: person.slug ?? null, occupation: person.occupation, age: person.age, realization: realizations[index] })), null, 2));

console.log(JSON.stringify(summary, null, 2));
if (!loaded.present) {
  console.log('\nNo character catalogue on this machine. The Foundry ran anyway and every person still');
  console.log('has correct canonical colours, scale and description — they simply have no meshes bound.');
  console.log(`Run unreal/scripts/audit_character_assets.py in the Unreal Editor to produce ${DEFAULT_CATALOGUE_PATH}.`);
}
console.log(`\nwrote ${outDir}/foundry-report.json and ${outDir}/realizations.json`);
