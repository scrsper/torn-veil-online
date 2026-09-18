import { mkdirSync, writeFileSync } from 'node:fs';
import { projectAppearanceDescription } from '../../sim/core/appearance';
import type { Person } from '../../sim/core/types';
import { newWorld } from '../../sim/persist/save';
import { DEFAULT_CATALOGUE_PATH, loadCatalogue } from '../../foundry/load';
import { realizeCharacter } from '../../foundry/resolve';
import type { CharacterCatalogue } from '../../foundry/catalogue';
import type { CharacterRealization, RealizationInput } from '../../foundry/resolve';

/**
 * `npm run foundry:fallback -- [seed] [catalogue] [outDir]`
 *
 * Proves the fail-soft contract against the *real* machine-local catalogue rather than a fixture:
 * take one asset away and nothing about the person should change except the slot that asset filled.
 *
 * The interesting failure this guards against is not a crash. It is a re-roll: a resolver that draws
 * every slot from one sequential stream will hand a person different clothes, a different body and a
 * different build the moment an unrelated hair pack is uninstalled, so a settlement silently becomes
 * a different settlement whenever content changes. That is why each slot draws from its own stream,
 * and this is the measurement that says so.
 *
 * Nothing is deleted on disk. The catalogue is filtered in memory, so the machine's installed
 * content is untouched and the check is repeatable.
 */
const seed = Number(process.argv[2] ?? 1337);
const cataloguePath = process.argv[3] ?? DEFAULT_CATALOGUE_PATH;
const outDir = process.argv[4] ?? '.debug/character-foundry';

const loaded = loadCatalogue(cataloguePath);
const { world } = newWorld(seed);
const people = world.persons().filter((p: Person) => p.alive && p.appearance.description);

const inputFor = (person: Person): RealizationInput => ({
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
});

const inputs = people.map(inputFor);
const resolveAll = (catalogue: CharacterCatalogue) => inputs.map(input => realizeCharacter(input, catalogue));

/** Everything about a realization a viewer could notice, keyed by slot. */
const slotMap = (r: CharacterRealization) => Object.fromEntries(r.slots.map(s => [s.slot, s.package]));

const baseline = resolveAll(loaded.catalogue);

/** Break the most-used body, because losing a body is the worst case the fallback has to survive. */
const bodyUse = new Map<string, number>();
for (const realization of baseline) {
  const body = realization.slots.find(s => s.slot === 'body');
  if (body) bodyUse.set(body.package, (bodyUse.get(body.package) ?? 0) + 1);
}
const broken = [...bodyUse.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

const damagedCatalogue: CharacterCatalogue = {
  ...loaded.catalogue,
  entries: loaded.catalogue.entries.filter(entry => entry.package !== broken),
};
const damaged = resolveAll(damagedCatalogue);

let changedSlotTotal = 0, unrelatedChanges = 0, lostBody = 0, stillComplete = 0;
const diagnostics = new Set<string>();
const examples: unknown[] = [];
for (let index = 0; index < baseline.length; index++) {
  const before = slotMap(baseline[index]), after = slotMap(damaged[index]);
  const slots = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...slots].filter(slot => before[slot] !== after[slot]);
  changedSlotTotal += changed.length;
  // Only the slot the removed asset filled may move. Anything else is a re-roll.
  unrelatedChanges += changed.filter(slot => before[slot] !== broken).length;
  if (before.body === broken) lostBody++;
  if (damaged[index].complete) stillComplete++;
  for (const problem of damaged[index].problems) diagnostics.add(`${problem.kind}:${problem.slot}`);
  if (changed.length && examples.length < 5) {
    examples.push({ person: people[index].name, changed, before: before.body ?? null, after: after.body ?? null });
  }
  // Canonical inputs are the same object either way; assert the projection never wrote to them.
  if (baseline[index].entityId !== damaged[index].entityId) unrelatedChanges++;
}

const summary = {
  seed,
  catalogue: { path: loaded.path, present: loaded.present, entries: loaded.catalogue.entries.length },
  brokenAsset: broken,
  people: people.length,
  peopleUsingBrokenAsset: lostBody,
  changedSlotTotal,
  /** The number that matters: a re-roll would make this non-zero. */
  unrelatedSlotChanges: unrelatedChanges,
  stillCompleteAfterBreak: stillComplete,
  diagnosticsRaised: [...diagnostics].sort(),
  examples,
  verdict: unrelatedChanges === 0
    ? 'PASS — removing one asset moved only the slot it filled'
    : `FAIL — ${unrelatedChanges} unrelated slot(s) changed; selection is not slot-independent`,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/fallback-report.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nwrote ${outDir}/fallback-report.json`);
if (unrelatedChanges !== 0) process.exitCode = 1;
