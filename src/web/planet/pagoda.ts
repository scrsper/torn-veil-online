import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import { loadScannedMaps } from '../render/materials';
import { metreUVs } from './uvs';
import { PAGODA_SHAPE } from '../../sim/world/planet/pagoda';

/** The Tower of Chrysanthus from outside: an ordinary East Asian pagoda. Square plan,
 * stacked storeys that step in as they rise, a deep tiled roof on every storey with
 * upturned eave corners, a balcony rail, and a sōrin finial of stacked rings.
 * Local frame: +Y up, door on the -Z face. Metres. The hundred trial floors are folded
 * interiors (see interiors/floorSpec.ts); the exterior storey count is architectural. */
export interface PagodaOptions { tiers: number; base: number; storey: number; taper: number }
export const PAGODA: PagodaOptions = { tiers: PAGODA_SHAPE.tiers, base: PAGODA_SHAPE.base, storey: PAGODA_SHAPE.storey, taper: PAGODA_SHAPE.taper };
const mat = (scene: Scene, name: string, hex: string, emissive = 0) => {
  const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(hex); m.ambientColor = m.diffuseColor.scale(.9); m.specularColor = new Color3(.08, .08, .08);
  if (emissive) m.emissiveColor = m.diffuseColor.scale(emissive); return m;
};
/** One storey's roof: four tiled ribbons sharing their corner lines, the eave lifting toward each
 * corner; a timber soffit just beneath (rafters seen from below) and a fascia board along the eave. */
function roof(scene: Scene, name: string, inner: number, eave: number, y: number, rise: number, curl: number): { tiles: Mesh; soffit: Mesh; fascia: Mesh } {
  const sheet = (drop: number, k0: number, k1: number, rows: number) => {
    const sides: Mesh[] = [];
    for (let side = 0; side < 4; side++) {
      const paths: Vector3[][] = [];
      for (let t = 0; t <= rows; t++) {
        const k = k0 + (k1 - k0) * t / rows, hs = inner + (eave - inner) * k, path: Vector3[] = [];
        for (let s = -10; s <= 10; s++) {
          const u = s / 10, lift = curl * Math.pow(k, 2.2) * Math.pow(Math.abs(u), 6);
          // Concave sweep: steep near the ridge, flattening to the eave.
          const yy = y + rise * Math.pow(1 - k, 1.6) + lift - drop * t / rows, a = u * hs, b = hs;
          path.push([new Vector3(a, yy, b), new Vector3(b, yy, -a), new Vector3(-a, yy, -b), new Vector3(-b, yy, a)][side]);
        }
        paths.push(path);
      }
      sides.push(MeshBuilder.CreateRibbon(`${name}:${side}`, { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, scene));
    }
    return Mesh.MergeMeshes(sides, true, true)!;
  };
  const tiles = sheet(0, 0, 1, 8), soffit = sheet(0, 0, 1, 8);
  soffit.position.y = -.32;
  // Fascia: the eave line itself, dropped 0.45 m (two rows at k = 1).
  const fascia = sheet(.45, 1, 1, 1);
  return { tiles, soffit, fascia };
}
/** Scanned CC0 surface (repo textures/world) on a pagoda material: albedo tinted to the old flat colour, plus its normal map. */
function scanned(scene: Scene, m: StandardMaterial, surface: string, tint: [number, number, number]) {
  const maps = loadScannedMaps(scene, surface); m.diffuseTexture = maps.albedo; m.bumpTexture = maps.normal; m.invertNormalMapY = true;
  m.diffuseColor = new Color3(...tint); m.ambientColor = m.diffuseColor.scale(.9);
}
export function buildPagoda(scene: Scene, parent: TransformNode, o: PagodaOptions = PAGODA) {
  const red = mat(scene, 'pagoda-vermilion', '#a5372b'), tile = mat(scene, 'pagoda-tile', '#2e3638'), wood = mat(scene, 'pagoda-timber', '#5a3424'),
    plaster = mat(scene, 'pagoda-plaster', '#e6dcc7'), stone = mat(scene, 'pagoda-stone', '#8d877c'), gold = mat(scene, 'pagoda-gold', '#c9a043', .15),
    lamp = mat(scene, 'pagoda-lantern', '#3a2418'), door = mat(scene, 'pagoda-door', '#120c09');
  gold.specularColor = new Color3(.6, .5, .25); gold.specularPower = 48;
  // Cut stone, lime plaster, slate tiles and weathered timber from the scanned set; vermilion lacquer and gilt stay plain.
  scanned(scene, stone, 'cobblestone_floor_08', [.97, .95, .9]); scanned(scene, plaster, 'plastered_wall', [1.4, 1.27, 1.06]);
  // Lime plaster in the eaves' shade takes warm bounce from the podium and ground, not only the blue zenith fill.
  plaster.ambientColor = new Color3(1.9, 1.62, 1.18);
  scanned(scene, tile, 'roof_slates_02', [.62, .67, .7]); scanned(scene, wood, 'weathered_planks', [1.1, .76, .6]);
  const tileSize = new Map<StandardMaterial, number>([[stone, 2.5], [plaster, 3], [tile, 2], [wood, 2]]);
  const meshes: Mesh[] = [], add = (m: Mesh, material: StandardMaterial) => { m.material = material; m.parent = parent; meshes.push(m); return m; };
  // Two-step stone podium and a stair to the door.
  const [outer, inner] = PAGODA_SHAPE.podium;
  add(MeshBuilder.CreateBox('pagoda-podium-1', { width: outer * 2, depth: outer * 2, height: 1.2 }, scene), stone).position.y = .6;
  add(MeshBuilder.CreateBox('pagoda-podium-2', { width: inner * 2, depth: inner * 2, height: 1.2 }, scene), stone).position.y = 1.8;
  { const landing = add(MeshBuilder.CreateBox('pagoda-landing', { width: PAGODA_SHAPE.stairWidth, depth: outer - inner, height: 2.4 }, scene), stone); landing.position.set(0, 1.2, -(outer + inner) / 2); }
  for (let s = 0; s < 4; s++) { const st = add(MeshBuilder.CreateBox(`pagoda-stair-${s}`, { width: PAGODA_SHAPE.stairWidth, depth: 1.2, height: .6 * (s + 1) }, scene), stone); st.position.set(0, .3 * (s + 1), -outer - 4.8 + .6 + s * 1.2); }
  let y = 2.4;
  for (let i = 0; i < o.tiers; i++) {
    const w = o.base * (1 - o.taper * i), h = i === 0 ? o.storey * 1.4 : o.storey, wall = w * .78;
    // Storey body: white plaster walls framed by vermilion posts, a vermilion sill and a timber lintel.
    const body = add(MeshBuilder.CreateBox(`pagoda-body-${i}`, { width: wall, depth: wall, height: h }, scene), plaster); body.position.y = y + h / 2;
    const sill = add(MeshBuilder.CreateBox(`pagoda-sill-${i}`, { width: wall + .3, depth: wall + .3, height: .5 }, scene), red); sill.position.y = y + .25;
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1 / 3, 1], [-1 / 3, 1], [1 / 3, -1], [-1 / 3, -1], [1, 1 / 3], [1, -1 / 3], [-1, 1 / 3], [-1, -1 / 3]]) {
      const post = add(MeshBuilder.CreateCylinder(`pagoda-post-${i}-${px}-${pz}`, { diameter: .6, height: h, tessellation: 10 }, scene), red);
      post.position.set(px * wall / 2, y + h / 2, pz * wall / 2);
    }
    const lintel = add(MeshBuilder.CreateBox(`pagoda-lintel-${i}`, { width: wall + .9, depth: wall + .9, height: .6 }, scene), red); lintel.position.y = y + h - .3;
    // Balcony deck and rail from the second storey up.
    if (i > 0) {
      const deck = add(MeshBuilder.CreateBox(`pagoda-deck-${i}`, { width: wall + 2.6, depth: wall + 2.6, height: .35 }, scene), wood); deck.position.y = y + .18;
      for (const [rx, rz, rw, rd] of [[0, 1, 1, 0], [0, -1, 1, 0], [1, 0, 0, 1], [-1, 0, 0, 1]]) {
        const rail = add(MeshBuilder.CreateBox(`pagoda-rail-${i}-${rx}-${rz}`, { width: rw ? wall + 2.6 : .15, depth: rd ? wall + 2.6 : .15, height: .9 }, scene), red);
        rail.position.set(rx * (wall + 2.5) / 2, y + .8, rz * (wall + 2.5) / 2);
      }
    }
    // Door on the ground storey; above, a latticed panel door in the middle bay of every face,
    // dark timber by day and lit from within after dusk.
    if (i === 0) { const d = add(MeshBuilder.CreatePlane('pagoda-door', { width: PAGODA_SHAPE.doorWidth, height: 5 }, scene), door); d.position.set(0, y + 2.5, -wall / 2 - .02); d.rotation.y = Math.PI; }
    else for (const f of [0, 1, 2, 3]) {
      const a = f * Math.PI / 2, pw = wall / 3 - .7, ph = h * .62, out = wall / 2 + .03;
      const win = add(MeshBuilder.CreatePlane(`pagoda-window-${i}-${f}`, { width: pw, height: ph }, scene), lamp);
      win.position.set(Math.sin(a) * out, y + .5 + ph / 2 + .2, Math.cos(a) * out); win.rotation.y = a + Math.PI;
      for (let b = 1; b < 4; b++) {
        const bar = add(MeshBuilder.CreatePlane(`pagoda-lattice-${i}-${f}-${b}`, { width: .12, height: ph }, scene), red), off = (b / 4 - .5) * pw;
        bar.position.set(Math.sin(a) * (out + .02) + Math.cos(a) * off, y + .5 + ph / 2 + .2, Math.cos(a) * (out + .02) - Math.sin(a) * off); bar.rotation.y = a + Math.PI;
      }
    }
    y += h;
    // Bracket band, then the roof: deep overhang, rise, corner curl; timber soffit and fascia.
    const band = add(MeshBuilder.CreateBox(`pagoda-bracket-${i}`, { width: wall + 1.8, depth: wall + 1.8, height: .9 }, scene), wood); band.position.y = y + .25;
    const eave = w / 2 + 4.4 - i * .16, rise = 2.5, curl = 2.1, rf = roof(scene, `pagoda-roof-${i}`, wall / 2 - .3, eave, y + .7, rise, curl);
    add(rf.tiles, tile).receiveShadows = true; add(rf.soffit, wood); add(rf.fascia, wood);
    // Bells hang from the four upturned corners.
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const bell = add(MeshBuilder.CreateCylinder(`pagoda-bell-${i}-${cx}-${cz}`, { diameterTop: .12, diameterBottom: .45, height: .6, tessellation: 8 }, scene), gold);
      bell.position.set(cx * (eave - .15), y + .7 + curl - .9, cz * (eave - .15));
    }
    y += .7 + rise * .55;
  }
  // Sōrin: base, nine rings, water flame and jewel.
  const top = o.base * (1 - o.taper * (o.tiers - 1)) * .78;
  const cap = add(MeshBuilder.CreateBox('pagoda-cap', { width: top * .6, depth: top * .6, height: 1.2 }, scene), tile); cap.position.y = y + .6; y += 1.2;
  const mast = add(MeshBuilder.CreateCylinder('pagoda-mast', { diameter: .45, height: 13, tessellation: 12 }, scene), gold); mast.position.y = y + 6.5;
  for (let k = 0; k < 9; k++) { const ring = add(MeshBuilder.CreateTorus(`pagoda-ring-${k}`, { diameter: 2.2 - k * .1, thickness: .22, tessellation: 20 }, scene), gold); ring.position.y = y + 2 + k * 1.05; }
  const jewel = add(MeshBuilder.CreateSphere('pagoda-jewel', { diameter: 1.1, segments: 10 }, scene), gold); jewel.position.y = y + 13.3;
  for (const m of meshes) { const t = tileSize.get(m.material as StandardMaterial); if (t) metreUVs(m, t); }
  return { meshes, lamp, height: y + 14, door: new Vector3(0, 2.4, -(o.base * .78) / 2), footprint: outer * 2 };
}
