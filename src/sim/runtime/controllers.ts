import type { Person } from '../core/types';

/** Scheduler/connection metadata. Never stored on a Person, copied into knowledge, or used
 * by social/physical adjudication. Multiple connections may control different people. */
const external = new WeakSet<Person>();
const acting = new WeakSet<Person>();
export function isExternallyControlled(person: Person | undefined): boolean { return !!person && external.has(person); }
export function hasExternalIntention(person: Person): boolean { return acting.has(person); }
export function authorizeExternalIntention(person: Person): void { acting.add(person); }
export function setExternalControl(person: Person, enabled: boolean): void {
  if (enabled && external.has(person)) return;
  if (enabled) external.add(person); else external.delete(person);
  acting.delete(person);
}
