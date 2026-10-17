import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core';

/** The Tower of Chrysanthus from outside: an ordinary East Asian pagoda. Square plan,
 * stacked storeys that step in as they rise, a deep tiled roof on every storey with
 * upturned eave corners, a balcony rail, and a sōrin finial of stacked rings.
 * Local frame: +Y up, door on the -Z face. Metres. The hundred trial floors are folded
 * interiors (see interiors/floorSpec.ts); the exterior storey count is architectural. */
export interface PagodaOptions { tiers: number; base: number; storey: number; taper: number }
export const PAGODA: PagodaOptions = { tiers: 9, base: 22, storey: 6.4, taper: .072 };
const mat = (scene: Scene, name: string, hex: string, emissive = 0) => {
  const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(hex); m.specularColor = new Color3(.08, .08, .08);
  if (emissive) m.emissiveColor = m.diffuseColor.scale(emissive); return m;
};
/** One storey's roof: four ribbons sharing their corner lines; the eave lifts toward each corner. */
function roof(scene: Scene, name: string, inner: number, eave: number, y: number, rise: number, curl: number): Mesh {
  const sides: Mesh[] = [];
  for (let side = 0; side < 4; side++) {
    const paths: Vector3[][] = [];
    for (let t = 0; t <= 8; t++) {
      const k = t / 8, hs = inner + (eave - inner) * k, path: Vector3[] = [];
      for (let s = -10; s <= 10; s++) {
        const u = s / 10, lift = curl * Math.pow(k, 2.2) * Math.pow(Math.abs(u), 6);
        // Concave sweep: steep near the ridge, flattening to the eave.
        const yy = y + rise * Math.pow(1 - k, 1.6) + lift, a = u * hs, b = hs;
        const p = [new Vector3(a, yy, b), new Vector3(b, yy, -a), new Vector3(-a, yy, -b), new Vector3(-b, yy, a)][side];
        path.push(p);
      }
      paths.push(path);
    }
    sides.push(MeshBuilder.CreateRibbon(`${name}:${side}`, { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, scene));
  }
  return Mesh.MergeMeshes(sides, true, true)!;
}
export function buildPagoda(scene: Scene, parent: TransformNode, o: PagodaOptions = PAGODA) {
  const red = mat(scene, 'pagoda-vermilion', '#a5372b'), tile = mat(scene, 'pagoda-tile', '#2e3638'), wood = mat(scene, 'pagoda-timber', '#5a3424'),
    plaster = mat(scene, 'pagoda-plaster', '#e6dcc7'), stone = mat(scene, 'pagoda-stone', '#8d877c'), gold = mat(scene, 'pagoda-gold', '#c9a043', .15),
    lamp = mat(scene, 'pagoda-lantern', '#ffb35a', .9), door = mat(scene, 'pagoda-door', '#120c09');
  gold.specularColor = new Color3(.6, .5, .25); gold.specularPower = 48;
  const meshes: Mesh[] = [], add = (m: Mesh, material: StandardMaterial) => { m.material = material; m.parent = parent; meshes.push(m); return m; };
  // Two-step stone podium and a stair to the door.
  add(MeshBuilder.CreateBox('pagoda-podium-1', { width: o.base + 10, depth: o.base + 10, height: 1.2 }, scene), stone).position.y = .6;
  add(MeshBuilder.CreateBox('pagoda-podium-2', { width: o.base + 5, depth: o.base + 5, height: 1.2 }, scene), stone).position.y = 1.8;
  for (let s = 0; s < 4; s++) { const st = add(MeshBuilder.CreateBox(`pagoda-stair-${s}`, { width: 6, depth: 1.2, height: .6 }, scene), stone); st.position.set(0, .3 + s * .6, -(o.base + 10) / 2 - 2.4 + s * 1.2); }
  let y = 2.4;
  for (let i = 0; i < o.tiers; i++) {
    const w = o.base * (1 - o.taper * i), h = i === 0 ? o.storey * 1.25 : o.storey, wall = w * .78;
    // Storey body: plaster walls framed by vermilion posts and a timber lintel.
    const body = add(MeshBuilder.CreateBox(`pagoda-body-${i}`, { width: wall, depth: wall, height: h }, scene), i % 2 ? plaster : red); body.position.y = y + h / 2;
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const post = add(MeshBuilder.CreateCylinder(`pagoda-post-${i}-${px}-${pz}`, { diameter: .7, height: h, tessellation: 10 }, scene), red);
      post.position.set(px * wall / 2, y + h / 2, pz * wall / 2);
    }
    const lintel = add(MeshBuilder.CreateBox(`pagoda-lintel-${i}`, { width: wall + .9, depth: wall + .9, height: .7 }, scene), wood); lintel.position.y = y + h - .35;
    // Balcony deck and rail from the second storey up.
    if (i > 0) {
      const deck = add(MeshBuilder.CreateBox(`pagoda-deck-${i}`, { width: wall + 2.6, depth: wall + 2.6, height: .35 }, scene), wood); deck.position.y = y + .18;
      for (const [rx, rz, rw, rd] of [[0, 1, 1, 0], [0, -1, 1, 0], [1, 0, 0, 1], [-1, 0, 0, 1]]) {
        const rail = add(MeshBuilder.CreateBox(`pagoda-rail-${i}-${rx}-${rz}`, { width: rw ? wall + 2.6 : .15, depth: rd ? wall + 2.6 : .15, height: 1 }, scene), red);
        rail.position.set(rx * (wall + 2.5) / 2, y + .85, rz * (wall + 2.5) / 2);
      }
    }
    // Door on the ground storey; latticed windows above, lit from within.
    if (i === 0) { const d = add(MeshBuilder.CreatePlane('pagoda-door', { width: 3.6, height: 5 }, scene), door); d.position.set(0, y + 2.5, -wall / 2 - .02); d.rotation.y = Math.PI; }
    else for (const f of [0, 1, 2, 3]) {
      const win = add(MeshBuilder.CreatePlane(`pagoda-window-${i}-${f}`, { width: wall * .32, height: h * .42 }, scene), lamp);
      const a = f * Math.PI / 2; win.position.set(Math.sin(a) * (wall / 2 + .02), y + h * .52, Math.cos(a) * (wall / 2 + .02)); win.rotation.y = a;
    }
    y += h;
    // Roof with brackets: deep overhang, rise, corner curl. Underside timber band.
    const eave = w / 2 + 3.2 - i * .12, r = add(roof(scene, `pagoda-roof-${i}`, wall / 2 - .3, eave, y, 2.2 + i * .05, 1.6), tile);
    r.receiveShadows = true;
    const band = add(MeshBuilder.CreateBox(`pagoda-bracket-${i}`, { width: wall + 1.6, depth: wall + 1.6, height: .9 }, scene), wood); band.position.y = y - .2;
    // Bells at the four upturned corners.
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const bell = add(MeshBuilder.CreateCylinder(`pagoda-bell-${i}-${cx}-${cz}`, { diameterTop: .12, diameterBottom: .45, height: .6, tessellation: 8 }, scene), gold);
      bell.position.set(cx * (eave - .1), y + 1.6 * .95 - .6, cz * (eave - .1));
    }
    y += 1.4;
  }
  // Sōrin: base, nine rings, water flame and jewel.
  const top = o.base * (1 - o.taper * (o.tiers - 1)) * .78;
  const cap = add(MeshBuilder.CreateBox('pagoda-cap', { width: top * .6, depth: top * .6, height: 1.2 }, scene), tile); cap.position.y = y + .6; y += 1.2;
  const mast = add(MeshBuilder.CreateCylinder('pagoda-mast', { diameter: .45, height: 13, tessellation: 12 }, scene), gold); mast.position.y = y + 6.5;
  for (let k = 0; k < 9; k++) { const ring = add(MeshBuilder.CreateTorus(`pagoda-ring-${k}`, { diameter: 2.2 - k * .1, thickness: .22, tessellation: 20 }, scene), gold); ring.position.y = y + 2 + k * 1.05; }
  const jewel = add(MeshBuilder.CreateSphere('pagoda-jewel', { diameter: 1.1, segments: 10 }, scene), gold); jewel.position.y = y + 13.3;
  return { meshes, height: y + 14, door: new Vector3(0, 2.4, -(o.base * .78) / 2), footprint: o.base + 10 };
}
