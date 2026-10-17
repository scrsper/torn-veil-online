import '@babylonjs/loaders/glTF';
import { Color3, Mesh, MeshBuilder, SceneLoader, StandardMaterial, TransformNode, VertexData, type AssetContainer, type Scene } from '@babylonjs/core';
import { libraryAsset, provenanceOk, type LibraryAsset } from '../../sim/world/assets/library';

/** Loads torn-veil-assets GLBs staged by scripts/world/sync-library.mjs --stage into
 * /world-assets/. Bytes must hash to the registry sha256 and pass the provenance check,
 * else the caller receives a procedural stand-in sized from the manifest bounds. */
const sha = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
export type LibraryStatus = Record<string, 'glb' | 'fallback' | 'refused'>;
export class LibraryLoader {
  private containers = new Map<string, Promise<AssetContainer | null>>(); readonly status: LibraryStatus = {};
  private staged: Promise<Set<string>>;
  constructor(readonly scene: Scene, readonly base = '/world-assets/') {
    this.staged = fetch(base + 'manifest.json').then(r => r.ok ? r.json() : { assets: [] }).then((m: { assets?: { id: string }[] }) => new Set((m.assets ?? []).map(a => a.id))).catch(() => new Set<string>());
  }
  container(id: string): Promise<AssetContainer | null> {
    let p = this.containers.get(id);
    if (!p) { p = this.load(id); this.containers.set(id, p); }
    return p;
  }
  private async load(id: string): Promise<AssetContainer | null> {
    const a = libraryAsset(id);
    if (!a || !provenanceOk(a)) { this.status[id] = 'refused'; return null; }
    try {
      if (!(await this.staged).has(id)) throw Error('not staged');
      const r = await fetch(this.base + a.path); if (!r.ok) throw Error('unavailable');
      const bytes = await r.arrayBuffer(); if (bytes.byteLength < 1024 || await sha(bytes) !== a.sha256) throw Error('hash');
      const c = await SceneLoader.LoadAssetContainerAsync('', new Uint8Array(bytes), this.scene, undefined, '.glb');
      this.status[id] = 'glb'; return c;
    } catch { this.status[id] = 'fallback'; return null; }
  }
  /** Instantiate under `parent` (asset local frame, +Y up), GLB if verified, else a stand-in. */
  async instantiate(id: string, name: string, parent: TransformNode): Promise<Mesh[]> {
    const c = await this.container(id), a = libraryAsset(id)!;
    if (c) {
      const e = c.instantiateModelsToScene(n => `${name}:${n}`, false);
      for (const n of e.rootNodes) n.parent = parent;
      return parent.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh);
    }
    return standIn(this.scene, a, name, parent);
  }
}
const mats = new Map<string, StandardMaterial>();
function m(scene: Scene, hex: string) {
  let x = mats.get(hex + scene.uid); if (!x) { x = new StandardMaterial('standin-' + hex, scene); x.diffuseColor = Color3.FromHexString(hex); x.ambientColor = x.diffuseColor.scale(.9); x.specularColor = new Color3(.05, .05, .05); mats.set(hex + scene.uid, x); }
  return x;
}
/** Bounds-faithful procedural stand-ins, recognisable by family. Never collision authority. */
export function standIn(scene: Scene, a: LibraryAsset, name: string, parent: TransformNode): Mesh[] {
  const out: Mesh[] = [], [x0, , z0] = a.bounds.min, [x1, y1, z1] = a.bounds.max, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const box = (k: string, x: number, y: number, z: number, bw: number, bh: number, bd: number, hex: string) => {
    const b = MeshBuilder.CreateBox(`${name}:${k}`, { width: bw, height: bh, depth: bd }, scene); b.position.set(x, y + bh / 2, z); b.material = m(scene, hex); b.parent = parent; out.push(b); return b;
  };
  const gable = (k: string, x: number, y: number, z: number, bw: number, bd: number, rise: number, hex: string) => {
    const r = new Mesh(`${name}:${k}`, scene), hw = bw / 2 + .4, hd = bd / 2 + .4;
    const p = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, 0, rise, -hd, 0, rise, hd], idx = [0, 4, 1, 3, 2, 5, 0, 3, 5, 0, 5, 4, 1, 4, 5, 1, 5, 2];
    const vd = new VertexData(), n: number[] = []; VertexData.ComputeNormals(p, idx, n); Object.assign(vd, { positions: p, indices: idx, normals: n }); vd.applyToMesh(r);
    r.position.set(x, y, z); r.material = m(scene, hex); r.material.backFaceCulling = false; r.parent = parent; out.push(r); return r;
  };
  const house = (k: string, x: number, z: number, bw: number, bd: number, h: number) => { box(k, x, 0, z, bw, h, bd, '#cdbb98'); gable(k + ':roof', x, h, z, bw, bd, Math.min(3.5, bw * .45), '#5b3a2c'); box(k + ':door', x, 0, z - bd / 2 - .05, 1.4, 2.2, .1, '#3a2418'); };
  switch (a.family) {
    case 'tavern': house('hall', cx, cz, w * .8, d * .7, Math.min(y1, 6) * .7); box('sign', cx + w * .3, 2.4, cz - d * .36, .1, .8, 1.2, '#b88a3a'); break;
    case 'village_lane': box('lane', cx, -.05, cz, 4, .1, d, '#8e8270'); for (let i = 0; i < 4; i++) { const s = i % 2 ? 1 : -1, z = z0 + d * (.18 + Math.floor(i / 2) * .5); house(`house${i}`, cx + s * w * .26, z, w * .3, d * .3, 4.2); } break;
    case 'market_square': box('paving', cx, -.05, cz, w, .1, d, '#9c9483'); for (let i = 0; i < 6; i++) { const x = x0 + w * (.17 + (i % 3) * .33), z = z0 + d * (i < 3 ? .3 : .7); box(`stall${i}`, x, 0, z, 3, 1, 2, '#7a5a3a'); gable(`awning${i}`, x, 2.4, z, 3, 2, .9, i % 2 ? '#a5372b' : '#c9a043'); for (const sx of [-1, 1]) box(`pole${i}${sx}`, x + sx * 1.4, 0, z, .12, 2.4, .12, '#4a3020'); } break;
    case 'gatehouse': for (const s of [-1, 1]) { box(`tower${s}`, cx + s * 9, 0, cz, 8, y1, 8, '#8a8274'); box(`crenel${s}`, cx + s * 9, y1, cz, 8.6, .8, 8.6, '#7a7366'); } box('arch', cx, 5, cz, 10, y1 - 5, 7, '#857d70'); box('gate', cx, 0, cz, 4, 4.6, .3, '#4a3020'); break;
    case 'gate_segment': for (const s of [-1, 1]) box(`wall${s}`, cx + s * w * .3, 0, cz, w * .38, y1, 2.2, '#8a8274'); box('lintel', cx, y1 * .75, cz, w * .25, y1 * .25, 2.2, '#7d7568'); break;
    case 'courtyard_passage': for (let i = 0; i < 5; i++) for (const s of [-1, 1]) box(`col${i}${s}`, cx + s * w * .32, 0, z0 + d * (.1 + i * .2), .6, y1 * .8, .6, '#d8cfbd'); box('roofL', cx - w * .32, y1 * .8, cz, 2.4, .4, d, '#5b3a2c'); box('roofR', cx + w * .32, y1 * .8, cz, 2.4, .4, d, '#5b3a2c'); box('floor', cx, -.05, cz, w * .9, .1, d, '#a39a88'); break;
    case 'watchpost': for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(`leg${sx}${sz}`, cx + sx * 2.2, 0, cz + sz * 2.2, .5, y1 * .75, .5, '#5a3e28'); box('deck', cx, y1 * .72, cz, 6, .4, 6, '#6a4a30'); gable('roof', cx, y1 * .95, cz, 5, 5, 2, '#4a3020'); box('palisade', cx, 0, cz + d * .4, w * .8, 2.6, .5, '#6a4a30'); break;
    case 'ravine_bridge': box('deck', cx, 4, cz, 4.2, .5, d, '#6a4a30'); for (const s of [-1, 1]) { box(`rail${s}`, cx + s * 2, 4.5, cz, .2, 1, d, '#4a3020'); box(`pier${s}`, cx, 0, cz + s * d * .3, 3, 4, 3, '#8a8274'); } break;
    case 'dungeon_junction': box('ruin', cx, 0, cz, w * .6, 2.2, d * .6, '#77706a'); box('stair', cx, 0, cz - d * .32, 3, .6, 2, '#5d5751'); box('dark', cx, 0, cz - d * .3, 2.4, 2, .05, '#0d0b0a'); break;
    default: box('mass', cx, 0, cz, w, y1, d, '#888');
  }
  return out;
}
