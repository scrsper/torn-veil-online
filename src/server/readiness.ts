/**
 * Service lifecycle as seen from outside the process:
 *   unreachable → (process alive) starting → ready ⇄ maintenance → stopping, or failed.
 * `/health` answers whenever the process does (liveness). `/ready` is HTTP 200 only in `ready`.
 */
export type Lifecycle = 'starting' | 'ready' | 'maintenance' | 'stopping' | 'failed';

/** What an operator waiting for a normal start should do with one `/ready` observation. */
export function startupOutcome(r: { status: number; state?: string }): 'ready' | 'wait' | 'failed' {
  if (r.state === 'failed') return 'failed';
  return r.status === 200 && r.state === 'ready' ? 'ready' : 'wait';
}
