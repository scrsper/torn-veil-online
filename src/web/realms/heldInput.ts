import { INTERACTION_SPEC } from '../../sim/physical/prediction';
import type { InteractionCommand } from '../net/messages';

/** Held guard as intention only. The host's guard lease expires on its own; the client
 * reports edges immediately and renews a continuing hold at the canonical refresh policy,
 * never once per input sample (that interleaving filled a stalled host's command queue). */
export class HeldGuard {
  private sent = false;
  private sentAt = -Infinity;
  constructor(private readonly send: (held: boolean) => void, private readonly refreshMs = INTERACTION_SPEC.guardRefreshSeconds * 1000) {}
  get held(): boolean { return this.sent; }
  update(held: boolean, nowMs: number): void {
    if (held !== this.sent) { this.sent = held; this.sentAt = nowMs; this.send(held); return; }
    if (held && nowMs - this.sentAt >= this.refreshMs) { this.sentAt = nowMs; this.send(true); }
  }
  /** Blur, Escape, menus and transitions: always state a neutral guard. */
  release(nowMs: number): void { this.sent = false; this.sentAt = nowMs; this.send(false); }
}


/** Browser input bookkeeping only: commands still pass through the bound host queue.
 * Both guard controls share one lease refresh clock. Release events are installed before
 * menu handlers so focus changes and Escape remain effective even when a modal consumes keys. */
export class RealmHeldInput {
  readonly keys = new Set<string>();
  private pointerGuard = false;
  private readonly guard: HeldGuard;
  constructor(private readonly send: (command: InteractionCommand) => void, private readonly now = () => performance.now()) {
    this.guard = new HeldGuard(held => this.send({ type: 'guard', held }));
  }
  get mouseGuard(): boolean { return this.pointerGuard; }
  get guarding(): boolean { return this.pointerGuard || this.keys.has('KeyG'); }
  keyDown(code: string, repeat = false): void {
    // A key held through Escape/blur/menu closure must be physically pressed again.
    if (repeat && !this.keys.has(code)) return;
    this.keys.add(code);
    if (code === 'KeyG') this.guard.update(this.guarding, this.now());
  }
  keyUp(code: string): void {
    this.keys.delete(code);
    if (code === 'KeyG') this.guard.update(this.guarding, this.now());
    if (code === 'KeyC') this.send({ type: 'crouch', held: false });
  }
  pointerGuardDown(): void { this.pointerGuard = true; this.guard.update(true, this.now()); }
  pointerGuardUp(): void { this.pointerGuard = false; this.guard.update(this.guarding, this.now()); }
  sampleGuard(allowed: boolean): void {
    if (!allowed) {
      if (this.keys.size || this.pointerGuard || this.guard.held) this.release();
      return;
    }
    this.guard.update(this.guarding, this.now());
  }
  release(): void {
    this.keys.clear(); this.pointerGuard = false;
    this.send({ type: 'move', x: 0, z: 0, sprint: false });
    this.guard.release(this.now());
    this.send({ type: 'crouch', held: false });
  }
  bindReleaseEvents(win: EventTarget, doc: EventTarget & { readonly hidden: boolean }): () => void {
    const release = () => this.release();
    const keydown = (event: Event) => { const key = event as KeyboardEvent; if (key.code === 'Escape' && !key.repeat) release(); };
    const keyup = (event: Event) => this.keyUp((event as KeyboardEvent).code);
    const pointerup = (event: Event) => { if ((event as PointerEvent).button === 2) this.pointerGuardUp(); };
    const visibility = () => { if (doc.hidden) release(); };
    win.addEventListener('keydown', keydown); win.addEventListener('keyup', keyup);
    win.addEventListener('pointerup', pointerup); win.addEventListener('blur', release); win.addEventListener('pointercancel', release);
    doc.addEventListener('visibilitychange', visibility);
    return () => {
      win.removeEventListener('keydown', keydown); win.removeEventListener('keyup', keyup);
      win.removeEventListener('pointerup', pointerup); win.removeEventListener('blur', release); win.removeEventListener('pointercancel', release);
      doc.removeEventListener('visibilitychange', visibility);
    };
  }
}
