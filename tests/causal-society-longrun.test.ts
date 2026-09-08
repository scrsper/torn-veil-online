import { beforeAll, describe, expect, it } from 'vitest';
import { runCausalTrace, type CausalTraceReport } from '../src/headless/causal/trace';

/**
 * THE UNATTENDED ACCEPTANCE RUN.
 *
 * The real generated village, no player embodied, no renderer, nothing scripted, for long enough
 * that a consequence has time to become another consequence. The `producer_struck` scenario seeds
 * exactly ONE happening — a bandit's killing blow, delivered through `Simulation.applyHit`, the
 * same method every NPC fight and every player swing goes through — and then only observes.
 *
 * The assertions are about CAUSAL SEMANTICS, not counters. It is not enough that beliefs were
 * formed; the run has to show that a specific belief was held first-hand by the person who found
 * it out, second-hand by people who were told, by nobody who was neither, that somebody concluded
 * something from it that they hold less firmly than what they concluded it from, and that a
 * decision taken days later can be walked back to the blow that started it.
 *
 * SEVENTEEN DAYS, not thirty, and for a measured reason: on seed 918271 the mill stops the moment
 * the miller dies, but the bakery has enough flour on hand to keep going for a fortnight, so the
 * baker's own stoppage lands on day 14 of the run. Seventeen is the shortest horizon that still
 * contains the whole chain. The full thirty- and sixty-day runs are `npm run causal:trace`, kept
 * out of the unit suite because re-running them on every commit buys no evidence this does not
 * already give — see docs/CAUSAL_SOCIETY_V0_4.md for their recorded output.
 *
 * RUN IT WITH `npm run causal:accept`. This file is deliberately NOT part of `npm test`: it is an
 * acceptance run, not a unit test, and seventeen simulated days is ~100 seconds of solid CPU in a
 * single file. Left in the default suite it starves the other workers, and a neighbour with a
 * tight per-test budget then fails for want of a core rather than for want of correctness —
 * measured: `embodied-economy`'s 5 s currency-conservation test takes 1.35 s alone and 5.2 s
 * beside this one. Widening that neighbour's budget would have hidden the cause. See
 * `vitest.accept.config.ts`.
 */
describe('Causal Society — unattended acceptance', () => {
  // Run once, in `beforeAll` rather than at collection time, so the suite's other files are not
  // held behind a two-minute synchronous call while vitest is still gathering tests.
  let report: CausalTraceReport;
  beforeAll(() => { report = runCausalTrace({ scenario: 'producer_struck', seed: 918271, days: 17 }); }, 600_000);

  it('runs the whole village with no player embodied', () => {
    expect(report.population).toBeGreaterThan(20);
    expect(report.decisions.length).toBeGreaterThan(0);
  });

  it('1. a relationship consequence: witnesses to the same act do not move by the same amount', () => {
    expect(report.acceptance.relationshipConsequence.length).toBeGreaterThan(0);
    const magnitudes = new Set(report.relationshipShifts.map(s => `${s.trust}/${s.grudge}/${s.affection}`));
    expect(magnitudes.size).toBeGreaterThan(3);
    // Kindness moves people too, not only harm.
    expect(report.relationshipShifts.some(s => s.affection > 0)).toBe(true);
    expect(report.relationshipShifts.some(s => s.grudge > 0)).toBe(true);
  });

  it('2. information travels with its provenance, and stops where the telling stops', () => {
    const spread = report.spread.find(s => s.holders.some(h => h.hops === 0) && s.holders.some(h => h.hops > 0));
    expect(spread).toBeTruthy();
    const firstHand = spread!.holders.filter(h => h.hops === 0);
    const hearsay = spread!.holders.filter(h => h.hops > 0);
    expect(firstHand.length).toBeGreaterThan(0);
    expect(hearsay.length).toBeGreaterThan(0);
    // Every first-hand holder found it out themselves or saw it; every second-hand one names who
    // told them, is further from the source, and is less sure of it.
    for (const h of firstHand) expect(['self', 'witnessed', 'heard']).toContain(h.source);
    for (const h of hearsay) {
      expect(h.source).toBe('told');
      expect(h.from).toBeTruthy();
      expect(h.confidence).toBeLessThan(1);
    }
    // Nobody holds it at zero hops by having been told, and nobody holds it at full confidence
    // through hearsay — those are the two shapes omniscience would take.
    expect(spread!.holders.some(h => h.source === 'told' && h.hops === 0)).toBe(false);
  });

  it('3. a work stoppage changes what somebody does about it', () => {
    expect(report.stoppages.length).toBeGreaterThan(0);
    expect(report.acceptance.economicDisruption.length).toBeGreaterThan(0);
    // The worry that did it rests on a belief that person actually holds.
    expect(report.supplyConcerns.length + report.decisions.length).toBeGreaterThan(0);
    for (const d of report.decisions) expect(['haul', 'work', 'shop']).toContain(d.goal.split(' ')[0]);
  });

  it('4. the killing propagates into the economy and back out as an attribution', () => {
    expect(report.deaths).toContain('Hobb Grist');
    // The mill's trade stopped, so the bakery ran dry, and the bakery's own people found it so.
    const flour = report.stoppages.filter(s => s.need === 'flour');
    expect(flour.length).toBeGreaterThan(0);
    expect(report.acceptance.injuryOrDeathDownstream.length).toBeGreaterThan(0);

    const drawn = report.conclusions.filter(c => c.rule === 'producer_dead' || c.rule === 'producer_harmed');
    expect(drawn.length).toBeGreaterThan(0);
    for (const c of drawn) {
      // A conclusion is never certain, and never claims to be closer to the source than its
      // evidence — that is what stops an inference becoming a second channel for omniscience.
      expect(c.confidence).toBeLessThan(0.9);
      expect(c.because).not.toBe('');
    }
  });

  it('5. a later state can be walked back to the event responsible for it', () => {
    const chains = report.chains.filter(c => c.lines.length > 1);
    expect(chains.length).toBeGreaterThan(0);
    // At least one walk descends: a thing, a reason for it, and a reason for that.
    const deep = chains.find(c => c.lines.some(l => l.startsWith('    because')));
    expect(deep).toBeTruthy();
    expect(report.acceptance.decisionTracedToEarlierEvent.length).toBeGreaterThan(0);
  });

  it('produces no omniscient shortcut: nobody knows a stoppage they were neither at nor told of', () => {
    for (const s of report.spread) {
      for (const h of s.holders) {
        const legitimate = h.hops === 0 ? ['self', 'witnessed', 'heard'].includes(h.source) : h.source === 'told' && !!h.from;
        expect(legitimate).toBe(true);
      }
    }
  });
}, 600_000);
