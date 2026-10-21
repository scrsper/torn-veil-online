import {
  Color3, Color4, DirectionalLight, HDRCubeTexture, HemisphericLight, ImageProcessingConfiguration,
  Mesh, MeshBuilder, Scene, ShaderMaterial, ShadowGenerator, Vector3, type AbstractMesh,
} from '@babylonjs/core';
import type { PlanetDescriptor } from '../../sim/world/universe/generation';
import type { V3 } from '../../sim/world/planet/planet';

export interface UniverseShadowOwner {
  addCaster(mesh: AbstractMesh): void;
  removeCaster(mesh: AbstractMesh): void;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
/** Fixed distant star direction for this presentation revision. No local camera
 * or animation clock changes the canonical planet or world clock. */
export const UNIVERSE_SUN_DIRECTION = Object.freeze({ x: .35, y: .82, z: .45 });
export function universeLightState(radial: V3, altitude: number, atmosphere: number) {
  const n = Math.hypot(radial.x, radial.y, radial.z) || 1;
  const sun = UNIVERSE_SUN_DIRECTION, sn = Math.hypot(sun.x, sun.y, sun.z);
  const elevation = (radial.x * sun.x + radial.y * sun.y + radial.z * sun.z) / (n * sn);
  const air = smooth(1 - Math.max(0, altitude) / Math.max(1, atmosphere));
  const day = smooth((elevation + .12) / .47);
  // Keep daylight ground unchanged, but retain readable terrain on the night
  // side and cloth silhouettes in space through the existing ambient sources.
  // No camera-following light, glow or extra shadow pass is introduced.
  const altitudeFill = smooth((Math.max(0, altitude) - 40) / Math.max(160, atmosphere));
  const nightFill = air * (1 - day);
  return { air, day, elevation, stars: 1 - air * day, shadows: altitude < 120,
    altitudeFill, fillIntensity: .3 + .25 * air * day + .28 * nightFill + .42 * altitudeFill,
    environmentIntensity: .2 + .3 * air * day + .22 * nightFill + .32 * altitudeFill };
}
export interface ShadowCandidate { id: number; distance: number; triangles: number; priority: number }
/** Babylon reports prototype indices, including for thin-instance batches.
 * Every rendered thin instance repeats those triangles in the shadow pass. */
export function shadowTriangleCount(mesh: AbstractMesh): number {
  return Math.ceil(mesh.getTotalIndices() / 3) * Math.max(1, mesh instanceof Mesh ? mesh.thinInstanceCount : 1);
}
/** Admit whole meshes in a deterministic near-first budget. A huge source mesh
 * cannot silently consume an unbounded shadow pass. */
export function chooseShadowCasters(candidates: readonly ShadowCandidate[], count: number, triangles: number) {
  const result: number[] = [];
  let used = 0;
  for (const c of [...candidates].sort((a, b) => b.priority - a.priority || a.distance - b.distance || a.id - b.id)) {
    if (result.length >= count) break;
    if (!Number.isFinite(c.distance) || c.distance > 65 || c.triangles <= 0 || c.triangles + used > triangles) continue;
    result.push(c.id); used += c.triangles;
  }
  return { ids: result, triangles: used };
}

/** Spherical sky, existing CC0 irradiance and a bounded local shadow pass.
 * Lighting is owned and disposed by the view, never by the realm simulation. */
export class UniverseLighting implements UniverseShadowOwner {
  readonly key: DirectionalLight;
  private fill: HemisphericLight;
  private shadow: ShadowGenerator;
  private environment: HDRCubeTexture;
  private dome: Mesh;
  private sky: ShaderMaterial;
  private casters = new Set<AbstractMesh>();
  private age = 1;
  private selected = 0;
  private triangleCount = 0;
  private state = universeLightState(Vector3.Up(), 0, 1);
  private sun = new Vector3(UNIVERSE_SUN_DIRECTION.x, UNIVERSE_SUN_DIRECTION.y, UNIVERSE_SUN_DIRECTION.z).normalize();
  private disposed = false;
  constructor(private scene: Scene, private lite = false) {
    this.key = new DirectionalLight('astral-sun', this.sun.scale(-1), scene);
    this.key.position.copyFrom(this.sun.scale(85));
    this.key.diffuse = new Color3(1, .91, .79);
    this.key.shadowMinZ = 1; this.key.shadowMaxZ = 180;
    this.key.shadowFrustumSize = 72;
    this.key.autoUpdateExtends = false; this.key.autoCalcShadowZBounds = false;
    this.fill = new HemisphericLight('astral-fill', Vector3.Up(), scene);
    this.fill.specular = Color3.Black();
    this.shadow = new ShadowGenerator(lite ? 1024 : 2048, this.key);
    this.shadow.usePercentageCloserFiltering = true;
    this.shadow.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    // At this bounded local depth range, the former bias detached the contact
    // shadow by several centimetres. Keep enough offset to avoid self acne.
    this.shadow.bias = .00008; this.shadow.normalBias = .008;
    this.shadow.setDarkness(.2);
    this.environment = new HDRCubeTexture('/textures/environment/kloppenheim_06_puresky_1k.hdr', scene, 128, false, true, false, true);
    scene.environmentTexture = this.environment;
    scene.ambientColor = new Color3(.08, .09, .11);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.02;
    scene.imageProcessingConfiguration.contrast = 1.04;
    this.sky = new ShaderMaterial('astral-sky-gradient', scene, {
      vertexSource: 'precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 ray; void main(){ray=position; gl_Position=worldViewProjection*vec4(position,1.0);}',
      fragmentSource: `precision highp float; varying vec3 ray; uniform vec3 radial; uniform vec3 sun; uniform vec3 tint; uniform float air; uniform float day;
        void main(){vec3 r=normalize(ray); float h=max(0.0,dot(r,radial));
          vec3 space=vec3(.003,.006,.018);
          vec3 zenith=mix(vec3(.012,.024,.065),tint*.48,day);
          vec3 horizon=mix(vec3(.035,.045,.09),mix(tint,vec3(.92,.84,.72),.3),day);
          vec3 sky=mix(horizon,zenith,pow(h,.42));
          float facing=max(0.0,dot(r,sun));
          sky+=vec3(1.0,.72,.4)*pow(facing,36.0)*.13*day;
          vec3 color=mix(space,sky,air);
          color+=vec3(1.0,.89,.67)*smoothstep(.99989,.99996,facing)*(.65+.35*air);
          gl_FragColor=vec4(color,1.0);}`,
    }, { attributes: ['position'], uniforms: ['worldViewProjection', 'radial', 'sun', 'tint', 'air', 'day'] });
    this.sky.backFaceCulling = false; this.sky.fogEnabled = false;
    this.sky.setVector3('sun', this.sun);
    this.dome = MeshBuilder.CreateSphere('astral-sky', { diameter: 500000, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
    this.dome.material = this.sky; this.dome.infiniteDistance = true; this.dome.isPickable = false;
    this.dome.applyFog = false;
    this.update({ palette: { sky: '#84bad8' }, atmosphere: 1 } as PlanetDescriptor, Vector3.Up(), 1, 0);
  }
  addCaster(mesh: AbstractMesh) { if (!this.disposed) this.casters.add(mesh); }
  removeCaster(mesh: AbstractMesh) {
    this.casters.delete(mesh);
    this.shadow.removeShadowCaster(mesh, false);
  }
  get starVisibility() { return this.state.stars; }
  update(planet: PlanetDescriptor, radial: V3, altitude: number, dt: number) {
    if (this.disposed) return;
    this.state = universeLightState(radial, altitude, planet.atmosphere);
    const { air, day, altitudeFill } = this.state, sky = Color3.FromHexString(planet.palette.sky);
    this.sky.setVector3('radial', new Vector3(radial.x, radial.y, radial.z).normalize());
    this.sky.setColor3('tint', sky); this.sky.setFloat('air', air); this.sky.setFloat('day', day);
    this.key.intensity = 1.45;
    this.fill.direction.set(radial.x, radial.y, radial.z);
    this.fill.diffuse = Color3.Lerp(new Color3(.5, .58, .74), new Color3(.76, .8, .86), day);
    this.fill.groundColor = Color3.Lerp(new Color3(.14, .16, .22), new Color3(.3, .27, .24), day);
    this.fill.groundColor.addInPlace(new Color3(.18, .2, .24).scale(altitudeFill));
    this.fill.intensity = this.state.fillIntensity;
    this.scene.environmentIntensity = this.state.environmentIntensity;
    this.scene.clearColor = new Color4(.003, .006, .018, 1);
    this.scene.fogMode = air > .02 ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_NONE;
    this.scene.fogDensity = .00022 * air;
    this.scene.fogColor.copyFrom(sky.scale(.25 + .45 * day));
    this.age += Math.max(0, dt);
    if (!this.state.shadows) {
      this.shadow.getShadowMap()!.renderList = []; this.selected = this.triangleCount = 0;
    } else if (this.age >= .2) {
      this.age = 0;
      const meshes = new Map<number, AbstractMesh>(), candidates: ShadowCandidate[] = [];
      for (const mesh of this.casters) {
        if (mesh.isDisposed()) { this.casters.delete(mesh); continue; }
        if (!mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= .01 || !mesh.getTotalVertices()) continue;
        mesh.computeWorldMatrix(true);
        const sphere = mesh.getBoundingInfo().boundingSphere;
        const distance = Math.max(0, sphere.centerWorld.length() - sphere.radiusWorld);
        let hero = false;
        for (let node: typeof mesh.parent = mesh; node; node = node.parent)
          if (node.metadata?.bodyId) { hero = true; break; }
        candidates.push({ id: mesh.uniqueId, distance, triangles: shadowTriangleCount(mesh), priority: hero ? 1 : 0 });
        meshes.set(mesh.uniqueId, mesh);
      }
      const selection = chooseShadowCasters(candidates, this.lite ? 48 : 112, this.lite ? 100000 : 240000);
      this.shadow.getShadowMap()!.renderList = selection.ids.map(id => meshes.get(id)!);
      this.selected = selection.ids.length; this.triangleCount = selection.triangles;
    }
  }
  stats() { return { ...this.state, casters: this.selected, triangles: this.triangleCount, registered: this.casters.size, shadowMap: this.lite ? 1024 : 2048, environment: 'kloppenheim_06_puresky_1k.hdr' }; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.casters.clear();
    this.shadow.dispose(); this.dome.dispose(); this.sky.dispose();
    if (this.scene.environmentTexture === this.environment) this.scene.environmentTexture = null;
    this.environment.dispose(); this.key.dispose(); this.fill.dispose();
  }
}
