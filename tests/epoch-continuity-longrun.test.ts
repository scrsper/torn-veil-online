import { describe, expect, it } from 'vitest';
import { EPOCH_SEEDS, runEpochWorldLab } from '../src/headless/worldlab/epoch';

const deterministicShape = (report: ReturnType<typeof runEpochWorldLab>) => ({
  stateHash: report.stateHash,
  totals: report.totals,
  final: report.final,
  yearly: report.yearsTelemetry.map(y => ({
    year: y.year, livingPopulation: y.livingPopulation, cumulativePeople: y.cumulativePeople,
    cumulativeEntities: y.cumulativeEntities, births: y.births, deaths: y.deaths,
    inheritances: y.inheritances, eventLogSize: y.eventLogSize,
    chronicleDetailedEntries: y.chronicleDetailedEntries, chronicleEraCount: y.chronicleEraCount,
    mindStateItems: y.mindStateItems,
  })),
});

/**
 * WHY THE BOUNDS BELOW ARE ON `workingSetPerLiving` AND NOT ON WALL TIME.
 *
 * `trend.normalizedChangePercent` is milliseconds per tick per living person, and it is the
 * honest end measurement — it is also the one that moves with whatever else the machine is doing.
 * The same five-year run of seed 1 was measured at 24 s and at 54 s on the same machine minutes
 * apart, which is a 2x swing in the number an assertion would be reading. Asserting on it either
 * flakes or is set so loose it catches nothing: the regression this suite exists to catch (seed
 * 918271 at +111%) would have passed a bound generous enough to be stable.
 *
 * `workingSetPerLiving` is the deterministic quantity underneath it — the retained event log plus
 * everything the per-tick cognition loops walk (knowledge, memories, relationships, concerns,
 * pursuits), per living person. It is byte-identical on every machine for a given seed, and it is
 * what the cost is actually proportional to. Wall time is still reported by the CLI and still in
 * the JSON; it is evidence, not the gate.
 */
describe('epoch demographic acceptance', () => {
  it('is non-monotonic, conserved, invariant-clean, and deterministic over five years', { timeout: 120_000 }, () => {
    const first = runEpochWorldLab({ seed: 1, years: 5 });
    const replay = runEpochWorldLab({ seed: 1, years: 5 });
    const populations = [first.initialLivingPopulation, ...first.yearsTelemetry.map(y => y.livingPopulation)];
    expect(first.totals.births).toBeGreaterThan(0);
    expect(first.totals.deaths).toBeGreaterThan(0);
    expect(populations.some((n, i) => i > 0 && n > populations[i - 1])).toBe(true);
    expect(populations.some((n, i) => i > 0 && n < populations[i - 1])).toBe(true);
    expect(first.final.bornDuringRunWithParents).toBe(first.final.bornDuringRunPeople);
    expect(first.final.inheritanceTransfers).toBeGreaterThan(0);
    expect(first.final.demographicHistoryEvents).toBeGreaterThanOrEqual(first.totals.births + first.totals.deaths + first.totals.inheritances);
    expect(first.final.deadPeople).toBeGreaterThan(0);
    expect(first.final.cumulativePeople).toBeGreaterThan(first.final.livingPopulation);
    expect(first.conservation.currencyUnexplainedDelta).toBeCloseTo(0, 6);
    expect(first.conservation.invalidItemOwners).toBe(0);
    expect(first.invariantErrors).toEqual([]);
    expect(deterministicShape(replay)).toEqual(deterministicShape(first));
  });

  /**
   * The tier's own claim, made across the seed matrix rather than on one seed. This is what a
   * scale tier is for: `docs/DEMOGRAPHIC_CONTINUITY_YEAR_SCALE.md` reported flat cost from seed 1
   * alone while the canonical project seed was growing at +111% per five years, and the report
   * already computed the number that would have shown it.
   *
   * Growth inside the first five years is EXPECTED to be roughly linear and is not the flatness
   * claim: nothing compacts until `CHRONICLE_DETAIL_RETENTION_DAYS` (five years) has elapsed, so
   * this window is the retention buffer filling up on purpose. What these bounds catch is growth
   * of a different order — a fight that never ends, a belief store that never settles — which is
   * exactly what they did catch.
   */
  it('holds bounded per-person cost across the whole seed matrix at five years', { timeout: 900_000 }, () => {
    const reports = EPOCH_SEEDS.map(seed => runEpochWorldLab({ seed, years: 5 }));
    for (const report of reports) {
      const where = `seed ${report.seed}`;
      expect(report.invariantErrors, where).toEqual([]);
      expect(report.conservation.invalidItemOwners, where).toBe(0);
      expect(report.conservation.currencyUnexplainedDelta, where).toBeCloseTo(0, 6);
      expect(report.yearsTelemetry, where).toHaveLength(5);
      // Every seed keeps a living village: this tier must never certify a world that emptied.
      expect(report.final.livingPopulation, where).toBeGreaterThan(20);
      // Retained history added per living person per simulated year. Measured across this matrix
      // at 49-105; the bound is set above the observed spread and far below the shape a
      // non-converging process produces (seed 918271 before the combat-cadence fix added ~250).
      expect(report.trend.eventGrowthPerLivingPerYear, where).toBeLessThan(150);
      // And the same claim about everything a tick walks, not only the event log.
      expect(report.trend.workingSetChangePercent, where).toBeLessThan(150);
    }
  });

  it('sustains natural generations and compacted history for twenty-five years', { timeout: 300_000 }, () => {
    const report = runEpochWorldLab({ seed: 1, years: 25 });
    expect(report.yearsTelemetry).toHaveLength(25);
    expect(report.totals.births).toBeGreaterThan(1);
    expect(report.totals.deaths).toBeGreaterThan(1);
    expect(report.yearsTelemetry.slice(5).some(y => y.births > 0)).toBe(true);
    expect(report.final.bornDuringRunAdults).toBeGreaterThan(0);
    expect(report.final.bornDuringRunWithParents).toBe(report.final.bornDuringRunPeople);
    expect(report.final.maxLineageDepth).toBeGreaterThanOrEqual(3);
    expect(report.final.inheritanceTransfers).toBeGreaterThan(0);
    expect(report.final.cumulativePeople).toBeGreaterThan(report.final.livingPopulation);
    expect(report.final.chronicleDetailedEntries).toBeLessThan(250);
    // Eras GROW rather than sitting at the five the seeded pre-history produces: a twenty-five
    // year run outlives its own detail-retention window four times over, and each passage out of
    // it must produce a new era record.
    expect(report.final.chronicleEraCount).toBeGreaterThan(5);
    expect(report.yearsTelemetry.at(-1)!.chronicleEraCount)
      .toBeGreaterThan(report.yearsTelemetry[5].chronicleEraCount);
    // THE FLAT-COST CLAIM, and the only place it can honestly be made: past the retention window,
    // where nineteen further years of history are compacted rather than retained. A relative
    // bound against year 6 rather than an absolute event count, so it stays meaningful on a seed
    // whose village is busier or larger than this one.
    const settled = report.yearsTelemetry[5];
    const final = report.yearsTelemetry.at(-1)!;
    expect(final.eventLogSize).toBeLessThan(settled.eventLogSize * 1.6);
    expect(final.workingSetPerLiving).toBeLessThan(settled.workingSetPerLiving * 1.6);
    expect(report.conservation.currencyUnexplainedDelta).toBeCloseTo(0, 6);
    expect(report.conservation.invalidItemOwners).toBe(0);
    expect(report.invariantErrors).toEqual([]);

    // Generational continuity, at the only scale it can be observed. `coming_of_age` used to be
    // emitted and read by nothing, so a person born in year 1 was still on a child's schedule —
    // breakfast, play in the square, play again — at twenty-three.
    //
    // What this does NOT assert is the rest of the chain (a vocation acquired, real productive
    // work, output in the economy). That chain is proven end to end against the canonical
    // mechanisms in `tests/generational-livelihood.test.ts`; it is not reachable inside a
    // twenty-five year Ashford run, for measured reasons written up in
    // `docs/DEMOGRAPHIC_CONTINUITY_YEAR_SCALE.md` — chiefly that at this tier's
    // one-step-per-calendar-day cadence nobody in the world ever forms a goal other than eating
    // and drinking, so no trade is ever practised, taught or taken up by anybody.
    expect(report.final.comingOfAgeEvents).toBeGreaterThan(0);
    expect(report.final.bornDuringRunAdultsWithAChildsDay).toBe(0);
  });
});
