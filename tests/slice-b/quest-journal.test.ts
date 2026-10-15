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
import { ClientObjectives } from '../../src/web/quests/objectives';
import { RealmSession } from '../../src/sim/world/realms/session';
import { applyTowerCommand } from '../../src/server/canonicalTower';
import { TowerController } from '../../src/server/towerController';
import { questJournal, reconcileQuests } from '../../src/sim/quests';
it('carries the authoritative Tower ledger through the client and HUD projection', () => {
  const session = new RealmSession(317);
  const gate = session.grid.chunk('aether',32,32).buildings[0];
  session.body.pos = { x: gate.door.x+.5, y: 1, z: gate.z+4.5 };
  applyTowerCommand(session, { type: 'enter', id: 'journal-enter', revision: 0 });
  reconcileQuests(session.world, session.person.id);
  const frame = new TowerController(session).frame();
  expect(frame).not.toBeNull();
  expect(frame!.questJournal.length).toBeGreaterThan(0);
  expect(frame!.questJournal).toEqual(questJournal(session.world, session.person.id).slice(-40));
  const q = new ClientObjectives();
  q.ingestMessage(frame!);
  expect(q.journal()).toEqual(frame!.questJournal);
  expect(q.getActiveObjectives()).toEqual(frame!.objectives);
  const hud = hudReducer(initialHudState(), { type: 'ledger', entries: hudJournal(q.journal()) });
  expect(hud.entries.map(e => e.id)).toEqual(frame!.questJournal.map(e => e.id));
  q.ingestMessage({ type: 'tower_frame', objectives: [], questJournal: [] });
  expect(q.journal()).toEqual([]);
  expect(q.getActiveObjectives()).toEqual([]);
});
