/**
 * Enemy telegraphs read from projected canonical state, so the player can see an attack coming
 * and answer it with a guard or a roll.
 *
 * Two sources, both already on the wire: a defensive animal's mode (warn → charge → strike,
 * ecology/defense.ts) and a humanoid's combat action in its preparation phase, facing the
 * player and within reach. The output is what to draw (a ring, a flash) and how urgent it is;
 * it predicts nothing the server has not already committed to.
 */
export interface WildlifeView {
  bodyId: string; pos: { x: number; y: number; z: number }; dead: boolean;
  defense: { mode: 'warn' | 'charge' | 'strike' | 'recover' | 'retreat'; since: number; strikeAt: number | null; targetBodyId: string } | null;
}
export interface ActionView {
  actorBodyId: string; kind: string; phase?: string; startedAt: number; activeAt: number; completeAt: number; facing: number; reach?: number;
}
export interface HumanoidView { bodyId: string; pos: { x: number; y: number; z: number }; dead?: boolean; combatAction: ActionView | null }
export type TelegraphKind = 'warn' | 'charge' | 'windup';
export interface Telegraph { bodyId: string; kind: TelegraphKind; targetsMe: boolean; urgency: number; secondsToImpact: number | null }
export const TELEGRAPH = Object.freeze({ facingCone: Math.cos(Math.PI * 0.25), reachSlack: 1.6, chargeSeconds: 1.2 });

export function telegraphs(now: number, ownBodyId: string, own: { x: number; z: number }, wildlife: readonly WildlifeView[], humanoids: readonly HumanoidView[]): Telegraph[] {
  const out: Telegraph[] = [];
  for (const w of wildlife) {
    const d = w.defense; if (w.dead || !d) continue;
    const targetsMe = d.targetBodyId === ownBodyId;
    if (d.mode === 'warn') out.push({ bodyId: w.bodyId, kind: 'warn', targetsMe, urgency: targetsMe ? .35 : .15, secondsToImpact: null });
    else if (d.mode === 'charge' || (d.mode === 'strike' && d.strikeAt !== null && d.strikeAt > now)) {
      const left = d.strikeAt !== null ? Math.max(0, d.strikeAt - now) : Math.max(0, TELEGRAPH.chargeSeconds - (now - d.since));
      out.push({ bodyId: w.bodyId, kind: 'charge', targetsMe, urgency: targetsMe ? Math.min(1, .6 + .4 * (1 - left / TELEGRAPH.chargeSeconds)) : .3, secondsToImpact: left });
    }
  }
  for (const h of humanoids) {
    const a = h.combatAction;
    if (h.dead || !a || h.bodyId === ownBodyId || a.kind !== 'attack' || now >= a.activeAt || now < a.startedAt) continue;
    const dx = own.x - h.pos.x, dz = own.z - h.pos.z, dist = Math.hypot(dx, dz) || 1e-3;
    const facing = (dx * -Math.sin(a.facing) + dz * -Math.cos(a.facing)) / dist;
    const targetsMe = facing >= TELEGRAPH.facingCone && dist <= (a.reach ?? 1) + TELEGRAPH.reachSlack;
    const span = Math.max(1e-3, a.activeAt - a.startedAt), left = a.activeAt - now;
    out.push({ bodyId: h.bodyId, kind: 'windup', targetsMe, urgency: targetsMe ? Math.min(1, .5 + .5 * (1 - left / span)) : .2, secondsToImpact: left });
  }
  return out.sort((a, b) => b.urgency - a.urgency || a.bodyId.localeCompare(b.bodyId));
}
/** The most urgent attack aimed at the player, if any: what makes Space roll instead of jump. */
export function threatened(list: readonly Telegraph[]): Telegraph | null { return list.find(t => t.targetsMe && t.kind !== 'warn') ?? null; }
