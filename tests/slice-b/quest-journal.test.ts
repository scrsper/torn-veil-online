import { it, expect } from 'vitest';
import { hudReducer, initialHudState } from '../../src/web/ui/sliceHudState';
import { hudJournal } from '../../src/web/quests/objectives';
it('projects ledger entries with origin/source/state and never invents payment', () => {
  const base = { kind: 'x', stage: 'town', issuedAt: 0, endedAt: null, endedBy: null, basis: [], facts: {} } as any;
  const rows = hudJournal([
    { ...base, id: 'system:onboarding:listen', origin: 'system', source: { type: 'system', questId: 'onboarding:listen', issuer: 'john_smith' }, title: 'Listen', detail: 'd', state: 'completed', reward: { offered: 5, from: 'john_smith' }, claim: { paid: 5, from: 'john_smith', at: 1, eventId: null } },
    { ...base, id: 'req:1', origin: 'emergent', source: { type: 'request' }, title: 'Feed Ana', detail: 'd', state: 'resolved', reward: { offered: 2, from: 'p1' }, claim: null },
  ]);
  expect(rows.map(r => [r.origin, r.source, r.state, r.paid])).toEqual([['system', 'John Smith', 'completed', 5], ['emergent', 'request', 'resolved', null]]);
  const s = hudReducer(initialHudState(), { type: 'ledger', entries: rows });
  expect(s.entries).toHaveLength(2);
  expect(hudReducer(s, { type: 'ledger', entries: rows })).toBe(s);
});
