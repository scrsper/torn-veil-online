import {
  Color3, Color4, DirectionalLight, DynamicTexture, Mesh, MeshBuilder, PBRMaterial, PointLight, StandardMaterial, TransformNode, Vector3, Vector4,
  type AbstractMesh, type Scene, type Texture,
} from '@babylonjs/core';
import { mulberry } from '../render/noise';
import { loadScannedMaps, useScannedMaps } from '../render/materials';
import { blocksView, type CutBox } from './cutaway';
import type { Theme } from './tower/floorgen';

/**
 * Tower architecture and surfaces, built in code (no architecture kit is licensed locally; props stay the CC0 KayKit set).
 * A semi-realistic look from tactile materials and shaped light rather than a colour filter:
 * - scanned CC0 surfaces (Poly Haven, art/reference/web-rebirth/material-manifest.json) through the shared scan handling
 *   in render/materials.ts: cobblestone_floor_08 and weathered_planks floors, rock_wall_08 walls, tinted per tier; the
 *   marble courts (no marble scan here) use painted polished tiles with a normal map;
 * - a floor bake (contact shade under walls and along the perimeter, a worn route from the start to the door);
 * - tall pilastered perimeter walls with a plinth and cornice, banners, torch sconces whose nearest lights follow the hero;
 * - a bounded light budget in priority order (LIGHT_PRIORITY): hemi, key, a hero fill and a rim for every character;
 * - per-tier palettes so each band of floors has its own stone, metal, wood and light.
 * Presentation only: collision, navigation and the arena bounds are unchanged.
 */
export interface EnvLook {
  id: string;
  stone: [number, number, number]; mortar: [number, number, number];
  floor: 'flag' | 'plank' | 'checker'; floorA: [number, number, number]; floorB: [number, number, number];
  wood: [number, number, number]; metal: [number, number, number];
  torch: [number, number, number]; fog: [number, number, number]; fogDensity: number;
  sky: [number, number, number]; ground: [number, number, number]; hemi: number;
  key: [number, number, number]; keyI: number; banner: [number, number, number]; moss: number;
}

const L = (id: string, o: Omit<EnvLook, 'id'>): EnvLook => ({ id, ...o });
/** Per tier band (floorgen THEMES order), plus the Proving Hall. */
export const LOOKS: Record<string, EnvLook> = {
  hall: L('hall', { stone: [.62, .55, .46], mortar: [.24, .2, .17], floor: 'plank', floorA: [.5, .34, .2], floorB: [.45, .3, .18], wood: [.36, .22, .12], metal: [.55, .48, .38],
    torch: [1, .66, .34], fog: [.16, .12, .09], fogDensity: .008, sky: [.7, .66, .6], ground: [.26, .2, .15], hemi: .85, key: [1, .88, .72], keyI: 1.9, banner: [.55, .1, .1], moss: 0 }),
  Normal: L('Normal', { stone: [.5, .45, .38], mortar: [.17, .15, .12], floor: 'flag', floorA: [.46, .41, .34], floorB: [.42, .38, .32], wood: [.3, .19, .1], metal: [.32, .3, .28],
    torch: [1, .6, .3], fog: [.13, .11, .085], fogDensity: .01, sky: [.6, .6, .58], ground: [.22, .18, .14], hemi: .82, key: [1, .84, .66], keyI: 1.8, banner: [.38, .25, .12], moss: .35 }),
  Iron: L('Iron', { stone: [.36, .38, .41], mortar: [.12, .13, .14], floor: 'flag', floorA: [.33, .35, .37], floorB: [.3, .31, .33], wood: [.22, .17, .13], metal: [.42, .44, .47],
    torch: [1, .52, .22], fog: [.09, .1, .12], fogDensity: .011, sky: [.56, .62, .7], ground: [.14, .14, .16], hemi: .72, key: [.78, .86, 1], keyI: 1.5, banner: [.2, .24, .3], moss: .05 }),
  Bronze: L('Bronze', { stone: [.66, .52, .36], mortar: [.26, .19, .12], floor: 'flag', floorA: [.62, .48, .32], floorB: [.56, .43, .29], wood: [.4, .24, .12], metal: [.72, .5, .26],
    torch: [1, .7, .38], fog: [.16, .12, .08], fogDensity: .009, sky: [.74, .64, .5], ground: [.24, .17, .1], hemi: .8, key: [1, .84, .6], keyI: 1.6, banner: [.5, .14, .08], moss: .05 }),
  Silver: L('Silver', { stone: [.74, .75, .77], mortar: [.4, .41, .43], floor: 'checker', floorA: [.8, .8, .82], floorB: [.4, .42, .46], wood: [.3, .22, .16], metal: [.78, .8, .84],
    torch: [.86, .9, 1], fog: [.13, .14, .17], fogDensity: .009, sky: [.74, .8, .9], ground: [.2, .21, .24], hemi: .8, key: [.86, .92, 1], keyI: 1.7, banner: [.16, .22, .42], moss: 0 }),
  Gold: L('Gold', { stone: [.8, .72, .58], mortar: [.42, .35, .24], floor: 'checker', floorA: [.86, .8, .66], floorB: [.42, .12, .1], wood: [.36, .16, .08], metal: [.95, .74, .3],
    torch: [1, .8, .45], fog: [.17, .13, .08], fogDensity: .008, sky: [.82, .74, .58], ground: [.26, .18, .1], hemi: .82, key: [1, .9, .7], keyI: 1.7, banner: [.6, .08, .08], moss: 0 }),
  Diamond: L('Diamond', { stone: [.48, .56, .64], mortar: [.2, .25, .3], floor: 'flag', floorA: [.5, .6, .68], floorB: [.45, .54, .62], wood: [.25, .22, .24], metal: [.6, .82, .92],
    torch: [.45, .85, 1], fog: [.08, .11, .15], fogDensity: .01, sky: [.64, .78, .92], ground: [.13, .15, .2], hemi: .75, key: [.75, .9, 1], keyI: 1.5, banner: [.1, .3, .45], moss: 0 }),
  God: L('God', { stone: [.82, .76, .84], mortar: [.5, .44, .52], floor: 'checker', floorA: [.92, .88, .9], floorB: [.62, .54, .66], wood: [.3, .2, .24], metal: [1, .86, .55],
    torch: [1, .86, .64], fog: [.17, .14, .19], fogDensity: .007, sky: [.88, .82, .92], ground: [.28, .24, .3], hemi: .85, key: [1, .92, .84], keyI: 1.7, banner: [.45, .2, .55], moss: 0 }),
};
export const lookFor = (theme: Theme | null, floor: number): EnvLook => !theme ? LOOKS.hall : floor === 0 ? LOOKS.hall : LOOKS[theme.tier] ?? LOOKS.Normal;

// ---- procedural surfaces ------------------------------------------------------------------------------------------
const SIZE = 1024;
/** Lights an environment material takes: hemi, key, fill, rim, three torches, the door. */
export const ENV_LIGHTS = 8;
/**
 * Light ranking (Babylon renderPriority, higher first; scene.requireLightSorting is on): characters keep Babylon's default
 * four lights, so they get hemi + key + hero fill + rim (or a live spell flash in place of the rim); environment materials
 * take ENV_LIGHTS and add the door and the nearest torches. Disabled lights take no slot.
 */
export const LIGHT_PRIORITY = { hemi: 100, key: 90, fill: 80, flash: 75, rim: 70, door: 40, torch: 30 } as const;
const NEAR_TORCHES = 3;
const clamp = (v: number) => Math.max(0, Math.min(255, v));
/** Smooth value noise, tileable over the canvas. */
function noiseField(seed: number, cells: number): (x: number, y: number) => number {
  const r = mulberry(seed), g = Array.from({ length: cells * cells }, () => r());
  const at = (i: number, j: number) => g[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
  return (x, y) => {
    const fx = x / SIZE * cells, fy = y / SIZE * cells, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const s = (t: number) => t * t * (3 - 2 * t), a = at(i, j) + (at(i + 1, j) - at(i, j)) * s(u), b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * s(u);
    return a + (b - a) * s(v);
  };
}
/** Paint a surface: `cell` maps a pixel to {tone (0..1.4 multiplier), height (0..1), base colour}. Returns albedo and normal maps. */
function paint(scene: Scene, name: string, seed: number, cell: (x: number, y: number) => { c: [number, number, number]; t: number; h: number }, strength = 2.2): { albedo: DynamicTexture; normal: DynamicTexture } {
  const albedo = new DynamicTexture(`${name}-albedo`, SIZE, scene, true), normal = new DynamicTexture(`${name}-normal`, SIZE, scene, true);
  const ca = albedo.getContext() as CanvasRenderingContext2D, cn = normal.getContext() as CanvasRenderingContext2D;
  const A = ca.createImageData(SIZE, SIZE), N = cn.createImageData(SIZE, SIZE), H = new Float32Array(SIZE * SIZE);
  const fine = noiseField(seed, 96), mid = noiseField(seed + 1, 24), broad = noiseField(seed + 2, 6);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const p = cell(x, y), grain = (fine(x, y) - .5) * .18 + (mid(x, y) - .5) * .14 + (broad(x, y) - .5) * .12, k = (y * SIZE + x) * 4, t = p.t * (1 + grain);
    A.data[k] = clamp(p.c[0] * t * 255); A.data[k + 1] = clamp(p.c[1] * t * 255); A.data[k + 2] = clamp(p.c[2] * t * 255); A.data[k + 3] = 255;
    H[y * SIZE + x] = p.h + (fine(x, y) - .5) * .12 * p.h + (mid(x, y) - .5) * .06;
  }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const h = (i: number, j: number) => H[((j + SIZE) % SIZE) * SIZE + ((i + SIZE) % SIZE)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), k = (y * SIZE + x) * 4;
    N.data[k] = (-dx / l * .5 + .5) * 255; N.data[k + 1] = (dy / l * .5 + .5) * 255; N.data[k + 2] = (1 / l * .5 + .5) * 255; N.data[k + 3] = 255;
  }
  ca.putImageData(A, 0, 0); cn.putImageData(N, 0, 0); albedo.update(); normal.update();
  for (const t of [albedo, normal]) { t.wrapU = t.wrapV = 1; t.anisotropicFilteringLevel = 8; }
  return { albedo, normal };
}
/** Polished marble tiles for the court tiers (no marble scan is licensed locally): two tones, thin joints, faint veins. */
function checker(look: EnvLook) {
  const n = 4, cw = SIZE / n;
  return (x: number, y: number) => {
    const i = Math.floor(x / cw), j = Math.floor(y / cw), xx = x - i * cw, yy = y - j * cw;
    if (Math.min(xx, yy, cw - xx, cw - yy) < 2.5) return { c: look.mortar, t: 1, h: 0 };
    const vein = Math.max(0, 1 - Math.abs(Math.sin((x * .011 + y * .007) + Math.sin(y * .02) * 2)) * 8) * .12;
    return { c: (i + j) % 2 ? look.floorA : look.floorB, t: 1 - vein, h: .8 };
  };
}

type Maps = { albedo: Texture; normal: Texture; arm: Texture };
const scanCache = new Map<string, Maps>();
/** Shared scan maps for this scene (never disposed with a floor). */
function scan(scene: Scene, surface: string): Maps {
  const hit = scanCache.get(surface); if (hit && hit.albedo.getScene() === scene && !scene.isDisposed) return hit;
  const m = loadScannedMaps(scene, surface); scanCache.set(surface, m); return m;
}
/** Tint that moves a scan's own colour toward a tier colour (scan albedo averages about this grey). */
const tint = (c: [number, number, number], scanGrey: number) => new Color3(...c.map(v => Math.min(1.8, v / scanGrey)) as [number, number, number]);

interface Surface { mat: PBRMaterial }
const surfaceCache = new Map<string, Surface>();
const tileCache = new Map<string, { albedo: DynamicTexture; normal: DynamicTexture }>();
/** The painted marble tiles for a look, cached for the scene (retiled per floor, never disposed with one). */
function marbleTiles(scene: Scene, look: EnvLook): [DynamicTexture, DynamicTexture] {
  const key = `env-marble-${look.id}`; let t = tileCache.get(key);
  if (!t || t.albedo.getScene() !== scene || scene.isDisposed) { t = paint(scene, key, 41, checker(look)); tileCache.set(key, t); }
  return [t.albedo, t.normal];
}
/** The tier's wall stone: the rock_wall_08 scan tinted toward the look's stone colour; shared, kept for the scene. */
export function stoneSurface(scene: Scene, look: EnvLook): Surface {
  const key = `env-stone-${look.id}`, hit = surfaceCache.get(key); if (hit && hit.mat.getScene() === scene && !scene.isDisposed) return hit;
  const maps = scan(scene, 'rock_wall_08'), mat = new PBRMaterial(key, scene); useScannedMaps(mat, maps);
  mat.albedoColor = tint(look.stone, .3); mat.metallic = 0; mat.roughness = 1; mat.maxSimultaneousLights = ENV_LIGHTS; mat.environmentIntensity = 0;
  const s = { mat }; surfaceCache.set(key, s); return s;
}
const flat = (scene: Scene, name: string, c: [number, number, number], rough: number, metal = 0) => {
  const m = new PBRMaterial(name, scene); m.albedoColor = new Color3(...c); m.roughness = rough; m.metallic = metal; m.maxSimultaneousLights = ENV_LIGHTS; m.environmentIntensity = 0; return m;
};

/** A box whose faces repeat a texture every `tile` units (so long walls keep their stone size). */
export function tiledBox(name: string, w: number, h: number, d: number, tile: number, scene: Scene): Mesh {
  const u = (a: number, b: number) => new Vector4(0, 0, a / tile, b / tile);
  return MeshBuilder.CreateBox(name, { width: w, height: h, depth: d, faceUV: [u(w, h), u(w, h), u(d, h), u(d, h), u(w, d), u(w, d)], wrap: true }, scene);
}

/** A soft radial sprite (torch flames, portal glow). */
function glowTexture(scene: Scene, name: string, c: [number, number, number]): DynamicTexture {
  const t = new DynamicTexture(name, 128, scene, false); const g = t.getContext() as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62); const col = (a: number) => `rgba(${c.map(v => Math.round(v * 255)).join(',')},${a})`;
  grad.addColorStop(0, 'rgba(255,250,235,1)'); grad.addColorStop(.25, col(.9)); grad.addColorStop(1, col(0));
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128); t.hasAlpha = true; t.update(); return t;
}

export interface Layout { walls: { x: number; z: number; len: number; yaw: number }[]; start: { x: number; z: number }; exit: { x: number; z: number } }

/**
 * One floor's architecture. `update` (every frame, after the camera moves) fades the perimeter walls the camera is
 * behind, lets the nearest torches light the scene and flickers them.
 */
export class TowerEnvironment {
  private parts: { dispose(): void }[] = [];
  private torches: { light: PointLight; flame: Mesh; base: number; seed: number }[] = [];
  private sides: { meshes: AbstractMesh[]; inside: (x: number, z: number) => boolean }[] = [];
  private t = 0;
  /** Maze-wall sconces with their wall's box (widened by the sconce's reach), faded with the wall cutaway. */
  private sconces: ({ meshes: Mesh[] } & CutBox)[] = [];
  private fill: PointLight;
  private rim: DirectionalLight;
  constructor(private scene: Scene, readonly look: EnvLook, half: number, layout: Layout | null, label: (text: string, x: number, z: number, w: number, yaw: number, color?: string) => void, floor: number) {
    const s = scene, size = half * 2 + 8, e = half + 2.5;
    this.fill = new PointLight('env-hero-fill', Vector3.Zero(), s); this.fill.diffuse = new Color3(1, .95, .88); this.fill.specular = new Color3(.25, .24, .22); this.fill.range = 9; this.fill.intensity = 1.1; this.fill.renderPriority = LIGHT_PRIORITY.fill;
    // Rim: a cool back light from the far side of the room so bodies separate from the floor and the walls.
    this.rim = new DirectionalLight('env-rim', new Vector3(.25, -.55, 1).normalize(), s); this.rim.diffuse = new Color3(...look.sky).scale(1.1); this.rim.specular = new Color3(.3, .32, .36); this.rim.intensity = .85; this.rim.renderPriority = LIGHT_PRIORITY.rim;
    this.parts.push(this.fill, this.rim);
    // Light budget (shader limits: 12 per material failed to compile on this GPU). Scene order puts what matters first:
    // hemi, key, then this fill and rim (so characters, at Babylon's default 4, get hemi + key + fill + rim), then the
    // NEAR_TORCHES nearest torches and the door's light, which the environment's own materials (ENV_LIGHTS) also take.
    // Floor: the surface tiles every 4 units; a per-floor bake on the same UVs (scale 1) carries contact shade and wear.
    // Per-floor material and texture clones, all three maps at one tiling (clones share the GPU image).
    const mat = new PBRMaterial(`env-floor-${look.id}-${floor}`, s); mat.maxSimultaneousLights = ENV_LIGHTS; mat.environmentIntensity = 0;
    if (look.floor === 'checker') {
      // The painted tiles are used directly (DynamicTexture.clone() is a blank canvas); cached per look, never disposed
      // with a floor, retiled for this floor's size.
      const [a, n] = marbleTiles(s, look);
      for (const t of [a, n]) t.uScale = t.vScale = size / 4;
      mat.albedoTexture = a; mat.bumpTexture = n; mat.roughness = .42; mat.metallic = 0;
    } else {
      const src = scan(s, look.floor === 'plank' ? 'weathered_planks' : 'cobblestone_floor_08'), metres = look.floor === 'plank' ? 2.4 : 2.2;
      const own = { albedo: src.albedo.clone(), normal: src.normal.clone(), arm: src.arm.clone() };
      for (const t of Object.values(own)) t.uScale = t.vScale = size / metres;
      useScannedMaps(mat, own); mat.albedoColor = tint(look.floorA, look.floor === 'plank' ? .36 : .4); mat.metallic = 0; mat.roughness = 1;
      this.parts.push(own.albedo, own.normal, own.arm);
    }
    const bake = this.bakeFloor(size, half, layout); mat.lightmapTexture = bake; mat.useLightmapAsShadowmap = true;
    const slab = MeshBuilder.CreateGround('env-floor', { width: size, height: size }, s); slab.material = mat; slab.isPickable = false; slab.receiveShadows = true;
    this.parts.push(slab, mat, bake);
    // Perimeter: tall coursed walls, a plinth and cornice, pilasters every ~6 units with torches on alternate ones.
    const stone = stoneSurface(s, look).mat, trim = flat(s, `env-trim-${look.id}`, look.stone.map(v => v * .78) as [number, number, number], .7);
    const iron = flat(s, `env-iron-${look.id}`, look.metal, .45, .85), wood = flat(s, `env-wood-${look.id}`, look.wood, .8);
    const cloth = flat(s, `env-banner-${look.id}`, look.banner, .95);
    const flameTex = glowTexture(s, `env-flame-${look.id}`, look.torch);
    const flameMat = new StandardMaterial(`env-flame-${look.id}`, s); flameMat.diffuseTexture = flameTex; flameMat.opacityTexture = flameTex; flameMat.emissiveColor = new Color3(...look.torch); flameMat.disableLighting = true; flameMat.backFaceCulling = false;
    this.parts.push(trim, iron, wood, cloth, flameTex, flameMat);
    // Perimeter stands above the maze walls (floorgen MAZE_WALL_H), so the floor reads as one tall enclosed level.
    const H = 8.2, T = 2;
    for (const [i, [cx, cz, along]] of ([[0, -e, 'x'], [0, e, 'x'], [-e, 0, 'z'], [e, 0, 'z']] as const).entries()) {
      const len = e * 2 + T, inward = along === 'x' ? new Vector3(0, 0, -Math.sign(cz)) : new Vector3(-Math.sign(cx), 0, 0);
      const side = new TransformNode(`env-side-${i}`, s); side.position.set(cx, 0, cz); side.rotation.y = along === 'x' ? 0 : Math.PI / 2;
      // In the side's frame the wall runs along local X; its inner face points along local +Z or -Z.
      const innerSign = along === 'x' ? -Math.sign(cz) : Math.sign(cx);
      const wall = tiledBox('env-wall', len, H, T, 2.6, s); wall.parent = side; wall.position.y = H / 2; wall.material = stone;
      const plinth = MeshBuilder.CreateBox('env-plinth', { width: len, height: .45, depth: T + .35 }, s); plinth.parent = side; plinth.position.y = .22; plinth.material = trim;
      const cornice = MeshBuilder.CreateBox('env-cornice', { width: len, height: .3, depth: T + .5 }, s); cornice.parent = side; cornice.position.y = H + .05; cornice.material = trim;
      const meshes: AbstractMesh[] = [wall, plinth, cornice];
      const n = Math.max(4, Math.round(len / 6.5));
      for (let k = 1; k < n; k++) {
        const x = -len / 2 + k * len / n, zf = innerSign * (T / 2 + .25);
        const pil = tiledBox('env-pilaster', .9, H, .5, 2.6, s); pil.parent = side; pil.position.set(x, H / 2, zf); pil.material = stone; meshes.push(pil);
        const cap = MeshBuilder.CreateBox('env-cap', { width: 1.15, height: .25, depth: .75 }, s); cap.parent = side; cap.position.set(x, H - .1, zf); cap.material = trim; meshes.push(cap);
        if (k % 2 === 1) {
          // Torch sconce: iron bracket, wooden haft, a flame sprite and a point light (only the nearest few are lit).
          const br = MeshBuilder.CreateBox('env-bracket', { width: .12, height: .12, depth: .55 }, s); br.parent = side; br.position.set(x, 2.35, zf + innerSign * .4); br.material = iron; meshes.push(br);
          const haft = MeshBuilder.CreateCylinder('env-torch', { diameterTop: .14, diameterBottom: .08, height: .6, tessellation: 8 }, s); haft.parent = side; haft.position.set(x, 2.55, zf + innerSign * .62); haft.rotation.x = innerSign * .35; haft.material = wood; meshes.push(haft);
          const flame = MeshBuilder.CreatePlane('env-flame', { width: .5, height: .75 }, s); flame.parent = side; flame.position.set(x, 3.05, zf + innerSign * .72); flame.billboardMode = Mesh.BILLBOARDMODE_Y; flame.material = flameMat; flame.isPickable = false; meshes.push(flame);
          const light = new PointLight('env-torch-light', Vector3.Zero(), s); light.parent = side; light.position.set(x, 3, zf + innerSign * 1.1);
          light.diffuse = new Color3(...look.torch); light.specular = new Color3(...look.torch).scale(.4); light.range = 13; light.intensity = 0; light.renderPriority = LIGHT_PRIORITY.torch; light.setEnabled(false);
          this.torches.push({ light, flame, base: 3, seed: this.torches.length * 1.7 }); this.parts.push(light);
        } else {
          // Banner between torches: the tier's colour on an iron rod.
          const ban = MeshBuilder.CreatePlane('env-banner', { width: 1.1, height: 2.2 }, s); ban.parent = side; ban.position.set(x, 2.6, zf + innerSign * .27); ban.rotation.y = innerSign > 0 ? Math.PI : 0; ban.material = cloth; meshes.push(ban);
          const rod = MeshBuilder.CreateCylinder('env-rod', { diameter: .06, height: 1.35, tessellation: 6 }, s); rod.parent = side; rod.position.set(x, 3.72, zf + innerSign * .27); rod.rotation.z = Math.PI / 2; rod.material = iron; meshes.push(rod);
        }
      }
      for (const m of meshes) { m.isPickable = false; m.freezeWorldMatrix(); }
      this.parts.push(side, ...meshes);
      const lim = half + 1;
      this.sides.push({ meshes, inside: (x, z) => along === 'x' ? Math.sign(cz) * z < lim : Math.sign(cx) * x < lim });
      void inward;
    }
    // Maze sconces: one torch on each wall run of a cell or longer, alternating faces, so corridors and rooms deep in the
    // maze are lit too. They join the same nearest-three light pool (the light budget is unchanged).
    if (layout) layout.walls.forEach((wl, k) => {
      if (wl.len < 5) return;
      const side = k % 2 ? 1 : -1, nx = Math.cos(wl.yaw) * side, nz = -Math.sin(wl.yaw) * side;
      const px = wl.x + nx * .62, pz = wl.z + nz * .62, faceYaw = Math.atan2(nx, nz);
      const br = MeshBuilder.CreateBox('env-bracket', { width: .12, height: .12, depth: .5 }, s); br.position.set(wl.x + nx * .55, 2.45, wl.z + nz * .55); br.rotation.y = faceYaw; br.material = iron;
      const haft = MeshBuilder.CreateCylinder('env-torch', { diameterTop: .14, diameterBottom: .08, height: .6, tessellation: 8 }, s); haft.position.set(px, 2.62, pz); haft.rotation.set(.35, faceYaw, 0); haft.material = wood;
      const flame = MeshBuilder.CreatePlane('env-flame', { width: .5, height: .75 }, s); flame.position.set(px + nx * .08, 3.1, pz + nz * .08); flame.billboardMode = Mesh.BILLBOARDMODE_Y; flame.material = flameMat;
      for (const m of [br, haft, flame]) { m.isPickable = false; m.freezeWorldMatrix(); }
      this.sconces.push({ meshes: [br, haft, flame], x: wl.x, z: wl.z, yaw: wl.yaw, hx: .35 + .45 + .7, hz: wl.len / 2 + .2 });
      const light = new PointLight('env-torch-light', new Vector3(px + nx * .4, 3, pz + nz * .4), s);
      light.diffuse = new Color3(...look.torch); light.specular = new Color3(...look.torch).scale(.4); light.range = 11; light.intensity = 0; light.renderPriority = LIGHT_PRIORITY.torch; light.setEnabled(false);
      this.torches.push({ light, flame, base: 2.6, seed: this.torches.length * 1.7 }); this.parts.push(br, haft, flame, light);
    });
    // Engraved floor lettering keeps the floor's name (and the jokes) under foot, darker and smaller than before.
    if (floor >= 0) label(floor === 0 ? 'Floor 0' : `Floor ${floor}`, 0, half - 9, 10, Math.PI, '#00000038');
  }

  /** Contact shade under walls and at the perimeter, a worn lighter route from the start to the door. Same UVs as the floor, scale 1. */
  private bakeFloor(size: number, half: number, layout: Layout | null): DynamicTexture {
    const N = 1024, t = new DynamicTexture('env-floor-bake', N, this.scene, true), g = t.getContext() as CanvasRenderingContext2D;
    const P = (x: number, z: number) => [(x / size + .5) * N, (.5 - z / size) * N] as const, px = N / size;
    g.fillStyle = 'rgb(235,235,235)'; g.fillRect(0, 0, N, N);
    // Perimeter shade: the floor darkens toward the walls.
    const edge = (half + 1) * px, mid = N / 2;
    for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(0,0,0,${.05})`; g.lineWidth = (18 - i) * px * .35; g.strokeRect(mid - edge, mid - edge, edge * 2, edge * 2); }
    if (layout) {
      // Worn route: a broad soft lighter band from the start toward the door.
      const [sx, sz] = P(layout.start.x, layout.start.z), [ex, ez] = P(layout.exit.x, layout.exit.z);
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = (5 - i * .6) * px; g.beginPath(); g.moveTo(sx, sz); g.lineTo(ex, ez); g.stroke(); }
      // Contact shade under each ruined wall.
      for (const w of layout.walls) {
        const [cx, cz] = P(w.x, w.z), dx = Math.sin(w.yaw) * w.len / 2 * px, dz = -Math.cos(w.yaw) * w.len / 2 * px;
        for (let i = 0; i < 5; i++) { g.strokeStyle = 'rgba(0,0,0,.09)'; g.lineWidth = (1.6 + i * .5) * px; g.beginPath(); g.moveTo(cx - dx, cz - dz); g.lineTo(cx + dx, cz + dz); g.stroke(); }
      }
    }
    // Damp, moss or soot blooms (cellars more than courts).
    const r = mulberry(5 + Math.round(half)), blooms = Math.round(10 + this.look.moss * 30);
    for (let i = 0; i < blooms; i++) {
      const x = r() * N, y = r() * N, rad = (1.5 + r() * 4) * px, grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(0,0,0,${.08 + this.look.moss * .1})`); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    t.update(); return t;
  }

  /** Per frame: fade the walls the camera stands behind, light the torches nearest the hero, flicker. */
  update(dt: number, cam: Vector3, hero: Vector3): void {
    this.t += dt;
    // A sconce on a wall standing between the camera and the hero fades with that wall (world.ts cutaway, same test).
    for (const sc of this.sconces) {
      const want = blocksView(cam, hero, sc) ? .1 : 1;
      for (const m of sc.meshes) if (Math.abs(m.visibility - want) > .01) m.visibility += (want - m.visibility) * Math.min(1, dt * 10);
    }
    // Fill sits 2.2 above the hero and a third of the way toward the camera.
    this.fill.position.set(hero.x + (cam.x - hero.x) * .3, hero.y + 2.6, hero.z + (cam.z - hero.z) * .3);
    for (const sd of this.sides) {
      const v = sd.inside(cam.x, cam.z) ? 1 : .12;
      for (const m of sd.meshes) if (Math.abs(m.visibility - v) > .01) m.visibility += (v - m.visibility) * Math.min(1, dt * 8);
    }
    const near = [...this.torches].sort((a, b) => Vector3.DistanceSquared(a.light.getAbsolutePosition(), hero) - Vector3.DistanceSquared(b.light.getAbsolutePosition(), hero)).slice(0, NEAR_TORCHES);
    for (const tc of this.torches) {
      const on = near.includes(tc); if (tc.light.isEnabled() !== on) tc.light.setEnabled(on);
      const f = 1 + Math.sin(this.t * 9.3 + tc.seed) * .06 + Math.sin(this.t * 23.1 + tc.seed * 2) * .04;
      if (on) tc.light.intensity = tc.base * f;
      tc.flame.scaling.y = .9 + (f - 1) * 2.5;
    }
  }

  dispose(): void { for (const p of this.parts) p.dispose(); this.parts = []; this.torches = []; this.sides = []; this.sconces = []; }
}

/** Scene-wide light for a look: hemispheric fill, key colour and fog. */
export function applyAtmosphere(scene: Scene, look: EnvLook, hemi: { intensity: number; diffuse: Color3; groundColor: Color3 }, key: { diffuse: Color3; intensity: number }): void {
  hemi.intensity = look.hemi; hemi.diffuse = new Color3(...look.sky); hemi.groundColor = new Color3(...look.ground);
  key.diffuse = new Color3(...look.key); key.intensity = look.keyI;
  scene.fogMode = 2; scene.fogDensity = look.fogDensity; scene.fogColor = new Color3(...look.fog);
  scene.clearColor = new Color4(...look.fog, 1);
  // Tone mapping (ACES), vignette and the grade come from the shared pipeline (render/engine.ts); nothing stacked here.
}
