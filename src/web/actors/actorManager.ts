import { Color3, MeshBuilder, PBRMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { INTERACTION_SPEC } from '../../sim/physical/prediction';
import repertoire from '../../sim/physical/combatRepertoire.json';
import type { Atmosphere } from '../world/atmosphere';
import type { RegionManager } from '../world/regionManager';
import type { RenderContext } from '../render/engine';
import type { BodyState, CombatActionState, SnapshotMessage, Vec3, WildlifeBody } from '../net/messages';
import type { CombatContext } from './combatPose';
import { facingBody } from './projectedAttention';

/**
 * Every visible body (people, wildlife) as a scene actor. This layer owns motion smoothing,
 * lifetime, and turning server state into the small set of facts a visual needs (speaking, looking
 * at, combat phase, hit); what an actor looks like is delegated to a `BodyVisual` made by the
 * visual factory. Server state arrives a few times per second, so remote bodies are drawn slightly
 * extrapolated along their reported velocity and eased toward each new sample; the player's own body
 * is drawn from the predictor, never from the server sample.
 */
export interface BodyVisual {
  root: TransformNode;
  /** Imported animation support phases provide footfall events. */
  readonly contactFootfalls?: boolean;
  update(dt: number, state: ActorState): void;
  headHeight: number;
  /** Measured standing metre reference; optional for other creature renderers. */
  readonly bodyHeight?:number;
  dispose(): void;
}
export interface ActorState {
  bodyId: string; own: boolean; kind: 'person' | 'wildlife';
  body?: BodyState; wildlife?: WildlifeBody;
  speed: number; velocity: Vec3; yaw: number; crouch: number; age: number;
  /** Render-space point the body should look at (a conversation partner, a locked target), or null. */
  lookAt?: Vector3 | null;
  speaking?: boolean; gesture?: number;
  combat?: CombatContext | null; hit?: number; guard?: boolean;
  /** Client-only pose input in the actor's upright local frame; no simulation authority. */
  flightPresentation?: import('./flightPose').FlightPresentationInput;
}
export type VisualFactory = (ctx: RenderContext, atmosphere: Atmosphere, actor: { kind: 'person' | 'wildlife'; body?: BodyState; wildlife?: WildlifeBody }) => BodyVisual;

export interface ActorEnvironment {
  /** Estimated simulation physical time (seconds), advanced between snapshots. */
  physicalNow(): number;
  /** Body id currently in conversation with the player, or null. */
  speakerBodyId(): string | null;
  playerBodyId(): string;
  /** Render-space focus for the player's own body (camera target / lock), or null. */
  playerLook(): Vector3 | null;
  /** Called when a body's hit counter advances. */
  onHit?(bodyId: string, own: boolean): void;
  /** Called once per confirmed contact, with the simulation-space contact point. */
  onContact?(pos: Vec3, onPlayer: boolean): void;
}

interface Actor {
  id: string; kind: 'person' | 'wildlife'; visual: BodyVisual; pos: Vector3; targetPos: Vector3; yaw: number; targetYaw: number; vel: Vec3; lastSeen: number; body?: BodyState; wildlife?: WildlifeBody; own: boolean; crouch: number; stampMs: number;
  hitSeq: number; hitK: number; speechAt: number; guardSince: number; lastGuarding: boolean; predicted: PredictedCombat | null; ownSpeed: number; lastPos: Vector3; lastMoveMs: number;
}
export interface PredictedCombat { commandId: string; moveId: string; weight: 'light' | 'heavy'; startedAtMs: number; prep: number; active: number; recovery: number; dirLocal?: { x: number; z: number }; side?: number; kind: 'attack' | 'defend' }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
type Move = { preparation: number; active: number; recovery: number };
const MOVES = repertoire.moves as unknown as Record<string, Move>;
const S = INTERACTION_SPEC as unknown as Record<string, number>;

/** Timing of a strike as the server will decide it, for the instant local anticipation. */
export function predictedTiming(moveId: string, heavy: boolean): { prep: number; active: number; recovery: number } {
  const m = MOVES[moveId]; const base = m ? { prep: m.preparation, active: m.active, recovery: m.recovery } : { prep: S.preparationSeconds, active: S.activeSeconds, recovery: S.recoverySeconds };
  return heavy ? { prep: base.prep * S.heavyPreparationMultiplier, active: base.active, recovery: base.recovery * S.heavyRecoveryMultiplier } : base;
}
const moveOfAction = (a: CombatActionState): string => {
  if (a.kind !== 'attack') return a.kind;
  if (a.moveId) return a.moveId;
  return a.variant === 'kick' ? 'front_kick' : a.variant === 'round' ? 'round_kick' : a.variant === 'hook' ? 'cross' : 'jab';
};

export function placeholderVisual(ctx: RenderContext, atmosphere: Atmosphere, a: { kind: 'person' | 'wildlife'; body?: BodyState; wildlife?: WildlifeBody }): BodyVisual {
  const root = new TransformNode('actor', ctx.scene);
  const mat = new PBRMaterial('actor-mat', ctx.scene), c = a.body?.appearance;
  const col = (n: number | undefined, d: number) => { const v = n ?? d; return new Color3(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); };
  mat.albedoColor = a.kind === 'person' ? col(c?.shirt, 0x808080) : new Color3(0.4, 0.3, 0.2); mat.roughness = 0.8; mat.metallic = 0;
  const height = a.kind === 'person' ? 1.7 * (c?.height ?? 1) : (a.wildlife?.bodyPlan.heightM ?? 1);
  const body = MeshBuilder.CreateCapsule('actor-body', { height, radius: a.kind === 'person' ? 0.28 : (a.wildlife?.bodyPlan.radiusM ?? 0.4) }, ctx.scene);
  body.material = mat; body.parent = root; body.position.y = height / 2; atmosphere.addCaster(body);
  return { root, headHeight: height + 0.15, update() { /* static placeholder */ }, dispose() { body.dispose(); mat.dispose(); root.dispose(); } };
}

export class ActorManager {
  private readonly actors = new Map<string, Actor>();
  factory: VisualFactory = placeholderVisual;
  env: ActorEnvironment | null = null;
  constructor(private readonly ctx: RenderContext, private readonly atmosphere: Atmosphere, private readonly regions: RegionManager) {}

  private readonly seenContacts = new Set<string>();
  get count(): number { return this.actors.size; }
  get(id: string): Actor | undefined { return this.actors.get(id); }
  all(): IterableIterator<Actor> { return this.actors.values(); }

  /** Apply a snapshot. `ownBodyId` is drawn from the predictor, not from this sample. */
  sync(s: SnapshotMessage, ownBodyId: string, nowMs: number): void {
    const seen = new Set<string>();
    for (const b of s.bodies) {
      seen.add(b.bodyId);
      let a = this.actors.get(b.bodyId);
      if (!a) a = this.create(b.bodyId, 'person', b, undefined, b.bodyId === ownBodyId, b.pos, b.yaw);
      if (b.hitSeq > a.hitSeq && a.hitSeq >= 0) { a.hitK = 1; this.env?.onHit?.(b.bodyId, b.bodyId === ownBodyId); }
      a.hitSeq = b.hitSeq;
      if (b.speech && b.speech !== a.body?.speech) a.speechAt = nowMs; else if (!b.speech) a.speechAt = 0;
      if (b.guarding && !a.lastGuarding) a.guardSince = nowMs; a.lastGuarding = !!b.guarding;
      const contact = b.combatAction?.contact;
      if (contact?.eventId && b.combatAction!.outcome === 'hit' && !this.seenContacts.has(contact.eventId)) {
        this.seenContacts.add(contact.eventId); if (this.seenContacts.size > 256) this.seenContacts.delete(this.seenContacts.values().next().value!);
        // Only a fresh contact draws feedback; a snapshot taken after a reconnect may carry an old one.
        if (Math.abs((this.env?.physicalNow() ?? 0) - contact.at) < 1.2) this.env?.onContact?.(contact.position, contact.bodyId === ownBodyId);
      }
      this.syncLantern(b.bodyId, a, b.embodiment?.activity.carried);
      a.body = b; a.own = b.bodyId === ownBodyId; a.vel = b.velocity; a.stampMs = nowMs; a.lastSeen = nowMs;
      a.targetPos.set(b.pos.x, b.pos.y, b.pos.z); a.targetYaw = b.yaw;
      // The authoritative action for the controlled body supersedes local anticipation once it exists.
      if (a.predicted && b.combatAction && b.combatAction.commandId === a.predicted.commandId) a.predicted = null;
    }
    for (const w of s.wildlife.bodies) {
      if (!w.present) continue;
      seen.add(w.bodyId);
      let a = this.actors.get(w.bodyId);
      if (!a) a = this.create(w.bodyId, 'wildlife', undefined, w, false, w.pos, w.yaw);
      a.wildlife = w; a.vel = w.vel; a.stampMs = nowMs; a.lastSeen = nowMs; a.targetPos.set(w.pos.x, w.pos.y, w.pos.z); a.targetYaw = w.yaw;
    }
    for (const [id, a] of this.actors) if (!seen.has(id)) this.remove(id, a);
  }
  private create(id: string, kind: 'person' | 'wildlife', body: BodyState | undefined, wildlife: WildlifeBody | undefined, own: boolean, pos: Vec3, yaw: number): Actor {
    const visual = this.factory(this.ctx, this.atmosphere, { kind, body, wildlife });
    const a: Actor = {
      id, kind, visual, pos: new Vector3(pos.x, pos.y, pos.z), targetPos: new Vector3(pos.x, pos.y, pos.z), yaw, targetYaw: yaw, vel: { x: 0, y: 0, z: 0 }, lastSeen: 0, body, wildlife, own, crouch: 0, stampMs: 0,
      hitSeq: body?.hitSeq ?? -1, hitK: 0, speechAt: 0, guardSince: 0, lastGuarding: false, predicted: null, ownSpeed: 0, lastPos: new Vector3(pos.x, pos.y, pos.z), lastMoveMs: 0,
    };
    this.actors.set(id, a); return a;
  }
  private remove(id: string, a: Actor): void { this.regions.lights.remove(`lantern:${id}`); this.lanterns.delete(id); a.visual.dispose(); this.actors.delete(id); }
  /** A body that carries a lantern lights the ground around it (the simulation's lantern is a real light source); pooled like every other light. */
  private readonly lanterns = new Set<string>();
  private syncLantern(id: string, a: Actor, carried: unknown): void {
    const has = carried === 'lantern';
    if (has && !this.lanterns.has(id)) { this.lanterns.add(id); this.regions.lights.add({ id: `lantern:${id}`, root: a.visual.root, x: 0.3, y: 0.95, z: 0.1, color: [1, 0.72, 0.42], intensity: 1.3, range: 9, flicker: 1, enabled: true }); }
    else if (!has && this.lanterns.has(id)) { this.lanterns.delete(id); this.regions.lights.remove(`lantern:${id}`); }
  }
  clear(): void { for (const [id, a] of this.actors) this.remove(id, a); }

  /** Start local anticipation for the controlled body the instant a combat command is sent. */
  predict(bodyId: string, p: PredictedCombat): void { const a = this.actors.get(bodyId); if (a) a.predicted = p; }
  /** Use high-rate canonical feedback so queued input cannot replace a live strike pose. */
  applyLocalCombat(bodyId: string, action: CombatActionState | null, bufferedCommandId: string | null): void {
    const a = this.actors.get(bodyId); if (!a) return;
    if (a.body) a.body.combatAction = action;
    if (a.predicted && (a.predicted.commandId === action?.commandId || a.predicted.commandId === bufferedCommandId)) a.predicted = null;
  }
  cancelPredicted(bodyId: string, commandId: string): void { const a = this.actors.get(bodyId); if (a?.predicted?.commandId === commandId) a.predicted = null; }

  private combatFor(a: Actor, nowMs: number, physNow: number): CombatContext | null {
    const act = a.body?.combatAction;
    if (a.predicted && !(act && act.commandId !== a.predicted.commandId && !['complete', 'cancelled', 'interrupted'].includes(act.phase) && physNow < act.completeAt)) {
      const p = a.predicted, age = (nowMs - p.startedAtMs) / 1000, total = p.prep + p.active + p.recovery;
      if (age > total + 0.05) { a.predicted = null; } else return { moveId: p.moveId, weight: p.weight, age, prep: p.prep, active: p.active, recovery: p.recovery, dirLocal: p.dirLocal, side: p.side, predicted: true };
    }
    if (act && !['complete', 'cancelled', 'missed', 'interrupted'].includes(act.phase)) {
      const age = physNow - act.startedAt, total = act.completeAt - act.startedAt;
      if (age >= -0.05 && age <= total + 0.1) {
        const yaw = act.yaw ?? a.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), lx = -Math.cos(yaw), lz = Math.sin(yaw);
        const d = act.direction, dirLocal = d && (d.x || d.z) ? { x: d.x * lx + d.z * lz, z: d.x * fx + d.z * fz } : undefined;
        return { moveId: moveOfAction(act), weight: act.definition?.includes('heavy') ? 'heavy' : 'light', age: Math.max(0, age), prep: act.activeAt - act.startedAt, active: act.recoveryAt - act.activeAt, recovery: act.completeAt - act.recoveryAt, dirLocal, side: undefined };
      }
    }
    if (a.body?.guarding) return { moveId: 'guard', weight: 'light', age: (nowMs - a.guardSince) / 1000, prep: 0, active: 1, recovery: 0 };
    return null;
  }

  /** `own` supplies the predicted state for the controlled body. */
  update(dt: number, nowMs: number, own: { bodyId: string; pos: Vec3; yaw: number; crouch: number } | null): void {
    const k = 1 - Math.exp(-14 * dt), env = this.env, phys = env?.physicalNow() ?? 0, speaker = env?.speakerBodyId() ?? null, player = env?.playerBodyId() ?? '';
    const playerHead = this.actors.get(player) ? this.headPoint(player, new Vector3()) : null;
    for (const a of this.actors.values()) {
      const age = Math.max(0, Math.min(0.18, (nowMs - a.stampMs) / 1000));
      const isOwn = !!own && a.id === own.bodyId;
      let speed = Math.hypot(a.vel.x, a.vel.z), vel = a.vel;
      if (isOwn) {
        const prev = a.pos.clone();
        a.pos.set(own!.pos.x, own!.pos.y, own!.pos.z); a.yaw = own!.yaw; a.crouch = own!.crouch;
        if (dt > 0) { const vx = (a.pos.x - prev.x) / dt, vz = (a.pos.z - prev.z) / dt, sp = Math.hypot(vx, vz); a.ownSpeed += (sp - a.ownSpeed) * (1 - Math.exp(-10 * dt)); if (sp > 0.05) vel = { x: vx, y: 0, z: vz }; }
        speed = a.ownSpeed < 0.08 ? 0 : a.ownSpeed;
      } else {
        const tx = a.targetPos.x + a.vel.x * age, ty = a.targetPos.y, tz = a.targetPos.z + a.vel.z * age;
        if (Math.hypot(tx - a.pos.x, tz - a.pos.z) > 8) a.pos.set(tx, ty, tz); else { a.pos.x += (tx - a.pos.x) * k; a.pos.y += (ty - a.pos.y) * k; a.pos.z += (tz - a.pos.z) * k; }
        a.yaw = a.yaw + wrap(a.targetYaw - a.yaw) * (1 - Math.exp(-10 * dt));
        a.crouch = a.body?.crouch ?? 0;
      }
      const r = a.visual.root; this.regions.toRender(a.pos as unknown as Vec3, r.position); r.rotation.y = a.yaw;
      let lookAt: Vector3 | null = null, speaking = false;
      if (a.kind === 'person') {
        speaking = (!!a.body?.speech && nowMs - a.speechAt < 6000) || (speaker !== null && a.id === speaker);
        if (isOwn) lookAt = env?.playerLook() ?? (speaker ? this.headPoint(speaker, new Vector3()) : null);
        else if (speaker && a.id === speaker) lookAt = playerHead;
        else {
          const formation = a.body?.embodiment?.conversation;
          const target = facingBody(a, a.body?.embodiment?.activity.facingEntityId, this.actors.values());
          if (target) lookAt = this.headPoint(target, new Vector3());
          else if (formation && Number.isFinite(formation.yaw)) {
            // A projected conversation ring supplies an inward heading, not a
            // partner identity. Preserve that direction instead of staring at the player.
            lookAt = new Vector3(r.position.x - Math.sin(formation.yaw) * 2, r.position.y + a.visual.headHeight * .85, r.position.z - Math.cos(formation.yaw) * 2);
          }
        }
      }
      a.hitK *= Math.exp(-5 * dt);
      const state: ActorState = {
        bodyId: a.id, own: isOwn, kind: a.kind, body: a.body, wildlife: a.wildlife, speed, velocity: vel, yaw: a.yaw, crouch: a.crouch, age,
        lookAt, speaking, gesture: speaking ? 0.85 : 0.4, hit: a.hitK > 0.02 ? a.hitK : 0, guard: !!a.body?.guarding,
        combat: a.kind === 'person' ? this.combatFor(a, nowMs, phys) : null,
      };
      a.visual.update(dt, state);
    }
  }
  /** Render-space head position, for plates and bubbles. */
  headPoint(id: string, out = new Vector3()): Vector3 | null {
    const a = this.actors.get(id); if (!a) return null;
    return out.set(a.visual.root.position.x, a.visual.root.position.y + a.visual.headHeight, a.visual.root.position.z);
  }
  dispose(): void { this.clear(); }
}
export type { Actor };
