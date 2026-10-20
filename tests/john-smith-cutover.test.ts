import { describe, expect, it } from 'vitest';
import { RealmRuntime } from '../src/server/realmRuntime';
import { RealmSession } from '../src/sim/world/realms/session';
import { ensureJohnSmith, observeJohnSmith } from '../src/sim/orchestrator';
import { acceptRequest, completeRequest, createRequest } from '../src/sim/core/requests';
import { questLedger, questReceipts, reconcileQuests, systemObjectives } from '../src/sim/quests';

// Disclosed fixtures: emit floor-clear receipts directly; settle an accepted
// request through its canonical payment function. Combat/playability is separate.
function clear(s: RealmSession, floor: number) {
  s.world.emit('tower_floor_cleared', { actor: s.person.id, data: { runId: 'cutover-fixture', floor, seconds: 60 } });
}

describe('legacy silver ledger and current finite-cache authority cutover', () => {
  it('initializes the current authority in the journaled objectives operation before any host step', () => {
    const s = new RealmSession(918271), runtime = new RealmRuntime(s);
    expect(s.world.johnSmith).toBeUndefined();
    runtime.apply({ type: 'objectives' });
    expect(s.world.johnSmith).toBeDefined();
    expect(questLedger(s.world, s.person.id)!.entries).toEqual([]);
    const wealth = s.person.wealth;
    clear(s, 1); observeJohnSmith(s.world);
    runtime.apply({ type: 'objectives' }); runtime.apply({ type: 'objectives' });
    expect(s.world.johnSmith!.caches.filter(c => c.recipientId === s.person.id && c.reason === 'feat:floor-1')).toHaveLength(1);
    expect(s.world.events.filter(e => e.type === 'system_quest_reward')).toEqual([]);
    expect(s.person.wealth).toBe(wealth);
    expect(systemObjectives(s.world, s.person.id)).toEqual([]);
  });

  it('preserves historical paid and unpaid entries, balances and receipts across cutover and reload', () => {
    const s = new RealmSession(918271);
    clear(s, 1); reconcileQuests(s.world, s.person.id);
    const ledger = structuredClone(questLedger(s.world, s.person.id)!), receipts = questReceipts(s.world, s.person.id), wealth = s.person.wealth;
    expect(ledger.entries.find(e => e.id === 'system:tower:floor:1')!.claim!.paid).toBe(3);
    expect(ledger.entries.find(e => e.id === 'system:tower:floor:2')!.state).toBe('active');
    ensureJohnSmith(s.world); clear(s, 2); observeJohnSmith(s.world);
    reconcileQuests(s.world, s.person.id);
    expect(questLedger(s.world, s.person.id)).toEqual(ledger);
    expect(questReceipts(s.world, s.person.id)).toEqual(receipts);
    expect(s.person.wealth).toBe(wealth);
    expect(systemObjectives(s.world, s.person.id)).toEqual([]);
    const loaded = new RealmSession(0, s.save());
    const beforeEvents = loaded.world.events.length;
    reconcileQuests(loaded.world, loaded.person.id);
    expect(questLedger(loaded.world, loaded.person.id)).toEqual(ledger);
    expect(questReceipts(loaded.world, loaded.person.id)).toEqual(receipts);
    expect(loaded.person.wealth).toBe(wealth);
    expect(loaded.world.events).toHaveLength(beforeEvents);
    expect(loaded.world.johnSmith).toEqual(s.world.johnSmith);
  });

  it('still archives an emergent request paid once from its real requester', () => {
    const s = new RealmSession(918271), w = s.world, p = s.person;
    const payer = w.livingPersons().find(person => person.id !== p.id)!;
    payer.wealth = 10;
    ensureJohnSmith(w);
    const request = createRequest(w, { type: 'protection', requesterId: payer.id, reward: 3, cause: 'fixture settled protection', payload: { species: 'boar' } });
    acceptRequest(w, request, p);
    reconcileQuests(w, p.id);
    expect(questLedger(w, p.id)!.entries.find(e => e.id === `request:${request.id}`)!.state).toBe('active');
    const wealth = p.wealth;
    expect(completeRequest(w, request)).toBe(3);
    reconcileQuests(w, p.id); reconcileQuests(w, p.id);
    expect(p.wealth).toBe(wealth + 3); expect(payer.wealth).toBe(7);
    expect(questLedger(w, p.id)!.entries).toHaveLength(1);
    expect(questReceipts(w, p.id)).toEqual([expect.objectContaining({ objectiveId: `request:${request.id}`, silver: 3, payerId: payer.id })]);
    expect(w.events.filter(e => e.type === 'system_quest_reward')).toEqual([]);
  });
});
