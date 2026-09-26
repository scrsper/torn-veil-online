import type { WorldEvent } from '../core/types';

// Storage only: no event retires, and no knowledge is derived from current world truth.
// Repeated column names, witness field names and identical historical appearances are
// redundant in JSON. Decode restores independent mutable records, including exact evidence.
const COLUMNS = ['id', 'tick', 'type', 'category', 'actor', 'target', 'item', 'placeId', 'pos', 'data', 'causes', 'effects', 'perceivedBy', 'significance', 'summary', 'visibility', 'loudness'] as const;
const KEYS = new Set<string>(COLUMNS);
export interface EventTable { format: 1; appearances: Record<string, unknown>[]; rows: unknown[][] }
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

export function encodeEventTable(events: WorldEvent[]): EventTable {
  const appearances: Record<string, unknown>[] = [], indices = new Map<string, number>();
  const rows = events.map(event => {
    if (Object.keys(event).some(key => !KEYS.has(key))) throw new Error('Unrecognized event field in checkpoint');
    let mask = (1 << COLUMNS.length) - 1, appearance = -1;
    if (event.actor === undefined) mask &= ~(1 << 4);
    if (event.target === undefined) mask &= ~(1 << 5);
    if (event.item === undefined) mask &= ~(1 << 6);
    if (event.placeId === undefined) mask &= ~(1 << 7);
    if (event.pos === undefined) mask &= ~(1 << 8);
    if (event.visibility === undefined) mask &= ~(1 << 15);
    if (event.loudness === undefined) mask &= ~(1 << 16);
    let data = event.data;
    if (record(data.observation?.appearance)) {
      const a = data.observation.appearance, identity = JSON.stringify(a);
      appearance = indices.get(identity) ?? -1;
      if (appearance < 0) { appearance = appearances.length; indices.set(identity, appearance); appearances.push(a); }
      const { appearance: _appearance, ...observation } = data.observation;
      data = { ...data, observation };
    }
    // Flat witness triples avoid allocating one small array per witness on every checkpoint.
    const witnesses: unknown[] = [];
    for (const p of event.perceivedBy) witnesses.push(p.who, p.how, p.tick);
    return [mask, appearance, event.id, event.tick, event.type, event.category,
      event.actor ?? null, event.target ?? null, event.item ?? null, event.placeId ?? null,
      event.pos ?? null, data, event.causes, event.effects, witnesses, event.significance,
      event.summary, event.visibility ?? null, event.loudness ?? null];
  });
  return { format: 1, appearances, rows };
}

/** Reject malformed tables; never silently substitute missing historical evidence. */
export function decodeEventTable(table: unknown): WorldEvent[] {
  if (!record(table) || table.format !== 1 || !Array.isArray(table.appearances) || !table.appearances.every(record) || !Array.isArray(table.rows)) throw new Error('Invalid event table');
  const ids = new Set<string>();
  return table.rows.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== COLUMNS.length + 2) throw new Error('Invalid event row');
    const [mask, appearance] = row;
    if (!Number.isInteger(mask) || mask < 0 || mask >= 1 << COLUMNS.length || !Number.isInteger(appearance) || appearance < -1 || appearance >= table.appearances.length) throw new Error('Invalid event columns');
    const event: Record<string, any> = {};
    COLUMNS.forEach((key, index) => {
      if (mask & 1 << index) event[key] = row[index + 2];
      else if (row[index + 2] !== null) throw new Error('Ambiguous omitted event field');
    });
    if (typeof event.id !== 'string' || ids.has(event.id) || !finite(event.tick) || typeof event.type !== 'string' || !['world', 'social', 'cognition', 'history'].includes(event.category)
      || !record(event.data) || !strings(event.causes) || !strings(event.effects) || !finite(event.significance) || typeof event.summary !== 'string' || !Array.isArray(event.perceivedBy)) throw new Error('Invalid event evidence');
    ids.add(event.id);
    const witnesses = event.perceivedBy;
    if (witnesses.length % 3 !== 0) throw new Error('Truncated witness evidence');
    event.perceivedBy = [];
    for (let i = 0; i < witnesses.length; i += 3) {
      const [who, how, tick] = witnesses.slice(i, i + 3);
      if (typeof who !== 'string' || !['saw', 'heard'].includes(how) || !finite(tick)) throw new Error('Invalid witness evidence');
      event.perceivedBy.push({ who, how, tick });
    }
    if (appearance >= 0) {
      if (!record(event.data.observation) || Object.hasOwn(event.data.observation, 'appearance')) throw new Error('Invalid appearance reference');
      event.data = { ...event.data, observation: { ...event.data.observation, appearance: structuredClone(table.appearances[appearance]) } };
    }
    return event as WorldEvent;
  });
}
