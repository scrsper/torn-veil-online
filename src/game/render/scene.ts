import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { Vec3 } from '../../sim/core/types';
import { B, BLOCKS } from '../../sim/physical/blocks';

/** Sky, sun/moon, fog, weather particles, chimney smoke, torch lights: the atmosphere of the presentation layer. */
export class Atmosphere {
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight;
  sky: THREE.Mesh; skyMat: THREE.ShaderMaterial; stars: THREE.Points; sunMesh: THREE.Mesh; moonMesh: THREE.Mesh;
  rain: THREE.Points; rainMat: THREE.PointsMaterial; rainCount = 2500; rainPos: Float32Array;
  smoke: THREE.Points; smokePos: Float32Array; smokeLife: Float32Array; smokeCount = 600; smokeMat: THREE.PointsMaterial; smokeSources: Vec3[] = [];
  embers: THREE.Points; emberPos: Float32Array; emberLife: Float32Array; emberCount = 300; fireSources: Vec3[] = [];
  clouds: THREE.Group; lights: THREE.PointLight[] = []; lightBlocks: Vec3[] = [];
  fog: THREE.Fog; lightLevel = 1; sunTarget = new THREE.Object3D();
  constructor(public scene: THREE.Scene, private world: World) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2); this.sun.castShadow = true;
    const s = this.sun.shadow; s.mapSize.set(2048, 2048); s.camera.near = 1; s.camera.far = 220; s.camera.left = -60; s.camera.right = 60; s.camera.top = 60; s.camera.bottom = -60; s.bias = -0.0015; s.normalBias = 0.6;
    scene.add(this.sun); scene.add(this.sunTarget); this.sun.target = this.sunTarget;
    this.hemi = new THREE.HemisphereLight(0x8fb8ff, 0x5a4a30, 0.7); scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.15); scene.add(this.ambient);
    this.fog = new THREE.Fog(0xc8d8e8, 60, 190); scene.fog = this.fog;
    this.skyMat = new THREE.ShaderMaterial({ uniforms: { top: { value: new THREE.Color(0x3a70c8) }, horizon: { value: new THREE.Color(0xc8dcf0) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffe0b0) }, glow: { value: 0.4 } }, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w; }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vDir; void main(){ float h = clamp(vDir.y, -0.1, 1.0); float t = pow(max(0.0, h), 0.55); vec3 c = mix(horizon, top, t); float sd = max(0.0, dot(normalize(vDir), sunDir)); c += sunCol * pow(sd, 12.0) * glow * (1.0 - t * 0.5); c += sunCol * pow(sd, 3.0) * glow * 0.12; gl_FragColor = vec4(c, 1.0); }' });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), this.skyMat); this.sky.renderOrder = -10; scene.add(this.sky);
    // stars
    const sp: number[] = []; for (let i = 0; i < 900; i++) { const v = new THREE.Vector3().randomDirection(); if (v.y < 0.02) { i--; continue; } sp.push(v.x * 380, v.y * 380, v.z * 380); }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0, fog: false, sizeAttenuation: true })); scene.add(this.stars);
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false })); scene.add(this.sunMesh);
    this.moonMesh = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false })); scene.add(this.moonMesh);
    // rain
    this.rainPos = new Float32Array(this.rainCount * 3); for (let i = 0; i < this.rainCount; i++) this.resetRain(i, true);
    this.rainMat = new THREE.PointsMaterial({ color: 0xaac4e0, size: 0.14, transparent: true, opacity: 0, sizeAttenuation: true });
    this.rain = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3)), this.rainMat); this.rain.frustumCulled = false; scene.add(this.rain);
    // smoke
    this.smokePos = new Float32Array(this.smokeCount * 3); this.smokeLife = new Float32Array(this.smokeCount).fill(-1);
    this.smokeMat = new THREE.PointsMaterial({ color: 0x9a9a9a, size: 0.9, transparent: true, opacity: 0.45, sizeAttenuation: true, depthWrite: false });
    this.smoke = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3)), this.smokeMat); this.smoke.frustumCulled = false; scene.add(this.smoke);
    this.emberPos = new Float32Array(this.emberCount * 3); this.emberLife = new Float32Array(this.emberCount).fill(-1);
    this.embers = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3)), new THREE.PointsMaterial({ color: 0xffa040, size: 0.18, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false })); this.embers.frustumCulled = false; scene.add(this.embers);
    // voxel clouds
    this.clouds = new THREE.Group(); const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 14; i++) { const c = new THREE.Group(); const n = 4 + Math.floor(Math.random() * 6); for (let k = 0; k < n; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(6 + Math.random() * 10, 2 + Math.random() * 2, 5 + Math.random() * 8), cm); b.position.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 14); b.castShadow = true; c.add(b); } c.position.set(Math.random() * 400 - 100, 58 + Math.random() * 10, Math.random() * 400 - 100); this.clouds.add(c); }
    scene.add(this.clouds);
    for (let i = 0; i < 10; i++) { const l = new THREE.PointLight(0xffb060, 0, 14, 1.6); l.castShadow = false; scene.add(l); this.lights.push(l); }
    this.collectLightBlocks();
  }
  collectLightBlocks(): void {
    const g = this.world.grid; this.lightBlocks = []; this.smokeSources = []; this.fireSources = [];
    for (let x = 0; x < g.W; x++) for (let z = 0; z < g.D; z++) for (let y = 4; y < g.H; y++) { const b = g.get(x, y, z); if (b === B.Air) continue; const d = BLOCKS[b]; if (d.light) this.lightBlocks.push({ x: x + 0.5, y: y + 0.6, z: z + 0.5 }); if (b === B.Fire) this.fireSources.push({ x: x + 0.5, y: y + 0.3, z: z + 0.5 }); }
    for (const p of this.world.places()) for (const c of p.chimneys) this.smokeSources.push({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 });
    for (const p of this.world.places()) if (p.type === 'camp') for (const f of p.fires) this.smokeSources.push({ x: f.x + 0.5, y: f.y + 1, z: f.z + 0.5 });
  }
  private resetRain(i: number, initial: boolean): void { this.rainPos[i * 3] = (Math.random() - 0.5) * 80; this.rainPos[i * 3 + 1] = initial ? Math.random() * 40 : 30 + Math.random() * 10; this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * 80; }

  update(dt: number, dayF: number, playerPos: THREE.Vector3, camPos: THREE.Vector3): void {
    // sun position: rises at 0.25 (6:00), sets at 0.79 (19:00)
    const ang = (dayF - 0.25) / 0.54 * Math.PI; // 0..PI during day
    const sunEl = Math.sin(ang); const sunDir = new THREE.Vector3(Math.cos(ang) * 0.6, sunEl, 0.35 + Math.cos(ang) * 0.2).normalize();
    const moonAng = ((dayF + 0.5) % 1 - 0.25) / 0.54 * Math.PI; const moonDir = new THREE.Vector3(Math.cos(moonAng) * 0.6, Math.sin(moonAng), 0.3).normalize();
    const daylight = smooth(-0.12, 0.25, sunEl); const dusk = Math.max(0, 1 - Math.abs(sunEl) / 0.25) * (1 - Math.max(0, sunEl - 0.25));
    const w = this.world.weather; const overcast = w.kind === 'rain' || w.kind === 'storm' ? 0.8 * w.intensity + 0.2 : w.kind === 'cloudy' ? 0.45 : w.kind === 'fog' ? 0.5 : 0;
    this.lightLevel = daylight;
    // colours
    const dayTop = new THREE.Color(0x3d7ccf).lerp(new THREE.Color(0x6a7a8a), overcast), dayHor = new THREE.Color(0xcfe0f2).lerp(new THREE.Color(0x9aa4ad), overcast);
    const nightTop = new THREE.Color(0x060a1c), nightHor = new THREE.Color(0x111a30);
    const duskTop = new THREE.Color(0x4a3a7a), duskHor = new THREE.Color(0xf0905a);
    const top = nightTop.clone().lerp(dayTop, daylight).lerp(duskTop, dusk * 0.6 * (1 - overcast)); const hor = nightHor.clone().lerp(dayHor, daylight).lerp(duskHor, dusk * 0.8 * (1 - overcast));
    this.skyMat.uniforms.top.value.copy(top); this.skyMat.uniforms.horizon.value.copy(hor); this.skyMat.uniforms.sunDir.value.copy(sunEl > -0.1 ? sunDir : moonDir);
    this.skyMat.uniforms.sunCol.value.set(sunEl > -0.1 ? 0xffd090 : 0x8090c0); this.skyMat.uniforms.glow.value = (sunEl > -0.1 ? 0.5 + dusk * 0.8 : 0.15) * (1 - overcast * 0.7);
    this.sky.position.copy(camPos); this.stars.position.copy(camPos); (this.stars.material as THREE.PointsMaterial).opacity = (1 - daylight) * (1 - overcast) * 0.9;
    this.sunMesh.position.copy(camPos).addScaledVector(sunDir, 370); this.sunMesh.visible = sunEl > -0.05 && overcast < 0.6; this.moonMesh.position.copy(camPos).addScaledVector(moonDir, 370); this.moonMesh.visible = moonDir.y > 0 && overcast < 0.6;
    // lights
    const useSun = sunEl > 0.02; const dir = useSun ? sunDir : moonDir;
    this.sun.position.copy(playerPos).addScaledVector(dir, 90); this.sunTarget.position.copy(playerPos); this.sun.color.set(useSun ? new THREE.Color(0xfff4e0).lerp(new THREE.Color(0xffa060), dusk) : new THREE.Color(0x7080b0));
    this.sun.intensity = useSun ? (1.2 + 1.2 * Math.min(1, sunEl * 2)) * (1 - overcast * 0.75) : 0.25 * Math.max(0, moonDir.y) * (1 - overcast);
    this.hemi.intensity = 0.12 + daylight * 0.65 * (1 - overcast * 0.4); this.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.4); this.hemi.groundColor.set(0x5a4a30);
    this.ambient.intensity = 0.06 + daylight * 0.12;
    const fogCol = hor.clone(); this.fog.color.copy(fogCol); this.scene.background = null;
    const fogNear = w.kind === 'fog' ? 12 : 40 - overcast * 15, fogFar = w.kind === 'fog' ? 60 : 200 - overcast * 80 - (1 - daylight) * 40; this.fog.near = fogNear; this.fog.far = fogFar;
    // rain
    const raining = (w.kind === 'rain' || w.kind === 'storm') ? w.intensity : 0;
    this.rainMat.opacity = raining * 0.6; this.rain.position.set(playerPos.x, playerPos.y, playerPos.z);
    if (raining > 0) { const wind = w.wind * 3; for (let i = 0; i < this.rainCount; i++) { this.rainPos[i * 3 + 1] -= dt * (22 + (i % 5)); this.rainPos[i * 3] += wind * dt; if (this.rainPos[i * 3 + 1] < -6) this.resetRain(i, false); } (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; }
    // smoke
    const wind = this.world.weather.wind;
    for (let i = 0; i < this.smokeCount; i++) {
      if (this.smokeLife[i] < 0) { if (Math.random() < 0.08 && this.smokeSources.length) { const s = this.smokeSources[Math.floor(Math.random() * this.smokeSources.length)]; if (Math.hypot(s.x - camPos.x, s.z - camPos.z) > 90) continue; this.smokePos[i * 3] = s.x + (Math.random() - 0.5) * 0.4; this.smokePos[i * 3 + 1] = s.y; this.smokePos[i * 3 + 2] = s.z + (Math.random() - 0.5) * 0.4; this.smokeLife[i] = 0; } else { this.smokePos[i * 3 + 1] = -100; } continue; }
      this.smokeLife[i] += dt; if (this.smokeLife[i] > 6) { this.smokeLife[i] = -1; continue; }
      this.smokePos[i * 3 + 1] += dt * 1.1; this.smokePos[i * 3] += dt * (wind * 1.5 + Math.sin(this.smokeLife[i] * 2 + i) * 0.3); this.smokePos[i * 3 + 2] += dt * Math.cos(this.smokeLife[i] * 1.7 + i) * 0.3;
    }
    (this.smoke.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; this.smokeMat.opacity = 0.35 + (1 - daylight) * 0.1; this.smokeMat.color.set(daylight > 0.5 ? 0x9a9a9a : 0x404040);
    for (let i = 0; i < this.emberCount; i++) {
      if (this.emberLife[i] < 0) { if (Math.random() < 0.15 && this.fireSources.length) { const s = this.fireSources[Math.floor(Math.random() * this.fireSources.length)]; if (Math.hypot(s.x - camPos.x, s.z - camPos.z) > 40) continue; this.emberPos[i * 3] = s.x + (Math.random() - 0.5) * 0.5; this.emberPos[i * 3 + 1] = s.y; this.emberPos[i * 3 + 2] = s.z + (Math.random() - 0.5) * 0.5; this.emberLife[i] = 0; } else this.emberPos[i * 3 + 1] = -100; continue; }
      this.emberLife[i] += dt; if (this.emberLife[i] > 1.4) { this.emberLife[i] = -1; continue; }
      this.emberPos[i * 3 + 1] += dt * 1.8; this.emberPos[i * 3] += dt * Math.sin(i + this.emberLife[i] * 9) * 0.4; this.emberPos[i * 3 + 2] += dt * Math.cos(i * 1.3 + this.emberLife[i] * 7) * 0.4;
    }
    (this.embers.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    // clouds drift
    for (const c of this.clouds.children) { c.position.x += dt * (1.5 + wind * 2); if (c.position.x > 320) c.position.x = -120; }
    (this.clouds.children[0]?.children[0] as THREE.Mesh)?.material && ((this.clouds.children[0].children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial).opacity !== undefined && (((this.clouds.children[0].children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial).opacity = 0.5 + overcast * 0.45);
    // torch point lights: nearest to the camera
    const nearest = this.lightBlocks.map(p => ({ p, d: Math.hypot(p.x - camPos.x, p.y - camPos.y, p.z - camPos.z) })).filter(o => o.d < 40).sort((a, b) => a.d - b.d).slice(0, this.lights.length);
    const nightBoost = 1 - daylight * 0.7; const t = performance.now() * 0.001;
    this.lights.forEach((l, i) => { const n = nearest[i]; if (!n) { l.intensity = 0; return; } l.position.set(n.p.x, n.p.y, n.p.z); l.intensity = (6 + Math.sin(t * 9 + i * 1.7) * 1.2 + Math.sin(t * 23 + i) * 0.6) * nightBoost; });
  }
}
function smooth(a: number, b: number, x: number): number { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
