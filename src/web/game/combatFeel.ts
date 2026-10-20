/**
 * Impact feedback from canonical combat outcomes: hit-stop, camera shake and a visible
 * stagger/knockback on the body that was struck.
 *
 * Input is the server's own record of what happened (`attack`, `attack_missed`, `kill` events
 * projected in the realm snapshot or Tower frame). Output is presentation only: a time scale
 * for animation playback, a shake impulse for the camera and a decaying positional offset per
 * struck body. None of it advances or alters combat; the authoritative bodies are untouched,
 * and every event is felt once however many snapshots repeat it.
 */
export interface CombatEventView {
  id: string; type: 'attack' | 'attack_missed' | 'kill' | string;
  attackerBodyId: string | null; targetBodyId: string | null;
  damage: number; health: number | null; weight: 'light' | 'heavy' | null; guarded: boolean; pos: { x: number; y: number; z: number } | null;
}
export interface Impact { eventId: string; strength: number; hitStop: number; shake: number; own: 'dealt' | 'taken' | 'witnessed'; kill: boolean; guarded: boolean }
export const FEEL = Object.freeze({
  /** Seconds of near-freeze: a light hit, a heavy hit, and a killing blow. */
  hitStop: { light: .055, heavy: .095, kill: .14 }, hitStopScale: .06,
  shake: { dealt: .35, taken: .7, witnessed: .12 }, guardedFactor: .45,
  /** Metres of shove at full strength, and its spring back. */
  knockback: .32, knockbackDecay: 9, maxSeen: 256,
  /** Camera trauma: offset grows with its square and decays per second; metres at full trauma. */
  traumaDecay: 2.4, shakeMetres: .12, shakeRadians: .025,
});

export class CombatFeel {
  private seen = new Set<string>();
  private order: string[] = [];
  private stopLeft = 0;
  private offsets = new Map<string, { x: number; z: number }>();
  private trauma = 0; private clock = 0;
  /** Settings scale (0 disables shake, e.g. reduced motion); hit-stop and stagger still apply. */
  shakeScale = 1;

  /** Feel new events once; the returned impacts can drive audio, VFX or damage numbers.
   * `positions` gives current body positions for the shove direction. */
  ingest(events: readonly CombatEventView[], ownBodyId: string, positions: (bodyId: string) => { x: number; z: number } | null): Impact[] {
    const felt: Impact[] = [];
    for (const e of events) {
      if (this.seen.has(e.id)) continue;
      this.remember(e.id);
      if (e.type === 'attack_missed' || !e.targetBodyId) continue;
      const own = e.attackerBodyId === ownBodyId ? 'dealt' : e.targetBodyId === ownBodyId ? 'taken' : 'witnessed';
      const kill = e.type === 'kill' || (e.health !== null && e.health <= 0);
      const weight = kill ? 'kill' : e.weight === 'heavy' ? 'heavy' : 'light';
      const strength = Math.min(1, (e.damage || 4) / 25) * (e.guarded ? FEEL.guardedFactor : 1);
      const impact: Impact = { eventId: e.id, strength, own, kill, guarded: e.guarded,
        hitStop: own === 'witnessed' ? 0 : FEEL.hitStop[weight] * (e.guarded ? .6 : 1),
        shake: FEEL.shake[own] * (.4 + .6 * strength) * (kill ? 1.4 : 1) };
      this.stopLeft = Math.max(this.stopLeft, impact.hitStop);
      this.trauma = Math.min(1, this.trauma + impact.shake * this.shakeScale);
      const from = e.attackerBodyId ? positions(e.attackerBodyId) : null, to = positions(e.targetBodyId);
      if (from && to && e.type === 'attack') {
        const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz) || 1, k = FEEL.knockback * strength;
        const prev = this.offsets.get(e.targetBodyId) ?? { x: 0, z: 0 };
        this.offsets.set(e.targetBodyId, { x: prev.x + dx / d * k, z: prev.z + dz / d * k });
      }
      felt.push(impact);
    }
    return felt;
  }
  /** Advance by real `dt`; returns the animation time scale for this frame (1 = normal). */
  update(dt: number): number {
    this.clock += dt; this.trauma = Math.max(0, this.trauma - FEEL.traumaDecay * dt * Math.max(.2, this.trauma));
    const k = Math.exp(-FEEL.knockbackDecay * dt);
    for (const [id, o] of this.offsets) { o.x *= k; o.z *= k; if (Math.hypot(o.x, o.z) < 1e-3) this.offsets.delete(id); }
    if (this.stopLeft <= 0) return 1;
    this.stopLeft = Math.max(0, this.stopLeft - dt);
    return FEEL.hitStopScale;
  }
  /** Current stagger offset for a body (add to its drawn position), or zero. */
  offset(bodyId: string): { x: number; z: number } { return this.offsets.get(bodyId) ?? { x: 0, z: 0 }; }
  get stopping(): boolean { return this.stopLeft > 0; }
  /** Camera offset for this frame (metres, and a small roll in radians). Smooth noise, not random. */
  shake(): { x: number; y: number; z: number; roll: number } {
    const a = this.trauma * this.trauma, t = this.clock * 31;
    return { x: Math.sin(t * 1.3) * Math.cos(t * .7) * a * FEEL.shakeMetres, y: Math.sin(t * 1.7 + 1) * a * FEEL.shakeMetres * .8,
      z: Math.cos(t * 1.1) * Math.sin(t * .9 + 2) * a * FEEL.shakeMetres, roll: Math.sin(t * .9 + 3) * a * FEEL.shakeRadians };
  }
  get shakeTrauma(): number { return this.trauma; }
  private remember(id: string): void {
    this.seen.add(id); this.order.push(id);
    while (this.order.length > FEEL.maxSeen) this.seen.delete(this.order.shift()!);
  }
}
