import { Color3, Color4, DynamicTexture, GlowLayer, Mesh, MeshBuilder, ParticleSystem, PointLight, StandardMaterial, TrailMesh, TransformNode, Vector3, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { Element } from './tower/capability';

/**
 * Elemental visual effects for the arena and the Tower: one look per element, used for casts, missiles, impacts,
 * lasting fields, weapon imbues and statuses on bodies. Particles use small procedural textures (drawn once on a
 * canvas); glowing cores feed a GlowLayer; two pooled point lights (always enabled, so the light count never
 * changes and no shader recompiles) flash on big impacts.
 */
type Tex = 'soft' | 'spark' | 'smoke' | 'flake' | 'leaf' | 'drop';
interface Anim { m: AbstractMesh; t: number; life: number; tick: (k: number, m: AbstractMesh, dt: number) => void }
export interface Handle { node: TransformNode; dispose(): void; setEnabled?(on: boolean): void;
  /** End presentation gracefully (emission stops, visuals fade) and dispose itself; mechanics have already ended. */
  expire?(seconds?: number): void }
/**
 * How a projectile's flight ended, observed from existing branches (presentation only):
 * hit = a body took the damage; blocked = a body blocked or evaded it; wall = it struck a wall; expire = range ran out.
 */
export type ImpactOutcome = 'hit' | 'blocked' | 'wall' | 'expire';

const c4 = (r: number, g: number, b: number, a = 1) => new Color4(r, g, b, a);
/** Per element: particle colours (start, mid, end), texture, additive or not, light colour. */
const LOOK: Record<Element, { a: Color4; b: Color4; end: Color4; tex: Tex; add: boolean; light: Color3; core: Color3 }> = {
  flame: { a: c4(1, .85, .4), b: c4(1, .35, .05, .9), end: c4(.25, .04, 0, 0), tex: 'soft', add: true, light: new Color3(1, .5, .15), core: new Color3(1, .55, .15) },
  frost: { a: c4(.85, .97, 1), b: c4(.45, .75, 1, .8), end: c4(.3, .5, .8, 0), tex: 'flake', add: true, light: new Color3(.5, .8, 1), core: new Color3(.6, .9, 1) },
  storm: { a: c4(1, 1, 1), b: c4(.7, .6, 1, .9), end: c4(.3, .2, .8, 0), tex: 'spark', add: true, light: new Color3(.7, .6, 1), core: new Color3(.8, .75, 1) },
  swift: { a: c4(.9, 1, .95, .8), b: c4(.7, .95, .85, .5), end: c4(.6, .9, .8, 0), tex: 'spark', add: true, light: new Color3(.7, 1, .85), core: new Color3(.8, 1, .9) },
  iron: { a: c4(.75, .62, .45, .9), b: c4(.5, .4, .3, .7), end: c4(.35, .3, .25, 0), tex: 'smoke', add: false, light: new Color3(1, .8, .5), core: new Color3(.8, .6, .35) },
  shadow: { a: c4(.55, .3, .85, .9), b: c4(.15, .05, .25, .8), end: c4(0, 0, 0, 0), tex: 'smoke', add: false, light: new Color3(.6, .3, 1), core: new Color3(.55, .25, .9) },
  verdance: { a: c4(.7, 1, .5), b: c4(.3, .8, .3, .8), end: c4(.2, .5, .2, 0), tex: 'leaf', add: false, light: new Color3(.5, 1, .45), core: new Color3(.5, 1, .45) },
  water: { a: c4(.75, .9, 1, .9), b: c4(.25, .6, 1, .7), end: c4(.2, .45, .9, 0), tex: 'drop', add: false, light: new Color3(.4, .7, 1), core: new Color3(.35, .65, 1) },
  gravity: { a: c4(.75, .6, 1), b: c4(.35, .2, .9, .8), end: c4(.1, 0, .3, 0), tex: 'soft', add: true, light: new Color3(.5, .35, 1), core: new Color3(.45, .3, 1) },
  time: { a: c4(1, .95, .7), b: c4(1, .8, .35, .8), end: c4(.9, .6, .2, 0), tex: 'soft', add: true, light: new Color3(1, .85, .45), core: new Color3(1, .85, .4) },
};

export class Vfx {
  readonly glow: GlowLayer;
  private tex = {} as Record<Tex | 'clock' | 'streak', DynamicTexture>;
  private anims: Anim[] = [];
  private lights: { l: PointLight; t: number; life: number; i: number }[] = [];
  private mats = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {
    this.glow = new GlowLayer('vfx-glow', scene, { mainTextureFixedSize: 512, blurKernelSize: 48 });
    this.glow.intensity = .95;
    this.tex.soft = this.draw('soft', 64, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
    this.tex.spark = this.draw('spark', 64, (g, s) => { const r = g.createLinearGradient(0, 0, s, 0); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(.5, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, s * .44, s, s * .12); const c = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * .2); c.addColorStop(0, 'rgba(255,255,255,1)'); c.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = c; g.fillRect(0, 0, s, s); });
    this.tex.smoke = this.draw('smoke', 64, (g, s) => { for (let i = 0; i < 9; i++) { const x = s * (.3 + Math.random() * .4), y = s * (.3 + Math.random() * .4), rr = s * (.15 + Math.random() * .2); const r = g.createRadialGradient(x, y, 0, x, y, rr); r.addColorStop(0, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); } });
    this.tex.flake = this.draw('flake', 64, (g, s) => { g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3; g.translate(s / 2, s / 2); for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, s * .42); g.moveTo(0, s * .25); g.lineTo(s * .1, s * .33); g.moveTo(0, s * .25); g.lineTo(-s * .1, s * .33); g.stroke(); } });
    this.tex.leaf = this.draw('leaf', 64, (g, s) => { g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.ellipse(s / 2, s / 2, s * .16, s * .38, .6, 0, Math.PI * 2); g.fill(); });
    this.tex.drop = this.draw('drop', 64, (g, s) => { const r = g.createRadialGradient(s * .45, s * .45, 0, s / 2, s / 2, s * .3); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.7, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
    this.tex.streak = this.draw('streak', 256, (g, s) => { for (let i = 0; i < 5; i++) { const y = s * (.15 + i * .17); const r = g.createLinearGradient(0, 0, s, 0); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(.4 + i * .08, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, y, s, s * .035); } });
    this.tex.clock = this.draw('clock', 512, (g, s) => {
      const c = s / 2; g.strokeStyle = 'rgba(255,230,160,1)'; g.lineWidth = 6; g.beginPath(); g.arc(c, c, s * .46, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.arc(c, c, s * .38, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, r0 = i % 5 ? s * .42 : s * .39; g.lineWidth = i % 5 ? 2 : 6; g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * s * .46, c + Math.sin(a) * s * .46); g.stroke(); }
      g.font = `${s * .06}px serif`; g.fillStyle = 'rgba(255,230,160,1)'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const R = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
      R.forEach((t, i) => { const a = i / 12 * Math.PI * 2 - Math.PI / 2; g.fillText(t, c + Math.cos(a) * s * .32, c + Math.sin(a) * s * .32); });
      g.lineWidth = 8; g.beginPath(); g.moveTo(c, c); g.lineTo(c, c - s * .25); g.moveTo(c, c); g.lineTo(c + s * .17, c + s * .06); g.stroke();
    });
    // Pooled flash lights: off while idle (an enabled zero-intensity light still takes one of a material's light slots), and
    // ranked just under the key light so a live flash still reaches characters (environment.ts LIGHT_PRIORITY).
    for (let i = 0; i < 2; i++) { const l = new PointLight(`vfx-light-${i}`, new Vector3(0, -50, 0), scene); l.intensity = 0; l.range = 14; l.renderPriority = 75; l.setEnabled(false); this.lights.push({ l, t: 0, life: 0, i: 0 }); }
  }

  private draw(name: string, size: number, paint: (g: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
    const t = new DynamicTexture(`vfx-${name}`, { width: size, height: size }, this.scene, true);
    const g = t.getContext() as unknown as CanvasRenderingContext2D; g.clearRect(0, 0, size, size); paint(g, size); t.hasAlpha = true; t.update(); return t;
  }

  /** An emissive, unlit material (cached per colour/alpha). */
  mat(color: Color3, alpha = 1, tex?: DynamicTexture): StandardMaterial {
    const k = `${color.toHexString()}:${alpha}:${tex?.name ?? ''}`; let m = this.mats.get(k);
    if (!m) {
      m = new StandardMaterial(`vfx-${k}`, this.scene); m.emissiveColor = color; m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.disableLighting = true;
      m.alpha = alpha; m.backFaceCulling = false; if (tex) { m.opacityTexture = tex; m.emissiveTexture = tex; }
      this.mats.set(k, m);
    }
    return m;
  }

  private system(e: Element, cap: number, emitter: Vector3 | AbstractMesh | TransformNode, tex?: Tex): ParticleSystem {
    const L = LOOK[e];
    const ps = new ParticleSystem(`vfx-${e}`, cap, this.scene);
    ps.particleTexture = this.tex[tex ?? L.tex];
    ps.emitter = emitter as Vector3; ps.color1 = L.a; ps.color2 = L.b; ps.colorDead = L.end;
    ps.blendMode = L.add ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    return ps;
  }

  private once(ps: ParticleSystem, count: number, life: number): void {
    ps.manualEmitCount = count; ps.targetStopDuration = .05; ps.disposeOnStop = true; ps.start();
  }

  /** Flash a pooled light (impacts and casts). */
  flash(at: Vector3, color: Color3, intensity = 2.5, life = .25): void {
    const s = this.lights.reduce((a, b) => (a.t <= 0 ? a : b.t <= 0 ? b : a.t < b.t ? a : b));
    s.l.position.copyFrom(at); s.l.diffuse = color; s.l.specular = color; s.t = life; s.life = life; s.i = intensity; s.l.setEnabled(true);
  }

  /** Impact or cast burst for an element, sized in metres. */
  burst(e: Element, at: Vector3, size0 = 1): void {
    const L = LOOK[e], size = size0 * 1.45;
    const ps = this.system(e, Math.round(60 * size + 30), at.clone());
    ps.minSize = .15 * size; ps.maxSize = .55 * size; ps.minLifeTime = .25; ps.maxLifeTime = .75;
    ps.minEmitPower = 2 * size; ps.maxEmitPower = 6 * size; ps.createSphereEmitter(.2 * size);
    ps.gravity = new Vector3(0, e === 'flame' ? 4 : e === 'water' || e === 'iron' ? -9 : e === 'frost' ? -2 : 0, 0);
    if (e === 'gravity') { ps.minEmitPower = -7 * size; ps.maxEmitPower = -3 * size; ps.createSphereEmitter(1.6 * size); }
    if (e === 'time') { ps.minEmitPower = .5; ps.maxEmitPower = 1.6; ps.minLifeTime = .7; ps.maxLifeTime = 1.4; }
    if (e === 'storm') { ps.minSize = .05; ps.maxSize = .25 * size; ps.minEmitPower = 6 * size; ps.maxEmitPower = 12 * size; }
    ps.minAngularSpeed = -3; ps.maxAngularSpeed = 3;
    this.once(ps, Math.round(50 * size + 20), 1.4);
    if (e === 'flame' || e === 'iron' || e === 'shadow') {
      const sm = this.system(e, 24, at.clone(), 'smoke');
      sm.color1 = e === 'flame' ? c4(.25, .2, .18, .5) : L.b; sm.color2 = c4(.15, .12, .1, .35); sm.colorDead = c4(0, 0, 0, 0); sm.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      sm.minSize = .6 * size; sm.maxSize = 1.4 * size; sm.minLifeTime = .7; sm.maxLifeTime = 1.6; sm.minEmitPower = .5; sm.maxEmitPower = 1.5; sm.gravity = new Vector3(0, 1.4, 0);
      this.once(sm, 16, 1.8);
    }
    // A crisp shock ring on the ground and a bright core flash.
    this.ring(e, new Vector3(at.x, .05, at.z), 1.4 * size, .45);
    this.core(e, at, .5 * size, .18);
    if (e === 'frost') this.shards(at, size, 7);
    if (e === 'iron') this.rocks(at, size, 6);
    if (e === 'water') this.ring('water', new Vector3(at.x, .06, at.z), 2.2 * size, .7);
    if (e === 'time') this.clockRing(at, 1.2 * size, .9);
    if (e === 'gravity') this.blackhole(at, .7 * size, .7);
    this.flash(at, L.light, 1.6 + size, .22);
  }

  /**
   * A projectile's end, by outcome. Only a confirmed hit gets the full burst and a sharp contact accent. A block is a
   * dull deflection, a wall strike a flattened splash back along the travel direction, and running out of range a
   * soft dissipation with no flash or ring, so none of them reads as a landed blow.
   */
  impactAt(e: Element, at: Vector3, outcome: ImpactOutcome, dir: Vector3, size = 1): void {
    const L = LOOK[e];
    if (outcome === 'hit') { this.burst(e, at, size); this.core(e, at, .32 * size, .07); return; }
    if (outcome === 'expire') {
      const ps = this.system(e, 40, at.clone()); ps.minSize = .1; ps.maxSize = .3 * size; ps.minLifeTime = .3; ps.maxLifeTime = .6; ps.minEmitPower = .2; ps.maxEmitPower = .8; ps.createSphereEmitter(.25 * size);
      ps.color1 = new Color4(L.a.r, L.a.g, L.a.b, .5); ps.color2 = new Color4(L.b.r, L.b.g, L.b.b, .35); this.once(ps, 26, .9); return;
    }
    const back = dir.scale(-1); back.y = 0; if (back.lengthSquared() < 1e-6) back.set(0, 0, 1); back.normalize();
    const ps = this.system(e, 80, at.clone()); ps.minSize = .08; ps.maxSize = .3 * size; ps.minLifeTime = .2; ps.maxLifeTime = .45;
    ps.minEmitPower = 3 * size; ps.maxEmitPower = 7 * size;
    const spread = outcome === 'wall' ? .9 : .5;
    ps.createDirectedSphereEmitter(.15, back.add(new Vector3(-spread, .2, -spread)), back.add(new Vector3(spread, .9, spread)));
    if (outcome === 'blocked') { ps.color1 = new Color4(.85, .9, 1, 1); ps.color2 = new Color4(L.b.r, L.b.g, L.b.b, .6); }
    this.once(ps, outcome === 'wall' ? 60 : 34, .8);
    if (outcome === 'wall') this.core(e, at, .3 * size, .1);
  }

  /**
   * A ground footprint whose final edge is exactly `r` (the gameplay query radius; targets also count their own radius):
   * a ring grows to r and holds while a faint disc fades, so the decoration never extends past the real boundary.
   */
  footprint(color: Color3, at: Vector3, r: number, life: number): void {
    const t = .08, ring = MeshBuilder.CreateTorus('vfx-footprint', { diameter: 2 * (r - t / 2), thickness: t, tessellation: 64 }, this.scene);
    ring.position.set(at.x, .06, at.z); ring.material = this.mat(color, .95); ring.isPickable = false;
    const disc = MeshBuilder.CreateDisc('vfx-footprint-disc', { radius: r, tessellation: 64 }, this.scene); disc.parent = ring; disc.rotation.x = Math.PI / 2; disc.position.y = -.01; disc.material = this.mat(color, .22); disc.isPickable = false;
    this.anims.push({ m: ring, t: 0, life, tick: (k, mm) => { const grow = Math.min(1, k / .35), s = .25 + .75 * (1 - (1 - grow) ** 2); mm.scaling.set(s, 1, s); mm.visibility = k < .6 ? 1 : 1 - (k - .6) / .4; } });
  }

  /** A pulsing ground marker for a telegraphed blow (red-gold), lasting `life` seconds. */
  marker(at: Vector3, r: number, life: number, color = new Color3(1, .35, .15)): void {
    const m = MeshBuilder.CreateDisc('vfx-mark', { radius: r, tessellation: 40 }, this.scene); m.position.set(at.x, .05, at.z); m.rotation.x = Math.PI / 2; m.isPickable = false;
    m.material = this.mat(color, .35);
    const e = MeshBuilder.CreateTorus('vfx-mark-edge', { diameter: r * 2, thickness: .1, tessellation: 48 }, this.scene); e.parent = m; e.rotation.x = -Math.PI / 2; e.material = this.mat(color.scale(1.3), 1); e.isPickable = false;
    this.anims.push({ m, t: 0, life, tick: (k, mm) => { mm.visibility = .45 + Math.sin(k * 30) * .25; const s = .3 + .7 * Math.min(1, k * 1.3); mm.scaling.set(s, s, 1); } });
  }

  /** A directional spray (wave spells): a flamethrower of the element across a cone, for a third of a second. */
  spray(e: Element, from: Vector3, dir: Vector3, range: number, arc: number): void {
    const L = LOOK[e], ps = this.system(e, 900, from.clone());
    const side = new Vector3(dir.z, 0, -dir.x), a = Math.tan(arc) * .8;
    ps.direction1 = dir.add(side.scale(-a)).add(new Vector3(0, .05, 0)); ps.direction2 = dir.add(side.scale(a)).add(new Vector3(0, .3, 0));
    ps.minEmitBox = new Vector3(-.15, -.15, -.15); ps.maxEmitBox = new Vector3(.15, .15, .15);
    ps.minLifeTime = .32; ps.maxLifeTime = .5; ps.minEmitPower = range / .45 * 1.9; ps.maxEmitPower = range / .45 * 2.5;   // particle speed is per-frame scaled: ~0.4 of nominal
    ps.minSize = .35; ps.maxSize = 1.1; ps.minAngularSpeed = -4; ps.maxAngularSpeed = 4;
    ps.addSizeGradient(0, .3); ps.addSizeGradient(.6, 1); ps.addSizeGradient(1, 1.6);
    ps.gravity = new Vector3(0, e === 'flame' ? 3 : e === 'water' || e === 'iron' ? -10 : 0, 0);
    // Normal blending with solid colour so the spray reads on pale floors too (additive washes out there).
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD; ps.color1 = new Color4(L.a.r, L.a.g, L.a.b, .85); ps.color2 = new Color4(L.b.r * .9, L.b.g * .9, L.b.b * .9, .75); ps.colorDead = new Color4(L.end.r, L.end.g, L.end.b, 0);
    ps.emitRate = 1100; ps.targetStopDuration = .34; ps.disposeOnStop = true; ps.start();
    if (e === 'flame' || e === 'storm') { const sp = this.system(e, 160, from.clone(), 'spark'); sp.direction1 = ps.direction1; sp.direction2 = ps.direction2; sp.minLifeTime = .3; sp.maxLifeTime = .6; sp.minEmitPower = ps.minEmitPower * 1.1; sp.maxEmitPower = ps.maxEmitPower * 1.2; sp.minSize = .08; sp.maxSize = .2; sp.color1 = new Color4(1, .95, .7, 1); sp.emitRate = 400; sp.targetStopDuration = .3; sp.disposeOnStop = true; sp.start(); }
    if (e === 'storm') for (let k = 0; k < 3; k++) { const b = from.add(dir.scale(range * (.6 + Math.random() * .4))).add(side.scale((Math.random() - .5) * range * a)); this.bolt(from, b, L.core, .04); }
    this.flash(from.add(dir.scale(range * .5)), L.light, 2.2, .35);
  }

  /** Expanding flat ring. */
  ring(e: Element, at: Vector3, r: number, life: number): void {
    const m = MeshBuilder.CreateTorus('vfx-ring', { diameter: 1, thickness: .06, tessellation: 40 }, this.scene);
    m.position.copyFrom(at); m.material = this.mat(LOOK[e].core, .9); m.isPickable = false;
    this.anims.push({ m, t: 0, life, tick: (k, mm) => { const s = .3 + k * r * 2; mm.scaling.set(s, 1 - k * .7, s); (mm.material as StandardMaterial).alpha = .9; mm.visibility = 1 - k; } });
  }

  /** A short-lived glowing sphere. */
  core(e: Element, at: Vector3, r: number, life0: number): void {
    const life = life0 * 1.3;
    const m = MeshBuilder.CreateSphere('vfx-core', { diameter: 1, segments: 10 }, this.scene);
    m.position.copyFrom(at); m.material = this.mat(LOOK[e].core, .55); m.isPickable = false;
    this.anims.push({ m, t: 0, life, tick: (k, mm) => { const s = r * 1.4 * (1 + k); mm.scaling.setAll(s); mm.visibility = (1 - k) * .8; } });
  }

  private shards(at: Vector3, size: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const m = MeshBuilder.CreateCylinder('vfx-shard', { diameterTop: 0, diameterBottom: .22 * size, height: .9 * size * (.6 + Math.random() * .7), tessellation: 4 }, this.scene);
      const a = i / n * Math.PI * 2 + Math.random() * .4, d = .4 + Math.random() * .7 * size;
      m.position.set(at.x + Math.cos(a) * d, 0, at.z + Math.sin(a) * d); m.rotation.set(Math.sin(a) * .5, a, Math.cos(a) * .5); m.isPickable = false;
      m.material = this.mat(new Color3(.55, .85, 1), .75);
      const h = m.position.clone();
      this.anims.push({ m, t: 0, life: 1.1, tick: (k, mm) => { const up = k < .2 ? k / .2 : 1; mm.position.y = h.y - .5 + up * .7 - Math.max(0, k - .7) * 2; mm.visibility = k > .7 ? 1 - (k - .7) / .3 : 1; } });
    }
  }

  private rocks(at: Vector3, size: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const m = MeshBuilder.CreatePolyhedron('vfx-rock', { type: 1, size: .14 * size * (.6 + Math.random()) }, this.scene);
      m.position.copyFrom(at); m.isPickable = false;
      const mt = new StandardMaterial('vfx-rock', this.scene); mt.diffuseColor = new Color3(.45, .38, .3); mt.specularColor = Color3.Black(); m.material = mt;
      const v = new Vector3((Math.random() - .5) * 6, 4 + Math.random() * 4, (Math.random() - .5) * 6).scale(size * .8);
      this.anims.push({ m, t: 0, life: 1, tick: (_k, mm, dt) => { v.y -= 18 * dt; mm.position.addInPlace(v.scale(dt)); if (mm.position.y < .05) { mm.position.y = .05; v.scaleInPlace(.4); v.y = Math.abs(v.y) * .3; } mm.rotation.x += dt * 6; }, });
    }
  }

  /** Rotating golden clock rings (time). */
  clockRing(at: Vector3, r: number, life: number): void {
    const m = MeshBuilder.CreatePlane('vfx-clock', { size: 1 }, this.scene);
    m.position.set(at.x, Math.max(.06, at.y), at.z); m.rotation.x = Math.PI / 2; m.isPickable = false;
    m.material = this.mat(new Color3(1, .85, .45), 1, this.tex.clock);
    this.anims.push({ m, t: 0, life, tick: (k, mm, dt) => { mm.scaling.setAll(r * 2 * (.6 + k * .6)); mm.rotation.y += dt * 1.2; mm.visibility = Math.sin(Math.PI * Math.min(1, k * 1.2)); } });
  }

  /** A collapsing dark sphere with a violet rim (gravity). */
  blackhole(at: Vector3, r: number, life: number): void {
    const core = MeshBuilder.CreateSphere('vfx-hole', { diameter: 1, segments: 16 }, this.scene);
    core.position.copyFrom(at); core.isPickable = false;
    const cm = new StandardMaterial('vfx-hole', this.scene); cm.diffuseColor = Color3.Black(); cm.specularColor = Color3.Black(); cm.emissiveColor = new Color3(.02, 0, .05); core.material = cm;
    const rim = MeshBuilder.CreateSphere('vfx-hole-rim', { diameter: 1.25, segments: 16 }, this.scene); rim.parent = core; rim.isPickable = false; rim.material = this.mat(new Color3(.45, .3, 1), .35);
    this.anims.push({ m: core, t: 0, life, tick: (k, mm) => { const s = r * 2 * Math.sin(Math.PI * Math.min(1, k * 1.1)); mm.scaling.setAll(Math.max(.01, s)); } });
  }

  /** Jagged lightning between two points, with branches; a few frames of life. */
  bolt(a: Vector3, b: Vector3, color = new Color3(.85, .8, 1), width = .05): void {
    const make = (p: Vector3, q: Vector3, w: number, depth: number) => {
      const n = 9, path: Vector3[] = [], d = q.subtract(p), len = d.length();
      const side = Vector3.Cross(d, Vector3.Up()).normalize(); if (!isFinite(side.x) || side.length() < .1) side.set(1, 0, 0);
      for (let i = 0; i <= n; i++) { const t = i / n, j = i === 0 || i === n ? 0 : (Math.random() - .5) * len * .16; path.push(p.add(d.scale(t)).add(side.scale(j)).add(new Vector3(0, (Math.random() - .5) * len * .1, 0))); }
      const m = MeshBuilder.CreateTube('vfx-bolt', { path, radius: w, tessellation: 4, cap: 0 }, this.scene); m.isPickable = false;
      m.material = this.mat(color.scale(1.3), 1);
      this.anims.push({ m, t: 0, life: .16, tick: (k, mm) => { mm.visibility = k < .5 ? 1 : (1 - k) * 2; } });
      if (depth > 0) for (let i = 0; i < 2; i++) { const s = path[2 + Math.floor(Math.random() * (n - 4))]; make(s, s.add(new Vector3((Math.random() - .5) * len * .5, -Math.random() * len * .3, (Math.random() - .5) * len * .5)), w * .55, depth - 1); }
    };
    make(a, b, width, 1);
    this.flash(b, color, 3, .12);
  }

  /** A missile's look: glowing core plus trailing particles, carried by the returned node. */
  missile(e: Element, size = 1): Handle {
    const node = new TransformNode('vfx-missile', this.scene);
    const core = MeshBuilder.CreateSphere('vfx-missile-core', { diameter: .5 * size, segments: 10 }, this.scene); core.parent = node; core.isPickable = false;
    core.material = this.mat(LOOK[e].core.scale(1.25), 1);
    if (e === 'gravity') { const cm = new StandardMaterial('vfx-mcore', this.scene); cm.diffuseColor = Color3.Black(); cm.emissiveColor = new Color3(.05, 0, .1); core.material = cm; const rim = MeshBuilder.CreateSphere('vfx-mrim', { diameter: .46 * size, segments: 8 }, this.scene); rim.parent = node; rim.material = this.mat(LOOK[e].core, .4); rim.isPickable = false; }
    const ps = this.system(e, 260, core);
    ps.minSize = .14 * size; ps.maxSize = .5 * size; ps.minLifeTime = .22; ps.maxLifeTime = .55; ps.emitRate = 220;
    ps.minEmitPower = .2; ps.maxEmitPower = .8; ps.createSphereEmitter(.12 * size);
    if (e === 'flame') ps.gravity = new Vector3(0, 3, 0);
    ps.start();
    // A tapering ribbon of the element's core colour, so the flight path reads without relying on particles alone.
    const trail = new TrailMesh('vfx-missile-trail', core, this.scene, { diameter: .22 * size, length: 18, autoStart: true });
    trail.material = this.mat(LOOK[e].core.scale(e === 'gravity' ? .7 : 1.1), .55); trail.isPickable = false;
    return { node, dispose: () => { ps.stop(); ps.disposeOnStop = true; trail.dispose(); core.dispose(); node.dispose(); } };
  }

  /** A lasting ground effect at a point (fields). */
  field(e: Element, at: Vector3, r: number): Handle {
    const node = new TransformNode('vfx-field', this.scene); node.position.set(at.x, .04, at.z);
    const L = LOOK[e];
    const disc = MeshBuilder.CreateDisc('vfx-field-disc', { radius: r, tessellation: 48 }, this.scene); disc.parent = node; disc.rotation.x = Math.PI / 2; disc.isPickable = false;
    disc.material = e === 'time' ? this.mat(L.core, .85, this.tex.clock) : this.mat(L.core.scale(.6), .18);
    const edge = MeshBuilder.CreateTorus('vfx-field-edge', { diameter: r * 2, thickness: .08, tessellation: 64 }, this.scene); edge.parent = node; edge.isPickable = false; edge.material = this.mat(L.core, .85);
    const ps = this.system(e, 220, node);
    ps.minSize = .12; ps.maxSize = .45; ps.minLifeTime = .5; ps.maxLifeTime = 1.2; ps.emitRate = 70 + r * 25;
    ps.createCylinderEmitter(r * .95, .05, .1, 0);
    ps.minEmitPower = .4; ps.maxEmitPower = 1.6; ps.gravity = new Vector3(0, e === 'flame' ? 3 : e === 'water' ? -1 : 1, 0);
    if (e === 'gravity') { ps.minEmitPower = -2.6; ps.maxEmitPower = -1.2; ps.createSphereEmitter(r * .9); ps.gravity = Vector3.Zero(); }
    ps.start();
    let hole: AbstractMesh | null = null, swirl: AbstractMesh | null = null;
    if (e === 'gravity') { hole = MeshBuilder.CreateSphere('vfx-well', { diameter: 1.1, segments: 16 }, this.scene); hole.parent = node; hole.position.y = 1.1; const hm = new StandardMaterial('vfx-well', this.scene); hm.diffuseColor = Color3.Black(); hm.emissiveColor = new Color3(.03, 0, .08); hole.material = hm; hole.isPickable = false; const rim = MeshBuilder.CreateSphere('vfx-well-rim', { diameter: 1.4, segments: 16 }, this.scene); rim.parent = hole; rim.material = this.mat(L.core, .3); rim.isPickable = false; }
    if (e === 'swift' || e === 'water') { swirl = MeshBuilder.CreateCylinder('vfx-swirl', { diameterTop: r * 1.6, diameterBottom: r * .6, height: e === 'swift' ? 3.5 : .6, tessellation: 32, cap: 0 }, this.scene); swirl.parent = node; swirl.position.y = e === 'swift' ? 1.75 : .3; swirl.material = this.mat(L.core, .55, this.tex.streak); swirl.isPickable = false; }
    const spin = { t: 0 };
    const obs = this.scene.onBeforeRenderObservable.add(() => { const dt = this.scene.getEngine().getDeltaTime() / 1000; spin.t += dt; edge.rotation.y += dt * .6; if (e === 'time') disc.rotation.z += dt * .4; if (swirl) swirl.rotation.y -= dt * (e === 'swift' ? 7 : 3); if (hole) hole.scaling.setAll(1 + Math.sin(spin.t * 6) * .06); });
    const dispose = () => { this.scene.onBeforeRenderObservable.remove(obs); ps.stop(); ps.disposeOnStop = true; node.dispose(false, false); disc.dispose(); edge.dispose(); hole?.dispose(); swirl?.dispose(); };
    // Expiry: emission stops at once (the field's effect has ended); the zone fades and its edge settles in `seconds`.
    const expire = (seconds = .35) => {
      ps.stop(); let t = 0;
      const fade = this.scene.onBeforeRenderObservable.add(() => {
        t += this.scene.getEngine().getDeltaTime() / 1000; const k = Math.min(1, t / seconds);
        for (const m of [disc, edge, hole, swirl]) if (m && !m.isDisposed()) m.visibility = 1 - k;
        if (k >= 1) { this.scene.onBeforeRenderObservable.remove(fade); dispose(); }
      });
    };
    return { node, dispose, expire };
  }

  /** A continuous emitter on a node (weapon imbue, statuses, the god's orb). */
  aura(e: Element, on: TransformNode | AbstractMesh, o: { rate?: number; size?: number; radius?: number; height?: number; tex?: Tex } = {}): Handle {
    const ps = this.system(e, 200, on as AbstractMesh, o.tex);
    const sz = o.size ?? 1;
    ps.minSize = .06 * sz; ps.maxSize = .22 * sz; ps.minLifeTime = .25; ps.maxLifeTime = .7; ps.emitRate = o.rate ?? 60;
    if (o.height) ps.createCylinderEmitter(o.radius ?? .3, o.height, 0, 0); else ps.createSphereEmitter(o.radius ?? .15);
    ps.minEmitPower = .1; ps.maxEmitPower = .6; ps.gravity = new Vector3(0, e === 'flame' ? 2.5 : e === 'water' ? -4 : e === 'frost' ? -.8 : .4, 0);
    ps.isLocal = false;
    ps.start();
    return { node: on as TransformNode, dispose: () => { ps.stop(); ps.disposeOnStop = true; }, setEnabled: v => { if (v) ps.start(); else ps.stop(); } };
  }

  /** An ice shell around a body (frozen solid). */
  iceShell(at: TransformNode, height: number): Handle {
    const m = MeshBuilder.CreatePolyhedron('vfx-ice', { type: 2, size: .5 }, this.scene);
    m.parent = at; m.position.y = height * .5; m.scaling.set(1.1, height * 1.15, 1.1); m.isPickable = false;
    const mt = new StandardMaterial('vfx-ice', this.scene); mt.diffuseColor = new Color3(.6, .85, 1); mt.emissiveColor = new Color3(.15, .3, .45); mt.specularColor = new Color3(1, 1, 1); mt.specularPower = 64; mt.alpha = .55; m.material = mt;
    return { node: m as unknown as TransformNode, dispose: () => { this.burst('frost', at.getAbsolutePosition().add(new Vector3(0, height * .5, 0)), .6); m.dispose(); mt.dispose(); } };
  }

  /** A slowly spinning golden clock at the feet (time-slowed). */
  clockAt(at: TransformNode, r: number): Handle {
    const m = MeshBuilder.CreatePlane('vfx-clock-at', { size: r * 2 }, this.scene); m.parent = at; m.position.y = .06; m.rotation.x = Math.PI / 2; m.isPickable = false;
    m.material = this.mat(new Color3(1, .85, .45), .9, this.tex.clock);
    const obs = this.scene.onBeforeRenderObservable.add(() => { m.rotation.y += this.scene.getEngine().getDeltaTime() / 1000 * .5; });
    return { node: m as unknown as TransformNode, dispose: () => { this.scene.onBeforeRenderObservable.remove(obs); m.dispose(); } };
  }

  update(dt: number): void {
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = Math.max(0, L.t / L.life) * L.i; } else if (L.l.isEnabled()) { L.l.intensity = 0; L.l.setEnabled(false); } }
    for (const a of this.anims) { a.t += dt; a.tick(Math.min(1, a.t / a.life), a.m, dt); if (a.t >= a.life) a.m.dispose(); }
    this.anims = this.anims.filter(a => a.t < a.life);
  }
}

export const elementLook = (e: Element) => LOOK[e];
export type { Mesh };
