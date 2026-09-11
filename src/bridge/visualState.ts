import type { Appearance, Body, Pose, Vec3 } from '../sim/core/types';

/** Renderer-neutral physical projection. No asset paths, cognition or movement tuning. */
export interface HumanoidVisualState {
  bodyId: string;
  entityId: string;
  name: string;
  pos: Vec3;
  velocity: Vec3;
  yaw: number;
  pose: Pose;
  activity: string;
  /** Actual horizontal velocity magnitude, metres/second. */
  speed: number;
  attackSeq: number;
  hitSeq: number;
  lastAttackAt: number;
  lastHitAt: number;
  dead: boolean;
  incapacitated: boolean;
  appearance?: Appearance;
}

export function humanoidVisualState(body: Body, name: string, activity: string, appearance?: Appearance): HumanoidVisualState {
  return {
    bodyId: body.id, entityId: body.ownerId, name,
    pos: { ...body.pos }, velocity: { ...body.vel }, yaw: body.yaw,
    pose: body.pose, activity, speed: Math.hypot(body.vel.x, body.vel.z),
    attackSeq: body.attackSeq, hitSeq: body.hitSeq,
    lastAttackAt: body.lastAttackAt, lastHitAt: body.lastHitAt,
    dead: body.dead, incapacitated: body.pose === 'downed',
    ...(appearance ? { appearance: { ...appearance } } : {}),
  };
}
