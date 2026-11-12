import { describe, it, expect } from 'vitest';
import { HeldGuard, RealmHeldInput } from '../src/web/realms/heldInput';
import { CommandQueue, type InteractionCommand } from '../src/bridge/commands';
import { INTERACTION_SPEC } from '../src/sim/physical/prediction';

/**
 * The realm client samples held input every 50 ms. It previously re-sent `guard held:true`
 * on every one of those samples (twice the canonical 100 ms refresh policy), interleaving a
 * non-movement command between every movement sample. The host queue may only supersede a
 * trailing run of movement samples, so a briefly stalled host filled with guard renewals and
 * answered queue_full (the notice seen under held guard in the Tower follow-up evidence).
 */
const SAMPLE_MS = 50, REFRESH_MS = INTERACTION_SPEC.guardRefreshSeconds * 1000, LEASE_MS = INTERACTION_SPEC.guardLeaseSeconds * 1000;

function held(policy: HeldGuard, from: number, to: number) { for (let t = from; t < to; t += SAMPLE_MS) policy.update(true, t); }

describe('realm held guard input', () => {
  it('renews a held guard at the canonical refresh cadence and never lets the lease lapse', () => {
    const sent: { held: boolean; at: number }[] = []; let now = 0;
    const guard = new HeldGuard(h => sent.push({ held: h, at: now }));
    for (now = 0; now < 2000; now += SAMPLE_MS) guard.update(true, now);
    expect(sent.every(s => s.held)).toBe(true);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(2000 / REFRESH_MS) + 1);
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(REFRESH_MS);
    expect(Math.max(...gaps)).toBeLessThan(LEASE_MS);
  });

  it('sends one release, stops renewing, and resumes only on a new hold', () => {
    const sent: boolean[] = [];
    const guard = new HeldGuard(h => sent.push(h));
    held(guard, 0, 300);
    const before = sent.length;
    guard.update(false, 300); guard.update(false, 350); guard.update(false, 1000);
    expect(sent.slice(before)).toEqual([false]);
    guard.update(true, 1050); expect(sent.at(-1)).toBe(true);
    // Blur/Escape/menus force a neutral guard even if the last known state was already neutral.
    guard.release(1100); guard.release(1150);
    expect(sent.slice(-2)).toEqual([false, false]);
    guard.update(false, 1200); expect(sent.length).toBe(before + 4);
  });

  it('a held guard under a briefly stalled host never fills the command queue', () => {
    const run = (refreshMs: number) => {
      const q = new CommandQueue('e', 'c', 'b');
      let sequence = 0;
      const results: string[] = [];
      const send = (command: InteractionCommand, at: number) => results.push(q.receive({ version: 2, type: 'command', epoch: 'e', controllerId: 'c', bodyId: 'b', sequence, commandId: `c-${sequence++}`, specRevision: INTERACTION_SPEC.revision, clientTimeMs: at, command }, 0, at).result);
      let now = 0;
      const guard = new HeldGuard(h => send({ type: 'guard', held: h }, now), refreshMs);
      // 600 ms without a host tick (e.g. a long journal flush or GC pause) while the player
      // keeps holding guard and facing a target: one movement sample per input interval.
      for (now = 0; now < 600; now += SAMPLE_MS) { send({ type: 'move', x: 0, z: 0, sprint: false, facing: 1 }, now); guard.update(true, now); }
      return results;
    };
    // The previous client cadence (a renewal every input sample) reproduces the defect.
    expect(run(SAMPLE_MS)).toContain('queue_full');
    // The canonical refresh policy keeps the same held guard and admits every command.
    expect(run(REFRESH_MS)).not.toContain('queue_full');
  });
});


// Event-level regressions exercise the same release listeners installed by the town client.
describe('realm held input release boundaries', () => {
  function setup() {
    let now = 0;
    const sent: InteractionCommand[] = [];
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const input = new RealmHeldInput(command => sent.push(command), () => now);
    input.bindReleaseEvents(win, doc);
    const key = (type: string, code: string) => win.dispatchEvent(Object.assign(new Event(type), { code }));
    const guards = () => sent.filter(c => c.type === 'guard');
    return { input, win, doc, key, sent, guards, time: (value: number) => { now = value; } };
  }

  it('starts guard immediately and shares one refresh cadence between keyboard and mouse', () => {
    const t = setup();
    t.input.keyDown('KeyG');
    expect(t.guards()).toEqual([{ type: 'guard', held: true }]);
    t.time(20); t.input.pointerGuardDown();
    t.time(50); t.input.sampleGuard(true);
    expect(t.guards()).toHaveLength(1);
    t.time(100); t.input.sampleGuard(true);
    expect(t.guards()).toHaveLength(2);
    t.key('keyup', 'KeyG');
    expect(t.input.guarding).toBe(true);
    expect(t.guards()).toHaveLength(2);
    t.win.dispatchEvent(Object.assign(new Event('pointerup'), { button: 2 }));
    expect(t.guards().at(-1)).toEqual({ type: 'guard', held: false });
    t.time(500); t.input.sampleGuard(true);
    expect(t.guards()).toHaveLength(3);
  });

  it.each(['blur', 'pointercancel', 'escape', 'hidden'])('releases movement, guard and crouch on %s, without repeat-key reacquisition', reason => {
    const t = setup();
    t.input.keyDown('KeyW'); t.input.keyDown('KeyG'); t.input.keyDown('KeyC'); t.input.pointerGuardDown();
    if (reason === 'escape') t.key('keydown', 'Escape');
    else if (reason === 'hidden') { t.doc.hidden = true; t.doc.dispatchEvent(new Event('visibilitychange')); }
    else t.win.dispatchEvent(new Event(reason));
    expect(t.input.keys.size).toBe(0);
    expect(t.input.guarding).toBe(false);
    expect(t.sent.slice(-3)).toEqual([
      { type: 'move', x: 0, z: 0, sprint: false },
      { type: 'guard', held: false },
      { type: 'crouch', held: false },
    ]);
    const stoppedAt = t.sent.length;
    t.win.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape', repeat: true }));
    expect(t.sent).toHaveLength(stoppedAt);
    t.time(1000); t.input.keyDown('KeyG', true); t.input.keyDown('KeyW', true); t.input.sampleGuard(true);
    expect(t.input.keys.size).toBe(0);
    expect(t.sent).toHaveLength(stoppedAt);
    t.input.keyDown('KeyG');
    expect(t.guards().at(-1)).toEqual({ type: 'guard', held: true });
  });

  it('releases guard when a modal blocks input and drops the held keys until a fresh press', () => {
    const t = setup();
    t.input.keyDown('KeyG'); t.input.keyDown('KeyW');
    t.time(25); t.input.sampleGuard(false);
    expect(t.input.keys.size).toBe(0);
    expect(t.guards().at(-1)).toEqual({ type: 'guard', held: false });
    const stoppedAt = t.sent.length;
    t.time(500); t.input.sampleGuard(true);
    expect(t.sent).toHaveLength(stoppedAt);
  });

  it('keeps body/controller and duplicate fences for the lower-rate guard stream', () => {
    const q = new CommandQueue('epoch', 'owner', 'body');
    const envelope = { version: 2 as const, type: 'command' as const, epoch: 'epoch', controllerId: 'owner', bodyId: 'body', sequence: 0, commandId: 'guard-0', specRevision: INTERACTION_SPEC.revision, clientTimeMs: 0, command: { type: 'guard' as const, held: true } };
    expect(q.receive({ ...envelope, controllerId: 'other' }, 0, 0).result).toBe('binding_mismatch');
    expect(q.receive({ ...envelope, bodyId: 'other' }, 0, 0).result).toBe('binding_mismatch');
    expect(q.receive(envelope, 0, 0).status).toBe('received');
    expect(q.receive(envelope, 0, 1).status).toBe('received');
    expect(q.size).toBe(1);
    expect(q.receive({ ...envelope, commandId: 'stale-0' }, 0, 2).result).toBe('stale_sequence');
    let applied = 0;
    q.apply(1, 3, () => { applied++; return 'accepted'; });
    expect(applied).toBe(1);
    expect(q.receive(envelope, 1, 4).status).toBe('applied');
    expect(q.size).toBe(0);
  });
});
