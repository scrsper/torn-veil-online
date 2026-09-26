import { describe, expect, it } from 'vitest';
import { encodeEventTable, stringifyEventTable, decodeEventTable } from '../src/sim/persist/eventTable';
import { deserialize, serialize, newWorld } from '../src/sim/persist/save';
import { migrationPath } from '../src/server/migrations';
import { BridgeSession } from '../src/bridge/session';


const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function fixture() {
  const { world } = newWorld(731);
  const appearance = { skin: 0.7, description: { hairStyle: 'braid', accessories: ['sash', '林'] } };
  const first = world.emit('perceived', { actor: world.persons()[0].id, significance: 0.8,
    data: { how: 'saw', encounter: true, observation: { appearance, bodyId: 'b_2', pos: { x: 1, y: 2, z: 3 } } }, summary: 'An encounter — "here"' });
  world.emit('perceived', { actor: world.persons()[1].id, causes: [first.id], significance: 0.8,
    data: { observation: { appearance: structuredClone(appearance), bodyId: 'b_2', pos: { x: 9, y: 2, z: 3 } } } });
  first.perceivedBy.push({ who: world.persons()[2].id, how: 'heard', tick: world.now + 0.1 });
  return world;
}

describe('lossless event storage', () => {
  it('streams multiple batches with exact bytes and never reuses stale witnesses or evidence', () => {
    const world = fixture();
    const data = world.events.find(e => e.data.observation)!.data;
    for (let i = 0; i < 1100; i++) world.emit('perceived', { data: structuredClone(data), summary: `batch ${i} — 林` });
    for (const events of [[], world.events]) {
      const streamed = stringifyEventTable(events), table = encodeEventTable(events);
      expect(streamed.rows).toBe(JSON.stringify(table.rows));
      expect(streamed.appearances).toEqual(table.appearances);
    }
    const before = stringifyEventTable(world.events).rows;
    world.events[700].perceivedBy.push({ who: 'p_1', how: 'saw', tick: world.now });
    world.events[700].data.observation.appearance.skin = 0.2;
    const after = stringifyEventTable(world.events);
    expect(after.rows).not.toBe(before);
    expect(after.rows).toBe(JSON.stringify(encodeEventTable(world.events).rows));
    expect(json(decodeEventTable({ ...after, rows: JSON.parse(after.rows) }))).toEqual(json(world.events));
  });

  it('deduplicates only identical appearance bytes and preserves complete independent evidence', () => {
    const world = fixture(), before = json(world.events), packed = json(encodeEventTable(world.events));
    expect(packed.appearances).toHaveLength(1);
    const restored = decodeEventTable(packed);
    expect(restored).toEqual(before);
    expect(json(world.events)).toEqual(before);
    const observations = restored.filter(e => e.data.observation);
    observations[0].data.observation.appearance.description.accessories.push('changed');
    expect(observations[1].data.observation.appearance.description.accessories).toEqual(['sash', '林']);
    expect(packed.appearances[0]).toEqual(before.find(e => e.data.observation)!.data.observation.appearance);
  });

  it('rejects truncated rows, impossible appearance references, witnesses and duplicate event ids', () => {
    for (const corrupt of [
      (t: any) => t.rows[0].pop(),
      (t: any) => t.rows[0][1] = t.appearances.length,
      (t: any) => t.rows[0][14] = [['p_1', 'omniscient', 1]],
      (t: any) => t.rows[1][2] = t.rows[0][2],
      (t: any) => t.rows[0][0] = 2 ** 20,
    ]) {
      const table = json(encodeEventTable(fixture().events)); corrupt(table);
      expect(() => decodeEventTable(table)).toThrow();
    }
  });

  it('loads explicit legacy migration and compact checkpoints to the same world', () => {
    const world = fixture(), raw = json(JSON.parse(serialize(world)));
    raw.version = 24;
    const legacy = JSON.stringify(raw), path = migrationPath(24, 25)!;
    expect(path.map(p => p.id)).toEqual(['24-to-25-lossless-event-storage']);
    const migrated = path[0].apply(legacy);
    const before = JSON.parse(legacy), after = JSON.parse(migrated);
    expect({ ...after, version: 24 }).toEqual(before);
    for (const input of [legacy, migrated, serialize(world, true)]) {
      const loaded = deserialize(input);
      expect(loaded).not.toBeNull();
      const normalized = JSON.parse(serialize(loaded!.world)); delete normalized.savedAt;
      const expected = JSON.parse(serialize(world)); delete expected.savedAt;
      expect(normalized).toEqual(expected);
    }
    const bad = JSON.parse(serialize(world, true)); bad.events[0][1] = 9999;
    expect(deserialize(JSON.stringify(bad))).toBeNull();
    bad.version = 24;
    expect(deserialize(JSON.stringify(bad))).toBeNull();
  });

  it('continues identical canonical execution after either storage representation', () => {
    const original = new BridgeSession(731);
    for (let i = 0; i < 20; i++) original.step(0.1);
    const plain = new BridgeSession(731, { save: original.save() });
    const compact = new BridgeSession(731, { save: original.save(true) });
    for (let i = 0; i < 100; i++) { plain.step(0.1); compact.step(0.1); }
    const a = JSON.parse(plain.save()), b = JSON.parse(compact.save());
    delete a.savedAt; delete b.savedAt;
    expect(b).toEqual(a);
  });
});


