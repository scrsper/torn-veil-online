// Shared "player" driver for accelerated acceptance runs. It acts only through the messages a
// client sends: move intents along a path it plans from geometry the client also receives, talk
// and dialogue choices, hand interactions, hush, person actions, and realtime combat commands.
// Online/offline switches the local controller exactly as a connection would (GameSim attach /
// detach); while offline the person lives through ordinary autonomy. It never edits state.
import { BridgeSession } from '../../src/bridge/session';
import type { Body, Person, Vec3 } from '../../src/sim/core/types';
import { handInteractions } from '../../src/sim/physical/hand';

export class PlayerBot {
  readonly w; readonly p: Person; readonly body: Body;
  private seq = 0; private commandSeq = 0; online = true; readonly DT = 0.1;
  private binding?: ReturnType<BridgeSession['bindInteraction']>;
  constructor(readonly s: BridgeSession) { this.w = s.world; this.p = this.w.person(this.w.playerId!)!; this.body = this.w.primaryBody(this.p.id)!; }
  say(m: Record<string, unknown>): string { return this.s.intent({ version: 1, sequence: ++this.seq, ...m }).result; }
  dist(a: Vec3, b: Vec3) { return Math.hypot(a.x - b.x, a.z - b.z); }
  setOnline(on: boolean) {
    if (on === this.online) return; this.online = on;
    if (on) {
      this.s.game.attach('local', this.p.id); this.p.mind.plan = []; this.p.mind.goal = null; this.binding = undefined;
      // A body left to ordinary life may be asleep when its player returns; they wake it (Z) first.
      if (this.body.pose === 'sleep') this.say({ type: 'person_action', intent: { kind: 'wake' } });
    } else this.s.game.detach('local');
  }
  tick(x = 0, z = 0, sprint = false) { if (this.online && (x || z)) this.say({ type: 'move', x, z, sprint }); this.s.step(this.DT); }
  wait(seconds: number) { for (let t = 0; t < seconds; t += this.DT) this.tick(); }
  offline(seconds: number) { this.setOnline(false); for (let t = 0; t < seconds; t += this.DT) this.s.step(this.DT); this.setOnline(true); }
  /** Walk to somewhere one can stand beside `target` (goods on a counter, a thing against a wall). */
  goNear(target: Vec3, budgetSeconds = 400): boolean {
    for (const r of [1, 1.6]) for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, spot = { x: target.x + Math.cos(a) * r, y: target.y, z: target.z + Math.sin(a) * r };
      if (this.w.nav.findPath(this.body.pos, spot, 4000) && this.go(spot, 0.4, budgetSeconds)) return true;
    }
    return false;
  }
  /** Walk along a path planned over the same geometry the client receives. */
  go(target: Vec3, within = 1.2, budgetSeconds = 900): boolean {
    const pts = this.w.nav.findPath(this.body.pos, target, 4000); if (!pts) return false;
    const t0 = this.w.physicalTime;
    for (const pt of pts) {
      let stuck = 0;
      while (this.dist(this.body.pos, pt) > 0.3) {
        if (this.w.physicalTime - t0 > budgetSeconds || ['downed', 'sleep'].includes(this.body.pose)) return false;
        const dx = pt.x - this.body.pos.x, dz = pt.z - this.body.pos.z, l = Math.hypot(dx, dz), old = { ...this.body.pos };
        this.tick(dx / l, dz / l, l > 4);
        if (this.dist(old, this.body.pos) < 0.001) { if (++stuck > 30) return false; } else stuck = 0;
        if (this.dist(this.body.pos, target) <= within) return true;
      }
    }
    return this.dist(this.body.pos, target) <= within + 1;
  }
  /** Open a conversation with someone within reach, pick an option by label, close it. */
  talk(npc: Person, pick: (label: string) => boolean, keepOpen = false): { labels: string[]; lines: string[] } | null {
    const nb = this.w.primaryBody(npc.id); if (!nb) return null;
    if (this.say({ type: 'talk', targetBodyId: nb.id }) !== 'accepted') return null;
    const menu = this.s.snapshot(false).dialogue; const labels = menu?.options.map(o => o.label) ?? [];
    const o = menu?.options.find(x => pick(x.label));
    if (!o) { this.say({ type: 'dialogue_close' }); return { labels, lines: [] }; }
    this.say({ type: 'dialogue_option', optionId: o.id });
    const after = this.s.snapshot(false).dialogue; const lines = after?.lines ?? [];
    if (!keepOpen) this.say({ type: 'dialogue_close' });
    return { labels: after?.options.map(x => x.label) ?? labels, lines };
  }
  choose(pick: (label: string) => boolean): string[] | null {
    const menu = this.s.snapshot(false).dialogue; const o = menu?.options.find(x => pick(x.label)); if (!o) return null;
    this.say({ type: 'dialogue_option', optionId: o.id }); const lines = this.s.snapshot(false).dialogue?.lines ?? []; return lines;
  }
  interactions() { return handInteractions(this.s.sim, this.p); }
  interact(id: string) { return this.say({ type: 'interact', interactionId: id }); }
  /** Realtime combat command, as the packaged client sends it. */
  command(c: Record<string, unknown>) {
    this.binding ??= this.s.bindInteraction('bot');
    const n = ++this.commandSeq;
    return this.s.receiveCommand({ version: 2, type: 'command', ...this.binding, sequence: n, commandId: `bot:${n}`, clientTimeMs: n * 16, command: c }, n * 16);
  }
  /** One 60 Hz step through the realtime path (used during combat). */
  stepRealtime() { this.s.stepInteraction(this.commandSeq * 16); }
}
