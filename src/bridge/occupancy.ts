import type { Anchor, Body, Place, Vec3 } from '../sim/core/types';
import type { World } from '../sim/core/world';
import { B } from '../sim/physical/blocks';
import type { StationKind } from './activityPresentation';

/**
 * Physical occupancy (Slice 3 Part 2, "people should physically belong in the environment").
 *
 * Canonical simulation already says "this person is working at the smithy" — it names the goal,
 * the action and the `Place`, and `Place.anchors` already carries the canonical work/seat/bed/
 * counter/altar/stall positions of that place. What it does not say, and should not have to, is
 * *which physically valid position a given body should be seen occupying, facing which way*.
 * That is what this module derives, and it derives it only from canonical geometry: the anchor
 * list, the voxel grid, and the furnishing blocks around each anchor.
 *
 * Two hard limits, so that "presentation decides the position" never becomes "presentation
 * rewrites the goal" (AGENTS.md §3):
 *
 *   - Nothing here mutates canonical state. Reservations live in a presentation-side map that is
 *     never saved and never read by cognition; a reservation is a rendering courtesy so two
 *     characters do not stand inside each other, not a canonical claim on a workplace.
 *   - The visible settle offset is bounded by `MAX_SETTLE_METRES` and only applies to a body the
 *     simulation has already brought to rest inside the relevant place. A moving body is drawn
 *     exactly where canonical state puts it.
 */

/** How far a visibly stationary character may be nudged from its canonical body centre to reach
 * a valid station. Canonical planning routes a worker to the anchor cell itself (`mind/agent.ts`
 * `anchorIn`), and a standing position beside that cell is exactly one cell away — so the bound
 * is one cell plus a small margin. That is enough to stop a smith standing inside his own anvil,
 * and far too little to move him to a different anvil than the simulation put him at. */
export const MAX_SETTLE_METRES = 1.25;
/** Radius of the standing ring used for a conversation group, metres. */
export const CONVERSATION_RADIUS = 0.85;

export type SlotPosture = 'stand' | 'sit' | 'lie';

export interface OccupancySlot {
  /** Stable across reload: derived from the canonical place id and the anchor's own cell. */
  id: string;
  placeId: string;
  kind: Anchor['kind'];
  /** The canonical anchor cell itself (the chair, the anvil, the bed). */
  anchor: Vec3;
  /** Where a body actually stands or sits to use it. */
  stand: Vec3;
  /** Facing, radians, derived from the canonical furnishing this anchor serves. */
  yaw: number;
  posture: SlotPosture;
}

const STATION_ANCHORS: Record<StationKind, Anchor['kind']> = {
  work: 'work', counter: 'counter', seat: 'seat', bed: 'bed',
  stall: 'stall', fire: 'fire', altar: 'altar', display: 'display',
};

const SEATED_KINDS = new Set<Anchor['kind']>(['seat']);
const LYING_KINDS = new Set<Anchor['kind']>(['bed']);

/** Blocks an occupant of an anchor should face: the thing the anchor exists to serve. */
const FACING_BLOCKS = new Set<number>([B.Table, B.Counter, B.Anvil, B.Furnace, B.Altar, B.Bookshelf, B.Fire]);

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function yawTowards(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** A cell a humanoid can actually stand in: solid floor beneath, two clear cells above. */
function standable(world: World, x: number, y: number, z: number): boolean {
  const grid = world.grid;
  if (!grid.isSolidAt(x, y - 1, z)) return false;
  return !grid.isSolidAt(x, y, z) && !grid.isSolidAt(x, y + 1, z);
}

/**
 * Derive every physically valid occupancy slot a canonical place offers.
 *
 * An anchor whose cell no longer admits a body — a collapsed roof, a chest dropped on the chair,
 * a bed the world generator put half inside a wall — yields no slot rather than a slot that
 * would make a character stand inside geometry. The caller sees a shorter list, not a bad one.
 */
export function occupancySlots(world: World, place: Place): OccupancySlot[] {
  const slots: OccupancySlot[] = [];
  for (const anchor of place.anchors) {
    const ax = Math.floor(anchor.pos.x), ay = Math.floor(anchor.pos.y), az = Math.floor(anchor.pos.z);
    const seated = SEATED_KINDS.has(anchor.kind), lying = LYING_KINDS.has(anchor.kind);
    // A seat or a bed is occupied AT the anchor; a work/counter/stall position is occupied
    // BESIDE it, facing it — you do not stand inside an anvil.
    const face0: Vec3 = { x: ax + 0.5, y: ay, z: az + 0.5 };
    let face: Vec3 = face0;
    if (seated || lying) {
      if (!standable(world, ax, ay, az) && !lying) continue;
      const stand: Vec3 = { x: ax + 0.5, y: ay, z: az + 0.5 };
      const served = NEIGHBOURS
        .map(([dx, dz]) => ({ x: ax + dx, z: az + dz, block: world.grid.get(ax + dx, ay, az + dz) }))
        .find(n => FACING_BLOCKS.has(n.block));
      face = served ? { x: served.x + 0.5, y: ay, z: served.z + 0.5 } : { x: place.inside.x + 0.5, y: ay, z: place.inside.z + 0.5 };
      slots.push({
        id: `${place.id}:${anchor.kind}:${ax},${ay},${az}`,
        placeId: place.id, kind: anchor.kind, anchor: { x: ax + 0.5, y: ay, z: az + 0.5 },
        stand, yaw: yawTowards(stand, face),
        posture: lying ? 'lie' : 'sit',
      });
      continue;
    }
    // A work anchor on a fixture — an anvil, a counter, a forge, an altar, a shelf — is worked
    // from BESIDE it. A work anchor on open floor (a farm plot, a yard, a guard post) is worked
    // standing ON it: pushing that worker a metre off their own anchor would be presentation
    // inventing a position the place does not have.
    const fixture = FACING_BLOCKS.has(world.grid.get(ax, ay, az));
    if (!fixture && standable(world, ax, ay, az)) {
      const served = NEIGHBOURS
        .map(([dx, dz]) => ({ x: ax + dx, z: az + dz, block: world.grid.get(ax + dx, ay, az + dz) }))
        .find(n => FACING_BLOCKS.has(n.block));
      const stand = { x: ax + 0.5, y: ay, z: az + 0.5 };
      const look = served ? { x: served.x + 0.5, y: ay, z: served.z + 0.5 }
        : { x: place.inside.x + 0.5, y: ay, z: place.inside.z + 0.5 };
      slots.push({
        id: `${place.id}:${anchor.kind}:${ax},${ay},${az}`,
        placeId: place.id, kind: anchor.kind, anchor: { x: ax + 0.5, y: ay, z: az + 0.5 },
        stand, yaw: yawTowards(stand, look), posture: 'stand',
      });
      continue;
    }
    // Otherwise one station per side a body can actually stand on. Two smiths can then work
    // opposite faces of the same anvil, and a forge backed against a wall honestly offers only
    // the one position it physically has.
    for (const [dx, dz] of NEIGHBOURS) {
      if (!standable(world, ax + dx, ay, az + dz)) continue;
      const standCell = { x: ax + dx + 0.5, y: ay, z: az + dz + 0.5 };
      slots.push({
        id: `${place.id}:${anchor.kind}:${ax},${ay},${az}:${dx},${dz}`,
        placeId: place.id, kind: anchor.kind, anchor: { x: ax + 0.5, y: ay, z: az + 0.5 },
        stand: standCell, yaw: yawTowards(standCell, face),
        posture: 'stand',
      });
    }
  }
  return slots;
}

/**
 * Presentation-only occupancy reservations.
 *
 * Never persisted, never canonical, never visible to cognition. Entries expire on a physical
 * time stamp so a body that stops being presented (walked out of range, despawned, died) frees
 * its station without anyone having to remember to release it.
 */
export class SlotReservations {
  private held = new Map<string, { bodyId: string; until: number }>();

  /** Takes or renews a station. Refuses only while a DIFFERENT body's unexpired hold stands. */
  reserve(slotId: string, bodyId: string, now: number, until: number): boolean {
    const holder = this.holder(slotId, now);
    if (holder && holder !== bodyId) return false;
    this.held.set(slotId, { bodyId, until });
    return true;
  }
  holder(slotId: string, now: number): string | null {
    const current = this.held.get(slotId);
    if (!current) return null;
    if (current.until <= now) { this.held.delete(slotId); return null; }
    return current.bodyId;
  }
  release(bodyId: string): void {
    for (const [slotId, current] of this.held) if (current.bodyId === bodyId) this.held.delete(slotId);
  }
  expire(now: number): void {
    for (const [slotId, current] of this.held) if (current.until <= now) this.held.delete(slotId);
  }
  get size(): number { return this.held.size; }
}

export interface Station {
  slot: OccupancySlot;
  /** How far the body must be visibly settled from its canonical centre to occupy it. */
  settleMetres: number;
}

/**
 * Choose the station a body should occupy for a required station kind.
 *
 * Preference order is entirely physical: an unreserved, valid slot of the right kind, nearest to
 * where canonical simulation actually put the body. A body the simulation has not brought within
 * `MAX_SETTLE_METRES` of any valid slot gets none — the character then stands wherever canonical
 * state says, which is the honest presentation of "walking toward the forge but not there yet".
 */
export function chooseStation(
  world: World, body: Body, kind: StationKind, placeId: string | null,
  reservations: SlotReservations, holdSeconds = 4,
): Station | null {
  const place = placeId ? world.place(placeId) : undefined;
  if (!place) return null;
  const want = STATION_ANCHORS[kind];
  const now = world.physicalTime;
  let best: Station | null = null;
  for (const slot of occupancySlots(world, place)) {
    if (slot.kind !== want) continue;
    const holder = reservations.holder(slot.id, now);
    if (holder && holder !== body.id) continue;
    const distance = Math.hypot(slot.stand.x - body.pos.x, slot.stand.z - body.pos.z);
    if (distance > MAX_SETTLE_METRES) continue;
    if (!best || distance < best.settleMetres) best = { slot, settleMetres: distance };
  }
  if (best) reservations.reserve(best.slot.id, body.id, now, now + holdSeconds);
  return best;
}

/**
 * An F-formation for a canonical conversation: participants evenly spaced on a ring around the
 * midpoint of the people actually talking, each facing the centre.
 *
 * The ring is derived from the canonical body positions themselves, so it follows the people
 * rather than relocating them: a caller applies the result as a bounded presentation offset, the
 * same discipline `chooseStation` uses.
 */
export function conversationStations(bodies: Body[]): Map<string, { stand: Vec3; yaw: number }> {
  const out = new Map<string, { stand: Vec3; yaw: number }>();
  if (bodies.length < 2) return out;
  const centre = bodies.reduce((acc, b) => ({ x: acc.x + b.pos.x / bodies.length, y: acc.y + b.pos.y / bodies.length, z: acc.z + b.pos.z / bodies.length }), { x: 0, y: 0, z: 0 });
  // Keep each participant on its own side of the ring by sorting on its actual bearing from the
  // centre, so nobody is asked to cross the circle to reach their station.
  const ordered = [...bodies].sort((a, b) =>
    Math.atan2(a.pos.x - centre.x, a.pos.z - centre.z) - Math.atan2(b.pos.x - centre.x, b.pos.z - centre.z));
  ordered.forEach((body, index) => {
    const angle = (index / ordered.length) * Math.PI * 2;
    const stand = { x: centre.x + Math.sin(angle) * CONVERSATION_RADIUS, y: body.pos.y, z: centre.z + Math.cos(angle) * CONVERSATION_RADIUS };
    out.set(body.id, { stand, yaw: yawTowards(stand, centre) });
  });
  return out;
}

/**
 * The nearest physically valid cell from which `from` can approach `target` — the "approach slot"
 * the slice asks for. Used for a doorway, a well, a market stall or a person: anything a body has
 * to stand next to rather than inside.
 */
export function approachSlot(world: World, target: Vec3, from: Vec3): Vec3 | null {
  const tx = Math.floor(target.x), ty = Math.floor(target.y), tz = Math.floor(target.z);
  let best: { pos: Vec3; distance: number } | null = null;
  for (const [dx, dz] of NEIGHBOURS) {
    const x = tx + dx, z = tz + dz;
    if (!standable(world, x, ty, z)) continue;
    const pos = { x: x + 0.5, y: ty, z: z + 0.5 };
    const distance = Math.hypot(pos.x - from.x, pos.z - from.z);
    if (!best || distance < best.distance) best = { pos, distance };
  }
  return best?.pos ?? null;
}

/**
 * A bounded lateral separation for a visibly stationary body crowded by its neighbours.
 *
 * Presentation-only local avoidance: canonical collision and canonical movement are unchanged,
 * and the offset is clamped so a character never drifts far enough to appear somewhere the
 * simulation did not put it. Returns a zero offset for a moving body — canonical movement
 * already resolves those.
 */
export function separationOffset(body: Body, neighbours: Body[], radius = 0.55): { x: number; z: number } {
  if (Math.hypot(body.vel.x, body.vel.z) > 0.15) return { x: 0, z: 0 };
  let ox = 0, oz = 0;
  for (const other of neighbours) {
    if (other.id === body.id) continue;
    const dx = body.pos.x - other.pos.x, dz = body.pos.z - other.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= radius * 2 || distance < 1e-4) continue;
    const push = (radius * 2 - distance) / 2;
    ox += (dx / distance) * push; oz += (dz / distance) * push;
  }
  const magnitude = Math.hypot(ox, oz);
  if (magnitude > MAX_SETTLE_METRES) { ox = ox / magnitude * MAX_SETTLE_METRES; oz = oz / magnitude * MAX_SETTLE_METRES; }
  return { x: ox, z: oz };
}
