import { describe, expect, it } from 'vitest';
import { DodgeMachine, DODGE, spaceIntent } from '../../src/web/game/dodge';
import { TargetLock, LOCK, type LockCandidate } from '../../src/web/game/targetLock';
import { CombatFeel, FEEL, type CombatEventView } from '../../src/web/game/combatFeel';
import { telegraphs, threatened } from '../../src/web/game/telegraph';
import { SliceCombat, viewFromRealm, type SliceView } from '../../src/web/game/sliceCombat';
import { RealmSession } from '../../src/sim/world/realms/session';
import { INTERACTION_SPEC } from '../../src/sim/physical/prediction';

const cycle = DODGE.rollSeconds + DODGE.recoverySeconds;

describe('dodge state machine', () => {
  it('rolls from ready, refuses a second roll mid-roll, and returns to ready after recovery', () => {
    const d = new DodgeMachine();
    expect(d.press(0, { x: 1, z: 0 })).toEqual({ type: 'defend', kind: 'sidestep', side: 1, direction: { x: 1, z: 0 } });
    expect(d.phase).toBe('rolling'); expect(d.evading(0.05)).toBe(true);
    expect(d.update(DODGE.rollSeconds + .01)).toBeNull(); expect(d.phase).toBe('recovery');
    expect(d.evading(DODGE.rollSeconds + .01)).toBe(false);
    d.update(cycle + .01); expect(d.phase).toBe('ready'); expect(d.count).toBe(1);
  });
  it('uses the server dead zone: no direction is a backstep, a direction is normalised', () => {
    const d = new DodgeMachine();
    expect(d.press(0, { x: .05, z: .05 })).toEqual({ type: 'defend', kind: 'backstep', side: 1 });
    const c = new DodgeMachine().press(0, { x: 0, z: -3 })!;
    expect(c.kind).toBe('sidestep'); expect(Math.hypot(c.direction!.x, c.direction!.z)).toBeCloseTo(1);
    expect(DODGE.deadZone).toBe(INTERACTION_SPEC.dodgeDeadZone);
  });
  it('buffers a press made during recovery and fires it once the roll can chain; stale buffers expire', () => {
    const d = new DodgeMachine(); d.press(0, { x: 1, z: 0 });
    expect(d.press(DODGE.rollSeconds + .02, { x: 0, z: 1 })).toBeNull();
    const chained = d.update(cycle + .001);
    expect(chained?.direction).toEqual({ x: 0, z: 1 }); expect(d.count).toBe(2);
    const e = new DodgeMachine(); e.press(0, { x: 1, z: 0 }); e.press(.05, { x: 1, z: 0 });
    expect(e.update(.05 + DODGE.bufferSeconds + .5)).toBeNull(); expect(e.count).toBe(1);
  });
  it('a rejected roll does not swallow the next press', () => {
    const d = new DodgeMachine(); d.press(0, { x: 1, z: 0 }); d.rejected();
    expect(d.press(.01, { x: 1, z: 0 })).not.toBeNull();
  });
  it('Space rolls while fighting and traverses otherwise', () => {
    expect(spaceIntent({ locked: false, guarding: false, threatened: false })).toBe('traverse');
    expect(spaceIntent({ locked: true, guarding: false, threatened: false })).toBe('dodge');
    expect(spaceIntent({ locked: false, guarding: true, threatened: false })).toBe('dodge');
    expect(spaceIntent({ locked: false, guarding: false, threatened: true })).toBe('dodge');
  });
});

const at = (bodyId: string, x: number, z: number, hostile = true, dead = false): LockCandidate => ({ bodyId, pos: { x, y: 0, z }, hostile, dead, kind: 'person' });
// View yaw 0 looks toward -z.
describe('target lock state machine', () => {
  it('soft-locks the best hostile in front, ignoring friends and anything behind', () => {
    const l = new TargetLock();
    l.update(0, [at('friend', 0, -2, false), at('behind', 0, 3), at('ahead', 1, -5)], { x: 0, z: 0 }, 0);
    expect([l.mode, l.bodyId]).toEqual(['soft', 'ahead']);
  });
  it('keeps the soft target through small score changes (hysteresis) and switches on a clear winner', () => {
    const l = new TargetLock(), own = { x: 0, z: 0 };
    l.update(0, [at('a', 0, -5), at('b', .2, -6)], own, 0); expect(l.bodyId).toBe('a');
    l.update(.1, [at('a', 0, -5.6), at('b', .2, -5.2)], own, 0); expect(l.bodyId).toBe('a');
    l.update(.2, [at('a', 0, -10), at('b', .2, -3)], own, 0); expect(l.bodyId).toBe('b');
  });
  it('hard lock pins a target, cycles nearest-first, and toggles off', () => {
    const l = new TargetLock(), own = { x: 0, z: 0 }, list = [at('far', 0, -9), at('near', 0, -3), at('side', 6, 0)];
    expect(l.toggle(list, own, 0)).toBe('near'); expect(l.mode).toBe('hard');
    l.update(0, [at('closer', 0, -1), ...list], own, 0); expect(l.bodyId).toBe('near');
    expect(l.cycle(list, own, 0)).toBe('side'); expect(l.cycle(list, own, 0)).toBe('far'); expect(l.cycle(list, own, 0)).toBe('near');
    expect(l.toggle(list, own, 0)).toBeNull(); expect(l.mode).toBe('none');
  });
  it('breaks a hard lock on death, distance or sustained loss of sight', () => {
    const own = { x: 0, z: 0 }, events: string[] = [];
    const l = new TargetLock(); l.onChange = (id, mode) => events.push(`${mode}:${id}`);
    l.toggle([at('t', 0, -4)], own, 0);
    l.update(0, [at('t', 0, -4, true, true)], own, 0); expect(l.mode).not.toBe('hard');
    l.toggle([at('t', 0, -4)], own, 0); l.update(0, [at('t', 0, -(LOCK.breakRange + 1))], own, 0); expect(l.mode).toBe('none');
    l.toggle([at('t', 0, -4)], own, 0);
    l.update(0, [at('t', 0, -4)], own, 0, () => false); expect(l.mode).toBe('hard');
    l.update(LOCK.lostSightSeconds + .1, [at('t', 0, -4)], own, 0, () => false); expect(l.mode).toBe('none');
    expect(events[0]).toBe('hard:t');
  });
});

const hit = (id: string, over: Partial<CombatEventView> = {}): CombatEventView => ({ id, type: 'attack', attackerBodyId: 'me', targetBodyId: 'foe', damage: 12, health: 40, weight: 'light', guarded: false, pos: null, ...over });
describe('combat feel', () => {
  const where = (id: string) => id === 'me' ? { x: 0, z: 0 } : { x: 0, z: -1 };
  it('feels each canonical event once: hit-stop, shake and a knockback along the blow', () => {
    const f = new CombatFeel();
    const [impact] = f.ingest([hit('e1')], 'me', where);
    expect(impact.own).toBe('dealt'); expect(impact.hitStop).toBeCloseTo(FEEL.hitStop.light);
    expect(f.ingest([hit('e1')], 'me', where)).toEqual([]);
    expect(f.update(.016)).toBe(FEEL.hitStopScale);
    expect(f.offset('foe').z).toBeLessThan(0);
    for (let i = 0; i < 20; i++) f.update(.016);
    expect(f.update(.016)).toBe(1); expect(Math.hypot(f.offset('foe').x, f.offset('foe').z)).toBeLessThan(.02);
  });
  it('kills and heavy blows stop longer; guarded blows and witnessed hits are softer; misses are not felt', () => {
    const f = new CombatFeel();
    const [kill, heavy, guarded, seen] = f.ingest([hit('k', { type: 'kill', health: 0 }), hit('h', { weight: 'heavy' }), hit('g', { guarded: true }), hit('w', { attackerBodyId: 'x', targetBodyId: 'y' })], 'me', where);
    expect(kill.hitStop).toBeGreaterThan(heavy.hitStop); expect(heavy.hitStop).toBeGreaterThan(guarded.hitStop);
    expect(seen.hitStop).toBe(0); expect(seen.shake).toBeLessThan(kill.shake);
    expect(f.ingest([hit('m', { type: 'attack_missed' })], 'me', where)).toEqual([]);
  });
  it('taking a hit shakes harder than dealing one, and a zero shake scale disables shake only', () => {
    const a = new CombatFeel(), b = new CombatFeel(), c = new CombatFeel(); c.shakeScale = 0;
    a.ingest([hit('t', { attackerBodyId: 'foe', targetBodyId: 'me' })], 'me', where); b.ingest([hit('d')], 'me', where); c.ingest([hit('d')], 'me', where);
    expect(a.shakeTrauma).toBeGreaterThan(b.shakeTrauma); expect(c.shakeTrauma).toBe(0); expect(c.update(.016)).toBe(FEEL.hitStopScale);
  });
});

describe('telegraphs', () => {
  it('reads boar warn/charge and a humanoid wind-up aimed at the player', () => {
    const list = telegraphs(10, 'me', { x: 0, z: 0 },
      [{ bodyId: 'boar', pos: { x: 0, y: 0, z: -3 }, dead: false, defense: { mode: 'charge', since: 9.8, strikeAt: 10.3, targetBodyId: 'me' } },
        { bodyId: 'sow', pos: { x: 5, y: 0, z: 0 }, dead: false, defense: { mode: 'warn', since: 9, strikeAt: null, targetBodyId: 'me' } }],
      // Yaw 0 faces -z, toward the player at the origin; yaw π faces away.
      [{ bodyId: 'warden', pos: { x: 0, y: 0, z: 1.2 }, combatAction: { actorBodyId: 'warden', kind: 'attack', startedAt: 9.8, activeAt: 10.1, completeAt: 10.6, facing: 0, reach: .9 } },
        { bodyId: 'turned', pos: { x: 0, y: 0, z: 1.2 }, combatAction: { actorBodyId: 'turned', kind: 'attack', startedAt: 9.8, activeAt: 10.1, completeAt: 10.6, facing: Math.PI, reach: .9 } }]);
    const by = Object.fromEntries(list.map(t => [t.bodyId, t]));
    expect(by.boar).toMatchObject({ kind: 'charge', targetsMe: true }); expect(by.boar.secondsToImpact).toBeCloseTo(.3);
    expect(by.sow).toMatchObject({ kind: 'warn' });
    expect(by.warden).toMatchObject({ kind: 'windup', targetsMe: true });
    expect(by.turned.targetsMe).toBe(false);
    expect(threatened(list)?.targetsMe).toBe(true); expect(threatened(list)?.kind).not.toBe('warn');
    expect(telegraphs(10.2, 'me', { x: 0, z: 0 }, [], [{ bodyId: 'warden', pos: { x: 0, y: 0, z: 1.2 }, combatAction: { actorBodyId: 'warden', kind: 'attack', startedAt: 9.8, activeAt: 10.1, completeAt: 10.6, facing: 0 } }])).toEqual([]);
  });
});

describe('slice combat facade', () => {
  const view = (over: Partial<SliceView> = {}): SliceView => ({ time: 0, ownBodyId: 'me', own: { x: 0, y: 0, z: 0 }, ownTraversal: null,
    people: [{ bodyId: 'foe', pos: { x: 0, y: 0, z: -4 }, dead: false, hostile: true, combatAction: null }], wildlife: [], combatEvents: [], ...over });
  it('sends ordinary intentions only, aims attacks at the lock, and makes Space contextual', () => {
    const sent: object[] = [], commands: { type: string; targetBodyId?: string; kind?: string }[] = [];
    const slice = new SliceCombat({ command: c => commands.push(c as never), send: m => sent.push(m) });
    const ctx = { moveWorld: { x: 0, z: 0 }, viewYaw: 0, guarding: false };
    slice.ingest(view());
    expect(slice.action('jump', ctx)).toBe('traverse'); expect(sent).toEqual([{ type: 'traverse' }]);
    slice.frame(.016, ctx);
    slice.action('lightAttack', ctx); expect(commands.at(-1)).toMatchObject({ type: 'attack', targetBodyId: 'foe' });
    expect(slice.action('lockTarget', ctx)).toBe('foe');
    expect(slice.action('jump', ctx)).toBe('backstep'); expect(commands.at(-1)).toMatchObject({ type: 'defend', kind: 'backstep' });
    expect(sent).toHaveLength(1);
  });
  it('feels hits from projected events and draws a hop only when the host answers hop', () => {
    const slice = new SliceCombat({ command: () => {}, send: () => {} }), ctx = { moveWorld: { x: 0, z: 0 }, viewYaw: 0, guarding: false };
    slice.ingest(view({ combatEvents: [hit('e1', { targetBodyId: 'foe' })] }));
    const fx = slice.frame(.016, ctx);
    expect(fx.impacts).toHaveLength(1); expect(fx.timeScale).toBeLessThan(1);
    expect(slice.frame(.016, ctx).impacts).toHaveLength(0);
    slice.traversalResult('vault'); expect(slice.frame(.1, ctx).hop).toBe(0);
    slice.traversalResult('hop'); expect(slice.frame(.2, ctx).hop).toBeGreaterThan(0);
  });
  it('normalises a real realm snapshot', () => {
    const s = new RealmSession(918271), v = viewFromRealm(s.snapshot());
    expect(v.ownBodyId).toBe(s.body.id); expect(v.people.every(p => p.bodyId !== s.body.id)).toBe(true);
    expect(v.people.some(p => p.hostile)).toBe(false);
  });
});
