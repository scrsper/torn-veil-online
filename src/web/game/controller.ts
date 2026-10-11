import { INTERACTION_SPEC } from '../../sim/physical/prediction';
import type { GameLink } from '../net/connection';
import type { BodyState, InteractionCommand, Vec3 } from '../net/messages';
import type { CameraRig } from './cameraRig';
import type { InputManager } from './input';
import type { LocalPredictor, StepInput } from './predictor';
import type { Settings } from './bindings';

/**
 * Turns player input into intentions and nothing else.
 *
 * Each rendered frame it (1) hands the predictor a function that yields the current movement input
 * for every fixed 1/60 s step (predictor sends one epoch-bound `move` command per step and applies it
 * locally on the shared movement kernel), and (2) turns press/release edges into combat, posture and
 * target intentions. It never touches the World: the server owns contact, damage, cost and
 * outcome; what happens on screen while a command is in flight is disposable presentation.
 */
export interface CombatIntent {
  commandId: string; sequence: number; kind: 'attack' | 'defend'; weight?: 'light' | 'heavy'; defend?: 'sidestep' | 'backstep' | 'duck'; side?: number;
  direction?: { x: number; z: number }; at: number; targetBodyId?: string;
}
export interface ControllerHooks {
  /** A combat command was accepted onto the wire; presentation may start its anticipation pose. */
  onCombatCommand?(c: CombatIntent): void;
  onLockChange?(bodyId: string | null): void;
  /** `false` while movement is not accepted (menu, dialogue, dead): input is neutral and commands stop. */
  canAct(): boolean;
  /** Body the player is facing for conversation, or null. */
  conversationPartner(): Vec3 | null;
}
export interface Candidate { bodyId: string; pos: Vec3; kind: 'person' | 'wildlife'; hostile: boolean; name: string; dead: boolean }

const STEP = INTERACTION_SPEC.stepSeconds;

export class PlayerController {
  lockedBodyId: string | null = null;
  guardHeld = false;
  focusHeld = false;
  sprintHeld = false;
  crouchHeld = false;
  /** Crouch latched from the Abilities menu (gamepad players); pressing the crouch control releases it. */
  crouchToggled = false;
  moving = false;
  private idleSteps = 0;
  private guardSentAt = 0;
  private guardWanted = false;
  private lastDodgeAt = -9;
  private inputReleaseSerial = 0;
  lastCombat: CombatIntent | null = null;
  lastMoveWorld = { x: 0, z: 0 };
  constructor(
    private readonly link: GameLink, private readonly predictor: LocalPredictor, private readonly input: InputManager, private readonly cam: CameraRig,
    private readonly settings: () => Settings, private readonly hooks: ControllerHooks, private readonly candidates: () => Candidate[], private readonly ownPos: () => Vec3 | null,
  ) {}

  release(): void {
    this.input.releaseAll();
    this.sendGuard(false); this.guardHeld = this.focusHeld = this.sprintHeld = this.crouchHeld = false; this.moving = false;
  }

  private sendGuard(held: boolean): void {
    if (this.guardWanted === held && held === false) return;
    this.guardWanted = held; this.guardSentAt = performance.now();
    this.link.sendCommand({ type: 'guard', held } as InteractionCommand);
  }

  /** Called once per rendered frame after `input.beginFrame`. */
  update(dt: number): void {
    const s = this.settings();
    if (this.input.releaseSerial !== this.inputReleaseSerial) {
      this.inputReleaseSerial = this.input.releaseSerial;
      this.sendGuard(false);
      this.guardHeld = this.focusHeld = this.sprintHeld = this.crouchHeld = this.crouchToggled = false;
    }
    const acting = this.hooks.canAct();
    // Projected target loss must release the camera even while a menu blocks actions.
    if (this.lockedBodyId) {
      const c = this.target(), p = this.ownPos();
      if (!c || c.dead || !p || Math.hypot(c.pos.x - p.x, c.pos.z - p.z) > 26) this.setLock(null);
    }
    if (!acting) { this.input.stopAutoWalk(); if (this.guardHeld || this.guardWanted) this.release(); this.stepMovement(dt, false); return; }

    // Held-state toggles.
    const sprintNow = s.sprintToggle ? (this.input.pressed('sprint') ? !this.sprintHeld : this.sprintHeld) : this.input.isDown('sprint');
    this.sprintHeld = sprintNow;
    this.focusHeld = s.focusToggle ? (this.input.pressed('focus') ? !this.focusHeld : this.focusHeld) : this.input.isDown('focus');
    const guardNow = s.guardToggle ? (this.input.pressed('guard') ? !this.guardHeld : this.guardHeld) : this.input.isDown('guard');
    if (guardNow !== this.guardHeld) { this.guardHeld = guardNow; this.sendGuard(guardNow); }
    else if (this.guardHeld && performance.now() - this.guardSentAt >= INTERACTION_SPEC.guardRefreshSeconds * 1000) this.sendGuard(true);
    if (this.input.pressed('crouch')) this.crouchToggled = false;
    this.crouchHeld = this.input.isDown('crouch') || this.crouchToggled;

    // Targeting.
    if (this.input.pressed('lockTarget')) this.toggleLock();
    if (this.input.pressed('switchTarget')) this.cycleLock();

    this.stepMovement(dt, true);
    // Combat edges.
    const now = performance.now();
    if (this.input.pressed('lightAttack')) this.attack('light', now);
    if (this.input.pressed('heavyAttack')) this.attack('heavy', now);
    if (this.input.pressed('dodge')) this.dodge(now);
  }

  private target(): Candidate | undefined { return this.lockedBodyId ? this.candidates().find(c => c.bodyId === this.lockedBodyId) : undefined; }

  private stepMovement(dt: number, acting: boolean): void {
    const mv = acting ? this.input.move : { x: 0, y: 0 };
    const yaw = this.cam.moveYaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
    // Camera-relative: forward = (-sin, -cos), right = (cos, -sin).
    const wx = -sy * mv.y + cy * mv.x, wz = -cy * mv.y - sy * mv.x;
    const mag = Math.hypot(wx, wz);
    this.moving = mag > 0.02; this.lastMoveWorld.x = wx; this.lastMoveWorld.z = wz;
    const combatPosture = this.guardHeld || this.focusHeld;
    this.predictor.advanceBy(dt, () => {
      const p = this.predictor.predicted; if (!p) return null;
      const settled = (p.crouch ?? 0) === (this.crouchHeld ? 1 : 0) || (!this.crouchHeld && (p.crouch ?? 0) <= 0);
      if (!this.moving && settled && !combatPosture && !this.lockedBodyId && !this.hooks.conversationPartner() && !(this.cam.isometric && this.cam.aimYaw !== null)) { this.idleSteps++; if (this.idleSteps > 24 && !this.guardHeld) return null; } else this.idleSteps = 0;
      let facing: number | undefined;
      const partner = this.hooks.conversationPartner(), lock = this.target();
      if (lock) facing = Math.atan2(-(lock.pos.x - p.pos.x), -(lock.pos.z - p.pos.z));
      else if (partner && !this.moving) facing = Math.atan2(-(partner.x - p.pos.x), -(partner.z - p.pos.z));
      else if (this.moving && !combatPosture) facing = Math.atan2(-wx, -wz);
      else if (this.cam.isometric && this.cam.aimYaw !== null && !this.moving) facing = this.cam.aimYaw;
      else if (combatPosture) facing = this.cam.aimYaw ?? yaw;   // guard or focus: face where the camera looks
      const sprint = this.sprintHeld && this.moving && !combatPosture && !this.crouchHeld;
      const input: StepInput = { x: this.moving ? Math.max(-1, Math.min(1, wx)) : 0, z: this.moving ? Math.max(-1, Math.min(1, wz)) : 0, sprint, ...(facing !== undefined ? { facing } : {}), crouch: this.crouchHeld };
      return input;
    }, input => {
      const cmd: InteractionCommand = { type: 'move', x: input.x, z: input.z, sprint: input.sprint, crouch: input.crouch, ...(input.facing !== undefined ? { facing: input.facing } : {}) };
      const sent = this.link.sendCommand(cmd);
      return sent ? sent.sequence : null;
    });
    void STEP;
  }

  // ── combat ───────────────────────────────────────────────────────────────────────────────────
  private attack(weight: 'light' | 'heavy', at: number): void {
    const t = this.target();
    const cmd: InteractionCommand = { type: 'attack', weight, trajectory: 'high', ...(t ? { targetBodyId: t.bodyId } : {}) };
    const sent = this.link.sendCommand(cmd); if (!sent) return;
    const intent: CombatIntent = { commandId: sent.commandId, sequence: sent.sequence, kind: 'attack', weight, at, ...(t ? { targetBodyId: t.bodyId } : {}) };
    this.lastCombat = intent; this.hooks.onCombatCommand?.(intent);
  }
  private dodge(at: number): void {
    if (at - this.lastDodgeAt < 120) return;
    const wx = this.lastMoveWorld.x, wz = this.lastMoveWorld.z, mag = Math.hypot(wx, wz);
    let cmd: InteractionCommand, intent: Omit<CombatIntent, 'commandId' | 'sequence'>;
    if (mag < INTERACTION_SPEC.dodgeDeadZone) { cmd = { type: 'defend', kind: 'backstep', side: 1 }; intent = { kind: 'defend', defend: 'backstep', side: 1, at }; }
    else { const d = { x: wx / mag, z: wz / mag }; cmd = { type: 'defend', kind: 'sidestep', side: 1, direction: d }; intent = { kind: 'defend', defend: 'sidestep', side: 1, direction: d, at }; }
    const sent = this.link.sendCommand(cmd); if (!sent) return;
    this.lastDodgeAt = at;
    const full: CombatIntent = { ...intent, commandId: sent.commandId, sequence: sent.sequence }; this.lastCombat = full; this.hooks.onCombatCommand?.(full);
  }
  cancelAction(): void { this.link.sendCommand({ type: 'cancel' }); }

  // ── targeting ────────────────────────────────────────────────────────────────────────────────
  setLock(id: string | null): void { if (this.lockedBodyId !== id) { this.lockedBodyId = id; this.hooks.onLockChange?.(id); } }
  private scoreTargets(): { c: Candidate; score: number }[] {
    const p = this.ownPos(); if (!p) return [];
    const fx = -Math.sin(this.cam.moveYaw), fz = -Math.cos(this.cam.moveYaw);
    return this.candidates().filter(c => !c.dead).map(c => {
      const dx = c.pos.x - p.x, dz = c.pos.z - p.z, d = Math.hypot(dx, dz) || 0.001, cosA = (dx * fx + dz * fz) / d;
      return { c, score: d <= 22 && (this.cam.cutaway || cosA > 0.25) ? d * (this.cam.cutaway ? 1 : 1.6 - cosA) - (c.hostile ? 2 : 0) : Infinity };
    }).filter(x => Number.isFinite(x.score)).sort((a, b) => a.score - b.score);
  }
  toggleLock(): void {
    if (this.lockedBodyId) { this.setLock(null); return; }
    const best = this.scoreTargets()[0]; if (best) this.setLock(best.c.bodyId);
  }
  cycleLock(): void {
    const list = this.scoreTargets(); if (!list.length) { this.setLock(null); return; }
    const i = list.findIndex(x => x.c.bodyId === this.lockedBodyId);
    this.setLock(list[(i + 1) % list.length].c.bodyId);
  }
  /** Best available hush/aim target: the lock, else the best forward candidate. */
  aimTarget(): Candidate | undefined { return this.target() ?? this.scoreTargets()[0]?.c; }
}

export function candidatesFrom(bodies: BodyState[], wildlife: { bodyId: string; pos: Vec3; speciesId: string; dead: boolean; present: boolean; alive: boolean; defense: string | null }[], ownBodyId: string): Candidate[] {
  const out: Candidate[] = [];
  for (const b of bodies) if (b.bodyId !== ownBodyId) out.push({ bodyId: b.bodyId, pos: b.pos, kind: 'person', hostile: false, name: b.name, dead: b.dead });
  for (const w of wildlife) if (w.present) out.push({ bodyId: w.bodyId, pos: w.pos, kind: 'wildlife', hostile: w.defense !== null, name: w.speciesId, dead: w.dead || !w.alive });
  return out;
}
