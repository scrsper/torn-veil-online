import { describe, expect, it } from 'vitest';
import { RealmSession } from '../src/sim/world/realms/session';
import { applyExpeditionCommand, commitExpedition, validateExpeditionSave, type ExpeditionCommand } from '../src/server/realmExpedition';
import { beginFloor, finishFloor, newSheet, practice, startJourney } from '../src/sim/progression/tower';
import { newStats } from '../src/web/arena/tower/achievements';
import type { TowerCheckpoint } from '../src/web/arena/tower/checkpoint';
import { portalPoint } from '../src/sim/world/realms/layout';

let sequence = 0;
const command = (s: RealmSession, type: ExpeditionCommand['type'], extra: Partial<ExpeditionCommand> = {}): ExpeditionCommand => ({ id: `test-command-${++sequence}`, type, revision: s.world.realmExpedition?.revision ?? 0, runId: s.world.realmExpedition?.runId, ...extra });
const atrium = (s: RealmSession, realm: 'aether' | 'brass' = 'aether') => {
  const b = s.grid.chunk(realm, 32, 32).buildings[0];
  s.world.setDoorOpen(b.door, true, s.person.id);
  s.body.pos = { x: b.door.x + .5, y: 1, z: b.z + 4.5 };
};
/** Unit fixture, not an observed combat playthrough. */
function checkpoint(s: RealmSession, floor = 1): TowerCheckpoint {
  const r = s.world.realmExpedition!, sheet = newSheet(); startJourney(sheet, r.seed);
  for (let n = 1; n <= floor; n++) {
    beginFloor(sheet, n, [{ id: `foe-${n}`, hp: 100, boss: false, kind: 'raider' }]);
    if (n < floor) { practice(sheet, { kind: 'kill', target: `foe-${n}`, style: 'fists' }); finishFloor(sheet, n); }
  }
  return { version: 1, kind: 'floor-start', runId: r.runId, climberId: r.personId, savedAt: new Date().toISOString(), seed: r.seed, floor, randomState: 19,
    sheet, gear: {}, armor: null, charm: null, known: [], slots: [null, null], pending: [], classSkill: null, cls: null, essences: [], confluence: '', scrolls: [],
    stats: newStats(), earned: [], boxes: [], belt: [], extraSlots: 0, tierIdx: 0, flaskBase: 3,
    world: { level: 1, xp: 0, nextXp: 100, mods: { damage: 1, atkSpeed: 1, move: 1, regen: 1, range: 1 }, bonus: { damage: 1, atkSpeed: 1, move: 1, maxHpUpgrades: 1 },
      weapon: 'fists', hp: 100, energy: 100, mana: 100, flasks: 3, cooldowns: [0, 0], weaponImbue: {}, imbue: null, potion: { haste: 0, might: 0, stone: 0, clarity: 0 }, wardHp: 0, wardT: 0, time: 0 } };
}

describe('world-bound Tower expedition boundary', () => {
  it('requires the physical atrium and freezes city movement and simulation during ascent', () => {
    const s = new RealmSession(); expect(() => applyExpeditionCommand(s, command(s, 'enter'))).toThrow('atrium');
    atrium(s); const before = { ...s.body.pos }, time = s.world.physicalTime, person = s.person, body = s.body;
    applyExpeditionCommand(s, command(s, 'enter'));
    for (let i = 0; i < 10; i++) { s.move({ x: 1, z: 1, sprint: true }); s.step(.05); }
    expect(s.navigate('portal')).toBe(false); expect(s.body.pos).toEqual(before); expect(s.world.physicalTime).toBe(time);
    expect(s.person).toBe(person); expect(s.body).toBe(body); expect(s.interact()).toContain('Resume');
  });
  it('makes acknowledged requests idempotent across reload and rejects stale or altered requests', () => {
    let s = new RealmSession(); atrium(s); const enter = command(s, 'enter');
    const r = applyExpeditionCommand(s, enter); s = new RealmSession(0, s.save());
    expect(applyExpeditionCommand(s, enter)).toEqual(r);
    expect(() => applyExpeditionCommand(s, { ...enter, type: 'return' })).toThrow('different data');
    expect(() => applyExpeditionCommand(s, command(s, 'return', { revision: 0 }))).toThrow('changed');
    expect(() => applyExpeditionCommand(s, command(s, 'return', { runId: 'other-person' }))).toThrow('matching');
    const leave = command(s, 'return'); const returned = applyExpeditionCommand(s, leave);
    expect(applyExpeditionCommand(s, leave)).toEqual(returned); expect(returned.active).toBe(false);
  });
  it('keeps one scoped checkpoint, enforcing identity, floor sequence and a clean floor boundary', () => {
    const s = new RealmSession(); atrium(s); applyExpeditionCommand(s, command(s, 'enter'));
    expect(() => applyExpeditionCommand(s, command(s, 'checkpoint', { checkpoint: checkpoint(s, 2) }))).toThrow('next floor');
    const first = checkpoint(s);
    expect(() => applyExpeditionCommand(s, command(s, 'checkpoint', { checkpoint: { ...first, climberId: 'another-person' } }))).toThrow('match');
    const preview = structuredClone(first); preview.sheet.journey!.preview = true;
    expect(() => applyExpeditionCommand(s, command(s, 'checkpoint', { checkpoint: preview }))).toThrow('match');
    const midFloor = structuredClone(first); midFloor.sheet.journey!.current!.seconds = 1;
    expect(() => applyExpeditionCommand(s, command(s, 'checkpoint', { checkpoint: midFloor }))).toThrow('match');
    applyExpeditionCommand(s, command(s, 'checkpoint', { checkpoint: first }));
    first.gear = { fists: { kind: 'weapon', id: 'mutated', name: 'changed' } as never };
    expect((s.world.realmExpedition!.checkpoint as TowerCheckpoint).gear).toEqual({});
    applyExpeditionCommand(s, command(s, 'checkpoint', { checkpoint: checkpoint(s, 2) }));
    expect(() => applyExpeditionCommand(s, command(s, 'checkpoint', { checkpoint: checkpoint(s, 1) }))).toThrow('next floor');
    validateExpeditionSave(new RealmSession(0, s.save()));
  });
  it('returns the same character, possessions, ontology and health, then resumes across the other realm', () => {
    let s = new RealmSession(); atrium(s);
    const original = { id: s.person.id, body: s.body.id, inventory: structuredClone(s.person.inventory), ontology: structuredClone(s.person.ontology), health: s.body.health };
    const landing = { ...s.body.pos }; applyExpeditionCommand(s, command(s, 'enter'));
    const first = checkpoint(s); first.world.level = 99; first.world.hp = 1; first.sheet.might = 100;
    applyExpeditionCommand(s, command(s, 'checkpoint', { checkpoint: first }));
    s = new RealmSession(0, s.save()); const runId = s.world.realmExpedition!.runId;
    applyExpeditionCommand(s, command(s, 'return')); expect(s.body.pos).toEqual(landing);
    s.body.pos = portalPoint('aether'); s.interact(); expect(s.confirm(s.snapshot().pending!.id)).toBe(true);
    atrium(s, 'brass'); applyExpeditionCommand(s, command(s, 'enter'));
    expect(s.world.realmExpedition).toMatchObject({ runId, realm: 'brass', checkpoint: first });
    applyExpeditionCommand(s, command(s, 'return')); s = new RealmSession(0, s.save());
    expect({ id: s.person.id, body: s.body.id, inventory: s.person.inventory, ontology: s.person.ontology, health: s.body.health }).toEqual(original);
    expect(s.world.persons()).toHaveLength(5); expect(s.snapshot().realm).toBe('brass');
  });
  it('rolls back failed durable writes on both entry and return, retaining the last valid save', () => {
    let s = new RealmSession(); atrium(s); let disk = s.save(); const enter = command(s, 'enter');
    const failed = commitExpedition(s, enter, () => { throw Error('disk full'); }); s = failed.session;
    expect(failed.error).toContain('disk full'); expect(s.world.realmExpedition).toBeUndefined(); expect(new RealmSession(0, disk).world.realmExpedition).toBeUndefined();
    const entered = commitExpedition(s, enter, raw => { disk = raw; }); s = entered.session; expect(entered.error).toBeUndefined();
    const leave = command(s, 'return'); const rejected = commitExpedition(s, leave, () => { throw Error('disk full'); }); s = rejected.session;
    expect(s.world.realmExpedition!.active).toBe(true); expect(new RealmSession(0, disk).world.realmExpedition!.active).toBe(true);
    const returned = commitExpedition(s, leave, raw => { disk = raw; }); expect(returned.error).toBeUndefined();
    expect(new RealmSession(0, disk).world.realmExpedition!.active).toBe(false);
  });
  it('rejects incompatible bindings instead of silently dropping a pending ascent', () => {
    const s = new RealmSession(); atrium(s); applyExpeditionCommand(s, command(s, 'enter'));
    const raw = JSON.parse(s.save()); raw.realmExpedition.bodyId = 'missing-body';
    expect(() => new RealmSession(0, JSON.stringify(raw))).toThrow();
    raw.realmExpedition.bodyId = s.body.id; raw.version = 26;
    expect(() => new RealmSession(0, JSON.stringify(raw))).toThrow();
    raw.version = 27; raw.realmExpedition.checkpoint = {};
    expect(() => validateExpeditionSave(new RealmSession(0, JSON.stringify(raw)))).toThrow('checkpoint');
  });
  it('records a scoped ending once and creates a new run only after returning and entering again', () => {
    const s = new RealmSession(); atrium(s); applyExpeditionCommand(s, command(s, 'enter')); const id = s.world.realmExpedition!.runId;
    expect(() => applyExpeditionCommand(s, command(s, 'finish', { outcome: 'completed' }))).toThrow('Summit');
    applyExpeditionCommand(s, command(s, 'finish', { outcome: 'fallen' }));
    expect(() => applyExpeditionCommand(s, command(s, 'enter'))).toThrow('atrium');
    applyExpeditionCommand(s, command(s, 'return')); applyExpeditionCommand(s, command(s, 'enter'));
    expect(s.world.realmExpedition!.runId).not.toBe(id); expect(s.world.realmExpedition!.checkpoint).toBeNull();
  });
});
