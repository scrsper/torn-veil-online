import { beforeAll, describe, expect, it } from 'vitest';
import { runAdaptiveTrace, type AdaptiveTraceReport } from '../src/headless/adaptive/trace';

/**
 * THE UNATTENDED ACCEPTANCE RUN.
 *
 * The real generated village, no player embodied, no renderer, nothing scripted, for long enough
 * that a consequence has time to become another consequence and then to be answered. The
 * `producer_lost` scenario seeds exactly ONE happening — a bandit's killing blow, delivered
 * through `Simulation.applyHit`, the same method every NPC fight and every player swing goes
 * through — and then only observes.
 *
 * Nothing anywhere in the simulation chooses a successor. What this run has to show is that one
 * appeared anyway, out of ordinary motives, and that the whole chain holds end to end:
 *
 *    an important worker becomes unavailable
 *      → their productive output falls
 *      → a downstream shortage forms
 *      → relevant people become concerned
 *      → somebody plausible develops pressure and opportunity to respond
 *      → they perform the work
 *      → their capability rises through doing it
 *      → production partially resumes
 *      → the shortage eases
 *
 * THIRTY DAYS, and for a measured reason. On seed 918271 the mill stops the moment the miller
 * dies on day 100, but the bakery has a fortnight of flour on hand, so the first person in the
 * village who can KNOW anything is wrong does not find out until day 112. A stand-in takes the
 * mill up that same day; the flour she grinds takes until roughly day 126 to work its way back
 * down the chain. Twenty-two days was not enough — it caught the succession but ended before the
 * recovery reached the bakery. Thirty is the shortest horizon that comfortably contains the
 * whole chain rather than the shortest one that squeaks past it.
 *
 * RUN IT WITH `npm run adapt:accept`. Deliberately NOT part of `npm test`: thirty simulated days
 * is roughly four minutes of solid CPU in one file, and left in the default suite it starves the
 * other workers until a neighbour with a tight per-test budget fails for want of a core rather
 * than for want of correctness. See `vitest.accept.config.ts`, and the same note on
 * `causal-society-longrun.test.ts`.
 */
describe('Adaptive Society — unattended acceptance', () => {
  let report: AdaptiveTraceReport;
  beforeAll(() => { report = runAdaptiveTrace({ scenario: 'producer_lost', seed: 918271, days: 30 }); }, 900_000);

  it('runs the whole village with no player embodied', () => {
    expect(report.population).toBeGreaterThan(20);
    expect(report.lostProducer?.occupation).toBe('miller');
  });

  it('1. the loss is a real production loss, and the world can tell the work is going undone', () => {
    expect(report.acceptance.producerLost.length).toBeGreaterThan(0);
    expect(report.acceptance.outputFell.length).toBeGreaterThan(0);
    // The vacancy is derived, and it names the canonical reason rather than a flag.
    expect(report.vacancies.length).toBeGreaterThan(0);
    const mill = report.vacancies.find(v => v.makes === 'flour');
    expect(mill).toBeTruthy();
    expect(mill!.why).toMatch(/is dead/);
    expect(mill!.demand).toBeGreaterThan(0);
  });

  it('2. the shortage travels downstream and becomes something people carry', () => {
    expect(report.acceptance.shortageDownstream.length).toBeGreaterThan(0);
    expect(report.acceptance.concernFormed.length).toBeGreaterThan(0);
    expect(report.stoppages.some(s => s.need === 'flour')).toBe(true);
  });

  it('3. more than one person was plausible, and none of them was told to be', () => {
    expect(report.acceptance.plausibleCandidates.length).toBeGreaterThan(1);
    // Every candidate's case rests on something they actually know or can do — never on the
    // vacancy alone, and never on anybody's occupation.
    for (const c of report.candidates) {
      expect(c.score).toBeGreaterThan(0);
      expect(c.reasons.join(' ')).toMatch(/flour|short|done this work|not far from it|never done it/);
    }
    // Plausibility is not a ranking the world acts on: the people who could have answered are
    // not the same list as the people who did.
    //
    // Compared PER PERSON AND PLACE, not by raw list length. `candidates` is deduplicated per
    // person and post; `standIns` is one record per `WorkStint`, and one person legitimately opens
    // several stints at the same mill across a month (they work, they miss two days, the stint
    // lapses, they come back). Comparing the two lengths was therefore comparing distinct people
    // against total spells of work, and it broke the first time somebody's spells were counted
    // differently — for a reason that had nothing to do with the invariant it was guarding.
    const standInKeys = new Set(report.standIns.map(s => `${s.who}@${s.place}`));
    const candidateKeys = new Set(report.candidates.map(c => `${c.who}@${c.place}`));
    expect(candidateKeys.size).toBeGreaterThanOrEqual(standInKeys.size);
    // And the assertion that actually matters, which the length comparison never made: NOBODY
    // worked a post the world had not independently found them a plausible responder for. That is
    // the "the nearest idle NPC does not just get assigned" invariant, stated directly.
    for (const key of standInKeys) expect([...candidateKeys]).toContain(key);
  });

  it('4. somebody did the work, badly, and got better at it by doing it', () => {
    expect(report.acceptance.responderPerformedTheWork.length).toBeGreaterThan(0);
    expect(report.acceptance.capabilityRoseThroughWork.length).toBeGreaterThan(0);
    const worked = report.standIns.filter(s => s.batches > 0);
    expect(worked.length).toBeGreaterThan(0);
    // Nobody arrived able: somebody's FIRST time at a trade begins at nothing.
    const firstTimes = new Map<string, number>();
    for (const s of [...report.standIns].sort((a, b) => a.day - b.day)) {
      if (!firstTimes.has(`${s.who}:${s.resource}`)) firstTimes.set(`${s.who}:${s.resource}`, s.skillAtStart);
    }
    expect([...firstTimes.values()].every(v => v === 0)).toBe(true);
    for (const s of worked) {
      expect(s.skillNow).toBeGreaterThan(s.skillAtStart);
      // ...and nobody was handed a trade: a month of standing in is not a life at the stones.
      expect(s.skillNow).toBeLessThan(0.6);
    }
  });

  it('5. production resumed at a worse rate than the hand that was lost', () => {
    expect(report.acceptance.productionResumed.length).toBeGreaterThan(0);
    const lostAt = report.lostProducer!.at;
    const before = report.output.filter(o => o.resource === 'flour' && o.at < lostAt);
    const after = report.output.filter(o => o.resource === 'flour' && o.at > lostAt);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    const per = (rs: typeof before) => rs.reduce((n, o) => n + o.quantity, 0) / rs.length;
    // Partial recovery, which is the point: the mill turns again, and it does not turn as well.
    expect(per(after)).toBeLessThan(per(before));
    expect(per(after)).toBeGreaterThan(0);
  });

  it('6. the shortage eased without being cured', () => {
    expect(report.acceptance.shortageEased.length).toBeGreaterThan(0);
    // Real material reached the consumer again after the worst of it.
    const lostDay = report.lostProducer!.day;
    const days = report.downstream.filter(d => d.day >= lostDay);
    const worst = days.reduce((a, d) => (d.flourAtBakery < a.flourAtBakery ? d : a), days[0]);
    expect(days.some(d => d.day > worst.day && d.flourAtBakery > worst.flourAtBakery)).toBe(true);
    // And it is not a cure. Stated as the MATERIAL fact rather than as a worry count, which is
    // both stronger and closer to what the claim means. Measured on this seed: the bakery held 28
    // flour the day the miller was lost and 0-1 for the last three days of the run — the mill
    // turns again and it does not keep up. The old assertion read `worriedPeople > 0` on the final
    // day and was a knife edge: the shortage is worse than ever at day 130, but the people who
    // only ever HEARD of it have had their worry fade on its half-life by then (which is
    // `mind/concern.ts` behaving exactly as documented — "they stopped worrying, they did not find
    // out"). A cognition-side claim is still made, and made where it is true: the shortage WAS
    // carried as a real worry once it reached people.
    const preLoss = report.downstream.find(d => d.day === lostDay)!;
    expect(days[days.length - 1].flourAtBakery).toBeLessThan(preLoss.flourAtBakery / 2);
    expect(days.some(d => d.worriedPeople > 0)).toBe(true);
  });

  it('7. the decision can be walked back to the blow that caused it', () => {
    expect(report.acceptance.decisionTracedToTheLoss.length).toBeGreaterThan(0);
    const walk = report.chains.find(c => c.lines.length > 2);
    expect(walk).toBeTruthy();
    expect(walk!.lines.some(l => l.includes('because'))).toBe(true);
  });

  it('grants nobody a trade they did not earn', () => {
    // A first stint begins at nothing; where somebody came back to the work a second time, they
    // may now be above the old 0.2 novice threshold because they genuinely earned it earlier.
    // They must begin no higher than their preceding stint actually left them.
    // own earlier work had left them — the proficiency is carried by the person, not reset by the
    // record and not conferred by it.
    const byPerson = new Map<string, typeof report.standIns>();
    for (const s of report.standIns) {
      const key = `${s.who}:${s.resource}`;
      byPerson.set(key, [...(byPerson.get(key) ?? []), s]);
    }
    for (const runs of byPerson.values()) {
      const ordered = [...runs].sort((a, b) => a.day - b.day);
      expect(ordered[0].skillAtStart).toBe(0);
      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i].skillAtStart).toBeGreaterThan(ordered[i - 1].skillAtStart);
        expect(ordered[i].skillAtStart).toBeLessThanOrEqual(ordered[i - 1].skillNow);
      }
    }
    // No lesson is credited to anybody who never worked — instruction and capability stay apart.
    for (const l of report.lessons) {
      expect(l.studentSkillThen).toBe(0);
      expect(l.studentSkillNow).toBeGreaterThanOrEqual(0);
    }
  });
}, 900_000);
