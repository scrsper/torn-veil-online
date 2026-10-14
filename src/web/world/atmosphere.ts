import {
  CascadedShadowGenerator, Color3, Color4, DirectionalLight, DynamicTexture, HemisphericLight, Mesh, MeshBuilder, Scene, ShaderMaterial, StandardMaterial, Texture, Vector3,
  type AbstractMesh,
} from '@babylonjs/core';
import { lerp, mulberry } from '../render/noise';
import type { RenderContext } from '../render/engine';

/**
 * Sky, sun, moon, ambient light, fog and shadows, driven only by the projected world time and
 * weather. The palette follows the concept board: pale gold at low sun, cool slate light and blue
 * mist otherwise, deep indigo (never black) at night so paths, faces and enemies stay readable.
 */
export interface WeatherProjection { kind: string; intensity: number; wind: number }
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const S = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export class Atmosphere {
  readonly key: DirectionalLight;
  readonly fill: HemisphericLight;
  readonly shadow: CascadedShadowGenerator;
  private readonly skyDome: Mesh;
  private readonly skyTex: DynamicTexture;
  private readonly starDome: Mesh;
  private readonly starMat: StandardMaterial;
  private readonly sunDisc: Mesh; private readonly moonDisc: Mesh;
  private readonly sunMat: StandardMaterial; private readonly moonMat: StandardMaterial;
  private readonly cloudDome: Mesh; private readonly cloudMat: ShaderMaterial; private cloudTex: DynamicTexture;
  private lastGradientAt = -1;
  private lastHour = 12;
  /** Light the scene is currently using, for systems that need to know how dark it is. */
  daylight = 1;
  sunDirection = new Vector3(0, -1, 0);
  hour = 12;
  /** Art-direction multipliers (tuned live with ?look=key:1.2,fill:1.3,exposure:1.4). */
  readonly look = { key: 1.24, fill: .98, exposure: 1.16, fog: 1 };
  fogColor = new Color3(0.6, 0.66, 0.74);

  constructor(private readonly ctx: RenderContext) {
    const scene = ctx.scene;
    this.key = new DirectionalLight('key', new Vector3(-0.4, -1, -0.3), scene);
    this.key.intensity = 2.4; this.key.shadowMinZ = 1; this.key.shadowMaxZ = 260;
    this.fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
    this.fill.intensity = 0.55; this.fill.groundColor = new Color3(0.2, 0.18, 0.16);
    this.fill.specular = Color3.Black();

    const q = ctx.quality;
    this.shadow = new CascadedShadowGenerator(q.shadowMapSize, this.key);
    this.shadow.numCascades = q.shadowCascades; this.shadow.lambda = 0.8; this.shadow.shadowMaxZ = q.shadowDistance;
    this.shadow.stabilizeCascades = true; this.shadow.filteringQuality = 1; this.shadow.usePercentageCloserFiltering = true;
    this.shadow.bias = 0.0006; this.shadow.normalBias = 0.02; this.shadow.depthClamp = true; this.shadow.autoCalcDepthBounds = false;
    this.shadow.setDarkness(0.15);

    this.skyTex = new DynamicTexture('sky-gradient', { width: 4, height: 256 }, scene, false);
    this.skyTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const skyMat = new StandardMaterial('sky', scene);
    skyMat.disableLighting = true; skyMat.backFaceCulling = false; skyMat.emissiveTexture = this.skyTex; skyMat.diffuseColor = Color3.Black(); skyMat.specularColor = Color3.Black(); skyMat.fogEnabled = false;
    this.skyDome = MeshBuilder.CreateSphere('sky-dome', { diameter: 1800, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.skyDome.material = skyMat; this.skyDome.infiniteDistance = true; this.skyDome.isPickable = false; this.skyDome.renderingGroupId = 0; this.skyDome.applyFog = false;

    this.starMat = new StandardMaterial('stars', scene);
    this.starMat.disableLighting = true; this.starMat.backFaceCulling = false; this.starMat.fogEnabled = false; this.starMat.alpha = 0; this.starMat.diffuseColor = Color3.Black(); this.starMat.specularColor = Color3.Black();
    this.starMat.emissiveTexture = starTexture(scene); this.starMat.opacityTexture = this.starMat.emissiveTexture;
    this.starMat.opacityTexture.getAlphaFromRGB = true;
    this.starDome = MeshBuilder.CreateSphere('star-dome', { diameter: 1700, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
    this.starDome.material = this.starMat; this.starDome.infiniteDistance = true; this.starDome.isPickable = false; this.starDome.applyFog = false;

    this.sunMat = discMaterial(scene, 'sun', new Color3(1, 0.93, 0.75)); this.moonMat = discMaterial(scene, 'moon', new Color3(0.8, 0.86, 1));
    this.sunDisc = MeshBuilder.CreateDisc('sun-disc', { radius: 60, tessellation: 32 }, scene); this.sunDisc.material = this.sunMat;
    this.moonDisc = MeshBuilder.CreateDisc('moon-disc', { radius: 42, tessellation: 32 }, scene); this.moonDisc.material = this.moonMat;
    for (const d of [this.sunDisc, this.moonDisc]) { d.infiniteDistance = true; d.isPickable = false; d.billboardMode = Mesh.BILLBOARDMODE_ALL; d.applyFog = false; }

    this.cloudTex = cloudTexture(scene, 0.5);
    // Explicit unlit cloud composition: alpha is coverage, RGB comes exclusively
    // from the sky state. No white emissive map can keep clouds lit at midnight.
    this.cloudMat = new ShaderMaterial('clouds', scene, {
      vertexSource: 'precision highp float; attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection; varying vec2 cloudUV; varying float cloudHeight; void main(){cloudUV=uv;cloudHeight=position.y/800.0;gl_Position=worldViewProjection*vec4(position,1.0);}',
      fragmentSource: 'precision highp float; varying vec2 cloudUV; varying float cloudHeight; uniform sampler2D cloudMask; uniform vec3 cloudTint; uniform float cloudOpacity; void main(){gl_FragColor=vec4(cloudTint,texture2D(cloudMask,cloudUV).a*cloudOpacity*smoothstep(0.0,0.12,cloudHeight));}',
    }, {attributes:['position','uv'],uniforms:['worldViewProjection','cloudTint','cloudOpacity'],samplers:['cloudMask'],needAlphaBlending:true});
    this.cloudMat.setTexture('cloudMask',this.cloudTex); this.cloudMat.backFaceCulling=false; this.cloudMat.disableDepthWrite=true;
    this.cloudDome = MeshBuilder.CreateSphere('cloud-dome', { diameter: 1600, segments: 16, slice: 0.5, sideOrientation: Mesh.BACKSIDE }, scene);
    this.cloudDome.material = this.cloudMat; this.cloudDome.infiniteDistance = true; this.cloudDome.isPickable = false; this.cloudDome.applyFog = false;

    scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.0009; scene.fogColor = this.fogColor;
    this.update(9.5, { kind: 'clear', intensity: 0, wind: 0.2 }, 0);
  }

  addCaster(mesh: AbstractMesh): void { this.shadow.addShadowCaster(mesh, false); }
  removeCaster(mesh: AbstractMesh): void { this.shadow.removeShadowCaster(mesh, false); }

  /** `worldSeconds` is the canonical world clock (86400 per day). */
  update(hourOfDay: number, weather: WeatherProjection, dt: number): void {
    const h = ((hourOfDay % 24) + 24) % 24; this.hour = h;
    const theta = Math.PI * (h - 6) / 12;                       // 0 at 06:00, pi/2 at noon, pi at 18:00
    const elev = Math.sin(theta);
    const sunPos = new Vector3(Math.cos(theta) * .85, elev, -.65 * Math.cos(theta) - .2).normalize();
    const moonPos = sunPos.scale(-1);
    const wet = weather.kind === 'rain' || weather.kind === 'storm' ? weather.intensity : 0, fog = weather.kind === 'fog' ? Math.max(0.4, weather.intensity) : 0;
    const overcast = clamp01(wet * 0.9 + fog * 0.7 + (weather.kind === 'cloudy' ? 0.5 : 0));

    const day = S(-0.05, 0.28, elev), dusk = S(0.28, -0.02, elev) * S(-0.28, -0.02, elev), night = 1 - S(-0.3, 0.02, elev);
    this.daylight = clamp01(day * (1 - overcast * 0.45) + night * 0.06);
    this.ctx.scene.environmentIntensity = lerp(.1, .62, day) * (1 - overcast*.18);

    // Key light: sun by day, moon at night (both from the sky towards the ground).
    const keyFromSun = elev > -0.06;
    const dir = (keyFromSun ? sunPos : moonPos).scale(-1);
    this.key.direction.copyFrom(dir);
    const sunColor = mix(mix([1, 0.62, 0.36], [1, 0.9, 0.74], S(0.05, 0.5, elev)), [0.78, 0.82, 0.9], overcast * 0.6);
    const moonColor: RGB = [0.5, 0.6, 0.85];
    const kc = keyFromSun ? sunColor : moonColor;
    this.key.diffuse = new Color3(...kc); this.key.specular = new Color3(kc[0], kc[1], kc[2]);
    this.key.intensity = (keyFromSun ? lerp(0.3, 2.5, S(-0.06, 0.4, elev)) * (1 - overcast * 0.55) : 0.42 * (1 - overcast * 0.3)) * this.look.key;   // moonlight: dark, but enough to read paths, people and faces
    this.sunDirection.copyFrom(sunPos);

    // A broad, near-neutral daylight fill balances the directional sun. The old blue,
    // weak hemisphere made shaded timber and upright clothes almost black while roads
    // in direct sun were bright. Raise diffuse sky/earth bounce rather than exposure:
    // the visible sky, highlights and the deliberately dark clear-night profile stay intact.
    // Cloud cover transfers illumination from the key to the hemisphere instead of
    // dimming both; this gives rain a softer light without losing material colour.
    const skyAmbient = mix(mix([0.22, 0.28, 0.46], [0.64, 0.69, 0.76], day), [0.67, 0.70, 0.75], overcast * day * 0.5);
    this.fill.diffuse = new Color3(...skyAmbient);
    this.fill.groundColor = new Color3(...mix([0.06, 0.07, 0.11], [0.46, 0.42, 0.36], day));
    this.fill.intensity = lerp(0.4, 0.94, day) * (1 + overcast * day * 0.12) * this.look.fill;

    // Fog: exponential haze coloured like the horizon.
    const horizon = mix(mix(mix([0.06, 0.08, 0.16], [0.63, 0.7, 0.8], day), [1.0, 0.62, 0.4], dusk * 0.85), [0.58, 0.62, 0.68], overcast * 0.6);
    this.fogColor = new Color3(...horizon);
    const s = this.ctx.scene; s.fogColor = this.fogColor;
    s.fogDensity = (0.0035 + overcast * 0.002 + fog * 0.006) * this.ctx.quality.fogDensityScale * lerp(1.25, 1, day) * this.look.fog;
    s.clearColor = new Color4(horizon[0], horizon[1], horizon[2], 1);

    // Exposure keeps night readable and noon from clipping.
    if (this.ctx.pipeline) this.ctx.pipeline.imageProcessing.exposure = lerp(1.4, 1.02, day) * (1 + overcast * 0.06) * this.look.exposure;

    const camera = s.activeCamera;
    const place = (m: Mesh, p: Vector3) => { if (camera) m.position.copyFrom(p.scale(780)); };
    place(this.sunDisc, sunPos); place(this.moonDisc, moonPos);
    this.sunDisc.setEnabled(elev > -0.12 && overcast < 0.85); this.moonDisc.setEnabled(elev < 0.1 && overcast < 0.9);
    this.sunMat.alpha = 1 - overcast; this.moonMat.alpha = (1 - overcast) * night;
    this.starMat.alpha = clamp01(night * 1.2) * (1 - overcast);
    this.cloudMat.setFloat('cloudOpacity',lerp(.16, .55, day) + overcast * lerp(.2,.4,day));
    this.cloudDome.rotation.y += dt * 0.0015 * (0.5 + weather.wind);
    this.cloudMat.setColor3('cloudTint',new Color3(...mix(mix([0.12, 0.17, 0.28], [1, 1, 1], day), [1.0, 0.72, 0.55], dusk * 0.7)).toLinearSpace());
    if (Math.abs(h - this.lastGradientAt) > 0.03 || overcast !== this.lastOvercast) {
      this.lastGradientAt = h; this.lastOvercast = overcast;
      const zenith = mix(mix(mix([0.02, 0.03, 0.09], [0.16, 0.36, 0.72], day), [0.14, 0.14, 0.34], dusk * 0.8), [0.42, 0.46, 0.54], overcast * 0.8);
      const mid = mix(horizon, zenith, 0.55);
      const ctx2 = this.skyTex.getContext() as CanvasRenderingContext2D;
      const g = ctx2.createLinearGradient(0, 0, 0, 256);
      const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
      g.addColorStop(0, css(zenith)); g.addColorStop(0.35, css(mid)); g.addColorStop(0.5, css(horizon)); g.addColorStop(0.62, css(mix(horizon, [0.05, 0.06, 0.08], 0.55)) ); g.addColorStop(1, css(mix(horizon, [0.03, 0.04, 0.05], 0.7)));
      ctx2.fillStyle = g; ctx2.fillRect(0, 0, 4, 256); this.skyTex.update(false);
    }
    this.lastHour = h;
  }
  private lastOvercast = -1;
  /** A plain studio backdrop for the showroom: no sky, no fog, a flat clear colour. */
  setStage(color: Color3 | null): void {
    const on = !!color;
    for (const m of [this.skyDome, this.starDome, this.cloudDome, this.sunDisc, this.moonDisc]) m.setEnabled(!on);
    const s = this.ctx.scene; if (color) { s.clearColor = new Color4(color.r, color.g, color.b, 1); s.fogDensity = 0; s.fogMode = Scene.FOGMODE_NONE; }
  }
  /** Infinite-distance meshes already receive camera translation from Babylon.
   * Adding it a second time offsets the dome and lifts its horizon into view. */
  follow(cameraPos: Vector3): void { this.key.position.copyFrom(cameraPos); }
  get hourValue(): number { return this.lastHour; }
}

function discMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true; m.emissiveColor = color; m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.fogEnabled = false; m.backFaceCulling = false; m.alpha = 1;
  return m;
}
function starTexture(scene: Scene): DynamicTexture {
  const t = new DynamicTexture('stars-tex', { width: 1024, height: 512 }, scene, true), ctx = t.getContext() as CanvasRenderingContext2D, rnd = mulberry(4242);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 900; i++) { const b = 0.35 + rnd() * 0.65, r = rnd() < 0.06 ? 1.6 : rnd() < 0.3 ? 1.1 : 0.7; ctx.fillStyle = `rgba(${200 + rnd() * 55},${210 + rnd() * 45},255,${b})`; ctx.beginPath(); ctx.arc(rnd() * 1024, rnd() * 512, r, 0, Math.PI * 2); ctx.fill(); }
  t.update(true); t.hasAlpha = false; return t;
}
function cloudTexture(scene: Scene, coverage: number): DynamicTexture {
  const size = 512, t = new DynamicTexture('cloud-tex', { width: size, height: size }, scene, true), ctx = t.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size), rnd = mulberry(99), lat: number[] = []; const n = 32;
  for (let i = 0; i < n * n; i++) lat.push(rnd());
  // Integer-period lattice tiles across the dome's longitude seam.
  const noise = (x: number, y: number, period: number) => {
    const gx=x*period, gy=y*period, x0=Math.floor(gx), y0=Math.floor(gy), fx=gx-x0, fy=gy-y0;
    const smooth=(v:number)=>v*v*(3-2*v);
    const v=(i:number,j:number)=>lat[(((j%period)%n)*n)+((i%period)%n)];
    return lerp(lerp(v(x0,y0),v(x0+1,y0),smooth(fx)),lerp(v(x0,y0+1),v(x0+1,y0+1),smooth(fx)),smooth(fy));
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, a = 0.55, f = 8; for (let o = 0; o < 5; o++) { v += noise(x / size, y / size, f) * a; a *= 0.5; f *= 2; }
    const c = clamp01((v - (1 - coverage) * 0.75) * 2.6), o = (y * size + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = c * 255;
  }
  ctx.putImageData(img, 0, 0); t.update(true); t.hasAlpha = true; return t;
}
