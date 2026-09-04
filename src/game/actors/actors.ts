import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { Body, Person, Creature, Appearance, Item } from '../../sim/core/types';

/** Voxel humanoid: the physical projection of a Person's body. Procedural animation driven by pose and velocity. */
class Humanoid {
  root = new THREE.Group(); pivot = new THREE.Group();
  head: THREE.Mesh; torso: THREE.Mesh; armL: THREE.Group; armR: THREE.Group; legL: THREE.Group; legR: THREE.Group; held: THREE.Mesh | null = null; heldType = '';
  phase = 0; hitFlash = 0; bodyMats: THREE.MeshLambertMaterial[] = []; scale = 1;
  constructor(public app: Appearance) {
    const mat = (c: number) => { const m = new THREE.MeshLambertMaterial({ color: c }); this.bodyMats.push(m); return m; };
    const box = (w: number, h: number, d: number, c: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.castShadow = true; m.receiveShadow = true; return m; };
    const B = app.build; this.scale = app.height;
    // legs (pivot at hip)
    this.legL = new THREE.Group(); this.legR = new THREE.Group();
    for (const [g, x] of [[this.legL, -0.13 * B], [this.legR, 0.13 * B]] as [THREE.Group, number][]) { const l = box(0.22 * B, 0.7, 0.24, app.pants); l.position.y = -0.35; g.add(l); g.position.set(x, 0.72, 0); this.pivot.add(g); }
    this.torso = box(0.56 * B, 0.7, 0.32 * B, app.shirt); this.torso.position.y = 1.07; this.pivot.add(this.torso);
    if (app.apron) { const a = box(0.4 * B, 0.55, 0.06, app.apron); a.position.set(0, 0.95, 0.18 * B); this.pivot.add(a); }
    this.armL = new THREE.Group(); this.armR = new THREE.Group();
    for (const [g, x] of [[this.armL, -0.37 * B], [this.armR, 0.37 * B]] as [THREE.Group, number][]) { const a = box(0.18 * B, 0.66, 0.2, app.shirt); a.position.y = -0.3; g.add(a); const hand = box(0.16 * B, 0.12, 0.18, app.skin); hand.position.y = -0.66; g.add(hand); g.position.set(x, 1.38, 0); this.pivot.add(g); }
    this.head = box(0.44, 0.44, 0.44, app.skin); this.head.position.y = 1.67; this.pivot.add(this.head);
    // hair cap
    const hair = box(0.47, 0.14, 0.47, app.hair); hair.position.set(0, 0.2, 0); this.head.add(hair);
    const hairBack = box(0.47, 0.3, 0.1, app.hair); hairBack.position.set(0, 0.02, -0.2); this.head.add(hairBack);
    if (app.beard) { const bd = box(0.36, 0.16, 0.08, app.beard); bd.position.set(0, -0.2, 0.2); this.head.add(bd); }
    // eyes
    for (const x of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.04), new THREE.MeshBasicMaterial({ color: 0x1a1410 })); e.position.set(x, 0.04, 0.22); this.head.add(e); }
    switch (app.hatStyle) {
      case 'helm': { const h = box(0.5, 0.3, 0.5, app.hat ?? 0x888890); h.position.y = 0.16; this.head.add(h); const nose = box(0.1, 0.3, 0.06, app.hat ?? 0x888890); nose.position.set(0, -0.02, 0.24); this.head.add(nose); break; }
      case 'hood': { const h = box(0.5, 0.36, 0.5, app.hat ?? 0x333333); h.position.y = 0.1; this.head.add(h); const c = box(0.6, 0.25, 0.4, app.hat ?? 0x333333); c.position.set(0, -0.3, -0.05); this.torso.add(c); break; }
      case 'cap': { const h = box(0.48, 0.14, 0.48, app.hat ?? 0x444466); h.position.y = 0.26; this.head.add(h); break; }
      case 'wide': { const h = box(0.9, 0.06, 0.9, app.hat ?? 0xb0a060); h.position.y = 0.24; this.head.add(h); const t = box(0.4, 0.16, 0.4, app.hat ?? 0xb0a060); t.position.y = 0.3; this.head.add(t); break; }
    }
    this.pivot.scale.setScalar(this.scale); this.root.add(this.pivot);
  }
  setHeld(type: string): void {
    if (type === this.heldType) return; this.heldType = type;
    if (this.held) { this.armR.remove(this.held); this.held = null; }
    if (!type) return;
    const col = type === 'sword' ? 0xc0c4cc : type === 'dagger' ? 0xb0b4bc : type === 'hammer' ? 0x606068 : type === 'axe' ? 0x808890 : type === 'lantern' ? 0xffd080 : type === 'bread' ? 0xc89050 : 0x9a8060;
    const len = type === 'sword' ? 0.9 : type === 'dagger' ? 0.4 : 0.55;
    const g = new THREE.Group(); const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, len, 0.12), new THREE.MeshLambertMaterial({ color: col, emissive: type === 'lantern' ? 0xff9020 : 0x000000 })); blade.position.y = len / 2; blade.castShadow = true; g.add(blade);
    if (type === 'hammer' || type === 'axe') { const hd = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 0.18), new THREE.MeshLambertMaterial({ color: 0x505058 })); hd.position.y = len; g.add(hd); }
    if (type === 'sword' || type === 'dagger') { const gd = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), new THREE.MeshLambertMaterial({ color: 0x6a5030 })); gd.position.y = 0.12; g.add(gd); }
    g.position.set(0, -0.7, 0.1); g.rotation.x = -Math.PI / 2 + 0.3; this.held = g as any; this.armR.add(g);
  }
  animate(dt: number, body: Body, physTime: number): void {
    const speed = Math.hypot(body.vel.x, body.vel.z);
    const walking = speed > 0.3 && (body.pose === 'walk' || body.pose === 'run' || body.pose === 'stand');
    this.phase += dt * (speed * 2.6 + (walking ? 0 : 0));
    const p = this.phase; const t = physTime;
    const pose = body.pose;
    const lerp = (o: THREE.Object3D, rx: number, rz = 0, k = 0.25) => { o.rotation.x += (rx - o.rotation.x) * k; o.rotation.z += (rz - o.rotation.z) * k; };
    this.pivot.position.y = 0; this.pivot.rotation.x = 0; this.pivot.rotation.z = 0;
    const flash = body.lastHitAt > physTime - 0.35;
    for (const m of this.bodyMats) m.emissive.setHex(flash ? 0x802020 : 0x000000);
    if (pose === 'dead' || pose === 'downed') { this.pivot.rotation.x = -Math.PI / 2 * 0.95; this.pivot.position.y = 0.35; this.pivot.position.z = 0; lerp(this.armL, 0.3, -0.6); lerp(this.armR, 0.3, 0.6); lerp(this.legL, 0.1); lerp(this.legR, -0.1); return; }
    if (pose === 'sleep') { this.pivot.rotation.x = -Math.PI / 2; this.pivot.position.y = 0.55; lerp(this.armL, 0, 0); lerp(this.armR, 0, 0); lerp(this.legL, 0); lerp(this.legR, 0); return; }
    if (pose === 'sit') { this.pivot.position.y = -0.4; lerp(this.legL, -Math.PI / 2 + 0.1); lerp(this.legR, -Math.PI / 2 + 0.1); lerp(this.armL, -0.5); lerp(this.armR, -0.5); return; }
    if (pose === 'pray') { this.pivot.position.y = -0.55; lerp(this.legL, -Math.PI / 2 + 0.2); lerp(this.legR, -Math.PI / 2 + 0.2); lerp(this.armL, -1.2, 0.35); lerp(this.armR, -1.2, -0.35); this.head.rotation.x = 0.4; return; }
    this.head.rotation.x = 0;
    if (pose === 'attack') { const k = Math.min(1, (physTime - body.lastAttackAt) / 0.4); const swing = Math.sin(k * Math.PI); lerp(this.armR, -2.4 + swing * 2.6, -0.3, 0.6); lerp(this.armL, -0.4, 0.2); lerp(this.legL, 0.2); lerp(this.legR, -0.2); return; }
    if (pose === 'hit') { this.pivot.rotation.x = -0.25; lerp(this.armL, -1.2, -0.4, 0.5); lerp(this.armR, -1.2, 0.4, 0.5); return; }
    if (pose === 'work') { const w = Math.sin(t * 7); lerp(this.armR, -1.4 + w * 0.9, 0, 0.4); lerp(this.armL, -0.6 + Math.sin(t * 3.5) * 0.2); lerp(this.legL, 0); lerp(this.legR, 0); this.pivot.rotation.x = 0.15; return; }
    if (pose === 'talk') { lerp(this.armR, -0.4 + Math.sin(t * 5) * 0.3, -0.2); lerp(this.armL, -0.2 + Math.sin(t * 4 + 1) * 0.2, 0.15); lerp(this.legL, 0); lerp(this.legR, 0); this.head.rotation.y = Math.sin(t * 2) * 0.1; return; }
    if (walking) { const a = Math.sin(p) * Math.min(1.1, speed * 0.32); lerp(this.legL, a, 0, 0.5); lerp(this.legR, -a, 0, 0.5); lerp(this.armL, -a * 0.8, 0.08, 0.5); lerp(this.armR, a * 0.8, -0.08, 0.5); this.pivot.position.y = Math.abs(Math.sin(p)) * 0.05; }
    else { lerp(this.legL, 0); lerp(this.legR, 0); lerp(this.armL, Math.sin(t * 1.3) * 0.04, 0.06); lerp(this.armR, Math.sin(t * 1.3 + 1) * 0.04, -0.06); this.torso.position.y = 1.07 + Math.sin(t * 1.6) * 0.01; }
  }
}

class Chicken {
  root = new THREE.Group(); phase = 0; body: THREE.Mesh;
  constructor() {
    const m = (c: number) => new THREE.MeshLambertMaterial({ color: c });
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.42), m(0xf0ece0)); this.body.position.y = 0.3; this.body.castShadow = true; this.root.add(this.body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.18), m(0xf0ece0)); head.position.set(0, 0.52, 0.22); this.root.add(head);
    const beak = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.1), m(0xe8a030)); beak.position.set(0, 0.5, 0.35); this.root.add(beak);
    const comb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.12), m(0xd83030)); comb.position.set(0, 0.66, 0.2); this.root.add(comb);
    for (const x of [-0.08, 0.08]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), m(0xe8a030)); l.position.set(x, 0.09, 0); this.root.add(l); }
  }
  animate(dt: number, body: Body): void { const s = Math.hypot(body.vel.x, body.vel.z); this.phase += dt * (4 + s * 6); this.body.position.y = 0.3 + Math.abs(Math.sin(this.phase)) * 0.03 * (s > 0.1 ? 1 : 0.3); this.root.rotation.z = Math.sin(this.phase) * 0.04 * (s > 0.1 ? 1 : 0); }
}

/** Small props for items lying in the world. */
function makeItemMesh(it: Item): THREE.Object3D {
  const g = new THREE.Group(); const m = (c: number, e = 0x000000) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
  const add = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0, e = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c, e)); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b; };
  switch (it.type) {
    case 'sword': add(0.06, 0.1, 0.8, 0xc4c8d0, 0, 0.06, 0); add(0.22, 0.06, 0.05, 0x6a5030, 0, 0.06, -0.3); break;
    case 'dagger': add(0.05, 0.08, 0.4, 0xb8bcc4, 0, 0.05, 0); add(0.14, 0.05, 0.05, 0x5a4020, 0, 0.05, -0.15); break;
    case 'hammer': add(0.06, 0.06, 0.55, 0x5a4020, 0, 0.05, 0); add(0.16, 0.14, 0.24, 0x505058, 0, 0.09, 0.2); break;
    case 'axe': add(0.06, 0.06, 0.6, 0x5a4020, 0, 0.05, 0); add(0.22, 0.05, 0.2, 0x808890, 0, 0.07, 0.2); break;
    case 'bread': add(0.22, 0.14, 0.4, 0xc89050, 0, 0.08, 0); add(0.16, 0.05, 0.3, 0xe0b070, 0, 0.16, 0); break;
    case 'pie': add(0.34, 0.1, 0.34, 0xd0a060, 0, 0.06, 0); add(0.26, 0.04, 0.26, 0xa05030, 0, 0.13, 0); break;
    case 'ale': add(0.18, 0.24, 0.18, 0x8a6a40, 0, 0.13, 0); add(0.14, 0.04, 0.14, 0xf0e8c0, 0, 0.27, 0); break;
    case 'coins': add(0.24, 0.16, 0.2, 0x8a6a40, 0, 0.09, 0); add(0.08, 0.04, 0.08, 0xf0d060, 0.06, 0.19, 0); break;
    case 'ring': add(0.14, 0.05, 0.14, 0xe8e8f0, 0, 0.03, 0, 0x404050); add(0.06, 0.06, 0.06, 0xd0b060, 0, 0.06, 0.05); break;
    case 'cheese': add(0.3, 0.14, 0.3, 0xf0d060, 0, 0.08, 0); break;
    case 'lantern': add(0.18, 0.28, 0.18, 0xffd080, 0, 0.15, 0, 0xff8020); add(0.22, 0.04, 0.22, 0x404040, 0, 0.3, 0); break;
    case 'herbs': add(0.26, 0.1, 0.26, 0x4a8a3a, 0, 0.06, 0); break;
    case 'flowers': add(0.2, 0.2, 0.2, 0xe060a0, 0, 0.12, 0); break;
    case 'meat': add(0.3, 0.12, 0.42, 0xa03030, 0, 0.07, 0); break;
    case 'wheat': add(0.24, 0.3, 0.24, 0xd8c060, 0, 0.16, 0); break;
    default: add(0.2, 0.2, 0.2, 0x9a8060, 0, 0.1, 0);
  }
  return g;
}

export class ActorRenderer {
  group = new THREE.Group();
  private humans = new Map<string, Humanoid>(); private chickens = new Map<string, Chicken>(); private itemMeshes = new Map<string, THREE.Object3D>();
  constructor(private world: World) { this.group.name = 'actors'; }
  meshFor(bodyId: string): THREE.Object3D | undefined { return this.humans.get(bodyId)?.root ?? this.chickens.get(bodyId)?.root; }
  /** Sync every body's visual to the canonical body state. */
  sync(dt: number, physTime: number, hidePlayerBody: boolean): void {
    const seen = new Set<string>();
    for (const b of this.world.bodies()) {
      seen.add(b.id);
      if (!b.present) { const h = this.humans.get(b.id); if (h) h.root.visible = false; continue; }
      const owner = this.world.get(b.ownerId) as Person | Creature | undefined; if (!owner) continue;
      if (b.shape === 'humanoid') {
        const p = owner as Person; let h = this.humans.get(b.id);
        if (!h) { h = new Humanoid(p.appearance); this.humans.set(b.id, h); this.group.add(h.root); h.root.userData.bodyId = b.id; }
        h.root.visible = !(hidePlayerBody && p.controlled);
        // Canonical facing is `(-sin yaw, -cos yaw)` (the convention perception + combat use —
        // see Simulation.perceive / followPath). This voxel mesh's "front" (eyes, held item) is
        // its local +Z, which `rotation.y = yaw` alone would point the OTHER way — the cause of
        // the "NPCs walking backwards" the v0.2.3 playtest saw. Add PI so the mesh faces the
        // canonical facing direction. Canonical nav is untouched.
        h.root.position.set(b.pos.x, b.pos.y, b.pos.z); h.root.rotation.y = b.yaw + Math.PI;
        const held = p.inventory.map(id => this.world.item(id)).find(i => i && ['sword', 'dagger', 'hammer', 'axe', 'lantern'].includes(i.type));
        h.setHeld(b.pose === 'sleep' || b.pose === 'dead' ? '' : (held?.type ?? ''));
        h.animate(dt, b, physTime);
      } else if (b.shape === 'chicken') {
        let c = this.chickens.get(b.id); if (!c) { c = new Chicken(); this.chickens.set(b.id, c); this.group.add(c.root); c.root.userData.bodyId = b.id; }
        c.root.position.set(b.pos.x, b.pos.y, b.pos.z); c.root.rotation.y = b.yaw + Math.PI; c.animate(dt, b);
      }
    }
    for (const [id, h] of this.humans) if (!seen.has(id)) { this.group.remove(h.root); this.humans.delete(id); }
    // items lying in the world
    const seenItems = new Set<string>();
    for (const it of this.world.items()) {
      if (!it.pos || it.holderId) continue; seenItems.add(it.id);
      let m = this.itemMeshes.get(it.id); if (!m) { m = makeItemMesh(it); this.itemMeshes.set(it.id, m); this.group.add(m); m.userData.itemId = it.id; }
      m.position.set(it.pos.x, it.pos.y, it.pos.z); m.rotation.y = (it.id.length * 0.7) % 3;
    }
    for (const [id, m] of this.itemMeshes) if (!seenItems.has(id)) { this.group.remove(m); this.itemMeshes.delete(id); }
  }
}
