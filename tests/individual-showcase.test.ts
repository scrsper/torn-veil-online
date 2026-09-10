import { describe, it, expect } from 'vitest';
import { runIndividualShowcase, individualMotivationComparison } from '../src/headless/individual/showcase';

describe('bounded multi-generation individual showcase', () => {
  it('replays the same exceptional origin, hidden carrier and later discovery exactly', () => {
    const report = runIndividualShowcase();
    expect(report.pathway).toBe(true);
    expect(report).toEqual(runIndividualShowcase());
    if (!report.pathway) return;
    expect(report.founder!.developed).toBeGreaterThan(report.founder!.potential);
    expect(report.hiddenCarrier!.expressed).toBe(0);
    expect(report.later![0].expressed).toBeGreaterThan(0); expect(report.later![1].expressed).toBe(0);
    expect(report.ancestry).toMatchObject({ unknownBefore: true, discovered: true, inheritanceUnchanged: true });
    expect(report.exactContinuation).toBe(true); expect(report.householdErrors).toEqual([]);
    expect(report.atCeiling).toEqual({ strength: 20, ironEligible: false });
    expect(report.readiness).toEqual({ eligible: true, stage: 'Normal' });
  });
  it('separates observed voluntary engagement from the disclosed long exposure comparison', () => {
    const [gifted, persistent] = individualMotivationComparison();
    expect(persistent.potential).toBeLessThan(gifted.potential);
    expect(persistent.autonomousLaborSeconds).toBeGreaterThan(gifted.autonomousLaborSeconds);
    expect(persistent.developedDexterity).toBeGreaterThan(gifted.developedDexterity);
    expect(persistent.developedDexterity).toBeGreaterThan(persistent.potential);
  });
});
