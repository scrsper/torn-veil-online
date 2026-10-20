import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealmJournal } from '../../src/server/realmJournal';
import { RealmSession } from '../../src/sim/world/realms/session';
import { neutralInput } from '../../src/sim/world/universe/travel';

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const savedWorld = (journal: RealmJournal) => {
  const world = JSON.parse(journal.runtime.session.save()); delete world.savedAt; return world;
};

describe('canonical universe with the real journal worker', () => {
  it('recovers a committed flight tail and preserves it after a later failed write', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'veil-universe-journal-')); directories.push(directory);
    const path = join(directory, 'world.json'), original = new RealmSession(731).save();
    writeFileSync(path, original);
    let journal = new RealmJournal(path, 731, 'universe-worker-recovery-test');
    try {
      await journal.ready;
      const identity = { person: journal.runtime.session.person.id, body: journal.runtime.session.body.id };
      const inventory = structuredClone(journal.runtime.session.person.inventory);
      expect(journal.apply({ type: 'universe', command: { type: 'enter', id: 'durable-board-flight', revision: 0 } }).error).toBeUndefined();
      journal.apply({ type: 'universe_travel', command: { type: 'launch' } });
      journal.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), throttle: 1 } } });
      for (let i = 0; i < 24; i++) journal.apply({ type: 'step', now: i * 1000 / 60 });
      await journal.flush();
      const committed = savedWorld(journal), control = journal.runtime.checkpoint();
      expect(committed.universeExpedition.state.mode).toBe('flight');
      // Stop without creating another checkpoint: the next process must replay
      // the durable operation tail, including the absent planar body and cadence.
      await journal.abort();
      journal = new RealmJournal(path, 731, 'universe-worker-recovery-test');
      await journal.ready;
      expect(savedWorld(journal)).toEqual(committed);
      expect(journal.runtime.checkpoint()).toEqual(control);
      expect(journal.runtime.session.person.id).toBe(identity.person);
      expect(journal.runtime.session.body.id).toBe(identity.body);
      expect(journal.runtime.session.person.inventory).toEqual(inventory);
      expect(journal.runtime.session.body.present).toBe(false);
      expect(journal.runtime.session.world.primaryBody(identity.person)).toBeUndefined();
      // This is the ordinary realm host's startup/disconnect operation.
      journal.apply({ type: 'disconnect' }); await journal.flush();
      const safe = savedWorld(journal);
      expect(safe.universeExpedition.state.position).toEqual(committed.universeExpedition.state.position);
      expect(safe.universeExpedition.state.velocity).toEqual({ x: 0, y: 0, z: 0 });
      journal.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), lift: 1 } } });
      journal.apply({ type: 'step', now: 1000 });
      vi.spyOn(journal.store, 'append').mockRejectedValueOnce(Error('injected universe journal failure'));
      await expect(journal.flush()).rejects.toThrow('injected universe journal failure');
      expect(() => journal.apply({ type: 'step', now: 1017 })).toThrow('injected universe journal failure');
      await journal.abort();
      journal = new RealmJournal(path, 731, 'universe-worker-recovery-test'); await journal.ready;
      expect(savedWorld(journal)).toEqual(safe);
      expect(readFileSync(path, 'utf8')).toBe(original);
    } finally { await journal.abort(); }
  }, 30000);
});
