import { Color3, Mesh, MeshBuilder, StandardMaterial, type Material, type Scene } from '@babylonjs/core';
import type { InteriorPlan } from '../../sim/world/interiors/layout';
import { metreUVs } from './uvs';

/** The timber frame of a pagoda storey around a survey floor: a plank ceiling on cross beams
 * at the perimeter wall crown, vermilion posts at every partition end and along the outer walls,
 * dark cap rails on the partitions, and a steep ladder stair (hashigo-dan, as in real pagoda
 * storeys) up through a lit stairwell above the plan's stair. Presentation only: every piece sits
 * inside a solid the plan already owns or above head height, so no route narrows and the
 * walker's voxel test is unchanged. The ceiling is hidden in the overview. */
export interface StoreyFrame { meshes: Mesh[]; overhead: Mesh[] }
export const STOREY_CEILING = 7;
export function buildStoreyFrame(s: Scene, plan: InteriorPlan, planks: Material, torch: [number, number, number]): StoreyFrame {
  const o = plan.origin, h = plan.half, top = STOREY_CEILING, ex = plan.exit;
  const std = (name: string, hex: string, e = 0) => { const m = new StandardMaterial(name, s); m.diffuseColor = Color3.FromHexString(hex); m.specularColor = new Color3(.05, .05, .05); if (e) m.emissiveColor = m.diffuseColor.scale(e); return m; };
  const lacquer = std('storey-lacquer', '#7a2a1f'), timber = std('storey-timber', '#3b2619');
  const parts = new Map<Material, Mesh[]>(), over = new Map<Material, Mesh[]>();
  const box = (to: Map<Material, Mesh[]>, m: Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uv = 0) => {
    const b = MeshBuilder.CreateBox('storey-part', { width: x1 - x0, height: y1 - y0, depth: z1 - z0 }, s); b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (uv) metreUVs(b, uv); (to.get(m) ?? to.set(m, []).get(m)!).push(b); return b;
  };
  // Stairwell: an opening over the stair flight (which climbs against the wall behind the stair disc).
  const hx0 = ex.x - 1.4, hx1 = ex.x + 1.4, hz0 = ex.z - 3.5, hz1 = ex.z - .9, x0 = o.x - h, x1 = o.x + h, z0 = o.z - h, z1 = o.z + h;
  // Plank ceiling in four pieces around the opening, on cross beams every 3 m (none across the opening).
  for (const [a, b, c, d] of [[x0, z0, x1, hz0], [x0, hz1, x1, z1], [x0, hz0, hx0, hz1], [hx1, hz0, x1, hz1]]) if (c > a && d > b) box(over, planks, a, top, b, c, top + .12, d, 2.5);
  for (let z = z0 + 1.5; z < z1 - 1; z += 3) {
    if (z > hz0 - .3 && z < hz1 + .3) { box(over, timber, x0, top - .42, z - .17, hx0, top, z + .17); box(over, timber, hx1, top - .42, z - .17, x1, top, z + .17); continue; }
    box(over, timber, x0, top - .42, z - .17, x1, top, z + .17);
  }
  // Well walls up to the lit storey above, and its warm glow.
  for (const [a, b, c, d] of [[hx0 - .1, hz0 - .1, hx1 + .1, hz0], [hx0 - .1, hz1, hx1 + .1, hz1 + .1], [hx0 - .1, hz0, hx0, hz1], [hx1, hz0, hx1 + .1, hz1]]) box(over, timber, a, top, b, c, top + 2.2, d);
  const glow = std('storey-glow', '#000000'); glow.emissiveColor = new Color3(...torch).scale(.55); glow.disableLighting = true;
  box(over, glow, hx0, top + 2.2, hz0, hx1, top + 2.3, hz1);
  // Ladder stair: ten treads rising 0.55 m over 2.4 m, between two stringers, against the wall.
  const run = 2.4, rise = 5.75, n = 10, sw = 1.9, zFoot = ex.z - 1.05;
  for (let k = 0; k < n; k++) { const zz = zFoot - (k + .5) * run / n, y = 1 + (k + 1) * rise / (n + 1); box(parts, planks, ex.x - sw / 2, y - .05, zz - .16, ex.x + sw / 2, y + .05, zz + .16, 1.2); }
  const len = Math.hypot(run, rise);
  for (const side of [-1, 1]) {
    // Stringer: a beam along the flight's slope (its +y axis tipped back toward the wall).
    const st = box(parts, timber, -.06, -len / 2, -.14, .06, len / 2, .14); st.position.set(ex.x + side * (sw / 2 + .06), 1 + rise / 2, zFoot - run / 2); st.rotation.x = -Math.atan2(run, rise);
    box(parts, lacquer, ex.x + side * (sw / 2 + .2) - .12, 1, zFoot - .12, ex.x + side * (sw / 2 + .2) + .12, 2.15, zFoot + .12);
  }
  // Posts and cap rails on the partitions (inside their footprint, flush with the faces).
  for (const w of plan.solids) {
    if (!w.id.includes(':partition:')) continue;
    const yTop = w.y + w.h; box(parts, timber, w.x - .03, yTop, w.z - .03, w.x + w.w + .03, yTop + .14, w.z + w.d + .03);
    if (w.w >= w.d) for (const px of [w.x, w.x + w.w - .5]) box(parts, lacquer, px, w.y, w.z - .02, px + .5, top - .42, w.z + w.d + .02);
    else for (const pz of [w.z, w.z + w.d - .5]) box(parts, lacquer, w.x - .02, w.y, pz, w.x + w.w + .02, top - .42, pz + .5);
  }
  // Posts along the outer walls every 6 m, 8 cm proud of the inner faces, and a timber plinth.
  for (let t = 0; t <= 2 * h + .01; t += 6) {
    const a = Math.min(x0 + t, x1 - .5), c = Math.min(z0 + t, z1 - .5);
    if (a + .5 < hx0 - .3 || a > hx1 + .3) box(parts, lacquer, a, 1, z0 - .2, a + .5, top, z0 + .08); box(parts, lacquer, a, 1, z1 - .08, a + .5, top, z1 + .2);
    box(parts, lacquer, x0 - .2, 1, c, x0 + .08, top, c + .5); box(parts, lacquer, x1 - .08, 1, c, x1 + .2, top, c + .5);
  }
  for (const [a, b, c, d] of [[x0, z0 - .1, x1, z0 + .04], [x0, z1 - .04, x1, z1 + .1], [x0 - .1, z0, x0 + .04, z1], [x1 - .04, z0, x1 + .1, z1]]) box(parts, timber, a, 1, b, c, 1.28, d);
  const merge = (groups: Map<Material, Mesh[]>, tag: string) => [...groups].map(([m, list], i) => { const g = Mesh.MergeMeshes(list, true, true)!; g.name = `storey-${tag}-${i}`; g.material = m; return g; });
  const meshes = merge(parts, 'frame'), overhead = merge(over, 'ceiling');
  meshes[0].onDisposeObservable.addOnce(() => { for (const m of [lacquer, timber, glow]) m.dispose(); });
  return { meshes, overhead };
}
