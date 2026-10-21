import { afterEach, describe, expect, it, vi } from 'vitest';
import { UniverseCommandQueue, UniverseHeldInput } from '../../src/web/universe/input';
import { applyTravelCommand, createTravelState, neutralInput, stepTravel, type TravelInput, type UniverseCommand } from '../../src/sim/world/universe/travel';
import { generateSystem, universeSpec } from '../../src/sim/world/universe/generation';
import { length, sub } from '../../src/sim/world/planet/planet';

afterEach(() => vi.useRealTimers());
const input = (throttle: number): UniverseCommand => ({ type: 'input', input: { ...neutralInput(), throttle } });
function deferred() {
  let resolve!: (value: boolean) => void, reject!: (error: Error) => void;
  const promise = new Promise<boolean>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('responsive authoritative universe input', () => {
  it('emits current axes on key edges and keeps held inputs alive without key-repeat bursts', () => {
    const sent: TravelInput[] = [], keys = new UniverseHeldInput(value => sent.push(value));
    keys.press('KeyW', false); expect(sent).toEqual([{ ...neutralInput(), throttle: 1 }]);
    keys.press('KeyW', false); expect(sent).toHaveLength(1);
    keys.press('KeyA', false); expect(sent.at(-1)).toEqual({ ...neutralInput(), throttle: 1, strafe: -1 });
    keys.release('KeyW', false); expect(sent.at(-1)).toEqual({ ...neutralInput(), strafe: -1 });
    keys.heartbeat(false); expect(sent.at(-1)).toEqual({ ...neutralInput(), strafe: -1 }); expect(sent).toHaveLength(4);
    keys.release('KeyA', false); expect(sent.at(-1)).toEqual(neutralInput());
    keys.heartbeat(false); keys.release('KeyA', false); expect(sent).toHaveLength(5);
  });

  it('keeps ground camera tilt local, preserves flight steering and sends braking immediately', () => {
    const sent: TravelInput[] = [], keys = new UniverseHeldInput(value => sent.push(value));
    keys.press('ArrowUp', false); keys.heartbeat(false); keys.release('ArrowUp', false);
    keys.press('KeyR', false); expect(sent).toEqual([]);
    keys.press('ArrowUp', true); expect(sent.at(-1)?.pitch).toBe(1);
    keys.release('ArrowUp', true); expect(sent.at(-1)).toEqual(neutralInput());
    keys.press('KeyW', true); keys.brake();
    expect(sent.at(-1)).toEqual({ ...neutralInput(), brake: true }); expect(keys.keys.size).toBe(0);
    keys.heartbeat(true); expect(sent.at(-1)).toEqual(neutralInput());
  });

  it('drains a queued release at response completion without another 100ms timer', async () => {
    const first = deferred(), sent: UniverseCommand[] = [];
    const queue = new UniverseCommandQueue(() => true, async command => {
      sent.push(command); return sent.length === 1 ? first.promise : true;
    });
    queue.enqueue(input(1)); queue.enqueue(input(0));
    expect(sent).toEqual([input(1)]);
    first.resolve(true); await settle();
    expect(sent).toEqual([input(1), input(0)]); expect(queue.length).toBe(0);
  });

  it('coalesces only unsent input while preserving structural command order and one request in flight', async () => {
    const replies = [deferred(), deferred(), deferred(), deferred()], sent: UniverseCommand[] = [];
    let active = 0, maximum = 0;
    const queue = new UniverseCommandQueue(() => true, async command => {
      active++; maximum = Math.max(maximum, active); sent.push(command);
      try { return await replies[sent.length - 1].promise; } finally { active--; }
    });
    queue.enqueue(input(1)); queue.enqueue(input(-1)); queue.enqueue({ type: 'target', planetId: 'next' }); queue.enqueue(input(0));
    replies[0].resolve(true); await settle(); expect(sent[1]).toEqual(input(-1));
    replies[1].resolve(true); await settle();
    expect(sent[2]).toEqual({ type: 'target', planetId: 'next' });
    replies[2].resolve(true); await settle();
    expect(sent[3]).toEqual(input(0));
    replies[3].resolve(true); await settle();
    expect(sent).toHaveLength(4); expect(maximum).toBe(1); expect(queue.length).toBe(0);
  });

  it.each(['escape', 'held', 'released', 'tap'] as const)('retains cancellation after slow navigation and coalesced input: %s', async intent => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const spec = universeSpec(731), state = createTravelState(spec), sent: UniverseCommand[] = [];
    expect(applyTravelCommand(spec, state, { type: 'launch' }).ok).toBe(true);
    const queue = new UniverseCommandQueue(() => true, async command => {
      sent.push(command); const result = applyTravelCommand(spec, state, command);
      // Host accepted navigation, but the client still has its old cruise=false
      // snapshot until this reply arrives. Escape therefore sends only brake.
      if (command.type === 'navigate') await new Promise(resolve => setTimeout(resolve, 180));
      return result.ok;
    });
    const held = new UniverseHeldInput(value => queue.enqueue({ type: 'input', input: value }));
    queue.enqueue({ type: 'navigate', planetId: generateSystem(spec, 0).planets[1].id });
    expect(state.cruise).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    if (intent !== 'tap') held.brake();
    await vi.advanceTimersByTimeAsync(80); held.heartbeat(true);
    expect(sent).toHaveLength(1);
    if (intent !== 'escape') held.press('KeyW', true);
    if (intent === 'released' || intent === 'tap') { held.release('KeyW', true); held.heartbeat(true); }
    await vi.advanceTimersByTimeAsync(80);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(intent === 'held' ? input(1) : { type: 'input', input: { ...neutralInput(), brake: true } });
    expect(state.cruise).toBe(false); expect(queue.length).toBe(0);
  });

  it.each(['refused', 'interrupted', 'authority-lost'] as const)('stops queued commands after %s', async outcome => {
    const reply = deferred(), sent: UniverseCommand[] = []; let authorized = true;
    const queue = new UniverseCommandQueue(() => authorized, async command => { sent.push(command); return reply.promise; });
    queue.enqueue(input(1)); queue.enqueue({ type: 'launch' }); queue.enqueue(input(0));
    if (outcome === 'interrupted') reply.reject(Error('connection lost'));
    else if (outcome === 'refused') reply.resolve(false);
    else { authorized = false; queue.clear(); reply.resolve(true); }
    await settle(); expect(sent).toEqual([input(1)]); expect(queue.length).toBe(0);
  });

  it('limits a 20ms tap to the host tick actually reached despite a 35ms response, then stays stopped', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const spec = universeSpec(731), state = createTravelState(spec), start = { ...state.position };
    let accepted = neutralInput(), inFlight = 0, maximum = 0;
    const dispatched: { at: number; command: UniverseCommand }[] = [];
    const queue = new UniverseCommandQueue(() => true, async command => {
      maximum = Math.max(maximum, ++inFlight); dispatched.push({ at: Date.now(), command });
      if (command.type === 'input') accepted = command.input;
      await new Promise(resolve => setTimeout(resolve, 35)); inFlight--; return true;
    });
    const held = new UniverseHeldInput(value => queue.enqueue({ type: 'input', input: value }));
    const host = setInterval(() => stepTravel(spec, state, accepted), 50);
    const keepalive = setInterval(() => held.heartbeat(false), 100);
    try {
      await vi.advanceTimersByTimeAsync(49); held.press('KeyW', false);
      await vi.advanceTimersByTimeAsync(20); held.release('KeyW', false);
      await vi.advanceTimersByTimeAsync(16);
      expect(dispatched.map(x => x.at)).toEqual([49, 84]);
      expect(dispatched[1].command).toEqual(input(0));
      expect(length(sub(state.position, start))).toBeCloseTo(.35, 3);
      const stopped = { ...state.position };
      await vi.advanceTimersByTimeAsync(500);
      expect(length(sub(state.position, stopped))).toBeLessThan(1e-8); expect(accepted).toEqual(neutralInput());
      expect(maximum).toBe(1); expect(dispatched).toHaveLength(2);
    } finally { clearInterval(host); clearInterval(keepalive); }
  });
});
