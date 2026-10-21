import {
  CascadedShadowGenerator, Color3, Color4, DirectionalLight, Effect, GlowLayer, HemisphericLight, Mesh, MeshBuilder, PointLight, Scene, ShaderMaterial, ShadowGenerator,
  StandardMaterial, Texture, Vector3, VolumetricLightScatteringPostProcess, type Camera,
} from '@babylonjs/core';

/** Golden-hour (or dusk / day) lighting for the town: a low warm sun with cascaded shadows, a
 * cool sky fill with warm ground bounce, exponential height-less haze tinted like the horizon,
 * a gradient sky dome with sun glow and a thin cloud deck, light shafts from the sun, and lamp
 * glow. Presentation only. */
export type TimeOfDay = 'golden' | 'dusk' | 'day';
interface Preset { elev: number; az: number; sun: Color3; sunI: number; sky: Color3; ground: Color3; hemiI: number; zenith: Color3; horizon: Color3; fog: Color3; fogD: number; env: number; lamps: number; windows: number; exposure: number }
const D = Math.PI / 180;
export const PRESETS: Record<TimeOfDay, Preset> = {
  golden: { elev: 15, az: -58, sun: new Color3(1, .72, .46), sunI: 4.6, sky: new Color3(.5, .6, .82), ground: new Color3(.42, .33, .22), hemiI: .85, zenith: new Color3(.22, .38, .66), horizon: new Color3(1, .74, .5), fog: new Color3(.86, .7, .55), fogD: .0032, env: .45, lamps: .7, windows: .45, exposure: 1.0 },
  dusk: { elev: 1.5, az: -68, sun: new Color3(1, .45, .26), sunI: 1.6, sky: new Color3(.3, .34, .55), ground: new Color3(.25, .16, .12), hemiI: .5, zenith: new Color3(.08, .12, .3), horizon: new Color3(.95, .48, .3), fog: new Color3(.5, .38, .38), fogD: .0055, env: .2, lamps: 2.2, windows: 1.4, exposure: 1.15 },
  day: { elev: 42, az: -35, sun: new Color3(1, .95, .86), sunI: 4.4, sky: new Color3(.55, .68, .9), ground: new Color3(.4, .35, .28), hemiI: .7, zenith: new Color3(.2, .42, .8), horizon: new Color3(.75, .85, .95), fog: new Color3(.72, .8, .88), fogD: .0028, env: .7, lamps: 0, windows: 0, exposure: 1.0 },
};
Effect.ShadersStore.townSkyVertexShader = `precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vDir;
void main(){ vDir = position; gl_Position = worldViewProjection * vec4(position, 1.); gl_Position.z = gl_Position.w * .99995; }`;
Effect.ShadersStore.townSkyFragmentShader = `precision highp float;
varying vec3 vDir; uniform vec3 sunDir, zenith, horizon, fogCol; uniform float sunI, time;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1., 0.)), f.x), mix(h(i + vec2(0., 1.)), h(i + 1.), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += n(p) * a; p *= 2.03; a *= .5; } return s; }
void main(){
  vec3 d = normalize(vDir); float e = d.y, sd = max(dot(d, sunDir), 0.);
  vec3 sky = mix(horizon, zenith, pow(clamp(e, 0., 1.), .45));
  // Warm forward scattering around the sun, a broad glow along the horizon on the sun's side.
  sky += vec3(1., .62, .32) * (pow(sd, 6.) * .45 + pow(sd, 48.) * .9) * sunI;
  sky = mix(sky, fogCol, (1. - smoothstep(-.02, .22, e)) * .85);
  // Cloud deck: soft fbm streaks lit warm from below toward the sun.
  vec2 cp = d.xz / max(e + .18, .05) * 1.6 + vec2(time * .002, 0.);
  float c = smoothstep(.48, .78, fbm(cp * vec2(1., 2.4))) * smoothstep(.02, .25, e);
  vec3 cloud = mix(vec3(.55, .5, .58), vec3(1.15, .78, .55), .35 + .65 * pow(sd, 3.)) * (.6 + .4 * sunI);
  sky = mix(sky, cloud, c * .7);
  sky += vec3(1., .9, .75) * smoothstep(.9994, .9997, sd) * 8. * step(0., e + .02);
  sky = mix(sky, fogCol * .8, smoothstep(0., -.15, e));
  gl_FragColor = vec4(sky, 1.);
}`;
export class Atmosphere {
  readonly sun: DirectionalLight; readonly hemi: HemisphericLight; readonly sunDir: Vector3; readonly preset: Preset;
  readonly shadows: ShadowGenerator; readonly glow: GlowLayer | null; private sky: Mesh; private skyMat: ShaderMaterial;
  private sunDisc: Mesh; private lamps: PointLight[] = []; private lampSpots: Vector3[] = []; scatter: VolumetricLightScatteringPostProcess | null = null;
  constructor(readonly scene: Scene, readonly time: TimeOfDay, readonly lite: boolean) {
    const p = this.preset = PRESETS[time];
    this.sunDir = new Vector3(Math.sin(p.az * D) * Math.cos(p.elev * D), Math.sin(p.elev * D), Math.cos(p.az * D) * Math.cos(p.elev * D)).normalize();
    const sun = this.sun = new DirectionalLight('sun', this.sunDir.scale(-1), scene);
    sun.diffuse = p.sun; sun.specular = p.sun.scale(.6); sun.intensity = p.sunI; sun.position = this.sunDir.scale(200);
    const hemi = this.hemi = new HemisphericLight('sky-fill', new Vector3(0, 1, 0), scene);
    hemi.diffuse = p.sky; hemi.groundColor = p.ground; hemi.intensity = p.hemiI; hemi.specular = Color3.Black();
    scene.fogMode = Scene.FOGMODE_EXP2; scene.fogColor = p.fog; scene.fogDensity = p.fogD; scene.clearColor = new Color4(p.fog.r, p.fog.g, p.fog.b, 1);
    scene.environmentIntensity = p.env; scene.ambientColor = p.ground.scale(.4);
    if (lite) {
      const sg = new ShadowGenerator(1024, sun); sg.usePercentageCloserFiltering = true; sg.filteringQuality = ShadowGenerator.QUALITY_LOW; sg.bias = .002; sg.normalBias = .02;
      sun.autoUpdateExtends = false; sun.shadowMinZ = -120; sun.shadowMaxZ = 160; sun.orthoLeft = -45; sun.orthoRight = 45; sun.orthoTop = 45; sun.orthoBottom = -45; this.shadows = sg;
    } else {
      const csm = new CascadedShadowGenerator(2048, sun); csm.numCascades = 3; csm.lambda = .82; csm.shadowMaxZ = 170; csm.stabilizeCascades = true; csm.cascadeBlendPercentage = .08;
      csm.usePercentageCloserFiltering = true; csm.filteringQuality = ShadowGenerator.QUALITY_MEDIUM; csm.bias = .0018; csm.normalBias = .015; csm.depthClamp = true; this.shadows = csm;
    }
    this.shadows.transparencyShadow = false;
    // Sky dome.
    const sky = this.sky = MeshBuilder.CreateSphere('sky', { diameter: 1800, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    const sm = this.skyMat = new ShaderMaterial('town-sky', scene, 'townSky', { attributes: ['position'], uniforms: ['worldViewProjection', 'sunDir', 'zenith', 'horizon', 'fogCol', 'sunI', 'time'] });
    sm.backFaceCulling = false; sm.disableDepthWrite = true; sm.fogEnabled = false;
    sm.setVector3('sunDir', this.sunDir); sm.setColor3('zenith', p.zenith); sm.setColor3('horizon', p.horizon); sm.setColor3('fogCol', p.fog); sm.setFloat('sunI', Math.min(1.2, p.sunI / 3.5)); sm.setFloat('time', 0);
    sky.material = sm; sky.isPickable = false; sky.infiniteDistance = true; sky.applyFog = false;
    // Sun disc for light shafts (rendered only into the scattering pass's light texture).
    const disc = this.sunDisc = MeshBuilder.CreateDisc('sun-disc', { radius: 14, tessellation: 32 }, scene);
    const dm = new StandardMaterial('sun-disc', scene); dm.emissiveColor = p.sun.scale(1.2); dm.diffuseColor = Color3.Black(); dm.disableLighting = true; dm.fogEnabled = false; disc.material = dm;
    disc.billboardMode = Mesh.BILLBOARDMODE_ALL; disc.isPickable = false; disc.applyFog = false; disc.infiniteDistance = true; disc.position = this.sunDir.scale(800);
    this.glow = lite ? null : new GlowLayer('lamp-glow', scene, { blurKernelSize: 48, mainTextureRatio: .5 });
    if (this.glow) this.glow.intensity = .7 + p.lamps * .25;
  }
  /** Light shafts toward the low sun (skipped in lite mode). */
  attachCamera(camera: Camera) {
    if (this.lite || this.preset.elev > 30) return;
    const vls = this.scatter = new VolumetricLightScatteringPostProcess('sun-shafts', 1, camera, this.sunDisc, 64, Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine(), false);
    vls.exposure = this.time === 'dusk' ? .12 : .2; vls.decay = .965; vls.weight = .55; vls.density = .9;
    vls.excludedMeshes = [this.sky];
  }
  /** Warm point lights at the nearest lamps (few, re-assigned as the player moves). */
  setLamps(spots: Vector3[], count: number) {
    this.lampSpots = spots;
    if (this.preset.lamps <= 0) return;
    for (let i = 0; i < count; i++) { const l = new PointLight(`lamp-${i}`, Vector3.Zero(), this.scene); l.diffuse = new Color3(1, .62, .3); l.specular = l.diffuse.scale(.3); l.intensity = this.preset.lamps * 9; l.range = 14; l.radius = .15; this.lamps.push(l); }
  }
  update(focus: Vector3, seconds: number) {
    this.skyMat.setFloat('time', seconds);
    if (this.lamps.length && this.lampSpots.length) {
      const near = [...this.lampSpots].sort((a, b) => Vector3.DistanceSquared(a, focus) - Vector3.DistanceSquared(b, focus));
      this.lamps.forEach((l, i) => { const s = near[i]; if (s) l.position.copyFrom(s); l.setEnabled(!!s); });
    }
  }
  /** Keep the lite shadow frustum centred on the player. */
  follow(focus: Vector3) { if (this.lite) this.sun.position = focus.add(this.sunDir.scale(100)); }
}
