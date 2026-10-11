import { describe, expect, it } from 'vitest';
import { sharedActionClip, sharedActionProgress, sharedMotionMode, sharedTravelClip } from '../src/web/actors/sharedMotion';
import { kaykitFallback } from '../src/web/arena/assets';
import { SHARED_MOTION_NAMES } from '../src/web/arena/sharedMotionNames';
import type { ActorState } from '../src/web/actors/actorManager';
import type { CombatContext } from '../src/web/actors/combatPose';

const action: CombatContext = { moveId: 'jab', age: .2, prep: .3, active: .15, recovery: .3, weight: 'light' };
const state = (changes: Partial<ActorState> = {}): ActorState => ({ bodyId: 'b', kind: 'person', own: true, speed: 0,
 velocity: { x: 0, y: 0, z: 0 }, yaw: 0, crouch: 0, age: 0, ...changes });

describe('shared human presentation', () => {
 it('resumes ordinary movement after a retained completed/cancelled combat record', () => {
  for (const phase of ['complete', 'cancelled', 'missed']) {
   const s = state({ speed: 1.5, body: { combatAction: { kind: 'attack', phase } } as never });
   const before = JSON.stringify(s);
   expect(sharedMotionMode(s)).toBe('move'); expect(sharedMotionMode({ ...s, speed: 0 })).toBe('idle');
   expect(JSON.stringify(s)).toBe(before);
  }
 });
 it('prioritizes incapacitation and observed combat without replaying old counters', () => {
  expect(sharedMotionMode(state({ combat: action }))).toBe('action');
  expect(sharedMotionMode(state({ guard: true, speed: 2 }))).toBe('guard');
  expect(sharedMotionMode(state({ combat: action, body: { incapacitated: true } as never }))).toBe('down');
 });
 it('loads every mapped canonical action and keeps working with redistributable fallback motion', () => {
  for (const armed of [true, false]) for (const moveId of ['jab', 'cross', 'front_kick', 'round_kick', 'duck', 'sidestep', 'backstep']) {
   const name = sharedActionClip({ ...action, moveId }, armed);
   expect(SHARED_MOTION_NAMES.has(name)).toBe(true);
   expect(kaykitFallback(name)).not.toBe('Idle_Combat');
  }
  expect(kaykitFallback('unarmed/walk_backward')).toBe('Walking_Backwards');
  expect(kaykitFallback('unarmed/walk_strafe_left')).toBe('Running_Strafe_Left');
 });
 it('uses the canonical phase clock across startup, contact, recovery and late arrival', () => {
  expect(sharedActionProgress({ ...action, age: 0 })).toBe(0);
  expect(sharedActionProgress({ ...action, age: action.prep })).toBeCloseTo(.4);
  expect(sharedActionProgress({ ...action, age: action.prep + action.active })).toBeCloseTo(.68);
  expect(sharedActionProgress({ ...action, age: 5 })).toBe(1);
  let previous = 0;
  for (let age = 0; age < 1; age += .01) { const progress = sharedActionProgress({ ...action, age }); expect(progress).toBeGreaterThanOrEqual(previous); previous = progress; }
 });
 it('selects backward and lateral travel without turning the canonical body', () => {
  expect(sharedTravelClip(state({ velocity: { x: 0, y: 0, z: 1 } }))).toContain('backward');
  expect(sharedTravelClip(state({ velocity: { x: 1, y: 0, z: 0 } }))).toContain('right');
  expect(sharedTravelClip(state({ velocity: { x: -1, y: 0, z: 0 }, yaw: Math.PI / 2 }))).toContain('forward');
 });
});
