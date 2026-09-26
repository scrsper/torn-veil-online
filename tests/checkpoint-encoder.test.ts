import { describe, expect, it } from 'vitest';
import { CheckpointEncoder } from '../src/server/checkpointEncoder';
import { decodeEventTable } from '../src/sim/persist/eventTable';
import { newWorld, serializeParts } from '../src/sim/persist/save';

describe('checkpoint storage worker', () => {
  it('packs only the captured snapshot while subsequent canonical mutations remain independent', async () => {
    const encoder = new CheckpointEncoder();
    try {
      const { world } = newWorld(731), parts = serializeParts(world), original = JSON.parse(parts.join(''));
      const captured = encoder.encode(parts);
      world.persons()[0].wealth += 7;
      world.emit('perceived', { summary: 'After snapshot — 林', data: { encounter: true } });
      const result = await captured, stored = JSON.parse(result.bytes.toString());
      expect(result.encodeMs).toBeGreaterThan(0);
      stored.events = decodeEventTable({ ...stored.eventEncoding, rows: stored.events });
      delete stored.eventEncoding;
      expect(stored).toEqual(original);
      const next = JSON.parse((await encoder.encode(serializeParts(world))).bytes.toString());
      expect(next.persons[0].wealth).toBe(original.persons[0].wealth + 7);
      expect(next.events.length).toBe(original.events.length + 1);
    } finally { await encoder.close(); }
  });

  it('rejects malformed snapshots without returning a checkpoint and rejects concurrent jobs', async () => {
    const encoder = new CheckpointEncoder();
    try {
      const job = encoder.encode('{"truncated');
      expect(() => encoder.encode('{"events":[]}')).toThrow('already in flight');
      await expect(job).rejects.toThrow();
      await expect(encoder.encode('{"events":[],"eventEncoding":{}}')).rejects.toThrow('unpacked');
      await expect(encoder.encode(['{"events":', '['])).rejects.toThrow();
      expect(JSON.parse((await encoder.encode('{"events":[]}')).bytes.toString()).events).toEqual([]);
    } finally { await encoder.close(); }
  });

  it('rejects an interrupted worker instead of acknowledging an unsaved checkpoint', async () => {
    const encoder = new CheckpointEncoder();
    const result = expect(encoder.encode('{"events":[]}')).rejects.toThrow('exited');
    await encoder.close();
    await result;
  });
});
