import { Matrix, Quaternion, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import { Kit, Parts, type MatKey } from './kit';
import type { Prop, PropKind } from '../../sim/town/layout';

/** Procedural town dressing from the plan. One-off structures (houses, wall runs, towers,
 * fences) are built in place and merged per material; repeated props are templates drawn
 * with thin instances. Everything here is presentation; collision is the plan's. */
export interface BuiltProps { meshes: Mesh[]; casters: Mesh[]; lamps: Vector3[]; windows: Mesh[] }
const CLOTH: MatKey[] = ['clothRed', 'clothOchre', 'clothBlue', 'clothGreen', 'clothCream'];
const FLOWERS: MatKey[] = ['flowerRed', 'flowerYellow', 'flowerWhite', 'flowerPurple'];

function house(P: Parts, p: Prop) {
  const w = p.w!, d = p.d!, h = p.h!, v = p.v, base = .45, upper = h > 5;
  const wall: MatKey = v % 3 === 0 ? 'plasterWarm' : 'plaster', roof: MatKey = v % 4 === 1 ? 'roofSlate' : v % 4 === 3 ? 'thatch' : 'roofTerracotta';
  P.box('stoneDark', 0, 0, 0, w + .3, base, d + .3);
  P.box(wall, 0, base, 0, w, h - base, d);
  // Timber frame: corner posts, a floor beam, upper-storey studs and braces.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P.box('darkTimber', sx * (w / 2 - .02), base, sz * (d / 2 - .02), .28, h - base, .28);
  const beam = 2.9;
  if (upper) {
    P.box('darkTimber', 0, beam, d / 2 + .02, w + .1, .26, .14); P.box('darkTimber', 0, beam, -d / 2 - .02, w + .1, .26, .14);
    P.box('darkTimber', w / 2 + .02, beam, 0, .14, .26, d + .1); P.box('darkTimber', -w / 2 - .02, beam, 0, .14, .26, d + .1);
    for (let x = -w / 2 + 1.5; x < w / 2 - .8; x += 1.5) for (const sz of [1, -1]) P.box('darkTimber', x, beam + .26, sz * (d / 2 + .03), .16, h - beam - .26, .1);
    for (const sx of [-1, 1]) P.box('darkTimber', sx * (w / 2 - .9), beam + .3, d / 2 + .05, .14, (h - beam) * 1.05, .08, 0, 2, 0, sx * .62);
  }
  P.box('darkTimber', 0, h - .05, d / 2 + .02, w + .1, .22, .14); P.box('darkTimber', 0, h - .05, -d / 2 - .02, w + .1, .22, .14);
  // Door with frame and step on the front (+z) face; windows with shutters on front and sides.
  P.box('stone', 0, 0, d / 2 + .45, 1.8, .2, .8);
  P.box('darkTimber', 0, base, d / 2 + .04, 1.25, 2.2, .1); P.box('timber', 0, base + 2.2, d / 2 + .08, 1.6, .2, .16);
  P.box('iron', .4, base + 1.05, d / 2 + .1, .1, .1, .06);
  const win = (x: number, y: number, z: number, yaw: number) => {
    P.box('window', x, y, z, 1, 1.1, .06, yaw);
    P.box('timber', x, y - .12, z, 1.3, .12, .2, yaw);
    const sx = Math.cos(yaw), sz = -Math.sin(yaw);
    for (const s of [-1, 1]) P.box(v % 2 ? 'clothBlue' : 'darkTimber', x + s * .72 * sx, y, z + s * .72 * sz, .42, 1.1, .05, yaw);
  };
  for (const x of w > 7.5 ? [-w / 2 + 1.6, w / 2 - 1.6] : [w / 2 - 1.5]) win(x, base + 1, d / 2 + .04, 0);
  if (upper) for (const x of [-w / 4, w / 4]) win(x, beam + .7, d / 2 + .04, 0);
  for (const s of [-1, 1]) win(s * (w / 2 + .04), base + 1, 0, Math.PI / 2);
  P.gable(roof, 0, h, 0, w, d, Math.min(3.4, d * .5), 0, .6);
  if (v % 2 === 0) P.box('stone', w / 2 - 1.2, h, -d / 4, .8, Math.min(3.4, d * .5) + .9, .8);
  if (v % 3 === 1) { P.box('timber', 0, base + 2.55, d / 2 + .7, w * .45, .08, 1.2, 0, 2, -.25); for (const s of [-1, 1]) P.box('darkTimber', s * w * .2, base, d / 2 + 1.2, .1, 2.5, .1); }
}
function wallSeg(P: Parts, p: Prop) {
  const t = p.w!, l = p.d!, h = p.h!;
  P.box('stone', 0, -.4, 0, t, h + .4, l, 0, 2.5);
  P.box('stoneDark', 0, -.4, 0, t + .3, .9, l + .02, 0, 2.5);
  for (let z = -l / 2 + .5; z < l / 2 - .3; z += 1.6) for (const s of [-1, 1]) P.box('stone', s * (t / 2 - .2), h, z + .4, .4, .7, .8, 0, 2.5);
}
function tower(P: Parts, p: Prop) {
  const w = p.w!, h = p.h!;
  P.box('stoneDark', 0, -.5, 0, w + .6, 1.4, w + .6, 0, 2.5); P.box('stone', 0, -.5, 0, w, h + .5, w, 0, 2.5);
  P.box('stone', 0, h, 0, w + .5, .4, w + .5, 0, 2.5);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const a = i * Math.PI / 2; P.box('stone', Math.sin(a) * (w / 2) + Math.cos(a) * s * w / 4, h + .4, Math.cos(a) * (w / 2) - Math.sin(a) * s * w / 4, .9, .8, .9, a, 2.5); }
  const r = P.cyl('roofTerracotta', 0, h + .4, 0, 3.8, .05, w * 1.35, 4); r.rotation.y = Math.PI / 4; r.bakeCurrentTransformIntoVertices();
  for (const s of [-1, 1]) P.box('window', s * (w / 2 + .01), h * .6, 0, .02, 1, .35);
}
function fence(P: Parts, p: Prop) {
  const l = p.d!; for (let z = -l / 2; z <= l / 2 + .01; z += 2) P.box('darkTimber', 0, 0, z, .14, 1.2, .14);
  for (const y of [.45, .9]) P.box('timber', 0, y, 0, .06, .1, l);
}
/** Templates for repeated props, built once around the origin. */
function template(P: Parts, kind: PropKind, v: number) {
  switch (kind) {
    case 'crate': P.box('timber', 0, 0, 0, .9, .8, .9, 0, 1); P.box('darkTimber', 0, .78, 0, .95, .06, .95, 0, 1); break;
    case 'barrel': P.cyl('timber', 0, 0, 0, 1.05, .6, .6, 14, 1); P.cyl('timber', 0, .22, 0, .6, .72, .72, 14, 1); for (const y of [.12, .5, .9]) P.cyl('iron', 0, y, 0, .05, .7, .7, 14); P.cyl('darkTimber', 0, 1.04, 0, .02, .58, .58, 14); break;
    case 'sack': P.blob('clothCream', 0, .35, 0, .38, .38, .32, v, .12); P.blob('clothCream', 0, .78, 0, .14, .12, .14, v + 1, .1, 1); break;
    case 'hay': P.box('hay', 0, 0, 0, 1.6, .7, 1, 0, 1.2); P.box('hay', .2, .7, 0, 1.2, .55, .9, .15, 1.2); break;
    case 'woodpile': for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) { const c = P.cyl('bark', 0, 0, 0, 1.4, .26, .26, 7, 1); c.rotation.z = Math.PI / 2; c.position.set(0, .14 + r * .23, -.4 + i * .27 + r * .13); c.bakeCurrentTransformIntoVertices(); } break;
    case 'lamp':
      P.box('stoneDark', 0, 0, 0, .5, .35, .5); P.cyl('darkTimber', 0, .3, 0, 3.1, .16, .2, 8);
      P.box('darkTimber', .35, 3.1, 0, .8, .1, .1); P.box('iron', .7, 2.55, 0, .34, .06, .34);
      P.box('glow', .7, 2.62, 0, .24, .38, .24); P.box('iron', .7, 3.0, 0, .38, .08, .38); P.cyl('iron', .7, 3.06, 0, .12, .02, .3, 4);
      break;
    case 'bench': P.box('timber', 0, .42, 0, 1.8, .08, .5, 0, 1); for (const s of [-1, 1]) P.box('stone', s * .7, 0, 0, .18, .42, .45); P.box('timber', 0, .62, -.22, 1.8, .3, .06, 0, 1); break;
    case 'planter': P.box('stone', 0, 0, 0, 1.4, .55, 1.4, 0, 1.5); P.blob('leafDark', 0, .75, 0, .6, .38, .6, v, .25); for (let i = 0; i < 5; i++) P.blob(FLOWERS[(v + i) % 4], Math.sin(i * 2.4) * .45, .95, Math.cos(i * 2.4) * .45, .08, .06, .08, i, .1, 1); break;
    case 'sign': P.cyl('darkTimber', 0, 0, 0, 2.6, .14, .16, 6); for (const [y, a] of [[2.1, .3], [1.7, -.5], [1.35, 2.5]] as const) { const b = P.box('timber', 0, y, 0, 1.1, .22, .05, a, 1); void b; } break;
    case 'banner': P.cyl('darkTimber', 0, 0, 0, 6, .14, .18, 6); P.cyl('gold', 0, 6, 0, .25, .02, .16, 6); P.box('darkTimber', 0, 5.6, 0, 1.4, .07, .07); P.box('clothRed', 0, 2.6, 0, 1.2, 3, .03); P.box('gold', 0, 4.1, .02, .5, .5, .02, 0, 1, 0, Math.PI / 4); break;
    case 'notice': for (const s of [-1, 1]) P.box('darkTimber', s * .8, 0, 0, .14, 2.3, .14); P.box('timber', 0, .9, 0, 1.7, 1.1, .08, 0, 1); P.gable('darkTimber', 0, 2.2, 0, 1.9, .5, .3, 0, .1, .06); for (let i = 0; i < 4; i++) P.box('paper', -.5 + i * .33, 1.1 + (i % 2) * .4, .05, .26, .34, .01); break;
    case 'well':
      P.cyl('stone', 0, 0, 0, .9, 2.2, 2.4, 14, 1.5); P.cyl('water', 0, .6, 0, .02, 1.8, 1.8, 14);
      for (const s of [-1, 1]) P.box('darkTimber', s * 1, .8, 0, .15, 1.9, .15); P.box('darkTimber', 0, 2.6, 0, 2.3, .14, .14); P.gable('thatch', 0, 2.75, 0, 2.4, 1.6, .7, Math.PI / 2, .2, .1);
      P.cyl('timber', .1, 1.5, 0, .35, .3, .26, 8, 1); break;
    case 'cart':
      P.box('timber', 0, .6, 0, 1.5, .12, 2.6, 0, 1); for (const s of [-1, 1]) { P.box('timber', s * .72, .72, 0, .06, .4, 2.6, 0, 1); const wh = P.cyl('darkTimber', 0, 0, 0, .1, 1.2, 1.2, 14); wh.rotation.z = Math.PI / 2; wh.position.set(s * .86, .6, .2); wh.bakeCurrentTransformIntoVertices(); }
      for (const s of [-1, 1]) P.box('darkTimber', s * .35, .55, 2.1, .08, .08, 1.8, 0, 1, -.15); P.box('hay', 0, .72, -.3, 1.3, .45, 1.6, 0, 1.2); P.blob('clothCream', .2, 1.3, .6, .35, .3, .3, 2, .12); break;
    case 'stall': {
      const cloth = CLOTH[v % CLOTH.length];
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P.box('darkTimber', sx * 1.5, 0, sz * .9, .12, sz > 0 ? 2.3 : 2.7, .12);
      P.box('timber', 0, .85, .3, 3.1, .1, 1.2, 0, 1); P.box('timber', 0, 0, .9, 3.1, .85, .06, 0, 1);
      P.box(cloth, 0, 2.35, 0, 3.4, .05, 2.4, 0, 1, -.18);
      for (let i = 0; i < 5; i++) P.box(cloth, -1.36 + i * .68, 2.1, 1.23, .62, .32, .03, 0, 1, -.18);
      for (let i = 0; i < 6; i++) { const m: MatKey = (['produce', 'flowerYellow', 'clothGreen', 'produce', 'flowerRed', 'timber'] as MatKey[])[(i + v) % 6]; P.blob(m, -1.2 + i * .48, 1.03, .3 + (i % 2) * .25, .16, .1, .16, i + v, .2, 1); }
      P.box('timber', -1.1, 0, -.5, .6, .55, .6, .3, 1); P.blob('clothCream', 1, .3, -.5, .3, .3, .26, v, .12);
      break;
    }
    case 'fountain':
      P.cyl('stone', 0, 0, 0, .7, 6.6, 6.8, 16, 2); P.cyl('stoneDark', 0, .7, 0, .14, 6.9, 6.9, 16, 2); P.cyl('water', 0, .55, 0, .02, 6.1, 6.1, 24);
      P.cyl('stone', 0, 0, 0, 2.3, .7, .9, 10, 1); P.cyl('stone', 0, 2.3, 0, .35, 2.2, .6, 14, 1); P.cyl('water', 0, 2.62, 0, .02, 2, 2, 16);
      P.cyl('stone', 0, 2.6, 0, 1, .3, .4, 8, 1); P.blob('stone', 0, 3.8, 0, .3, .4, .3, 1, .05, 1); P.cyl('gold', 0, 4.15, 0, .3, .02, .14, 6);
      break;
    case 'flowers': for (let i = 0; i < 7; i++) { const a = i * 2.39 + v, r = .2 + (i % 3) * .22; P.blob('leafDark', Math.sin(a) * r, .12, Math.cos(a) * r, .2, .16, .2, i, .2, 1); P.blob(FLOWERS[(v + i) % 4], Math.sin(a) * r, .3, Math.cos(a) * r, .07, .05, .07, i + 3, .2, 1); } break;
    case 'bush': P.blob(v % 2 ? 'leafDark' : 'leaf', 0, .5, 0, .9, .65, .8, v, .25); P.blob('leafDark', .5, .38, .3, .55, .45, .55, v + 2, .25); break;
    case 'rock': P.blob('stoneDark', 0, .2, 0, .9, .55, .7, v, .2, 1); break;
    case 'tree': {
      const leaf: MatKey = v % 5 === 0 ? 'leafAutumn' : v % 2 ? 'leafDark' : 'leaf';
      P.cyl('bark', 0, -.2, 0, 3.6, .38, .62, 9, 1.4);
      for (const [a, l] of [[.6, 1.6], [2.6, 1.4], [4.4, 1.5]] as const) { const b = P.cyl('bark', 0, 0, 0, l, .1, .2, 6, 1); b.rotation.set(.75, a, 0); b.position.set(Math.sin(a) * .3, 3.1, Math.cos(a) * .3); b.bakeCurrentTransformIntoVertices(); }
      P.blob(leaf, 0, 5.2, 0, 2.6, 1.9, 2.5, v, .28);
      for (let i = 0; i < 5; i++) { const a = i * 1.26 + v, r = 1.7; P.blob(leaf, Math.sin(a) * r, 4.2 + (i % 2) * .9, Math.cos(a) * r, 1.4, 1.1, 1.4, v + i, .3); }
      break;
    }
    case 'pine':
      P.cyl('bark', 0, -.3, 0, 3, .22, .42, 7, 1.4);
      for (let i = 0; i < 4; i++) P.cyl('pine', 0, 1.6 + i * 1.65, 0, 3 - i * .3, 0, 3.6 - i * .75, 9, 1.2);
      break;
    default: P.box('stone', 0, 0, 0, .5, .5, .5);
  }
}
export function buildProps(scene: Scene, kit: Kit, props: readonly Prop[]): BuiltProps {
  const meshes: Mesh[] = [], casters: Mesh[] = [], lamps: Vector3[] = [], windows: Mesh[] = [];
  const one = new Parts(scene, 'town-static');
  for (const p of props) {
    if (!['house', 'wall', 'tower', 'fence'].includes(p.kind)) continue;
    const start = one.list.length;
    if (p.kind === 'house') house(one, p); else if (p.kind === 'wall') wallSeg(one, p); else if (p.kind === 'tower') tower(one, p); else fence(one, p);
    for (let i = start; i < one.list.length; i++) { const m = one.list[i].mesh; m.rotation.y = p.yaw; m.position.set(p.x, 0, p.z); m.bakeCurrentTransformIntoVertices(); }
  }
  for (const m of one.finish(kit)) { meshes.push(m); casters.push(m); if (m.name.endsWith(':window')) windows.push(m); m.freezeWorldMatrix(); }
  // Templates: one per kind (a few variants for stalls, trees and flowers), thin-instanced.
  const groups = new Map<string, Prop[]>();
  for (const p of props) {
    if (['house', 'wall', 'tower', 'fence', 'boulder', 'sapling'].includes(p.kind)) continue;
    const variants = p.kind === 'stall' ? 5 : p.kind === 'tree' || p.kind === 'flowers' || p.kind === 'bush' || p.kind === 'planter' ? 3 : p.kind === 'sack' || p.kind === 'rock' ? 2 : 1;
    const key = `${p.kind}:${p.v % variants}`; const l = groups.get(key) ?? []; l.push(p); groups.set(key, l);
  }
  for (const [key, list] of groups) {
    const [kind, v] = key.split(':'), P = new Parts(scene, `town-${key}`); template(P, kind as PropKind, Number(v));
    const parts = P.finish(kit), mats = list.map(p => Matrix.Compose(new Vector3(p.s, p.s, p.s), Quaternion.RotationAxis(Vector3.Up(), p.yaw), new Vector3(p.x, groundY(p), p.z)));
    for (const m of parts) {
      for (const mat of mats) m.thinInstanceAdd(mat, false);
      m.thinInstanceRefreshBoundingInfo(false); m.thinInstanceBufferUpdated('matrix'); m.freezeWorldMatrix(); meshes.push(m);
      if (!['flowers', 'rock'].includes(kind)) casters.push(m);
    }
    if (kind === 'lamp') for (const p of list) { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); lamps.push(new Vector3(p.x + .7 * c, groundY(p) + 2.62, p.z - .7 * s)); }
  }
  return { meshes, casters, lamps, windows };
}
/** Props stand on the ground; the plan's terrain is evaluated by the caller via `setGround`. */
let ground: (x: number, z: number) => number = () => 0;
export function setGround(fn: (x: number, z: number) => number) { ground = fn; }
const groundY = (p: Prop) => ground(p.x, p.z) - (p.kind === 'tree' || p.kind === 'pine' ? .15 : 0);
