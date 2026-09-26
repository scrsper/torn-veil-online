/**
 * Explicit save-schema migrations for live worlds. A release whose save schema differs from the
 * live world's may only be promoted when a path exists here; the update procedure applies it under
 * the writer fence after a pre-update backup. There is deliberately no automatic reinterpretation.
 * An older executable cannot read a migrated world: rolling back after a migration means restoring
 * the pre-update backup (the update tool says so), not just switching executables.
 */
export interface Migration { id: string; from: number; to: number; apply(world: string): string }
export const MIGRATIONS: Migration[] = [{
  id: '24-to-25-lossless-event-storage', from: 24, to: 25,
  apply(raw) {
    const data = JSON.parse(raw);
    if (data.version !== 24 || data.eventEncoding !== undefined || !Array.isArray(data.events)) throw new Error('Invalid schema-24 migration input');
    data.version = 25; // Plain event records are valid in 25; the next checkpoint packs them.
    return JSON.stringify(data);
  },
}];

/** The ordered steps from one schema to another; [] when equal; null when no path exists. */
export function migrationPath(from: number, to: number): Migration[] | null {
  if (from === to) return [];
  const steps: Migration[] = [];
  let at = from;
  while (at !== to) {
    const next = MIGRATIONS.find(m => m.from === at);
    if (!next) return null;
    steps.push(next); at = next.to;
    if (steps.length > 64) return null;
  }
  return steps;
}
