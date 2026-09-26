import { describe, expect, it } from 'vitest';
import { snapshotParts, stringifySnapshot } from '../src/sim/persist/json';
describe('checkpoint JSON encoding', () => {
  it('keeps existing bytes, omissions and escaping', () => {
    const snapshot = { version: 23, empty: undefined, unicode: 'Ashford — 林',
      persons: Array.from({ length: 19 }, (_, i) => ({ name: `Person ${i} 林`, omitted: undefined, history: [null, 'quoted "'] })),
      dictionary: Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['ev:' + i, { at: i / 3, evidence: ['e_1'], omitted: undefined }])),
      events: [{ data: { nullable: null }, perceivedBy: [{ who: 'p_1', tick: 1.23, how: 'heard' }] }],
      zero: -0, array: [undefined, null, Number.NaN], many: Array.from({ length: 1603 }, (_, i) => ({ id: i, text: 'quoted " and —', nested: [i / 3, undefined] })) };
    expect(stringifySnapshot(snapshot)).toBe(JSON.stringify(snapshot));
    expect([...snapshotParts(snapshot)].join('')).toBe(JSON.stringify(snapshot));
    expect(JSON.parse(stringifySnapshot(snapshot))).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });
  it('rejects cyclic and non-JSON state', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => stringifySnapshot({ cycle })).toThrow();
    expect(() => stringifySnapshot({ counter: 1n })).toThrow();
  });
});
