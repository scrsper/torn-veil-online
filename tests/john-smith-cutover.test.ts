import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealmJournal } from '../src/server/realmJournal';
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
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

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

  it('keeps both rewards single through claim retries, real journal replay, reload and a universe round trip', async () => {
    // Disclosed import fixture: floor 1 was paid by the legacy silver ledger;
    // floor 2 is a real-format receipt awaiting the current watch's first pass.
    // Reward generation/opening and every retry below use journaled host operations.
    const original = new RealmSession(731);
    clear(original, 1); reconcileQuests(original.world, original.person.id);
    const legacy = structuredClone(questLedger(original.world, original.person.id)!), wealth = original.person.wealth;
    expect(legacy.entries.find(e => e.id === 'system:tower:floor:1')!.claim!.paid).toBe(3);
    expect(legacy.entries.find(e => e.id === 'system:tower:floor:2')!.state).toBe('active');
    ensureJohnSmith(original.world); clear(original, 2);
    const imported = original.save(), directory = mkdtempSync(join(tmpdir(), 'veil-reward-cutover-'));
    directories.push(directory); const path = join(directory, 'world.json'); writeFileSync(path, imported);
    const canonical = (s: RealmSession) => { const data = JSON.parse(s.save()); delete data.savedAt; return data; };
    const rewards = (s: RealmSession) => structuredClone({
      personId: s.person.id, bodyId: s.body.id, inventory: s.person.inventory, wealth: s.person.wealth,
      legacy: questLedger(s.world, s.person.id), receipts: questReceipts(s.world, s.person.id),
      caches: s.world.johnSmith!.caches,
      grants: s.world.events.filter(e => e.type === 'orchestrator' && e.data.act === 'cache_granted'),
      opens: s.world.events.filter(e => e.type === 'orchestrator' && e.data.act === 'cache_opened'),
      silver: s.world.events.filter(e => e.type === 'system_quest_reward'),
      items: s.world.items().filter(i => i.tags.includes('veil-cache')),
      coffers: s.world.containers().filter(c => c.tags.includes('veil-cache')),
    });
    let journal = new RealmJournal(path, 731, 'cutover-retry-replay');
    try {
      await journal.ready;
      journal.apply({ type: 'objectives' }); journal.apply({ type: 'objectives' });
      journal.apply({ type: 'step', now: 0 });
      const cache = journal.runtime.session.world.johnSmith!.caches.find(c => c.reason === 'feat:floor-1')!;
      expect(cache).toBeDefined();
      const claim = { type: 'johnsmith' as const, command: { type: 'open_cache', cacheId: cache.id } };
      expect(journal.apply(claim).result).toBe('opened');
      expect(journal.apply(claim).result).toBe('already_opened');
      journal.apply({ type: 'step', now: 17 }); journal.apply({ type: 'objectives' });
      const expected = rewards(journal.runtime.session);
      expect(expected.wealth).toBe(wealth); expect(expected.legacy).toEqual(legacy);
      expect(expected.silver).toHaveLength(1); expect(expected.grants).toHaveLength(1); expect(expected.opens).toHaveLength(1);
      expect(expected.caches).toHaveLength(1); expect(expected.coffers).toHaveLength(1);
      expect(expected.items.length).toBeGreaterThan(0);
      expect(new Set(expected.items.map(i => i.id)).size).toBe(expected.items.length);
      const enter = { type: 'universe' as const, command: { type: 'enter' as const, id: 'reward-replay-enter', revision: 0 } };
      expect(journal.apply(enter)).toEqual({ value: { ok: true } });
      expect(journal.apply(enter)).toEqual({ value: { ok: true } });
      await journal.flush();
      const committed = canonical(journal.runtime.session), control = journal.runtime.checkpoint();
      // Abort without checkpoint: a fresh worker must reconstruct the grant,
      // opened coffer and duplicate commands by replaying the durable tail.
      await journal.abort(); journal = new RealmJournal(path, 731, 'cutover-retry-replay'); await journal.ready;
      expect(canonical(journal.runtime.session)).toEqual(committed);
      expect(journal.runtime.checkpoint()).toEqual(control);
      expect(journal.runtime.session.body.present).toBe(false);
      expect(rewards(journal.runtime.session)).toEqual(expected);
      expect(journal.apply(claim).ok).toBe(false); // An absent body cannot open a town coffer.
      const back = { type: 'universe' as const, command: { type: 'return' as const, id: 'reward-replay-return', revision: 1 } };
      expect(journal.apply(back)).toEqual({ value: { ok: true } });
      expect(journal.apply(back)).toEqual({ value: { ok: true } });
      journal.apply({ type: 'objectives' }); journal.apply({ type: 'objectives' });
      journal.apply({ type: 'step', now: 34 }); journal.apply({ type: 'step', now: 51 });
      expect(journal.apply(claim).result).toBe('already_opened');
      expect(rewards(journal.runtime.session)).toEqual(expected);
      expect(journal.runtime.session.body.present).toBe(true);
      expect(journal.runtime.session.world.events.filter(e => e.type === 'universe_entered')).toHaveLength(1);
      expect(journal.runtime.session.world.events.filter(e => e.type === 'universe_returned')).toHaveLength(1);
      await journal.checkpoint();
      expect(canonical(journal.store.load(731).runtime.session)).toEqual(canonical(journal.runtime.session));
      const reloaded = new RealmRuntime(new RealmSession(0, journal.runtime.session.save()));
      reloaded.apply({ type: 'objectives' }); reloaded.apply({ type: 'step', now: 68 });
      expect(reloaded.apply(claim).result).toBe('already_opened');
      expect(rewards(reloaded.session)).toEqual(expected);
      expect(readFileSync(path, 'utf8')).toBe(imported);
    } finally { await journal.abort(); }
  }, 30000);
});
