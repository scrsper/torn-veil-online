import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import { deriveConstructionPresentation, type ConstructionPresentation, type ConstructionStage } from './constructionProjector';

/**
 * ConstructionRenderer — the dedicated semantic renderer for construction (spec §11), separate
 * from the generic voxel mesher. It consumes `ConstructionPresentation` (derived fresh from
 * canonical `ConstructionProject` state every `update()`) and turns it into cheap low-poly
 * geometry: site stakes, material piles, a skeletal foundation/frame/walls/roof progression.
 *
 * Performance (spec §12): geometry is only rebuilt when a project's derived SIGNATURE (stage +
 * per-type material bucket) changes — not every frame. A project that finishes materializing
 * (`ConstructionProject.status === 'complete'`) or is cancelled has its group disposed and
 * removed here; the canonical finished structure already exists as real voxel blocks (see
 * `materializeStructure` in sim/world/construction.ts) by the time that happens, so no
 * duplicate stage geometry survives completion (spec §10/§22.9).
 */
const materialCache = new Map<number, THREE.MeshLambertMaterial>();
function matFor(color: number): THREE.MeshLambertMaterial {
  let m = materialCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); materialCache.set(color, m); }
  return m;
}
function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matFor(color));
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

const PILE_COLORS: Record<string, number> = { log: 0x6a4a28, plank: 0x9a7040, stone: 0x8a8880 };
const STAKE_COLOR = 0x7a5a34;
const FOUNDATION_COLOR = 0x8a8880;
const FRAME_COLOR = 0x9a7040;
const WALL_COLOR = 0xc8a878;
const ROOF_COLOR = 0x6a4a3a;

const STAGE_RANK: Record<ConstructionStage, number> = { site: 0, materials: 1, foundation: 2, frame: 3, walls: 4, roof: 5, complete: 6 };

function buildSiteGroup(p: ConstructionPresentation): THREE.Group {
  const g = new THREE.Group(); g.name = `construction-${p.projectId}`;
  const b = p.siteBounds; const rank = STAGE_RANK[p.stage];
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, y0 = b.y0;
  const width = b.x1 - b.x0 + 1, depth = b.z1 - b.z0 + 1;
  const wallH = 3;

  // SITE: footprint stakes at the corners — visible from `site` all the way to `roof`.
  for (const [sx, sz] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]] as const) {
    g.add(box(0.12, 1.1, 0.12, STAKE_COLOR, sx + 0.5, y0 + 0.55, sz + 0.5));
  }

  // MATERIALS: a low-detail pile per delivered type, sized by its bucket — derived, not
  // canonical stock (spec §9: "visual material piles are derived representations only").
  let pileIndex = 0;
  for (const m of p.materials) {
    if (m.delivered <= 0) continue;
    const count = m.bucket === 'many' ? 3 : 1;
    const color = PILE_COLORS[m.type] ?? 0x9a8060;
    const px = b.x0 - 1.2, pz = b.z0 + 1 + pileIndex * 1.4;
    for (let n = 0; n < count; n++) g.add(box(0.7, 0.45, 0.7, color, px, y0 + 0.25 + n * 0.3, pz + (n % 2) * 0.2));
    pileIndex++;
  }

  // FOUNDATION: low perimeter footing.
  if (rank >= STAGE_RANK.foundation) {
    g.add(box(width, 0.4, 0.5, FOUNDATION_COLOR, cx, y0 + 0.2, b.z0 + 0.25));
    g.add(box(width, 0.4, 0.5, FOUNDATION_COLOR, cx, y0 + 0.2, b.z1 + 0.75));
    g.add(box(0.5, 0.4, depth, FOUNDATION_COLOR, b.x0 + 0.25, y0 + 0.2, cz));
    g.add(box(0.5, 0.4, depth, FOUNDATION_COLOR, b.x1 + 0.75, y0 + 0.2, cz));
  }

  // FRAME: corner posts + top beams — a skeleton, deliberately not solid walls.
  if (rank >= STAGE_RANK.frame) {
    for (const [sx, sz] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]] as const) {
      g.add(box(0.25, wallH, 0.25, FRAME_COLOR, sx + 0.5, y0 + wallH / 2 + 0.4, sz + 0.5));
    }
    const topY = y0 + wallH + 0.4;
    g.add(box(width, 0.25, 0.25, FRAME_COLOR, cx, topY, b.z0 + 0.5));
    g.add(box(width, 0.25, 0.25, FRAME_COLOR, cx, topY, b.z1 + 0.5));
    g.add(box(0.25, 0.25, depth, FRAME_COLOR, b.x0 + 0.5, topY, cz));
    g.add(box(0.25, 0.25, depth, FRAME_COLOR, b.x1 + 0.5, topY, cz));
  }

  // WALLS: partial panels between the posts.
  if (rank >= STAGE_RANK.walls) {
    const wallY = y0 + wallH * 0.55 + 0.4;
    g.add(box(width - 0.4, wallH * 0.7, 0.15, WALL_COLOR, cx, wallY, b.z0 + 0.55));
    g.add(box(width - 0.4, wallH * 0.7, 0.15, WALL_COLOR, cx, wallY, b.z1 + 0.45));
    g.add(box(0.15, wallH * 0.7, depth - 0.4, WALL_COLOR, b.x0 + 0.55, wallY, cz));
    g.add(box(0.15, wallH * 0.7, depth - 0.4, WALL_COLOR, b.x1 + 0.45, wallY, cz));
  }

  // ROOF: exposed ridge + rafters, clearly above the frame's own top beam so it reads as a
  // distinct stage rather than overlapping it from a straight-on view.
  if (rank >= STAGE_RANK.roof) {
    const ridgeY = y0 + wallH + 1.3;
    g.add(box(width + 0.5, 0.22, 0.22, ROOF_COLOR, cx, ridgeY, cz)); // ridge beam, lengthwise
    const rafters = 4;
    for (let i = 0; i < rafters; i++) {
      const t = (i + 0.5) / rafters;
      g.add(box(0.18, 0.18, depth + 0.3, ROOF_COLOR, b.x0 + 0.5 + t * width, ridgeY - 0.35, cz));
    }
  }

  return g;
}

function signatureFor(p: ConstructionPresentation): string {
  return `${p.stage}|${p.materials.map(m => `${m.type}:${m.bucket}`).join(',')}`;
}

interface Cached { group: THREE.Group; signature: string; }

export class ConstructionRenderer {
  group = new THREE.Group();
  private cache = new Map<string, Cached>();
  constructor(private world: World) { this.group.name = 'construction-projection'; }

  /** Derives every active project's presentation and rebuilds only what changed. Safe to call
   * every frame — a project whose signature hasn't changed since the last call is untouched. */
  update(): void {
    const seen = new Set<string>();
    for (const project of this.world.constructionProjects) {
      if (project.status === 'complete' || project.status === 'cancelled') { this.retire(project.id); continue; }
      seen.add(project.id);
      const presentation = deriveConstructionPresentation(this.world, project);
      const signature = signatureFor(presentation);
      const cached = this.cache.get(project.id);
      if (cached && cached.signature === signature) continue;
      if (cached) this.retire(project.id);
      const g = buildSiteGroup(presentation);
      this.group.add(g);
      this.cache.set(project.id, { group: g, signature });
    }
    for (const id of [...this.cache.keys()]) if (!seen.has(id)) this.retire(id);
  }

  private retire(projectId: string): void {
    const cached = this.cache.get(projectId); if (!cached) return;
    cached.group.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.geometry) mesh.geometry.dispose(); });
    this.group.remove(cached.group);
    this.cache.delete(projectId);
  }
}
