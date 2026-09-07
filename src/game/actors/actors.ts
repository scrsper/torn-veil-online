import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { Body, Person, Creature, Item } from '../../sim/core/types';
import { workStyleFor } from '../presentation/activityCues';
import { HumanoidRig } from '../presentation/humanoid';
import { attireFor } from '../presentation/culture';
import { GeoAccum, UNIT, place as xf, rgb, shade, tapered } from '../presentation/geo';
import { surfaceMaterial, surfaceTex } from '../presentation/textures';

/**
 * The projection of canonical bodies and loose items into the scene.
 *
 * v0.11 replaced the block figure with `presentation/humanoid.ts`'s proportioned rig; this file
 * keeps its original job unchanged — walk every canonical `Body` each frame, make sure it has a
 * visual, and hand that visual the body's own state. It still reads and never writes.
 */

const propMaterial = (() => { let m: THREE.MeshStandardMaterial | null = null; return () => (m ??= surfaceMaterial('grain', { roughness: 0.8 })); })();
const featherMaterial = (() => { let m: THREE.MeshStandardMaterial | null = null; return () => (m ??= surfaceMaterial('cloth', { roughness: 0.9 })); })();

/** Fowl: still simple, but round rather than cubic, so it reads as a bird beside a person. */
class Chicken {
  root = new THREE.Group(); phase = 0; body: THREE.Mesh; head: THREE.Group;
  constructor() {
    const acc = new GeoAccum();
    const uv = surfaceTex('cloth').uvScale;
    const feather = rgb(0xf0ece0), comb = rgb(0xd83030), beak = rgb(0xe8a030);
    acc.add(UNIT.sphere, xf(0, 0.3, 0, 0.34, 0.3, 0.44), feather, uv);
    acc.add(UNIT.cone, xf(0, 0.3, -0.26, 0.24, 0.26, 0.24, 0, -Math.PI / 2.4, 0), shade(feather, 0.92), uv);
    for (const s of [-1, 1]) acc.add(UNIT.sphereLo, xf(s * 0.16, 0.32, 0.02, 0.1, 0.24, 0.3), shade(feather, 0.88), uv);
    for (const s of [-1, 1]) acc.add(UNIT.cyl6, xf(s * 0.07, 0.1, 0.02, 0.045, 0.2, 0.045), beak, uv);
    const g = acc.build()!;
    this.body = new THREE.Mesh(g, featherMaterial());
    this.body.castShadow = true; this.root.add(this.body);
    const hacc = new GeoAccum();
    hacc.add(UNIT.sphere, xf(0, 0, 0, 0.19, 0.2, 0.19), feather, uv);
    hacc.add(UNIT.cone, xf(0, 0.005, 0.12, 0.07, 0.11, 0.07, 0, Math.PI / 2, 0), beak, uv);
    hacc.add(UNIT.box, xf(0, 0.12, -0.01, 0.03, 0.09, 0.11), comb, uv);
    for (const s of [-1, 1]) hacc.add(UNIT.sphereLo, xf(s * 0.07, 0.03, 0.09, 0.03, 0.03, 0.02), rgb(0x1a1410), uv);
    this.head = new THREE.Group();
    const hm = new THREE.Mesh(hacc.build()!, featherMaterial()); hm.castShadow = true;
    this.head.add(hm); this.head.position.set(0, 0.53, 0.2);
    this.root.add(this.head);
  }
  animate(dt: number, body: Body): void {
    const s = Math.hypot(body.vel.x, body.vel.z);
    this.phase += dt * (4 + s * 6);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.03 * (s > 0.1 ? 1 : 0.3);
    this.head.position.z = 0.2 + Math.sin(this.phase * 1.3) * (s > 0.1 ? 0.05 : 0.015);
    this.head.rotation.x = Math.sin(this.phase * 0.7) * 0.12;
    this.root.rotation.z = Math.sin(this.phase) * 0.04 * (s > 0.1 ? 1 : 0);
  }
}

/** Small props for items lying in the world — one merged mesh per item, one shared material. */
function makeItemMesh(it: Item): THREE.Object3D {
  const acc = new GeoAccum();
  const uv = surfaceTex('grain').uvScale;
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, c: number) => acc.add(geo, m, rgb(c), uv);
  switch (it.type) {
    case 'sword': add(UNIT.box, xf(0, 0.06, 0.1, 0.05, 0.03, 0.72), 0xc4c8d0); add(UNIT.box, xf(0, 0.06, -0.3, 0.2, 0.05, 0.05), 0x6a5030); break;
    case 'dagger': add(UNIT.box, xf(0, 0.05, 0.06, 0.04, 0.025, 0.36), 0xb8bcc4); add(UNIT.box, xf(0, 0.05, -0.15, 0.13, 0.045, 0.045), 0x5a4020); break;
    case 'hammer': add(UNIT.cyl8, xf(0, 0.05, -0.05, 0.05, 0.5, 0.05, 0, Math.PI / 2, 0), 0x5a4020); add(UNIT.box, xf(0, 0.08, 0.2, 0.14, 0.12, 0.2), 0x505058); break;
    case 'axe': add(UNIT.cyl8, xf(0, 0.05, -0.06, 0.05, 0.55, 0.05, 0, Math.PI / 2, 0), 0x5a4020); add(UNIT.box, xf(0, 0.07, 0.2, 0.06, 0.18, 0.17), 0x808890); break;
    case 'bread': add(UNIT.sphere, xf(0, 0.09, 0, 0.24, 0.16, 0.4), 0xc89050); break;
    case 'pie': add(UNIT.cyl12, xf(0, 0.06, 0, 0.34, 0.11, 0.34), 0xd0a060); add(UNIT.cyl12, xf(0, 0.12, 0, 0.26, 0.04, 0.26), 0xa05030); break;
    case 'ale': add(tapered(0.88), xf(0, 0.13, 0, 0.2, 0.26, 0.2), 0x8a6a40); add(UNIT.cyl8, xf(0, 0.27, 0, 0.16, 0.04, 0.16), 0xf0e8c0); break;
    case 'coins': add(tapered(0.8), xf(0, 0.08, 0, 0.22, 0.17, 0.22), 0x8a6a40); for (let i = 0; i < 3; i++) add(UNIT.cyl8, xf((i - 1) * 0.05, 0.18, 0.02, 0.09, 0.02, 0.09), 0xf0d060); break;
    case 'ring': add(UNIT.cyl12, xf(0, 0.03, 0, 0.13, 0.03, 0.13), 0xe8e8f0); break;
    case 'cheese': add(UNIT.cyl6, xf(0, 0.08, 0, 0.3, 0.15, 0.3), 0xf0d060); break;
    case 'lantern': add(tapered(0.85), xf(0, 0.14, 0, 0.17, 0.26, 0.17), 0xffd080); add(UNIT.cyl8, xf(0, 0.29, 0, 0.2, 0.04, 0.2), 0x404040); break;
    case 'herbs': add(UNIT.blobLo, xf(0, 0.07, 0, 0.26, 0.14, 0.26), 0x4a8a3a); break;
    case 'flowers': add(UNIT.blobLo, xf(0, 0.12, 0, 0.2, 0.2, 0.2), 0xe060a0); break;
    case 'meat': add(UNIT.sphere, xf(0, 0.07, 0, 0.3, 0.13, 0.4), 0xa03030); break;
    case 'wheat': add(tapered(1.4), xf(0, 0.17, 0, 0.22, 0.34, 0.22), 0xd8c060); break;
    case 'log': add(UNIT.cyl8, xf(0, 0.13, 0, 0.26, 0.8, 0.26, 0, Math.PI / 2, 0), 0x68512f); break;
    case 'stone': for (let i = 0; i < 3; i++) add(UNIT.blobLo, xf((i - 1) * 0.14, 0.09, (i % 2) * 0.1, 0.22, 0.18, 0.22, i), 0x7a7c7e); break;
    default: add(UNIT.blobLo, xf(0, 0.1, 0, 0.22, 0.2, 0.22), 0x9a8060);
  }
  const geo = acc.build();
  const g = new THREE.Group();
  if (geo) { const m = new THREE.Mesh(geo, propMaterial()); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}

export class ActorRenderer {
  group = new THREE.Group();
  private humans = new Map<string, HumanoidRig>(); private chickens = new Map<string, Chicken>(); private itemMeshes = new Map<string, THREE.Object3D>();
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
        if (!h) { h = new HumanoidRig(attireFor(p)); this.humans.set(b.id, h); this.group.add(h.root); h.root.userData.bodyId = b.id; }
        h.root.visible = !(hidePlayerBody && p.controlled);
        // Canonical facing is `(-sin yaw, -cos yaw)` (the convention perception + combat use —
        // see Simulation.perceive / followPath). This mesh's "front" (face, held item) is its
        // local +Z, which `rotation.y = yaw` alone would point the OTHER way — the cause of the
        // "NPCs walking backwards" the v0.2.3 playtest saw. Add PI so the mesh faces the
        // canonical facing direction. Canonical nav is untouched.
        h.root.position.set(b.pos.x, b.pos.y, b.pos.z); h.root.rotation.y = b.yaw + Math.PI;
        const held = p.inventory.map(id => this.world.item(id)).find(i => i && ['sword', 'dagger', 'hammer', 'axe', 'lantern'].includes(i.type));
        h.setHeld((b.pose === 'sleep' || b.pose === 'dead' || b.pose === 'eat' || b.pose === 'drink' || b.pose === 'haul') ? '' : (held?.type ?? ''));
        h.animate(dt, b, physTime, b.pose === 'work' ? workStyleFor(this.world, p) : null);
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
