import { describe, expect, it } from 'vitest';
import { RealmRuntime } from '../../src/server/realmRuntime';
import { RealmSession } from '../../src/sim/world/realms/session';
import { makeItem } from '../../src/sim/world/factory';
import { learnArcaneSource } from '../../src/sim/physical/arcana/runtime';
import { observeJohnSmith } from '../../src/sim/orchestrator';
import { questLedger } from '../../src/sim/quests';

describe('traversal integrated with main progression and John Smith', () => {
  it('retains earned learning, both historical ledgers and reserve identities across saved absence and return', () => {
    let runtime = new RealmRuntime(new RealmSession(731));
    const s = runtime.session;
    observeJohnSmith(s.world);
    const book = makeItem(s.world, 'book', 'Release acceptance source', { owner: s.person.id, holder: s.person.id });
    book.arcaneSource = { version: 1, abilityId: 'book-well', kind: 'book' };
    expect(learnArcaneSource(s.world, s.person, s.body.id, book.id)).toBe('accepted');
    expect(s.person.experience?.lifetimeXp).toBeGreaterThan(0);
    questLedger(s.world, s.person.id);
    const retained = {
      person: s.person.id, body: s.body.id, inventory: structuredClone(s.person.inventory),
      experience: structuredClone(s.person.experience), stage: s.person.ontology.stage,
      johnSmith: structuredClone(s.world.johnSmith), legacyQuests: structuredClone(s.world.questLedgers),
    };
    expect(runtime.apply({ type: 'universe', command: { type: 'enter', id: 'release-board', revision: 0 } })).toEqual({ value: { ok: true } });
    runtime = new RealmRuntime(new RealmSession(0, runtime.session.save()));
    expect(runtime.session.body.present).toBe(false);
    // A town-only reward command cannot open an off-world coffer or mutate either reserve.
    expect(runtime.apply({ type: 'johnsmith', command: { type: 'open_cache', cacheId: 'veil-cache:iron:1' } }).ok).toBe(false);
    expect(runtime.apply({ type: 'universe', command: { type: 'return', id: 'release-return', revision: 1 } })).toEqual({ value: { ok: true } });
    const restored = new RealmSession(0, runtime.session.save());
    expect(restored.body.present).toBe(true);
    expect({ person: restored.person.id, body: restored.body.id, inventory: restored.person.inventory,
      experience: restored.person.experience, stage: restored.person.ontology.stage,
      johnSmith: restored.world.johnSmith, legacyQuests: restored.world.questLedgers }).toEqual(retained);
    expect(runtime.apply({ type: 'johnsmith', command: { type: 'nonsense' } })).toEqual({ result: 'invalid_command' });
  });
});
