import { INTERACTION_SPEC } from '../../sim/physical/prediction';

/**
 * Client side of the dodge roll: when a press may become a `defend` command, and what the
 * presentation should show while one is in flight. The server alone decides whether the
 * evasion worked (it moves the body and times the evade window); this machine only stops
 * a held or mashed key from flooding commands, buffers a press made during recovery so it
 * fires the moment the roll can chain, and reports the phase for animation and UI.
 *
 *   ready ──press──▶ rolling ──defenseSeconds──▶ recovery ──defenseRecoverySeconds──▶ ready
 *                       ▲                            │ press (buffered ≤ combatBufferSeconds)
 *                       └────────────────────────────┘
 */
export type DodgePhase = 'ready' | 'rolling' | 'recovery';
export interface DodgeDirection { x: number; z: number }
export interface DodgeCommand { type: 'defend'; kind: 'sidestep' | 'backstep'; side: 1; direction?: DodgeDirection }
export const DODGE = Object.freeze({
  rollSeconds: INTERACTION_SPEC.defenseSeconds,
  recoverySeconds: INTERACTION_SPEC.defenseRecoverySeconds,
  bufferSeconds: INTERACTION_SPEC.combatBufferSeconds,
  /** The part of the roll the server treats as evasive; drawn as the i-frame flash. */
  evadeSeconds: INTERACTION_SPEC.defenseSeconds * .75,
  deadZone: INTERACTION_SPEC.dodgeDeadZone,
});

export class DodgeMachine {
  phase: DodgePhase = 'ready';
  private startedAt = -Infinity;
  private buffered: { at: number; direction: DodgeDirection } | null = null;
  /** Rolls actually started, for diagnostics and tests. */
  count = 0;

  /** A press at `now` (seconds) with a camera-relative world direction (zero = backstep). */
  press(now: number, direction: DodgeDirection): DodgeCommand | null {
    this.update(now);
    if (this.phase === 'ready') return this.start(now, direction);
    if (this.phase === 'recovery' || now - this.startedAt >= DODGE.rollSeconds - DODGE.bufferSeconds) this.buffered = { at: now, direction: { ...direction } };
    return null;
  }
  /** Advance the phase; returns a buffered command that became ready to send. */
  update(now: number): DodgeCommand | null {
    const t = now - this.startedAt;
    this.phase = t < DODGE.rollSeconds ? 'rolling' : t < DODGE.rollSeconds + DODGE.recoverySeconds ? 'recovery' : 'ready';
    if (this.buffered && now - this.buffered.at > DODGE.bufferSeconds) this.buffered = null;
    if (this.phase === 'ready' && this.buffered) { const b = this.buffered; this.buffered = null; return this.start(now, b.direction); }
    return null;
  }
  /** True during the evasive part of the roll (presentation of invulnerability, not a rule). */
  evading(now: number): boolean { return now - this.startedAt >= 0 && now - this.startedAt < DODGE.evadeSeconds; }
  /** 0..1 through the roll, for the animation driver; 1 once recovered. */
  progress(now: number): number { return Math.max(0, Math.min(1, (now - this.startedAt) / (DODGE.rollSeconds + DODGE.recoverySeconds))); }
  /** A rejected command never rolled: return to ready so the next press is not swallowed. */
  rejected(): void { this.startedAt = -Infinity; this.phase = 'ready'; this.count = Math.max(0, this.count - 1); }
  private start(now: number, direction: DodgeDirection): DodgeCommand {
    this.startedAt = now; this.phase = 'rolling'; this.count++;
    const mag = Math.hypot(direction.x, direction.z);
    return mag < DODGE.deadZone ? { type: 'defend', kind: 'backstep', side: 1 }
      : { type: 'defend', kind: 'sidestep', side: 1, direction: { x: direction.x / mag, z: direction.z / mag } };
  }
}

/** Space is shared: it rolls when the player is fighting (locked, guarding or under a telegraphed
 * attack) and otherwise jumps or vaults. Alt always rolls. */
export function spaceIntent(context: { locked: boolean; guarding: boolean; threatened: boolean }): 'dodge' | 'traverse' {
  return context.locked || context.guarding || context.threatened ? 'dodge' : 'traverse';
}
