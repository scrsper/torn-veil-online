import type { InteractionCommand } from '../net/messages';
import type { BodyTraversal } from '../../sim/physical/traversal';
import { traversalPoint } from '../../sim/physical/traversal';
import { CombatFeel, type CombatEventView, type Impact } from './combatFeel';
import { DodgeMachine, spaceIntent, type DodgePhase } from './dodge';
import { TargetLock, type LockCandidate, type LockMode } from './targetLock';
import { telegraphs, threatened, type ActionView, type Telegraph, type WildlifeView } from './telegraph';

/**
 * One object a realm or Tower client wires in to get the vertical-slice combat shell: soft and
 * hard lock, a buffered dodge roll, contextual Space (roll while fighting, otherwise jump or
 * vault), enemy telegraphs, hit-stop, camera shake and stagger. It sends only ordinary
 * intentions (`defend`, `attack`, `traverse`) and reads only projected state; everything it
 * returns per frame is presentation.
 *
 * Wiring (realms/client.ts or realms/ascent.ts):
 *   const slice = new SliceCombat({ command, send });
 *   on state / tower_frame:   slice.ingest(viewFromRealm(state))  |  slice.ingest(viewFromTowerFrame(frame))
 *   on 'traversal' message:   slice.traversalResult(m.result)
 *   on key/button press:      slice.action('jump' | 'dodge' | 'lockTarget' | 'switchTarget' | 'lightAttack' | 'heavyAttack', ctx)
 *   each frame:               const fx = slice.frame(dt, ctx)  → fx.timeScale for animation dt, fx.shake for the camera,
 *                             slice.offset(bodyId) on drawn bodies, fx.telegraphs / fx.lock for markers.
 */
export interface SliceBody { bodyId: string; pos: { x: number; y: number; z: number }; dead: boolean; hostile: boolean; combatAction: ActionView | null }
export interface SliceWildlife extends WildlifeView { hostile: boolean }
export interface SliceView {
  /** Canonical physical time of the projection. */
  time: number; ownBodyId: string; own: { x: number; y: number; z: number }; ownTraversal: BodyTraversal | null;
  people: SliceBody[]; wildlife: SliceWildlife[]; combatEvents: CombatEventView[];
}
export interface SliceTransport { command(c: InteractionCommand): void; send(message: object): void }
export interface SliceContext {
  /** Camera-relative movement intent in world axes (forward = -sin/-cos yaw), zero when idle. */
  moveWorld: { x: number; z: number };
  /** Ground yaw of the camera, for lock selection. */
  viewYaw: number;
  guarding: boolean;
  /** Seconds since the last projection, to extrapolate canonical time. */
  age?: number;
}
export type SliceAction = 'jump' | 'dodge' | 'lockTarget' | 'switchTarget' | 'lightAttack' | 'heavyAttack';
export interface SliceFrame {
  timeScale: number; shake: { x: number; y: number; z: number; roll: number }; impacts: Impact[];
  lock: { bodyId: string | null; mode: LockMode }; telegraphs: Telegraph[]; threat: Telegraph | null;
  dodge: { phase: DodgePhase; evading: boolean; progress: number };
  /** Vertical presentation offset for an in-place hop, metres. */
  hop: number;
  /** Where to draw the own body while a vault/jump is in flight (canonical arc), else null. */
  traversal: { x: number; y: number; z: number } | null;
}
const HOP = { seconds: .42, height: .32 };

export class SliceCombat {
  readonly dodge = new DodgeMachine();
  readonly lock = new TargetLock();
  readonly feel = new CombatFeel();
  private view: SliceView | null = null;
  private clock = 0;
  private hopAt = -Infinity;
  private pendingImpacts: Impact[] = [];
  private lastTelegraphs: Telegraph[] = [];

  constructor(private readonly transport: SliceTransport) {}

  ingest(view: SliceView): void {
    this.view = view;
    const at = (id: string) => { const b = view.people.find(p => p.bodyId === id) ?? view.wildlife.find(w => w.bodyId === id); return id === view.ownBodyId ? view.own : b?.pos ?? null; };
    this.pendingImpacts.push(...this.feel.ingest(view.combatEvents, view.ownBodyId, at));
  }
  candidates(): LockCandidate[] {
    const v = this.view; if (!v) return [];
    return [...v.people.filter(p => p.bodyId !== v.ownBodyId).map(p => ({ bodyId: p.bodyId, pos: p.pos, hostile: p.hostile, dead: p.dead, kind: 'person' as const })),
      ...v.wildlife.map(w => ({ bodyId: w.bodyId, pos: w.pos, hostile: w.hostile, dead: w.dead, kind: 'wildlife' as const }))];
  }
  /** The body attacks are aimed at: the hard lock, else the soft lock, else none. */
  attackTarget(): string | undefined { return this.lock.bodyId ?? undefined; }

  action(name: SliceAction, ctx: SliceContext): string | null {
    const v = this.view; if (!v) return null;
    switch (name) {
      case 'lockTarget': return this.lock.toggle(this.candidates(), v.own, ctx.viewYaw);
      case 'switchTarget': return this.lock.cycle(this.candidates(), v.own, ctx.viewYaw);
      case 'lightAttack': case 'heavyAttack': {
        const target = this.attackTarget();
        this.transport.command({ type: 'attack', weight: name === 'heavyAttack' ? 'heavy' : 'light', trajectory: 'high', ...(target ? { targetBodyId: target } : {}) });
        return target ?? null;
      }
      case 'jump':
        if (spaceIntent({ locked: this.lock.mode === 'hard', guarding: ctx.guarding, threatened: !!threatened(this.lastTelegraphs) }) === 'traverse') {
          this.transport.send({ type: 'traverse' }); return 'traverse';
        }
        return this.roll(ctx);
      case 'dodge': return this.roll(ctx);
    }
  }
  /** The host's answer to `traverse`: a hop in place is drawn here; a vault/jump arrives as canonical state. */
  traversalResult(result: string): void { if (result === 'hop') this.hopAt = this.clock; }

  frame(dt: number, ctx: SliceContext): SliceFrame {
    this.clock += dt;
    const v = this.view, now = (v?.time ?? 0) + (ctx.age ?? 0);
    const buffered = this.dodge.update(this.clock); if (buffered) this.transport.command(buffered);
    if (v) this.lock.update(this.clock, this.candidates(), v.own, ctx.viewYaw);
    this.lastTelegraphs = v ? telegraphs(now, v.ownBodyId, v.own, v.wildlife, v.people.map(p => ({ bodyId: p.bodyId, pos: p.pos, dead: p.dead, combatAction: p.combatAction }))) : [];
    const timeScale = this.feel.update(dt), impacts = this.pendingImpacts.splice(0), h = (this.clock - this.hopAt) / HOP.seconds;
    return { timeScale, shake: this.feel.shake(), impacts, lock: { bodyId: this.lock.bodyId, mode: this.lock.mode },
      telegraphs: this.lastTelegraphs, threat: threatened(this.lastTelegraphs),
      dodge: { phase: this.dodge.phase, evading: this.dodge.evading(this.clock), progress: this.dodge.progress(this.clock) },
      hop: h >= 0 && h < 1 ? 4 * h * (1 - h) * HOP.height : 0,
      traversal: v?.ownTraversal ? traversalPoint(v.ownTraversal, now).pos : null };
  }
  offset(bodyId: string): { x: number; z: number } { return this.feel.offset(bodyId); }
  private roll(ctx: SliceContext): string | null {
    const c = this.dodge.press(this.clock, ctx.moveWorld); if (!c) return null;
    this.transport.command(c); return c.kind;
  }
}

/** Normalise the realm snapshot (sim/world/realms/session.ts `snapshot()`). */
export function viewFromRealm(s: {
  time: number; body: { id: string; pos: { x: number; y: number; z: number }; traversal?: BodyTraversal | null };
  residents: { hostile?: boolean; pos: { x: number; y: number; z: number }; visual: { bodyId: string; dead?: boolean; incapacitated?: boolean; combatAction: ActionView | null } }[];
  wildlife?: SliceWildlife[]; combatEvents?: CombatEventView[];
}): SliceView {
  return { time: s.time, ownBodyId: s.body.id, own: s.body.pos, ownTraversal: s.body.traversal ?? null,
    people: s.residents.map(r => ({ bodyId: r.visual.bodyId, pos: r.pos, dead: !!r.visual.dead || !!r.visual.incapacitated, hostile: !!r.hostile, combatAction: r.visual.combatAction })),
    wildlife: s.wildlife ?? [], combatEvents: s.combatEvents ?? [] };
}
/** Normalise a Tower frame (server/towerController.ts `frame()`): every other body there is a warden. */
export function viewFromTowerFrame(f: {
  snapshot: { worldTime?: number; bodies: { bodyId: string; pos: { x: number; y: number; z: number }; dead: boolean; incapacitated: boolean; combatAction: ActionView | null }[] };
  own: { bodyId: string }; combatEvents?: CombatEventView[]; time?: number; tower?: { retiredBodyIds?: string[] };
}, physicalTime: number): SliceView {
  const own = f.snapshot.bodies.find(b => b.bodyId === f.own.bodyId), retired = new Set(f.tower?.retiredBodyIds ?? []);
  return { time: physicalTime, ownBodyId: f.own.bodyId, own: own?.pos ?? { x: 0, y: 0, z: 0 }, ownTraversal: null,
    people: f.snapshot.bodies.map(b => ({ bodyId: b.bodyId, pos: b.pos, dead: b.dead || b.incapacitated, hostile: b.bodyId !== f.own.bodyId && !retired.has(b.bodyId), combatAction: b.combatAction })),
    wildlife: [], combatEvents: f.combatEvents ?? [] };
}
