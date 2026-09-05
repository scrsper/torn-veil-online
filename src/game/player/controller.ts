import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { Body, Vec3 } from '../../sim/core/types';
import { blockDef } from '../../sim/physical/blocks';

/** First/third person controller with AABB voxel collision. Drives the player's Body in the canonical world. */
export class PlayerController {
  yaw = -Math.PI / 2; pitch = 0; thirdPerson = false; locked = false; keys = new Set<string>();
  vel = new THREE.Vector3(); onGround = false; sprint = false; eyeHeight = 1.62; width = 0.3; height = 1.8;
  bobPhase = 0; camDist = 4.5; enabled = true; lastStep = 0; onStep: (() => void) | null = null;
  constructor(private world: World, public camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    dom.addEventListener('click', () => { if (this.enabled && !this.locked) void dom.requestPointerLock().catch(() => { /* unavailable in some embedded browsers */ }); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    document.addEventListener('mousemove', (e) => { if (!this.locked) return; this.yaw -= e.movementX * 0.0022; this.pitch -= e.movementY * 0.0022; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch)); });
    window.addEventListener('keydown', (e) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; this.keys.add(e.code); if (e.code === 'KeyV' && this.enabled) this.thirdPerson = !this.thirdPerson; if (e.code === 'Space') e.preventDefault(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  get body(): Body { return this.world.primaryBody(this.world.playerId)!; }
  forward(): THREE.Vector3 { return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  eye(): THREE.Vector3 { const b = this.body; return new THREE.Vector3(b.pos.x, b.pos.y + this.eyeHeight, b.pos.z); }

  update(dt: number): void {
    const b = this.body; const g = this.world.grid;
    const dead = b.dead;
    const move = new THREE.Vector3();
    if (this.enabled && this.locked && !dead) {
      if (this.keys.has('KeyW')) move.z -= 1; if (this.keys.has('KeyS')) move.z += 1; if (this.keys.has('KeyA')) move.x -= 1; if (this.keys.has('KeyD')) move.x += 1;
    }
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = (this.sprint ? 7.2 : 4.4);
    if (move.lengthSq() > 0) { move.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw); }
    const accel = this.onGround ? 40 : 12;
    this.vel.x += (move.x * speed - this.vel.x) * Math.min(1, accel * dt); this.vel.z += (move.z * speed - this.vel.z) * Math.min(1, accel * dt);
    if (this.keys.has('Space') && this.onGround && this.enabled && this.locked && !dead) { this.vel.y = 8.2; this.onGround = false; }
    this.vel.y -= 24 * dt; if (this.vel.y < -30) this.vel.y = -30;
    // in water: slow & float
    const inWater = g.get(Math.floor(b.pos.x), Math.floor(b.pos.y + 0.5), Math.floor(b.pos.z)) === 9;
    if (inWater) { this.vel.y = Math.max(this.vel.y, -2); if (this.keys.has('Space')) this.vel.y = 3; this.vel.x *= 0.9; this.vel.z *= 0.9; }
    // move with collision, axis by axis
    const pos = new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z);
    const collides = (p: THREE.Vector3) => this.aabbHits(p);
    pos.x += this.vel.x * dt; if (collides(pos)) { pos.x -= this.vel.x * dt; if (this.onGround && !collides(new THREE.Vector3(pos.x + this.vel.x * dt, pos.y + 1.01, pos.z))) { pos.y += 1.01; pos.x += this.vel.x * dt; } else this.vel.x = 0; }
    pos.z += this.vel.z * dt; if (collides(pos)) { pos.z -= this.vel.z * dt; if (this.onGround && !collides(new THREE.Vector3(pos.x, pos.y + 1.01, pos.z + this.vel.z * dt))) { pos.y += 1.01; pos.z += this.vel.z * dt; } else this.vel.z = 0; }
    pos.y += this.vel.y * dt; this.onGround = false;
    if (collides(pos)) { if (this.vel.y < 0) { pos.y = Math.floor(pos.y) + 1; this.onGround = true; } else { pos.y = Math.floor(pos.y + this.height) - this.height - 0.001; } this.vel.y = 0; }
    if (pos.y < 1) { pos.y = 1; this.vel.y = 0; this.onGround = true; }
    if (pos.x < 1) pos.x = 1; if (pos.z < 1) pos.z = 1; if (pos.x > g.W - 1) pos.x = g.W - 1; if (pos.z > g.D - 1) pos.z = g.D - 1;
    b.vel = { x: (pos.x - b.pos.x) / Math.max(dt, 1e-4), y: (pos.y - b.pos.y) / Math.max(dt, 1e-4), z: (pos.z - b.pos.z) / Math.max(dt, 1e-4) };
    b.pos = { x: pos.x, y: pos.y, z: pos.z }; b.onGround = this.onGround;
    if (!dead) {
      b.yaw = this.yaw;
      // A timed action pose (attack/hit/chop) holds until its own `poseUntil` expires, then
      // falls back to movement-based pose — previously 'attack'/'hit' were excluded from this
      // assignment UNCONDITIONALLY, so a player's swing pose never actually reverted once set
      // (bodyPhysics's own poseUntil decay explicitly skips controlled bodies). Same fix covers
      // the new v0.8 §16 'chop' pose.
      const timedPoseHeld = (b.pose === 'attack' || b.pose === 'hit' || b.pose === 'chop') && b.poseUntil > this.world.physicalTime;
      if (!timedPoseHeld) b.pose = Math.hypot(this.vel.x, this.vel.z) > 0.5 ? (this.sprint ? 'run' : 'walk') : 'stand';
    }
    // camera
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) { this.bobPhase += dt * hs * 1.8; if (Math.sin(this.bobPhase) > 0.97 && performance.now() - this.lastStep > 250) { this.lastStep = performance.now(); this.onStep?.(); } } else this.bobPhase = 0;
    const bob = this.onGround && hs > 0.5 ? Math.sin(this.bobPhase) * 0.045 : 0;
    const eye = new THREE.Vector3(pos.x, pos.y + this.eyeHeight + bob, pos.z);
    if (this.thirdPerson || dead) {
      const back = this.forward().multiplyScalar(-1); const desired = eye.clone().addScaledVector(back, this.camDist).add(new THREE.Vector3(0, 0.4, 0));
      // pull the camera in if blocked
      let dist = this.camDist; for (let d = 0.5; d <= this.camDist; d += 0.25) { const p = eye.clone().addScaledVector(back, d); if (blockDef(g.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))).opaque) { dist = d - 0.4; break; } }
      const cp = eye.clone().addScaledVector(back, Math.max(0.6, dist)).add(new THREE.Vector3(0, 0.4, 0)); void desired;
      this.camera.position.copy(cp); this.camera.lookAt(eye.clone().add(this.forward().multiplyScalar(2)));
    } else { this.camera.position.copy(eye); this.camera.rotation.set(0, 0, 0, 'YXZ'); this.camera.rotation.y = this.yaw; this.camera.rotation.x = this.pitch; }
  }
  private aabbHits(p: THREE.Vector3): boolean {
    const g = this.world.grid; const w = this.width;
    for (let x = Math.floor(p.x - w); x <= Math.floor(p.x + w); x++) for (let z = Math.floor(p.z - w); z <= Math.floor(p.z + w); z++) for (let y = Math.floor(p.y); y <= Math.floor(p.y + this.height); y++) if (g.isSolidAt(x, y, z)) return true;
    return false;
  }
  teleport(p: Vec3): void { const b = this.body; b.pos = { ...p }; this.vel.set(0, 0, 0); }
}
