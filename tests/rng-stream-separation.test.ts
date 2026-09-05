import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/core/world';

/**
 * v0.8 §9 RNG coupling investigation: `World.rng` used to be ONE shared stream consumed, in
 * strict call order, by both world generation and every per-tick runtime system (weather, agent
 * decisions, combat, gossip line selection, ...). That meant a code change that added or removed
 * even a single `rng.next()` call anywhere would shift every subsequent "random" draw for the
 * rest of the run — the documented cause of unrelated changes (e.g. a dialogue/pose tweak)
 * moving benchmark outcomes like construction completion day by weeks. `weatherRng` is now a
 * narrow, low-risk first cut at decoupling: weather is fully self-contained (see
 * docs/RNG_ARCHITECTURE.md for why it was chosen first and what's deliberately NOT done here).
 * This test proves the actual property that matters: consuming weatherRng, in any amount, never
 * perturbs what `world.rng` hands out next.
 */
describe('weather RNG is a separate stream from the main world RNG (v0.8 §9)', () => {
  it('world.rng and world.weatherRng are distinct stream instances', () => {
    const world = new World(918271);
    expect(world.weatherRng).not.toBe(world.rng);
  });

  it('consuming weatherRng an arbitrary number of times never changes what world.rng yields next', () => {
    const seed = 55512;
    const worldA = new World(seed);
    const baseline = [worldA.rng.next(), worldA.rng.next(), worldA.rng.next(), worldA.rng.next(), worldA.rng.next()];

    const worldB = new World(seed);
    // Simulate "weather logic changed and now draws a different number of random values" —
    // exactly the class of unrelated change that used to desynchronize the rest of the run.
    for (let i = 0; i < 137; i++) worldB.weatherRng.next();
    const afterWeatherChurn = [worldB.rng.next(), worldB.rng.next(), worldB.rng.next(), worldB.rng.next(), worldB.rng.next()];

    expect(afterWeatherChurn).toEqual(baseline);
  });

  it('weatherRng itself is still deterministic from the same seed', () => {
    const worldA = new World(4242);
    const worldB = new World(4242);
    expect(worldA.weatherRng.next()).toBe(worldB.weatherRng.next());
    expect(worldA.weatherRng.next()).toBe(worldB.weatherRng.next());
  });
});
