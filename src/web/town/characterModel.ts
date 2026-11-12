import '@babylonjs/loaders/glTF';
import { SceneLoader, TransformNode, type AbstractMesh, type AnimationGroup, type Scene, type ShadowGenerator } from '@babylonjs/core';
import { checkBytes, fitTransform, locomotionWeights, resolveRequest, validateManifest, type CharacterEntry, type CharacterManifest } from '../../sim/town/characterModel';
import type { Figure } from './actors';

/** Dresses a placeholder figure in a staged, hash-verified character GLB (see src/sim/town/characterModel.ts).
 * Cosmetic only: the model hangs under the figure's root, which the town simulation keeps moving, and its
 * clips follow the simulated speed. Any failure disposes what loaded and leaves the capsule showing. */
export type CharacterState = 'capsule' | 'model' | 'fallback';
export interface CharacterStatus {
  state: CharacterState; id?: string; kind?: CharacterEntry['kind']; label?: string; reason?: string;
  sha256?: string; clips?: string[]; missingClips?: string[]; unsupported?: string[]; scale?: number;
}
export interface TownCharacter { status: CharacterStatus; update(speed: number, dt: number): void; weights?(): { idle: number; walk: number; run: number } }
const sha = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
/** Staging directory: same-origin, lower-case path segments only (lets a smoke test point at a tampered copy). */
export const characterBase = (param: string | null) => param && /^\/[a-z0-9-]+(\/[a-z0-9-]+)*\/$/.test(param) ? param : '/town-characters/';

export async function loadTownCharacter(scene: Scene, figure: Figure, opts: { request: string | null; base: string; shadows?: ShadowGenerator }): Promise<TownCharacter> {
  const capsule = figure.root.getChildMeshes();
  const still: TownCharacter = { status: { state: 'capsule' }, update() {} };
  let manifest: CharacterManifest | null = null;
  if (opts.request !== 'none') {
    try {
      const r = await fetch(opts.base + 'manifest.json', { cache: 'no-store' });
      if (r.ok) {
        const v = validateManifest(await r.json());
        if (!v.ok) return fail(`staged manifest rejected: ${v.errors.slice(0, 3).join('; ')}`);
        manifest = v.manifest!;
      }
    } catch (e) { return fail(`manifest unreadable: ${String(e).slice(0, 120)}`); }
  }
  const pick = resolveRequest(opts.request, manifest);
  if (!pick.id) { if (pick.failed) return fail(pick.reason!); still.status.reason = pick.reason; return still; }
  const entry = manifest!.characters.find(c => c.id === pick.id)!;
  const tag = `char:${entry.id}`;
  let holder: TransformNode | null = null, groups: AnimationGroup[] = [];
  try {
    const r = await fetch(opts.base + entry.file, { cache: 'no-store' }); if (!r.ok) throw Error(`${entry.file}: HTTP ${r.status}`);
    const bytes = await r.arrayBuffer(), mismatch = checkBytes(entry, bytes.byteLength, await sha(bytes)); if (mismatch) throw Error(mismatch);
    const container = await SceneLoader.LoadAssetContainerAsync('', new Uint8Array(bytes), scene, undefined, '.glb');
    const inst = container.instantiateModelsToScene(n => `${tag}.${n}`, false, { doNotInstantiate: true });
    groups = inst.animationGroups; for (const g of groups) g.stop();
    holder = new TransformNode(`${tag}:holder`, scene);
    for (const n of inst.rootNodes) n.parent = holder;
    const meshes = holder.getChildMeshes(false) as AbstractMesh[];
    if (!meshes.some(m => m.getTotalVertices() > 0)) throw Error('model has no geometry');
    holder.computeWorldMatrix(true); for (const m of meshes) { m.computeWorldMatrix(true); m.refreshBoundingInfo({ applySkeleton: true }); }
    const { min, max } = holder.getHierarchyBoundingVectors(true);
    const fit = fitTransform({ minY: min.y, maxY: max.y }, entry.fit.height);
    const byName = new Map(groups.map(g => [g.name.startsWith(`${tag}.`) ? g.name.slice(tag.length + 1) : g.name, g]));
    const wanted = Object.entries(entry.clips) as [keyof CharacterEntry['clips'], string][];
    const missing = wanted.filter(([, n]) => !byName.has(n)).map(([k, n]) => `${k}:${n}`);
    if (!byName.has(entry.clips.idle)) throw Error(`idle clip "${entry.clips.idle}" not in model (has ${[...byName.keys()].slice(0, 8).join(', ')})`);
    const clips = { idle: entry.clips.idle, walk: entry.clips.walk && byName.has(entry.clips.walk) ? entry.clips.walk : undefined, run: entry.clips.run && byName.has(entry.clips.run) ? entry.clips.run : undefined };
    // Only now does the figure change: model under the sim-owned root, capsule hidden.
    holder.parent = figure.root; holder.position.set(0, fit.offsetY, 0); holder.scaling.setAll(fit.scale); holder.rotation.y = entry.fit.yaw;
    for (const m of meshes) { m.isPickable = false; m.receiveShadows = true; m.alwaysSelectAsActiveMesh = true; opts.shadows?.addShadowCaster(m, false); }
    for (const m of capsule) m.setEnabled(false);
    const idle = byName.get(clips.idle)!, walk = clips.walk ? byName.get(clips.walk)! : null, run = clips.run ? byName.get(clips.run)! : null;
    for (const [n, g] of byName) if (g !== idle && g !== walk && g !== run) { g.dispose(); byName.delete(n); }
    for (const g of [idle, walk, run]) if (g) { g.start(true); g.weight = g === idle ? 1 : 0; }
    let w = { idle: 1, walk: 0, run: 0 };
    const status: CharacterStatus = { state: 'model', id: entry.id, kind: entry.kind, label: entry.label, sha256: entry.sha256, clips: [clips.idle, clips.walk, clips.run].filter(Boolean) as string[], missingClips: missing, unsupported: entry.unsupported ?? [], scale: fit.scale };
    console.info('[town] character model', entry.id, entry.kind, `scale ${fit.scale.toFixed(3)}`, missing.length ? `missing ${missing.join(',')}` : 'all clips');
    return {
      status,
      weights: () => ({ ...w }),
      update(speed, dt) {
        const t = locomotionWeights(speed, clips, entry.fit), k = Math.min(1, dt * 10);
        w = { idle: w.idle + (t.idle - w.idle) * k, walk: w.walk + (t.walk - w.walk) * k, run: w.run + (t.run - w.run) * k };
        idle.weight = w.idle; if (walk) { walk.weight = w.walk; walk.speedRatio = t.walkRate; } if (run) { run.weight = w.run; run.speedRatio = t.runRate; }
      },
    };
  } catch (e) {
    for (const g of groups) g.dispose(); holder?.dispose(false, true);
    for (const m of capsule) m.setEnabled(true);
    return fail(String(e instanceof Error ? e.message : e).slice(0, 200), entry);
  }
  function fail(reason: string, e?: CharacterEntry): TownCharacter {
    console.warn('[town] character fallback to capsule:', reason);
    return { status: { state: 'fallback', reason, id: e?.id, kind: e?.kind, label: e?.label }, update() {} };
  }
}
