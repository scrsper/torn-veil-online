import { describe, expect, it } from 'vitest';
import { checkpointForShutdown } from '../src/server/realmShutdown';

describe('owned realm shutdown', () => {
  it('releases input, durably flushes and completes checkpoint before success', async () => {
    const calls: string[] = [];
    const result = await checkpointForShutdown({
      disconnect: () => { calls.push('disconnect'); },
      flush: async () => { calls.push('flush'); },
      close: async () => { calls.push('checkpoint'); },
      abort: async () => { calls.push('abort'); },
    });
    expect(result).toEqual({ saved: true });
    expect(calls).toEqual(['disconnect', 'flush', 'checkpoint']);
  });
  it('does not claim a successful quit when the final checkpoint fails', async () => {
    const calls: string[] = [];
    const result = await checkpointForShutdown({
      disconnect: () => { calls.push('disconnect'); },
      flush: async () => { calls.push('flush'); },
      close: async () => { calls.push('checkpoint'); throw Error('disk full'); },
      abort: async () => { calls.push('abort'); },
    });
    expect(result).toEqual({ saved: false, error: 'Error: disk full' });
    expect(calls).toEqual(['disconnect', 'flush', 'checkpoint', 'abort']);
  });
  it('preserves a failed journal for recovery instead of checkpointing it', async () => {
    const calls: string[] = [];
    const result = await checkpointForShutdown({
      disconnect: () => { calls.push('disconnect'); },
      flush: async () => { calls.push('flush'); },
      close: async () => { calls.push('checkpoint'); },
      abort: async () => { calls.push('abort'); },
    }, 'earlier write failed');
    expect(result).toEqual({ saved: false, error: 'earlier write failed' });
    expect(calls).toEqual(['abort']);
  });
});
