import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WriterLock } from './store';

/** Called only after the supervisor exits. A crashed writer cannot release its own fence. */
export function releaseStoppedWriter(stateDir: string, env: string): 'absent' | 'alive' | 'released' {
  if (!existsSync(join(stateDir, 'writer.lock'))) return 'absent';
  const lock = new WriterLock(stateDir, { release: 'operator-stop', env });
  const owner = lock.read();
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw new Error('Cannot establish stopped writer identity; inspect writer.lock');
  if (WriterLock.alive(owner.pid)) return 'alive';
  lock.acquire(); // Existing nonce/PID checks still fence another writer.
  try { lock.verify(); } finally { lock.release(); }
  return 'released';
}
