import { Color3, DirectionalLight, Effect, HemisphericLight, Mesh, MeshBuilder, ShaderMaterial, ShadowGenerator, Vector3, type AbstractMesh, type Scene } from '@babylonjs/core';
import { lightAt, type LocalLight, type SkyState, type V3 } from '../../sim/world/planet';

/** The sun and moon are the real light sources: two directional lights placed from the
 * canonical sky state, each with a shadow map; the hemisphere fill and the visible sky
 * dome follow the same LocalLight. Nothing here advances time. */
Effect.ShadersStore.tvSkyVertexShader = `precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vDir;
void main(){ vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); gl_Position.z = gl_Position.w * .9999; }`;
Effect.ShadersStore.tvSkyFragmentShader = `precision highp float;
varying vec3 vDir; uniform vec3 up, sun, moon, zenith, horizon, ground; uniform float stars, moonLit, space, sunI;
float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir); float e = dot(d, up);
  vec3 sky = mix(horizon, zenith, pow(clamp(e, 0., 1.), .55));
  sky = mix(sky, ground, smoothstep(0., -.08, e));
  float sd = dot(d, sun);
  sky += vec3(1., .75, .45) * pow(max(sd, 0.), 18.) * .35 * sunI;
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
    this.material = new ShaderMaterial('sky', scene, { vertex: 'tvSky', fragment: 'tvSky' }, { attributes: ['position'], uniforms: ['worldViewProjection', 'up', 'sun', 'moon', 'zenith', 'horizon', 'ground', 'stars', 'moonLit', 'space', 'sunI'] });
    this.material.backFaceCulling = false; this.material.disableDepthWrite = true;
    this.dome.material = this.material; this.dome.isPickable = false; this.dome.infiniteDistance = true; this.dome.applyFog = false; this.dome.renderingGroupId = 0;
  }
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
    this.sun.setEnabled(sunI > .001); this.moon.setEnabled(moonI > .001);
    this.sunShadows.getShadowMap()!.refreshRate = sunI > .001 && space < .5 ? 1 : 0;
    this.moonShadows.getShadowMap()!.refreshRate = moonI > .02 && sunI < .05 && space < .5 ? 1 : 0;
    this.fill.direction = v(up); this.fill.intensity = space > .5 ? .25 : l.ambient * .85;
    this.fill.diffuse = new Color3(...l.zenith).scale(.6).add(new Color3(.25, .25, .25).scale(l.daylight));
    this.fill.groundColor = new Color3(...l.ground);
    this.scene.environmentIntensity = space > .5 ? .35 : .05 + .6 * l.daylight + .15 * l.moonIntensity;
    const m = this.material, c = (a: [number, number, number]) => new Vector3(...a);
    m.setVector3('up', v(up)); m.setVector3('sun', sun); m.setVector3('moon', moon);
    m.setVector3('zenith', c(l.zenith)); m.setVector3('horizon', c(l.horizon)); m.setVector3('ground', c(l.ground));
    m.setFloat('stars', Math.max(l.stars, space)); m.setFloat('moonLit', .4 + .6 * Math.max(.2, 1 - l.daylight)); m.setFloat('space', space); m.setFloat('sunI', l.sunIntensity);
    this.dome.scaling.setAll(Math.max(50, cameraRadius));
    const fog = new Color3(...l.horizon);
    this.scene.fogColor = fog; this.scene.fogDensity = space > .2 ? 0 : .0016 * (1 - space * 4);
    return l;
  }
}
