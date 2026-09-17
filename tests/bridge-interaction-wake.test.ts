import { describe, expect, it } from 'vitest';
import { CoalescedInteractionWake, type ImmediateHandle } from '../src/bridge/interactionWake';

describe('bridge interaction wake', () => {
  it('does not step inline and coalesces a burst into one scheduled wake', () => {
    let due = true;
    const queued: Array<() => void> = [];
    let steps = 0;
    const wake = new CoalescedInteractionWake(
      () => due,
      () => { steps++; due = false; },
      callback => { queued.push(callback); return queued.length as unknown as ImmediateHandle; },
      () => undefined,
    );

    expect(wake.request()).toBe(true);
    expect(wake.request()).toBe(false);
    expect(wake.request()).toBe(false);
    expect(steps).toBe(0);
    expect(queued).toHaveLength(1);
    queued.shift()!();
    expect(steps).toBe(1);
    expect(wake.isPending).toBe(false);
  });

  it('does not schedule a second dispatch after the normal pump has cleared debt', () => {
    let due = true;
    let scheduled = 0;
    let steps = 0;
    let queued: (() => void) | undefined;
    const wake = new CoalescedInteractionWake(
      () => due,
      () => { steps++; due = false; },
      callback => { scheduled++; queued = callback; return scheduled as unknown as ImmediateHandle; },
      () => { queued = undefined; },
    );

    expect(wake.request()).toBe(true);
    due = false;
    expect(wake.request()).toBe(false);
    queued!();
    expect(scheduled).toBe(1);
    expect(steps).toBe(0);
  });
});
