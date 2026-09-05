import type { EntityId, Vec3 } from '../../sim/core/types';

/**
 * Semantic Activity Projection — shared vocabulary (see docs/SEMANTIC_ACTIVITY_PROJECTION.md).
 *
 * The simulation (`src/sim/`) knows WHAT canonical activity is happening (a construction
 * project's materials/labour, a resource node's extraction). This module and its sibling
 * projector files decide HOW that activity should look, translating canonical state into a
 * small, renderer-agnostic description a Three.js layer can turn into actor motion, object
 * stages, and transient effects. Nothing here is simulation truth: every `deriveXPresentation`
 * function is a pure read of `World`/canonical entities, never mutates them, and produces
 * nothing that gets persisted — reloading a save re-derives the identical presentation from
 * canonical state (Constitution §46 "Rendering Is Not Reality", AGENTS.md's `sim/` →`game/`
 * import rule).
 *
 * Only Construction and Resource Extraction have real projectors in this milestone. The other
 * `ActivityKind`s below are declared now as the extension surface a future adapter fills in —
 * see docs/SEMANTIC_ACTIVITY_PROJECTION.md's "Future adapters" section. Do not implement them
 * here; an unused kind with no projector is the intended state, not an oversight.
 */
export type ActivityKind =
  | 'construction'
  | 'resource_extraction'
  | 'crop_work'
  | 'production'
  | 'crafting'
  | 'repair'
  | 'cooking';

/**
 * A small, intentionally generic vocabulary. Each cue names a SEMANTIC thing the presentation
 * layer wants to happen — "this actor should look like they're mid-swing", "this target should
 * flinch" — never a Three.js detail (a mesh, a shader, a sound file). A renderer maps a cue to
 * whatever it can do with it today (an animation branch, a particle burst) and may map the same
 * cue to more later (a sound effect — see §16 of the spec) without the projector changing.
 */
export type PresentationCueType =
  | 'actor_pose'            // this actor should visibly adopt a work-specific stance
  | 'face_target'           // this actor should be oriented toward its target
  | 'show_material'         // a material/resource should be visibly represented at a place
  | 'show_stage'            // an object should be shown at a particular derived stage
  | 'impact'                // a transient strike/contact moment just occurred
  | 'damage_reaction'       // a target should visibly flinch/react to an impact
  | 'completion'            // an activity reached its canonical completion
  | 'hide_temporary_visual'; // any transient/derived visual for this activity should be removed

export interface PresentationCue {
  type: PresentationCueType;
  actorId?: EntityId;
  targetId?: EntityId;
  placeId?: EntityId;
  pos?: Vec3;
  data?: Record<string, any>;
}

/**
 * Illustrative common shape (see the feature brief). Concrete projectors (construction,
 * resource extraction) extend this with their own domain-specific fields rather than cramming
 * everything into one all-knowing object — `phase` is a free-form semantic label per activity
 * kind (a construction stage name, an extraction phase), not a universal 0..100 percent; use
 * `progress` only where a real fractional measure exists (labour fraction, growth fraction).
 */
export interface ActivityPresentation {
  kind: ActivityKind;
  actorId?: EntityId;
  targetId?: EntityId;
  placeId?: EntityId;
  phase: string;
  progress?: number;
  inputs?: { kind: string; amount: number }[];
  cues: PresentationCue[];
}

/** Coarse visual quantity bucket for a derived material pile — Constitution/spec: "bucketed
 * visual quantities are acceptable... do not require one physical mesh per canonical unit." */
export type MaterialBucket = 'none' | 'some' | 'many';
export function bucketFor(delivered: number, required: number): MaterialBucket {
  if (delivered <= 0) return 'none';
  if (required <= 0 || delivered >= required) return 'many';
  return delivered / required < 0.5 ? 'some' : 'many';
}
