import { describe, expect, it } from 'vitest';
import { runAgencyWorldLab } from '../src/headless/worldlab/agency';

describe('agency WorldLab scenario', () => {
  it('replays deterministically and reports canonical outcomes', () => {
    const a = runAgencyWorldLab(741), b = runAgencyWorldLab(741);
    expect(a.digest).toBe(b.digest);
    expect(a.invariantErrors).toEqual([]);
    expect(a.actions.attack).toMatchObject({ attempted: true });
    expect((a.outcomes.attackEvents as unknown[]).length).toBeGreaterThan(0);
    expect(a.outcomes.autonomousNpcGoals).toEqual(b.outcomes.autonomousNpcGoals);
    expect(a.outcomes.firstLabel).toBe('an unfamiliar person');
    expect(a.actions.visibleAtDeparture).toBe(false);
    expect(a.outcomes.recognition).toMatchObject({ level: 'identified' });
    expect(a.outcomes.saveReplayMatches).toBe(true);
    const news = (a.outcomes.indirectKnowledge as any[]).find(k => ['attack', 'attack_missed'].includes(k.claim.type));
    expect(news).toBeDefined(); expect(news.source.type).toBe('told'); expect(news.hops).toBeGreaterThan(0);
    const event = (a.outcomes.attackEvents as any[]).find(e => `ev:${e.id}` === news.key);
    const recipient = (a.initialConditions.residents as string[])[1];
    expect(event.perceivedBy.some((p: any) => p.who === recipient && p.how === 'saw')).toBe(false);
    expect((a.outcomes.autonomousNpcGoals as any[]).some(p => p.decisions.some((g: any) => g.to === 'flee'))).toBe(true);
  });
});
