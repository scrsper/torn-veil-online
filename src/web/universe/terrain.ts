import {
  Color3, Constants, Mesh, MeshBuilder, RawTexture, ShaderMaterial, StandardMaterial, Texture, TransformNode, Vector3, VertexData,
  type Scene,
} from '@babylonjs/core';
import { add, cross, dot, length, normalize, scale, sub, tangentFrame, type V3 } from '../../sim/world/planet/planet';
import { cubeToDir } from '../../sim/world/planet/scatter';
import { terrainHeight, terrainNormal, surfaceColor, type PlanetDescriptor, type StarSystem } from '../../sim/world/universe/generation';

/** Renderer-owned geometry only. No clock, travel, collision, resource or discovery state
 * is authored here. Every resolution samples the same canonical spherical height field. */
export interface TerrainTile { face: number; level: number; x: number; y: number }
export interface TerrainGeometry {
  positions: number[]; normals: number[]; colors: number[]; indices: number[]; uvs: number[];
  surfaceVertices: number;
}
export interface UniverseTerrainStats {
  planets: number; tiles: number; vertices: number; triangles: number; pendingTiles: number; rebuilds: number; decorations: number;
}
const ROOTS: readonly TerrainTile[] = Array.from({ length: 6 }, (_, face) => ({ face, level: 0, x: 0, y: 0 }));
const keyOf = (t: TerrainTile) => `${t.face}/${t.level}/${t.x}/${t.y}`;
const childrenOf = (t: TerrainTile): TerrainTile[] => [
  { face: t.face, level: t.level + 1, x: t.x * 2, y: t.y * 2 },
  { face: t.face, level: t.level + 1, x: t.x * 2 + 1, y: t.y * 2 },
  { face: t.face, level: t.level + 1, x: t.x * 2, y: t.y * 2 + 1 },
  { face: t.face, level: t.level + 1, x: t.x * 2 + 1, y: t.y * 2 + 1 },
];

/** Integer dyadic addresses make shared vertices identical at tile and cube-face seams. */
export function terrainTileDirection(tile: TerrainTile, u: number, v: number): V3 {
  const count = 2 ** tile.level;
  const x = ((tile.x + u) / count * 2 - 1) * Math.PI / 4;
  const y = ((tile.y + v) / count * 2 - 1) * Math.PI / 4;
  return cubeToDir(tile.face, Math.tan(x), Math.tan(y));
}

/** A bounded, closest-first quadtree. Ancestors remain in the plan so the renderer can
 * substitute children atomically, retaining complete coverage while geometry streams. */
export function selectTerrainTiles(planet: PlanetDescriptor, observer: V3, lite = false): TerrainTile[] {
  const local = sub(observer, planet.center), radialDistance = length(local);
  const maxLevel = lite ? 5 : 7, maxLeaves = lite ? 78 : 150;
  const leaves = ROOTS.map(t => ({ ...t }));
  const all = [...leaves];
  if (radialDistance > planet.radius * 5) return all;
  const up = normalize(local);
  const priorities = new Map<string, number>();
  const priority = (t: TerrainTile) => {
    if (t.level >= maxLevel) return 0;
    const key = keyOf(t), cached = priorities.get(key);
    if (cached !== undefined) return cached;
    const dir = terrainTileDirection(t, .5, .5);
    // Refine the visible hemisphere only. Level-zero face tiles still cover the back.
    if (t.level > 0 && dot(dir, up) < -.1) return 0;
    const edge = planet.radius * Math.PI / 2 / 2 ** t.level;
    const centre = scale(dir, planet.radius + terrainHeight(planet, dir));
    const distance = Math.max(8, length(sub(local, centre)) - edge * .45);
    const score = edge / distance;
    priorities.set(key, score);
    return score;
  };
  while (leaves.length + 3 <= maxLeaves) {
    let best = -1, score = lite ? 1.05 : .82;
    for (let i = 0; i < leaves.length; i++) {
      const p = priority(leaves[i]);
      if (p > score) { score = p; best = i; }
    }
    if (best < 0) break;
    const children = childrenOf(leaves[best]);
    leaves.splice(best, 1, ...children); all.push(...children);
  }
  return all;
}

/** Mesh vertices are planet-local metres. The shared parent supplies center-origin;
 * changing the floating origin never regenerates or rounds canonical geography. */
export function buildTerrainTile(planet: PlanetDescriptor, tile: TerrainTile, cells = 16,
  underlayHeight?: (planet: PlanetDescriptor, direction: V3) => number | null): TerrainGeometry {
  if (!Number.isInteger(cells) || cells < 2 || cells > 64) throw Error('Terrain cells must be an integer from 2 to 64');
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [], uvs: number[] = [];
  const stride = cells + 1;
  for (let y = 0; y <= cells; y++) for (let x = 0; x <= cells; x++) {
    const dir = terrainTileDirection(tile, x / cells, y / cells);
    const height = terrainHeight(planet, dir), radius = planet.radius + (underlayHeight?.(planet, dir) ?? height);
    const color = Color3.FromHexString(surfaceColor(planet, dir, height));
    positions.push(dir.x * radius, dir.y * radius, dir.z * radius);
    if (x === 0 || y === 0 || x === cells || y === cells) {
      // Exact shared field normals on the perimeter prevent lighting seams between
      // tiles. Interior normals follow actual rendered triangles at this LOD.
      const normal = terrainNormal(planet, dir);
      normals.push(normal.x, normal.y, normal.z);
    } else normals.push(0, 0, 0);
    colors.push(color.r, color.g, color.b, 1);
    // Integer repeats make every cube border land on the same periodic texture edge.
    // The grain texture is also reflection/axis symmetric for rotated face charts.
    const repeats = Math.max(1, Math.round(planet.radius * Math.PI / 2 / 9));
    uvs.push((tile.x + x / cells) / 2 ** tile.level * repeats, (tile.y + y / cells) / 2 ** tile.level * repeats);
  }
  const positionAt = (i: number): V3 => ({ x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] });
  for (let y = 1; y < cells; y++) for (let x = 1; x < cells; x++) {
    const i = y * stride + x;
    let normal = normalize(cross(sub(positionAt(i + stride), positionAt(i - stride)), sub(positionAt(i + 1), positionAt(i - 1))));
    if (dot(normal, positionAt(i)) < 0) normal = scale(normal, -1);
    normals[i * 3] = normal.x; normals[i * 3 + 1] = normal.y; normals[i * 3 + 2] = normal.z;
  }
  // Babylon's default LH normals/front faces use a clockwise winding from outside.
  // Flip individual faces where the cube chart's axes have the opposite parity.
  const triangle = (a: number, b: number, c: number) => {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3] - ax, by = positions[b * 3 + 1] - ay, bz = positions[b * 3 + 2] - az;
    const cx = positions[c * 3] - ax, cy = positions[c * 3 + 1] - ay, cz = positions[c * 3 + 2] - az;
    const facing = (by * cz - bz * cy) * ax + (bz * cx - bx * cz) * ay + (bx * cy - by * cx) * az;
    if (facing > 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const a = y * stride + x, b = a + 1, c = a + stride, d = c + 1;
    triangle(a, c, b); triangle(b, c, d);
  }
  const surfaceVertices = positions.length / 3;
  const perimeter: number[] = [];
  for (let i = 0; i < cells; i++) perimeter.push(i);
  for (let i = 0; i < cells; i++) perimeter.push(i * stride + cells);
  for (let i = cells; i > 0; i--) perimeter.push(cells * stride + i);
  for (let i = cells; i > 0; i--) perimeter.push(i * stride);
  // Downward skirts hide different-resolution T junctions without lifting the walkable
  // surface. Two relief scales plus chord sag bound the visible transition gap.
  const edge = planet.radius * Math.PI / 2 / 2 ** tile.level;
  const skirtDepth = Math.min(planet.radius * .22, Math.max(12, edge * .32));
  for (const i of perimeter) {
    const p = { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] };
    const factor = (length(p) - skirtDepth) / length(p);
    positions.push(p.x * factor, p.y * factor, p.z * factor);
    normals.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
    colors.push(colors[i * 4] * .82, colors[i * 4 + 1] * .82, colors[i * 4 + 2] * .82, 1);
    uvs.push(uvs[i * 2], uvs[i * 2 + 1]);
  }
  for (let i = 0; i < perimeter.length; i++) {
    const j = (i + 1) % perimeter.length;
    // Skirts are radial: their facing dot is degenerate, so use perimeter order.
    indices.push(perimeter[i], surfaceVertices + i, perimeter[j]);
    indices.push(perimeter[j], surfaceVertices + i, surfaceVertices + j);
  }
  return { positions, normals, colors, indices, uvs, surfaceVertices };
}

export interface SurfaceDecoration { id: string; dir: V3; height: number; scale: number; kind: 'grass' | 'stone' | 'crystal'; tint: number }
function decorationHash(seed: number, face: number, x: number, y: number): number {
  let h = seed ^ Math.imul(face + 1, 0x9e3779b1) ^ Math.imul(x, 0x85ebca77) ^ Math.imul(y, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Sub-half-metre cosmetic markers. They have no canonical IDs, resources, collision,
 * or discovery meaning. Cube-cell addresses keep repeated visits visually consistent. */
export function surfaceDecorations(planet: PlanetDescriptor, observer: V3, lite = false): SurfaceDecoration[] {
  const up = normalize(sub(observer, planet.center)), radius = lite ? 43 : 72;
  const n = 2 ** Math.round(Math.log2(planet.radius / (lite ? 2.3 : 1.4)));
  const candidates: { face: number; x: number; y: number; dir: V3; hash: number; proximity: number }[] = [];
  const minimumDot = Math.cos(radius / planet.radius);
  for (let face = 0; face < 6; face++) {
    const axis = face < 2 ? up.x * (face === 0 ? 1 : -1) : face < 4 ? up.y * (face === 2 ? 1 : -1) : up.z * (face === 4 ? 1 : -1);
    if (axis < .45) continue;
    const uv = face === 0 ? [-up.z / axis, up.y / axis] : face === 1 ? [up.z / axis, up.y / axis]
      : face === 2 ? [up.x / axis, -up.z / axis] : face === 3 ? [up.x / axis, up.z / axis]
        : face === 4 ? [up.x / axis, up.y / axis] : [-up.x / axis, up.y / axis];
    const cx = (uv[0] + 1) * n / 2, cy = (uv[1] + 1) * n / 2;
    const span = Math.ceil(radius / planet.radius * n / (axis * axis) * .65) + 2;
    for (let y = Math.max(0, Math.floor(cy - span)); y <= Math.min(n - 1, cy + span); y++) {
      for (let x = Math.max(0, Math.floor(cx - span)); x <= Math.min(n - 1, cx + span); x++) {
        const hash = decorationHash(planet.seed, face, x, y);
        if (hash > .88) continue;
        const dx = decorationHash(planet.seed ^ 0x5341, face, x, y);
        const dy = decorationHash(planet.seed ^ 0x98ab, face, x, y);
        const dir = cubeToDir(face, (x + .15 + dx * .7) / n * 2 - 1, (y + .15 + dy * .7) / n * 2 - 1);
        const proximity = dot(dir, up);
        if (proximity > minimumDot) candidates.push({ face, x, y, dir, hash, proximity });
      }
    }
  }
  candidates.sort((a, b) => b.proximity - a.proximity);
  const result: SurfaceDecoration[] = [], limit = lite ? 500 : 1600;
  for (const candidate of candidates) {
    if (result.length >= limit) break;
    const height = terrainHeight(planet, candidate.dir);
    if (height < .8) continue;
    const vegetation = (planet.kind === 'temperate' || planet.kind === 'oceanic') && Math.abs(candidate.dir.y) < .87;
    result.push({
      id: `${candidate.face}/${candidate.x}/${candidate.y}`, dir: candidate.dir, height,
      scale: .16 + candidate.hash * .32,
      kind: vegetation && candidate.hash < .68 ? 'grass' : planet.kind === 'glacial' ? 'crystal' : 'stone',
      tint: candidate.hash,
    });
  }
  return result;
}

export const TERRAIN_GRAIN_SIZE = 128;
/** CPU-generated source pixels make the material's seam behavior testable headlessly. */
export function buildGroundTextureData(): Uint8Array {
  const size = TERRAIN_GRAIN_SIZE, data = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Sample at texel centers so bilinear wrapping, reflections and 90° rotations
    // agree exactly. Cube faces share geometry but do not share UV orientation.
    const a = (x + .5) / size * Math.PI * 2, b = (y + .5) / size * Math.PI * 2;
    const broad = Math.cos(a * 2) * Math.cos(b * 2) * .65 + Math.cos(a) * Math.cos(b) * .35;
    const mx = Math.min(x, size - x - 1), my = Math.min(y, size - y - 1);
    const grain = decorationHash(0x74657272, 0, Math.min(mx, my), Math.max(mx, my));
    const fine = (Math.cos(a * 18) * Math.cos(b * 18) + Math.cos(a * 29) * Math.cos(b * 29)) * .5;
    const value = Math.max(0, Math.min(255, Math.round(216 + broad * 23 + fine * 7 + (grain - .5) * 20)));
    data.fill(value, (y * size + x) * 3, (y * size + x) * 3 + 3);
  }
  return data;
}

function createGroundTexture(scene: Scene): RawTexture {
  const size = TERRAIN_GRAIN_SIZE, data = buildGroundTextureData();
  const texture = RawTexture.CreateRGBTexture(data, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = 'universe:procedural-ground-grain';
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 4;
  return texture;
}

interface TileMesh { address: TerrainTile; mesh: Mesh }
interface PlanetMeshes {
  planet: PlanetDescriptor; root: TransformNode; tiles: Map<string, TileMesh>;
  desired: Map<string, TerrainTile>; ground: StandardMaterial; water: Mesh; sea: StandardMaterial;
  atmosphere: Mesh; air: ShaderMaterial;
}

const ATMOSPHERE_VERTEX = `precision highp float;
attribute vec3 position; attribute vec3 normal;
uniform mat4 world; uniform mat4 worldViewProjection;
varying vec3 vPosition; varying vec3 vNormal;
void main() {
  vPosition = (world * vec4(position, 1.0)).xyz;
  vNormal = normalize((world * vec4(normal, 0.0)).xyz);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;
const ATMOSPHERE_FRAGMENT = `precision highp float;
varying vec3 vPosition; varying vec3 vNormal;
uniform vec3 eye; uniform vec3 tint; uniform vec3 sunDirection;
uniform float strength;
void main() {
  vec3 viewDirection = normalize(eye - vPosition);
  float rim = pow(clamp(1.0 - abs(dot(vNormal, viewDirection)), 0.0, 1.0), 3.5);
  float daylight = 0.2 + 0.8 * smoothstep(-0.3, 0.65, dot(vNormal, sunDirection));
  gl_FragColor = vec4(tint * (0.65 + 0.55 * rim), rim * daylight * strength);
}`;

/**
 * Bounded streaming:
 * - six permanent root tiles per world;
 * - at most 198 resident terrain tiles on the nearest world (102 in lite mode);
 * - two new 16×16 tiles per update (one 10×10 in lite mode);
 * - every parent stays visible until all four children are ready.
 *
 * Refinement is driven by canonical observer position. Frame time only determines when
 * an improved presentation becomes available, never where a character can travel.
 */
export class UniverseTerrain {
  private readonly planets: PlanetMeshes[] = [];
  private readonly cells: number;
  private readonly budget: number;
  private lastObserver: V3 | null = null;
  private lastNearest = '';
  private rebuilds = 0;
  private disposed = false;
  private queue: { state: PlanetMeshes; tile: TerrainTile }[] = [];
  private readonly eye = new Vector3();
  private readonly sun = new Vector3(.55, .65, .52).normalize();
  private readonly texture: RawTexture;
  private readonly detailMaterial: StandardMaterial;
  private dressing: { state: PlanetMeshes; mesh: Mesh; observer: V3; count: number } | null = null;

  constructor(readonly scene: Scene, readonly system: StarSystem, readonly lite = false,
    private readonly underlayHeight?: (planet: PlanetDescriptor, direction: V3) => number | null) {
    this.cells = lite ? 10 : 16; this.budget = lite ? 1 : 2;
    this.texture = createGroundTexture(scene);
    this.detailMaterial = new StandardMaterial('universe:surface-decoration', scene);
    this.detailMaterial.diffuseColor = Color3.White();
    this.detailMaterial.ambientColor = new Color3(.24, .27, .2);
    this.detailMaterial.specularColor = new Color3(.025, .025, .025);
    this.detailMaterial.backFaceCulling = false;
    for (const planet of system.planets) {
      const root = new TransformNode(`universe:${planet.id}`, scene);
      const ground = new StandardMaterial(`terrain:${planet.id}`, scene);
      ground.diffuseColor = Color3.White();
      ground.ambientColor = new Color3(.22, .25, .29);
      ground.specularColor = new Color3(.035, .035, .035);
      ground.specularPower = 24;
      ground.diffuseTexture = this.texture;
      // Double-sided skirts avoid cracks regardless of cube-face winding and view.
      ground.backFaceCulling = false;
      const sea = new StandardMaterial(`sea:${planet.id}`, scene);
      sea.diffuseColor = Color3.FromHexString(planet.palette.water).scale(.85);
      sea.ambientColor = sea.diffuseColor.scale(.5);
      sea.specularColor = new Color3(.62, .69, .76);
      sea.specularPower = 128;
      const water = MeshBuilder.CreateSphere(`water:${planet.id}`, {
        diameter: planet.radius * 2, segments: lite ? 40 : 80,
      }, scene);
      water.parent = root; water.material = sea; water.isPickable = false;
      const air = new ShaderMaterial(`air:${planet.id}`, scene, {
        vertexSource: ATMOSPHERE_VERTEX, fragmentSource: ATMOSPHERE_FRAGMENT,
      }, {
        attributes: ['position', 'normal'],
        uniforms: ['world', 'worldViewProjection', 'eye', 'tint', 'sunDirection', 'strength'],
        needAlphaBlending: true,
      });
      air.setColor3('tint', Color3.FromHexString(planet.palette.sky));
      air.setVector3('sunDirection', this.sun);
      air.setFloat('strength', .55);
      air.alphaMode = Constants.ALPHA_ADD;
      air.backFaceCulling = false; air.disableDepthWrite = true;
      const atmosphere = MeshBuilder.CreateSphere(`atmosphere:${planet.id}`, {
        diameter: (planet.radius + planet.atmosphere * .52) * 2, segments: lite ? 24 : 48,
      }, scene);
      atmosphere.parent = root; atmosphere.material = air; atmosphere.isPickable = false;
      atmosphere.applyFog = false;
      const state: PlanetMeshes = {
        planet, root, tiles: new Map(), desired: new Map(ROOTS.map(t => [keyOf(t), t])),
        ground, water, sea, atmosphere, air,
      };
      this.planets.push(state);
      for (const tile of ROOTS) this.createTile(state, tile);
    }
  }

  /** The parent client may use the same direction for its directional light. */
  setSunDirection(direction: V3): void {
    this.sun.set(direction.x, direction.y, direction.z).normalize();
    for (const state of this.planets) state.air.setVector3('sunDirection', this.sun);
  }

  private createTile(state: PlanetMeshes, tile: TerrainTile): void {
    const geometry = buildTerrainTile(state.planet, tile, this.cells, this.underlayHeight);
    const mesh = new Mesh(`terrain:${state.planet.id}:${keyOf(tile)}`, this.scene);
    const data = new VertexData();
    data.positions = geometry.positions; data.normals = geometry.normals;
    data.colors = geometry.colors; data.indices = geometry.indices; data.uvs = geometry.uvs;
    data.applyToMesh(mesh);
    mesh.parent = state.root; mesh.material = state.ground;
    mesh.isPickable = false; mesh.receiveShadows = true;
    // Streamed children are hidden until the parent can hand over a complete quad.
    mesh.setEnabled(tile.level === 0);
    state.tiles.set(keyOf(tile), { address: tile, mesh });
    this.rebuilds++;
  }

  private plan(observer: V3, nearest: PlanetMeshes): void {
    this.queue = [];
    for (const state of this.planets) {
      const tiles = state === nearest ? selectTerrainTiles(state.planet, observer, this.lite) : [...ROOTS];
      state.desired = new Map(tiles.map(t => [keyOf(t), t]));
      for (const [key, tile] of state.tiles) {
        if (!state.desired.has(key)) { tile.mesh.dispose(); state.tiles.delete(key); }
      }
      const nearestFirst = (a: TerrainTile, b: TerrainTile) => this.distanceToTile(state, a, observer) - this.distanceToTile(state, b, observer);
      const enqueueBranch = (parent: TerrainTile) => {
        const children = childrenOf(parent).filter(child => state.desired.has(keyOf(child))).sort(nearestFirst);
        // Schedule a complete sibling quad before going deeper: every visible handoff
        // remains atomic, but the nearest branch no longer waits behind the whole globe.
        for (const tile of children) if (!state.tiles.has(keyOf(tile))) this.queue.push({ state, tile });
        for (const child of children) enqueueBranch(child);
      };
      [...ROOTS].sort(nearestFirst).forEach(enqueueBranch);
    }
    // V3 is structural: Babylon Vector3 exposes x/y/z through prototype accessors,
    // so spreading it copies _x/_y/_z instead of a usable canonical coordinate.
    this.lastObserver = { x: observer.x, y: observer.y, z: observer.z }; this.lastNearest = nearest.planet.id;
    this.refreshVisibility();
  }

  private distanceToTile(state: PlanetMeshes, tile: TerrainTile, observer: V3): number {
    return length(sub(sub(observer, state.planet.center), scale(terrainTileDirection(tile, .5, .5), state.planet.radius)));
  }

  private refreshVisibility(): void {
    for (const state of this.planets) {
      for (const tile of state.tiles.values()) tile.mesh.setEnabled(false);
      const show = (address: TerrainTile) => {
        const tile = state.tiles.get(keyOf(address));
        if (!tile) return;
        const children = childrenOf(address);
        if (children.every(child => state.desired.has(keyOf(child)) && state.tiles.has(keyOf(child)))) {
          children.forEach(show);
        } else tile.mesh.setEnabled(true);
      };
      ROOTS.forEach(show);
    }
  }

  private updateDressing(state: PlanetMeshes, observer: V3, altitude: number): void {
    if (altitude > 120) {
      this.dressing?.mesh.setEnabled(false);
      return;
    }
    if (this.dressing?.state === state && length(sub(observer, this.dressing.observer)) < 18) {
      this.dressing.mesh.setEnabled(true);
      return;
    }
    this.dressing?.mesh.dispose();
    const details = surfaceDecorations(state.planet, observer, this.lite)
      .filter(detail => this.underlayHeight?.(state.planet, detail.dir) == null);
    const positions: number[] = [], colors: number[] = [], indices: number[] = [], normals: number[] = [];
    for (const detail of details) {
      const frame = tangentFrame(detail.dir), ground = scale(detail.dir, state.planet.radius + detail.height - .015);
      const color = Color3.FromHexString(detail.kind === 'grass' ? state.planet.palette.land : state.planet.palette.rock);
      if (detail.kind === 'grass') {
        color.r *= .72 + detail.tint * .7; color.g *= .8 + detail.tint * .65; color.b *= .55 + detail.tint * .55;
      } else if (detail.kind === 'crystal') {
        color.r = .55 + detail.tint * .3; color.g = .72 + detail.tint * .2; color.b = .78 + detail.tint * .2;
      } else {
        color.r *= .7 + detail.tint * .55; color.g *= .7 + detail.tint * .55; color.b *= .7 + detail.tint * .55;
      }
      const vertex = (east: number, height: number, north: number, brightness = 1) => {
        const p = add(ground, add(scale(frame.east, east), add(scale(detail.dir, height), scale(frame.north, north))));
        const i = positions.length / 3;
        positions.push(p.x, p.y, p.z); colors.push(color.r * brightness, color.g * brightness, color.b * brightness, 1);
        return i;
      };
      if (detail.kind === 'grass') {
        for (let blade = 0; blade < 3; blade++) {
          const angle = detail.tint * Math.PI * 2 + blade * Math.PI / 3;
          const width = detail.scale * .24, dx = Math.cos(angle) * width, dz = Math.sin(angle) * width;
          const a = vertex(-dx, 0, -dz, .7), b = vertex(dx, 0, dz, .7);
          const c = vertex(dx * 1.2, detail.scale * (1 - blade * .12), dz * 1.2, 1.12);
          indices.push(a, b, c);
        }
      } else {
        const width = detail.scale * .45, height = detail.kind === 'crystal' ? detail.scale : detail.scale * .45;
        const base = [
          vertex(-width, .015, 0, .65), vertex(0, .015, width, .8),
          vertex(width, .015, 0, .95), vertex(0, .015, -width, .8),
        ];
        const top = vertex(width * .15, height, width * .1, 1.1);
        for (let side = 0; side < 4; side++) indices.push(base[side], base[(side + 1) % 4], top);
      }
    }
    VertexData.ComputeNormals(positions, indices, normals);
    // Decoration is double-sided and normals must face away from the planet.
    for (let i = 0; i < normals.length; i += 3) {
      if (normals[i] * positions[i] + normals[i + 1] * positions[i + 1] + normals[i + 2] * positions[i + 2] < 0) {
        normals[i] *= -1; normals[i + 1] *= -1; normals[i + 2] *= -1;
      }
    }
    const mesh = new Mesh(`surface-detail:${state.planet.id}`, this.scene), data = new VertexData();
    Object.assign(data, { positions, colors, indices, normals }); data.applyToMesh(mesh);
    mesh.parent = state.root; mesh.material = this.detailMaterial; mesh.isPickable = false;
    this.dressing = { state, mesh, observer: { x: observer.x, y: observer.y, z: observer.z }, count: details.length };
  }

  update(observer: V3, origin: V3): void {
    if (this.disposed || this.planets.length === 0) return;
    let nearest = this.planets[0], closest = Infinity;
    this.eye.set(observer.x - origin.x, observer.y - origin.y, observer.z - origin.z);
    for (const state of this.planets) {
      const distance = length(sub(observer, state.planet.center)) - state.planet.radius;
      if (distance < closest) { closest = distance; nearest = state; }
      state.root.position.set(
        state.planet.center.x - origin.x, state.planet.center.y - origin.y, state.planet.center.z - origin.z,
      );
      state.air.setVector3('eye', this.eye);
      // Rim is an orbital effect; the client owns the local sky gradient/fog.
      state.air.setFloat('strength', .55 * Math.min(1, Math.max(0, distance / (state.planet.atmosphere * .6))));
    }
    const movementThreshold = Math.max(8, Math.max(0, closest) * .06);
    if (!this.lastObserver || nearest.planet.id !== this.lastNearest || length(sub(observer, this.lastObserver)) >= movementThreshold) {
      this.plan(observer, nearest);
    }
    let changed = false;
    const workStarted = performance.now();
    for (let i = 0; i < this.budget && this.queue.length; i++) {
      const next = this.queue.shift()!;
      this.createTile(next.state, next.tile); changed = true;
      // A tile is the smallest work unit; don't begin a second expensive tile when
      // the first consumed the soft upload budget on this device.
      if (performance.now() - workStarted >= 5) break;
    }
    if (changed) this.refreshVisibility();
    const localAltitude = closest - terrainHeight(nearest.planet, normalize(sub(observer, nearest.planet.center)));
    this.updateDressing(nearest, observer, localAltitude);
  }

  stats(): UniverseTerrainStats {
    let tiles = 0, vertices = 0, triangles = 0;
    for (const state of this.planets) for (const tile of state.tiles.values()) {
      if (!tile.mesh.isEnabled()) continue;
      tiles++; vertices += tile.mesh.getTotalVertices(); triangles += tile.mesh.getTotalIndices() / 3;
    }
    return {
      planets: this.planets.length, tiles, vertices, triangles,
      pendingTiles: this.queue.length, rebuilds: this.rebuilds,
      decorations: this.dressing?.mesh.isEnabled() ? this.dressing.count : 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.queue = [];
    for (const state of this.planets) {
      state.root.dispose(false);
      state.ground.dispose(); state.sea.dispose(); state.air.dispose();
      state.tiles.clear();
    }
    this.dressing = null; this.texture.dispose(); this.detailMaterial.dispose();
    this.planets.length = 0;
  }
}
