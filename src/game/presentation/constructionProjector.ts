import type { ConstructionProject, EntityId, ItemType } from '../../sim/core/types';
import type { World } from '../../sim/core/world';
import { stockAt } from '../../sim/world/stock';
import type { ActivityPresentation, MaterialBucket, PresentationCue } from './types';
import { bucketFor } from './types';

/**
 * ConstructionProjector — turns a canonical `ConstructionProject` (src/sim/world/construction.ts)
 * into a derived `ConstructionPresentation`. The project itself never gains a `visualStage`
 * field; this function computes one fresh every call from the same canonical facts a player
 * could in principle inspect: which materials have actually arrived on site (`stockAt`) and how
 * much labour has actually been credited (`laborDone`/`laborRequired`).
 *
 * Causality (spec §8): a stage that implies a material is present must not render unless that
 * material really is. Rather than hardcoding "stone becomes the foundation, planks become the
 * walls" — which only one project template (`storage_shed`) currently has an opinion about —
 * this projector gates ALL structural stages behind EVERY required type being fully delivered:
 * as long as even one required type is entirely or partially missing, the stage stays at
 * `materials`, no matter how much labour a test or a bug manages to credit early — "labour 60%,
 * stone 0%" (with planks fully delivered) reads as `materials`, never a completed `foundation`
 * implying stone that isn't there. `site` is reserved for the stricter case where NOTHING has
 * arrived yet — a project with some materials already piled (even if others are still zero)
 * has visibly moved past a bare planned site.
 */
export type ConstructionStage = 'site' | 'materials' | 'foundation' | 'frame' | 'walls' | 'roof' | 'complete';

export interface ConstructionMaterialCue {
  type: ItemType;
  delivered: number;
  required: number;
  bucket: MaterialBucket;
}

export interface ConstructionPresentation extends ActivityPresentation {
  kind: 'construction';
  projectId: EntityId;
  placeId: EntityId;
  stage: ConstructionStage;
  /** 0..1 — aggregate delivered/required across all types (1 when nothing is required). An
   * overall proxy for display only; `stage` itself gates on `materials` (every type must
   * individually reach `required`), never on this scalar alone — see `stageFor`. */
  materialsFraction: number;
  /** 0..1 — laborDone / laborRequired. */
  laborFraction: number;
  materials: ConstructionMaterialCue[];
  siteBounds: ConstructionProject['siteBounds'];
}

const FRAME_AT = 0.35;
const WALLS_AT = 0.6;
const ROOF_AT = 0.85;

function stageFor(anyDelivered: boolean, allComplete: boolean, laborFraction: number, status: ConstructionProject['status']): ConstructionStage {
  if (status === 'complete') return 'complete';
  if (!anyDelivered) return 'site';
  if (!allComplete) return 'materials';
  if (laborFraction >= ROOF_AT) return 'roof';
  if (laborFraction >= WALLS_AT) return 'walls';
  if (laborFraction >= FRAME_AT) return 'frame';
  return 'foundation'; // materials complete, labour just starting (or none credited yet)
}

/** Pure, deterministic, non-mutating: same `project`/world stock in → same presentation out. */
export function deriveConstructionPresentation(world: World, project: ConstructionProject): ConstructionPresentation {
  const materials: ConstructionMaterialCue[] = project.required.map(r => {
    const delivered = Math.min(r.quantity, stockAt(world, r.type, project.sitePlaceId));
    return { type: r.type, delivered, required: r.quantity, bucket: bucketFor(delivered, r.quantity) };
  });
  const totalRequired = materials.reduce((a, m) => a + m.required, 0);
  const totalDelivered = materials.reduce((a, m) => a + m.delivered, 0);
  const materialsFraction = totalRequired > 0 ? totalDelivered / totalRequired : 1;
  const anyDelivered = materials.length === 0 || materials.some(m => m.delivered > 0);
  const allComplete = materials.every(m => m.delivered >= m.required);
  const laborFraction = project.laborRequired > 0 ? Math.min(1, project.laborDone / project.laborRequired) : (project.status === 'complete' ? 1 : 0);
  const stage = stageFor(anyDelivered, allComplete, laborFraction, project.status);

  const cues: PresentationCue[] = [];
  if (stage === 'complete') {
    cues.push({ type: 'completion', placeId: project.sitePlaceId }, { type: 'hide_temporary_visual', placeId: project.sitePlaceId });
  } else {
    cues.push({ type: 'show_stage', placeId: project.sitePlaceId, data: { stage } });
    for (const m of materials) if (m.delivered > 0) cues.push({ type: 'show_material', placeId: project.sitePlaceId, data: { type: m.type, bucket: m.bucket } });
    for (const workerId of Object.keys(project.contributions)) {
      // Only workers with a currently active `build` action get a live pose cue — see
      // activityCues.ts, which reads the same canonical action state. This cue set is about
      // what's visible AT the site (materials, stage), not who's presently swinging a hammer.
      cues.push({ type: 'actor_pose', actorId: workerId, placeId: project.sitePlaceId, data: { style: 'hammer' } });
    }
  }

  return {
    kind: 'construction', projectId: project.id, placeId: project.sitePlaceId,
    phase: stage, stage, progress: laborFraction, materialsFraction, laborFraction,
    materials, siteBounds: project.siteBounds,
    inputs: materials.map(m => ({ kind: m.type, amount: m.delivered })),
    cues,
  };
}
