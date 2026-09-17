import { projectAppearanceTraits } from '../sim/core/appearance';
import type { ProjectedAppearanceTraits } from '../sim/core/appearance';
import type { Appearance, Body, Person, Pose, Vec3 } from '../sim/core/types';

/**
 * A person's look as a renderer receives it: the realized colour/scale channels, plus the
 * structured description with the canonically derived fields (age presentation, role cues) filled
 * in. The renderer is free to key off the tokens or to ignore them and use the colours alone —
 * neither path teaches it anything about the simulation beyond how this body looks.
 */
export interface ProjectedAppearance extends Omit<Appearance, 'traits'> {
  traits?: ProjectedAppearanceTraits;
}

/** Project one person's appearance. Age and occupation are canonical, so they are read, not stored. */
export function projectAppearance(person: Pick<Person, 'appearance' | 'age' | 'occupation'> | undefined): ProjectedAppearance | undefined {
  if (!person) return undefined;
  const { traits, ...realized } = person.appearance;
  return traits
    ? { ...realized, traits: projectAppearanceTraits(traits, person.age, person.occupation) }
    : { ...realized };
}

/** Renderer-neutral physical projection. No asset paths, cognition or movement tuning. */
export interface HumanoidVisualState {
  bodyId: string;
  entityId: string;
  name: string;
  pos: Vec3;
  velocity: Vec3;
  yaw: number;
  crouch?:number;
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
  appearance?: ProjectedAppearance;
}

export function humanoidVisualState(body: Body, name: string, activity: string, appearance?: ProjectedAppearance): HumanoidVisualState {
  return {
    bodyId: body.id, entityId: body.ownerId, name,
    pos: { ...body.pos }, velocity: { ...body.vel }, yaw: body.yaw,crouch:body.crouch??0,
    pose: body.pose, activity, speed: Math.hypot(body.vel.x, body.vel.z),
    attackSeq: body.attackSeq, hitSeq: body.hitSeq,
    lastAttackAt: body.lastAttackAt, lastHitAt: body.lastHitAt,
    dead: body.dead, incapacitated: body.pose === 'downed',
    ...(appearance ? { appearance: { ...appearance, ...(appearance.traits ? { traits: { ...appearance.traits } } : {}) } } : {}),
  };
}
