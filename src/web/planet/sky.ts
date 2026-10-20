import { Color3, Constants, DirectionalLight, StandardMaterial, Effect, HemisphericLight, Mesh, MeshBuilder, ShaderMaterial, ShadowGenerator, Vector3, type AbstractMesh, type Scene } from '@babylonjs/core';
import { RELIEF, lightAt, type LocalLight, type SkyState, type V3 } from '../../sim/world/planet';

/** The sun and moon are the real light sources: two directional lights placed from the
 * canonical sky state, each with a shadow map; the hemisphere fill and the visible sky
 * dome follow the same LocalLight. Nothing here advances time. */
Effect.ShadersStore.tvLimbVertexShader = `precision highp float;
attribute vec3 position; attribute vec3 normal; uniform mat4 world, worldViewProjection; varying vec3 vN, vW;
void main() { vW = (world * vec4(position, 1.)).xyz; vN = normalize((world * vec4(normal, 0.)).xyz); gl_Position = worldViewProjection * vec4(position, 1.); }`;
Effect.ShadersStore.tvLimbFragmentShader = `precision highp float;
varying vec3 vN, vW; uniform vec3 eye, sun;
void main() { vec3 v = normalize(eye - vW); float rim = pow(1. - abs(dot(vN, v)), 5.); float lit = .25 + .75 * smoothstep(-.3, .4, dot(vN, normalize(sun)));
  gl_FragColor = vec4(vec3(.32, .56, 1.) * rim * lit * 1.4, 1.); }`;
Effect.ShadersStore.tvSkyVertexShader = `precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vDir;
void main(){ vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); gl_Position.z = gl_Position.w * .9999; }`;
Effect.ShadersStore.tvSkyFragmentShader = `precision highp float;
varying vec3 vDir; uniform vec3 up, sun, moon, zenith, horizon, ground; uniform float stars, moonLit, space, sunI, cloudT;
float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir); float e = dot(d, up);
  vec3 sky = mix(horizon, zenith, pow(clamp(e, 0., 1.), .55));
  sky = mix(sky, ground, 1. - smoothstep(-.08, 0., e));
  float sd = dot(d, sun);
  sky += vec3(1., .75, .45) * pow(max(sd, 0.), 18.) * .35 * sunI;
  // Thin drifting cloud deck: seeded value noise over the dome, lit by the sun and moon.
  vec2 cp = d.xz / max(.12, e + .25) * 2.2 + vec2(cloudT * .004, cloudT * .0013);
  vec2 ci = floor(cp), cf = fract(cp); cf = cf * cf * (3. - 2. * cf);
  float n00 = h(vec3(ci, 1.)), n10 = h(vec3(ci + vec2(1., 0.), 1.)), n01 = h(vec3(ci + vec2(0., 1.), 1.)), n11 = h(vec3(ci + 1., 1.));
  float cn = mix(mix(n00, n10, cf.x), mix(n01, n11, cf.x), cf.y);
  vec2 cp2 = cp * 2.7 + 13.1; vec2 cj = floor(cp2), cg = fract(cp2); cg = cg * cg * (3. - 2. * cg);
  float cn2 = mix(mix(h(vec3(cj, 2.)), h(vec3(cj + vec2(1., 0.), 2.)), cg.x), mix(h(vec3(cj + vec2(0., 1.), 2.)), h(vec3(cj + 1., 2.)), cg.x), cg.y);
  float cover = smoothstep(.55, .85, cn * .65 + cn2 * .35) * smoothstep(.02, .2, e) * (1. - space);
  vec3 cloudCol = mix(vec3(.08, .09, .12) + moonLit * .06, vec3(1., .97, .93), clamp(sunI, 0., 1.)) * (.75 + .25 * horizon.r);
  sky = mix(sky, cloudCol, cover * .85);
  sky = mix(sky, vec3(0.), space);
  vec3 q = floor(d * 420.); float s = step(.9975, h(q)) * stars * (1. - smoothstep(-.02, .06, -e) * (1. - space));
  sky += vec3(s) * (.6 + .4 * h(q + 3.));
  // Sun disc and halo.
  sky += vec3(1., .96, .86) * smoothstep(.99955, .99975, sd) * 6. * step(-.05, e + space);
  // Moon disc, lit hemisphere from the sun direction.
  float md = dot(d, moon);
  if (md > .9996) {
    vec3 t1 = normalize(cross(moon, abs(moon.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.))), t2 = cross(moon, t1);
    vec2 pp = vec2(dot(d - moon, t1), dot(d - moon, t2)) / .0283;
    float rr = dot(pp, pp);
    if (rr < 1.) { vec3 n = normalize(pp.x * t1 + pp.y * t2 - sqrt(1. - rr) * moon); float lit = smoothstep(-.05, .1, dot(n, sun));
      sky = mix(sky, vec3(.85, .88, .95) * (.08 + .92 * lit) * moonLit, smoothstep(1., .85, rr)); }
  }
  gl_FragColor = vec4(sky, 1.);
}`;
export class PlanetSky {
  readonly sun: DirectionalLight; readonly moon: DirectionalLight; readonly fill: HemisphericLight;
  readonly sunShadows: ShadowGenerator; readonly moonShadows: ShadowGenerator;
  readonly dome: Mesh; private material: ShaderMaterial; last: LocalLight | null = null;
  constructor(readonly scene: Scene, shadowSize = 2048) {
    this.sun = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
    this.moon = new DirectionalLight('moon', new Vector3(0, -1, 0), scene);
    this.fill = new HemisphericLight('sky-fill', new Vector3(0, 1, 0), scene);
    for (const l of [this.sun, this.moon]) { l.autoUpdateExtends = false; l.shadowMinZ = 1; l.shadowMaxZ = 900; l.orthoLeft = -90; l.orthoRight = 90; l.orthoTop = 90; l.orthoBottom = -90; }
    this.sunShadows = new ShadowGenerator(shadowSize, this.sun); this.moonShadows = new ShadowGenerator(Math.max(512, shadowSize / 2), this.moon);
    for (const g of [this.sunShadows, this.moonShadows]) { g.usePercentageCloserFiltering = true; g.bias = .0012; g.normalBias = .02; }
    this.moonShadows.darkness = .25;
    this.dome = MeshBuilder.CreateSphere('sky-dome', { diameter: 2, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.material = new ShaderMaterial('sky', scene, { vertex: 'tvSky', fragment: 'tvSky' }, { attributes: ['position'], uniforms: ['worldViewProjection', 'up', 'sun', 'moon', 'zenith', 'horizon', 'ground', 'stars', 'moonLit', 'space', 'sunI', 'cloudT'] });
    this.material.backFaceCulling = false; this.material.disableDepthWrite = true;
    this.dome.material = this.material; this.dome.isPickable = false; this.dome.infiniteDistance = true; this.dome.applyFog = false; this.dome.renderingGroupId = 0;
  }
  /** Thin atmospheric limb, visible from orbit: an additive rim on a shell above the highest
   * relief, clear face-on so sea and land keep their own colours. Brighter on the sunlit side. */
  atmosphere(radius: number) {
    const shell = MeshBuilder.CreateSphere('atmosphere', { diameter: (radius + RELIEF + 60) * 2, segments: 64 }, this.scene);
    const m = new ShaderMaterial('atmosphere', this.scene, { vertex: 'tvLimb', fragment: 'tvLimb' }, { attributes: ['position', 'normal'], uniforms: ['world', 'worldViewProjection', 'eye', 'sun'], needAlphaBlending: true });
    m.alphaMode = Constants.ALPHA_ADD; m.backFaceCulling = true; m.disableDepthWrite = true;
    m.onBind = () => { const c = this.scene.activeCamera; if (c) m.setVector3('eye', c.globalPosition); m.setVector3('sun', this.sun.direction.scale(-1)); };
    shell.material = m; shell.isPickable = false; shell.applyFog = false; this.shell = shell; return shell;
  }
  shell: Mesh | null = null;
  addCaster(m: AbstractMesh) { this.sunShadows.addShadowCaster(m, true); this.moonShadows.addShadowCaster(m, true); }
  removeCaster(m: AbstractMesh) { this.sunShadows.removeShadowCaster(m, true); this.moonShadows.removeShadowCaster(m, true); }
  /** `up` is the observer's local vertical; `focus` the shadow centre; `space` 0 on the ground, 1 in orbit. */
  update(sky: SkyState, up: V3, focus: Vector3, cameraRadius: number, space: number) {
    const l = this.last = lightAt(sky, up), v = (p: V3) => new Vector3(p.x, p.y, p.z), sun = v(sky.sun), moon = v(sky.moon);
    // From orbit the planet's own Lambert terminator shows day and night; light at full strength.
    const sunI = space > .5 ? 1.4 : l.sunIntensity, moonI = space > .5 ? .18 * (.3 + sky.moonIllumination) : l.moonIntensity;
    this.sun.direction = sun.scale(-1); this.sun.intensity = sunI * 1.15; this.sun.diffuse = new Color3(...l.sunColor); this.sun.specular = this.sun.diffuse.scale(.4);
    this.moon.direction = moon.scale(-1); this.moon.intensity = moonI * 1.6; this.moon.diffuse = new Color3(...l.moonColor); this.moon.specular = this.moon.diffuse.scale(.15);
    this.sun.position = focus.add(sun.scale(400)); this.moon.position = focus.add(moon.scale(400));
    // Both lights stay enabled (intensity 0 below the horizon): Babylon leaves disabled lights out of
    // meshes created meanwhile, which then never see the sun rise (stale shaders, failed draws).
    if (sunI <= .001) this.sun.intensity = 0; if (moonI <= .001) this.moon.intensity = 0;
    this.sunShadows.getShadowMap()!.refreshRate = sunI > .001 && space < .5 ? 1 : 0;
    this.moonShadows.getShadowMap()!.refreshRate = moonI > .02 && sunI < .05 && space < .5 ? 1 : 0;
    this.fill.direction = v(up); this.fill.intensity = space > .5 ? .05 : l.ambient * .85;
    this.fill.diffuse = new Color3(...l.zenith).scale(.6).add(new Color3(.25, .25, .25).scale(l.daylight));
    this.fill.groundColor = new Color3(...l.ground);
    this.scene.environmentIntensity = space > .5 ? .12 : .04 + .42 * l.daylight + .15 * l.moonIntensity;
    // Flat ambient for Standard materials (scene.ambientColor × material.ambientColor), from the same sky.
    const amb = space > .5 ? .05 : l.ambient; this.scene.ambientColor = new Color3(...l.zenith).scale(.5).add(new Color3(.5, .48, .44).scale(l.daylight * .5)).scale(Math.min(1.2, amb * 1.6));
    const m = this.material, c = (a: [number, number, number]) => new Vector3(...a);
    m.setVector3('up', v(up)); m.setVector3('sun', sun); m.setVector3('moon', moon);
    m.setVector3('zenith', c(l.zenith)); m.setVector3('horizon', c(l.horizon)); m.setVector3('ground', c(l.ground));
    m.setFloat('stars', Math.max(l.stars, space)); m.setFloat('moonLit', .4 + .6 * Math.max(.2, 1 - l.daylight)); m.setFloat('space', space); m.setFloat('sunI', l.sunIntensity); m.setFloat('cloudT', sky.seconds % 100000);
    this.dome.scaling.setAll(Math.max(50, cameraRadius));
    if (this.shell) this.shell.setEnabled(space > .5);
    const fog = new Color3(...l.horizon);
    this.scene.fogColor = fog; this.scene.fogDensity = space > .2 ? 0 : .0016 * (1 - space * 4);
    return l;
  }
}
