import { describe, expect, it } from 'vitest';
import { RealmSession } from '../../src/sim/world/realms/session';
import { deserialize, serialize, SAVE_VERSION } from '../../src/sim/persist/save';
import { applyCanonicalUniverseCommand } from '../../src/server/canonicalUniverse';
import { creditExperience } from '../../src/sim/progression/experience';
import { ensureJohnSmith } from '../../src/sim/orchestrator/state';
import { reconcileQuests } from '../../src/sim/quests';

function progress(s: RealmSession) {
  const event = s.world.emit('tower_floor_cleared', { actor: s.person.id });
  creditExperience(s.world, s.person, { kind: 'tower', xp: 25, eventId: event.id });
  ensureJohnSmith(s.world);
}
function travel(s: RealmSession) {
  reconcileQuests(s.world, s.person.id);
  expect(applyCanonicalUniverseCommand(s, { type: 'enter', id: 'schema-integration-entry', revision: 0 })).toEqual({ ok: true });
}
const load = (data: unknown) => deserialize(JSON.stringify(data));

describe('schema33 integrates both independently shipped schema32 contracts', () => {
  it('reads traversal32 with its absent planar body and quest history without granting progression', () => {
    const s = new RealmSession(731); travel(s);
    const data = JSON.parse(s.save()); data.version = 32;
    delete data.johnSmith;
    for (const p of data.persons) { delete p.experience; delete p.vessel; }
    for (const b of data.bodies) delete b.encounter;
    const loaded = load(data);
    expect(loaded).not.toBeNull();
    const world = loaded!.world, p = world.person(s.person.id)!;
    expect(world.universeExpedition).toEqual(data.universeExpedition);
    expect(world.questLedgers).toEqual(data.questLedgers);
    expect(world.body(s.body.id)!.present).toBe(false);
    expect(p.inventory).toEqual(s.person.inventory); expect(p.experience).toBeUndefined(); expect(p.vessel).toBeUndefined();
    expect(world.johnSmith).toBeUndefined();
    const rewritten = JSON.parse(serialize(world));
    expect(rewritten.version).toBe(33); expect(rewritten.universeExpedition).toEqual(data.universeExpedition);
    expect(rewritten.questLedgers).toEqual(data.questLedgers);
  });

  it('reads progression32 with its John Smith record without inventing a universe binding or old quest ledger', () => {
    const s = new RealmSession(732); progress(s);
    const data = JSON.parse(s.save()); data.version = 32;
    delete data.universeExpedition; delete data.questLedgers;
    const loaded = load(data);
    expect(loaded).not.toBeNull();
    const world = loaded!.world;
    expect(world.person(s.person.id)!.experience).toEqual(s.person.experience);
    expect(world.johnSmith).toEqual(data.johnSmith); expect(world.universeExpedition).toBeUndefined();
    expect(world.questLedgers).toBeUndefined(); expect(world.primaryBody(s.person.id)!.id).toBe(s.body.id);
    const rewritten = JSON.parse(serialize(world));
    expect(rewritten.version).toBe(33); expect(rewritten.johnSmith).toEqual(data.johnSmith);
  });

  it('round-trips both histories together and retains strict component and ontology validation', () => {
    const s = new RealmSession(733); progress(s); travel(s);
    const data = JSON.parse(s.save());
    expect(SAVE_VERSION).toBe(33); expect(data.version).toBe(33);
    const loaded = load(data);
    expect(loaded).not.toBeNull();
    expect(loaded!.world.johnSmith).toEqual(data.johnSmith);
    expect(loaded!.world.questLedgers).toEqual(data.questLedgers);
    expect(loaded!.world.universeExpedition).toEqual(data.universeExpedition);
    expect(loaded!.world.person(s.person.id)!.experience).toEqual(s.person.experience);
    const corruptions = [
      (d: typeof data) => { d.persons.find((p: { id: string }) => p.id === s.person.id).experience = { version: 1 }; },
      (d: typeof data) => { d.johnSmith.version = 99; },
      (d: typeof data) => { delete d.questLedgers[s.person.id].reserve; },
      (d: typeof data) => { delete d.universeExpedition; }, // Body remains absent: no silent return.
      (d: typeof data) => { d.persons.find((p: { id: string }) => p.id === s.person.id).ontology.stage = 'John Smith'; },
    ];
    for (const change of corruptions) { const copy = structuredClone(data); change(copy); expect(load(copy)).toBeNull(); }
  });
});
