import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { releaseStoppedWriter } from '../src/server/stoppedWriter';
import { WriterLock } from '../src/server/store';

const roots: string[] = [];
function fixture() { const root = mkdtempSync(join(tmpdir(), 'tvo-stopped-writer-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) {
  expect(resolve(root).startsWith(join(tmpdir(), 'tvo-stopped-writer-'))).toBe(true);
  rmSync(root, { recursive: true, force: true });
} });
it('releases a dead writer through the fence without touching checkpoint files', () => {
  const root = fixture(), pid = 2147483647;
  expect(WriterLock.alive(pid)).toBe(false);
  writeFileSync(join(root, 'writer.lock'), JSON.stringify({ pid, nonce: 'dead', env: 'dev', release: 'crashed' }));
  writeFileSync(join(root, 'retained-save.json'), 'unchanged');
  expect(releaseStoppedWriter(root, 'dev')).toBe('released');
  expect(existsSync(join(root, 'writer.lock'))).toBe(false);
  expect(readFileSync(join(root, 'retained-save.json'), 'utf8')).toBe('unchanged');
});
it('keeps a live writer fenced even when the supervisor is gone', () => {
  const root = fixture(), lock = new WriterLock(root, { env: 'dev', release: 'active' });
  lock.acquire();
  try {
    const before = readFileSync(join(root, 'writer.lock'), 'utf8');
    expect(releaseStoppedWriter(root, 'dev')).toBe('alive');
    expect(readFileSync(join(root, 'writer.lock'), 'utf8')).toBe(before);
    expect(() => lock.verify()).not.toThrow();
  } finally { lock.release(); }
});
it('refuses a malformed owner and treats a missing fence as already stopped', () => {
  const root = fixture(); expect(releaseStoppedWriter(root, 'dev')).toBe('absent');
  writeFileSync(join(root, 'writer.lock'), '{}');
  expect(() => releaseStoppedWriter(root, 'dev')).toThrow('identity');
  expect(readFileSync(join(root, 'writer.lock'), 'utf8')).toBe('{}');
});
