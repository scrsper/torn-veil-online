import { expect, it } from 'vitest';
import { World } from '../src/sim/core/world';
import { WorldGeography, LEGACY_PLAYABLE_WORLD, PLAYABLE_WORLD } from '../src/sim/world/geography';
import { generatePlayableWorld } from '../src/sim/world/playable';
import { near } from '../src/sim/world/locality';
import { serialize, deserialize } from '../src/sim/persist/save';
import { playableBaselineFingerprint } from '../src/server/fingerprint';

// Captured from the previous generator before adding the versioned household constraint.
const legacy = {
  918271: 'ad1ea05fc4c51786eba9aa9ee0804e036a9df6f7013ab87a72ba740e3dad7fde',
  918272: 'ad7bf58bebd90e230201f5abce57000bf1e74f5d53bf4f385fc0e12fca1dfd21',
  918273: 'a4be493066fc069f6ad923296f3f5bd8289fe6dc487c7b5f4f64f8022c855e21',
};
for (const seed of [918271, 918272, 918273] as const) {
  it(`preserves the exact playable-1 baseline for seed ${seed}`, () => {
    expect(playableBaselineFingerprint(seed, 'playable-1')).toBe(legacy[seed]);
  }, 30000);
  it(`places new homes within the unchanged work and routine range for seed ${seed}`, () => {
    const w = new World(seed); generatePlayableWorld(w);
    expect(w.geography!.spec.householdLocalityVersion).toBe(1);
    for (const p of w.livingPersons()) {
      const home = w.place(p.homeId)!.inside;
      for (const id of [p.workId, ...p.schedule.map(e => e.placeId)]) {
        if (id) expect(near(home, w.place(id)!.inside), `${p.name}: ${w.nameOf(id)}`).toBe(true);
      }
    }
  }, 30000);
}

for (const spec of [LEGACY_PLAYABLE_WORLD, PLAYABLE_WORLD]) {
  it(`preserves saved geography, identities, mechanics and history with housing revision ${spec.householdLocalityVersion ?? 'legacy'}`, () => {
    const w = new World(918272); generatePlayableWorld(w, spec);
    const before = JSON.parse(serialize(w)), loaded = deserialize(JSON.stringify(before));
    expect(loaded).not.toBeNull();
    const after = JSON.parse(serialize(loaded!.world));
    for (const key of ['geography', 'physicalPlaces', 'persons', 'bodies', 'events', 'clock', 'rng', 'counters'])
      expect(after[key], key).toEqual(before[key]);
  }, 30000);
}

it('rejects unknown generator and household revisions', () => {
  expect(() => playableBaselineFingerprint(1, 'playable-unknown')).toThrow('Unsupported');
  expect(() => new WorldGeography(1, { ...PLAYABLE_WORLD, householdLocalityVersion: 2 } as never)).toThrow('Unsupported');
});
