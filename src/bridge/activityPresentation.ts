import type { Action, Body, Person, Vec3 } from '../sim/core/types';
import type { World } from '../sim/core/world';

/**
 * General activity presentation (Slice 3 Part 2).
 *
 * The split this module exists to enforce:
 *
 *   canonical simulation decides WHAT a person is doing — the goal it selected, the action it is
 *   executing, the place it is at, the pose its body holds, whether it is wounded;
 *   embodiment decides HOW that reads physically — which activity family, which posture, which
 *   locomotion tier, whether a physical station is required, what the character should face.
 *
 * Every field below is derived from canonical state that already exists, and every resolution
 * records the canonical fields it read in `evidence`. There is deliberately no ambient/idle
 * animation pool: when the simulation says a person is doing nothing in particular, this returns
 * `idle`, because inventing visible activity would be the renderer asserting something the world
 * does not contain (AGENTS.md §5, §7).
 *
 * This is one general layer. There is no per-NPC special case anywhere in it.
 */

export type ActivityFamily =
  | 'travel' | 'work' | 'eat' | 'drink' | 'rest' | 'socialize' | 'trade'
  | 'carry' | 'flee' | 'injured' | 'combat' | 'idle';

export type Posture = 'stand' | 'sit' | 'lie' | 'kneel' | 'move';
export type LocomotionTier = 'idle' | 'walk' | 'run' | 'sprint';
/** Which canonical `Anchor.kind` this activity needs a physically valid instance of, if any. */
export type StationKind = 'work' | 'counter' | 'seat' | 'bed' | 'stall' | 'fire' | 'altar' | 'display';

export interface ActivityInjury {
  /** A canonical wound actually limits this person's capability right now. */
  impaired: boolean;
  /** Peak canonical injury severity over all regions, 0..1. */
  severity: number;
  /** Canonical movement capability multiplier — already consequential in simulation. */
  movementMultiplier: number;
}

export interface ActivityPresentation {
  family: ActivityFamily;
  /** Narrower read within the family, e.g. 'chop', 'forge', 'converse', 'sit_and_eat'. */
  detail: string;
  posture: Posture;
  locomotion: LocomotionTier;
  /** Canonical horizontal speed, metres/second. */
  speed: number;
  /** A physical station this activity should occupy, or null when it needs none. */
  station: StationKind | null;
  /** Canonical place the activity belongs to, when the canonical action names one. */
  placeId: string | null;
  /** Canonical entity this activity is directed at (a person, a workpiece, a source). */
  facingEntityId: string | null;
  /** Canonical position the action names, when it names one. */
  targetPos: Vec3 | null;
  /** A canonically held item that should be visible in hand, or null. */
  carried: string | null;
  injury: ActivityInjury;
  /** Exactly which canonical fields produced this resolution. */
  evidence: { pose: string; action: string | null; goal: string | null };
}

/** Canonical actions that are work regardless of the pose the body happens to hold. */
const WORK_ACTIONS = new Set(['work', 'chop', 'gather', 'build', 'plant', 'harvest',
  'haul_load', 'haul_unload', 'mechanism_task', 'operate_mechanism', 'construct_mechanism',
  'procure_material', 'read_record', 'write_record', 'copy_record', 'manage_household']);
const SOCIAL_ACTIONS = new Set(['talk', 'tell', 'introduce', 'propose', 'bark', 'give', 'demand', 'face']);
const TRADE_ACTIONS = new Set(['buy_food']);

/** Work detail, kept identical in meaning to the existing `visibleActivity` read in
 * `session.ts` so the two never disagree about what a working body is doing. */
function workDetail(action: Action | undefined, placeType: string | null): string {
  if (action?.type === 'chop') return 'chop';
  if (action?.type === 'gather') return 'gather';
  if (action?.type === 'build') return 'repair';
  if (action?.type === 'plant' || action?.type === 'harvest') return action.type;
  if (action?.type === 'haul_load' || action?.type === 'haul_unload') return 'haul';
  if (action?.type === 'mechanism_task') {
    const kind = action.data?.kind;
    return ['inspect', 'diagnose', 'reverse_engineer'].includes(kind) ? 'inspect' : kind === 'test' ? 'operate' : 'repair';
  }
  if (action?.type === 'operate_mechanism' || action?.type === 'construct_mechanism') return 'operate';
  if (action?.type === 'read_record' || action?.type === 'write_record' || action?.type === 'copy_record') return 'record';
  // The workplace itself is canonical evidence of what the work looks like when the action is
  // the generic 'work'. A smithy forges; a bakery bakes; anything else is generic craft.
  if (placeType === 'smithy') return 'forge';
  if (placeType === 'bakery') return 'bake';
  if (placeType === 'mill') return 'mill';
  if (placeType === 'farm') return 'tend';
  if (placeType === 'store' || placeType === 'stall') return 'serve';
  return 'craft';
}

function stationForWork(placeType: string | null): StationKind {
  if (placeType === 'store' || placeType === 'tavern' || placeType === 'bakery') return 'counter';
  if (placeType === 'stall') return 'stall';
  if (placeType === 'chapel' || placeType === 'shrine') return 'altar';
  return 'work';
}

function locomotionTier(speed: number, running: boolean): LocomotionTier {
  if (speed < 0.15) return 'idle';
  if (speed >= 5.5) return 'sprint';
  if (running || speed >= 2.6) return 'run';
  return 'walk';
}

/** Peak canonical wound severity; the same read `getPhysicalCapability` performs. */
function woundSeverity(body: Body): number {
  const injuries = body.injuries ?? {};
  let peak = 0;
  for (const value of Object.values(injuries)) if (typeof value === 'number' && value > peak) peak = value;
  return peak;
}

/**
 * Resolve how one canonical body's current activity should appear.
 *
 * `movementMultiplier` is supplied by the caller from `getPhysicalCapability`, which is where
 * canonical capability consequences already live — recomputing them here would be a second,
 * divergent account of the same fact (AGENTS.md §7).
 */
export function activityPresentation(
  world: World, body: Body, person: Person | undefined, movementMultiplier = 1,
): ActivityPresentation {
  const action = person?.mind.plan.find(a => a.status === 'active');
  const goal = person?.mind.goal?.type ?? null;
  const speed = Math.hypot(body.vel.x, body.vel.z);
  const severity = woundSeverity(body);
  const injury: ActivityInjury = {
    impaired: severity > 0.15 || movementMultiplier < 0.95,
    severity, movementMultiplier,
  };
  const placeId = action?.placeId ?? null;
  const placeType = placeId ? world.place(placeId)?.type ?? null : null;
  const evidence = { pose: body.pose, action: action?.type ?? null, goal };
  const carriedItem = person?.inventory
    .map(id => world.item(id))
    .find(item => item && item.holderId === person.id);
  const carried = carriedItem?.type ?? null;
  const facingEntityId = action?.targetEntity ?? body.attackTarget ?? null;
  const targetPos = action?.pos ? { ...action.pos } : null;
  const base = { speed, placeId, facingEntityId, targetPos, carried, injury, evidence };
  const moving = locomotionTier(speed, body.pose === 'run');

  // Terminal and incapacitated canonical state outranks everything: a downed body is not
  // "resting" and a dead one is not "idle".
  if (body.dead) {
    return { ...base, family: 'injured', detail: 'dead', posture: 'lie', locomotion: 'idle', station: null };
  }
  if (body.pose === 'downed' || body.subduedUntil > world.physicalTime) {
    return { ...base, family: 'injured', detail: 'downed', posture: 'lie', locomotion: 'idle', station: null };
  }
  if (body.pose === 'attack' || body.pose === 'hit' || body.combatAction || goal === 'attack' || goal === 'confront') {
    return { ...base, family: 'combat', detail: body.pose === 'hit' ? 'recoil' : 'strike', posture: 'stand', locomotion: moving, station: null };
  }
  if (goal === 'flee' || goal === 'return_home_safe') {
    return { ...base, family: 'flee', detail: 'flee', posture: 'move', locomotion: speed < 0.15 ? 'idle' : 'run', station: null };
  }
  if (body.pose === 'sleep') {
    return { ...base, family: 'rest', detail: 'sleep', posture: 'lie', locomotion: 'idle', station: 'bed' };
  }
  if (body.pose === 'eat' || action?.type === 'eat') {
    const seated = body.pose === 'sit' || body.sitAnchor !== null;
    return { ...base, family: 'eat', detail: seated ? 'sit_and_eat' : 'eat_standing', posture: seated ? 'sit' : 'stand', locomotion: 'idle', station: seated ? 'seat' : null };
  }
  if (body.pose === 'drink' || action?.type === 'drink') {
    const atSource = placeType === 'well' || goal === 'drink_water';
    return { ...base, family: 'drink', detail: atSource ? 'drink_from_source' : 'drink_vessel', posture: body.sitAnchor ? 'sit' : 'stand', locomotion: 'idle', station: body.sitAnchor ? 'seat' : null };
  }
  if ((action && TRADE_ACTIONS.has(action.type)) || goal === 'shop') {
    return { ...base, family: 'trade', detail: 'barter', posture: 'stand', locomotion: moving, station: 'counter' };
  }
  if (body.pose === 'talk' || (action && SOCIAL_ACTIONS.has(action.type)) || goal === 'socialize' || goal === 'talk') {
    const seated = body.pose === 'sit' || body.sitAnchor !== null;
    return { ...base, family: 'socialize', detail: seated ? 'sit_and_talk' : 'converse', posture: seated ? 'sit' : 'stand', locomotion: 'idle', station: seated ? 'seat' : null };
  }
  if (body.pose === 'pray' || goal === 'worship') {
    return { ...base, family: 'rest', detail: 'pray', posture: 'kneel', locomotion: 'idle', station: 'altar' };
  }
  if (body.pose === 'work' || body.pose === 'haul' || (action && WORK_ACTIONS.has(action.type))) {
    const detail = workDetail(action, placeType);
    if (detail === 'haul' || body.pose === 'haul') {
      return { ...base, family: 'carry', detail: 'haul', posture: speed < 0.15 ? 'stand' : 'move', locomotion: moving, station: null };
    }
    return { ...base, family: 'work', detail, posture: 'stand', locomotion: speed < 0.15 ? 'idle' : 'walk', station: stationForWork(placeType) };
  }
  if (body.pose === 'sit') {
    return { ...base, family: 'rest', detail: 'seated', posture: 'sit', locomotion: 'idle', station: 'seat' };
  }
  if (moving !== 'idle') {
    // Carrying while travelling is its own family: the canonical held item changes the
    // silhouette, which is exactly the distinction the slice asks embodiment to expose.
    if (carried) return { ...base, family: 'carry', detail: 'carry_travel', posture: 'move', locomotion: moving, station: null };
    return { ...base, family: 'travel', detail: goal === 'go_home' ? 'go_home' : 'travel', posture: 'move', locomotion: moving, station: null };
  }
  return { ...base, family: 'idle', detail: 'idle', posture: 'stand', locomotion: 'idle', station: null };
}
