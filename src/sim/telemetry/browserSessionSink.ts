import type { MemorySink } from './recorder';

const KEY_PREFIX = 'tv_telemetry_session_';
const MAX_SESSIONS = 5;

/**
 * Persists a browser dev session's telemetry to localStorage (v0.2 Part 18: "run game -> play
 * normally -> simulation automatically logs -> exit -> inspect session" — no manual marker like
 * pressing F8 required for a trace to exist). Defensively wrapped exactly like
 * sim/persist/save.ts's save()/load(): a full or disabled storage must never disrupt gameplay,
 * so every localStorage call here is try/caught and silently gives up on failure.
 *
 * Sessions are capped at `MAX_SESSIONS`, pruning oldest-first, so an ordinary dev session
 * doesn't grow localStorage without bound. Reading a session back is left for future in-game
 * tooling (e.g. an Inspector panel) to build against `listBrowserTelemetrySessions` /
 * `readBrowserTelemetrySession` — this module only owns the write path.
 */
export function flushBrowserSession(sessionId: string, sink: MemorySink): void {
  try {
    localStorage.setItem(KEY_PREFIX + sessionId, sink.toJSONL());
    pruneOldSessions();
  } catch { /* storage full or disabled — telemetry is best-effort, gameplay must not care */ }
}

function pruneOldSessions(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(KEY_PREFIX)).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SESSIONS))) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

export function listBrowserTelemetrySessions(): string[] {
  try { return Object.keys(localStorage).filter(k => k.startsWith(KEY_PREFIX)).sort(); } catch { return []; }
}

export function readBrowserTelemetrySession(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
