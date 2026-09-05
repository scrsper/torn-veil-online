import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { Body, Item, Person, Vec3 } from '../../sim/core/types';
import { Simulation } from '../../sim/mind/agent';
import { PlayerController } from './controller';
import { blockDef, B } from '../../sim/physical/blocks';

export type Target = { kind: 'body'; body: Body; person: Person | null; dist: number } | { kind: 'item'; item: Item; dist: number } | { kind: 'block'; x: number; y: number; z: number; name: string; dist: number } | null;

/** Targeting, attack, pickup, talk. The player's actions go through the same canonical Simulation calls NPCs use. */
export class Interaction {
  target: Target = null; lastAttack = -9; onTalk: ((p: Person) => void) | null = null; onInspect: ((p: Person) => void) | null = null; onMessage: ((s: string) => void) | null = null; onSwing: (() => void) | null = null; onPickup: (() => void) | null = null;
  enabled = true;
  constructor(private world: World, private sim: Simulation, private ctrl: PlayerController, dom: HTMLElement) {
    dom.addEventListener('mousedown', (e) => { if (!this.ctrl.locked || !this.enabled) return; if (e.button === 0) this.attack(); else if (e.button === 2) this.interact(); });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return; if (e.code === 'KeyE') this.interact(); if (e.code === 'KeyQ') this.drop(); if (e.code === 'KeyX') this.attack(); if (e.code === 'KeyF' && this.target?.kind === 'body' && this.target.person) this.onInspect?.(this.target.person); });
  }
  get player(): Person { return this.world.person(this.world.playerId)!; }
  update(): void {
    const eye = this.ctrl.eye(); const dir = this.ctrl.forward(); const w = this.world;
    let best: Target = null; let bestD = 4.2;
    const o = { x: eye.x, y: eye.y, z: eye.z };
    const hit = w.grid.raycastBlock(o, { x: dir.x, y: dir.y, z: dir.z }, 4.2); const blockD = hit ? hit.dist : 4.2;
    for (const b of w.bodies()) { if (b.ownerId === w.playerId || !b.present) continue; const c = new THREE.Vector3(b.pos.x, b.pos.y + (b.shape === 'chicken' ? 0.3 : 0.9), b.pos.z); const toC = c.clone().sub(eye); const d = toC.length(); if (d > bestD || d > blockD + 0.6) continue; const proj = toC.dot(dir); if (proj < 0) continue; const perp = toC.clone().sub(dir.clone().multiplyScalar(proj)).length(); if (perp < (b.shape === 'chicken' ? 0.4 : 0.7) + d * 0.05) { bestD = d; best = { kind: 'body', body: b, person: w.person(b.ownerId) ?? null, dist: d }; } }
    for (const it of w.items()) { if (!it.pos || it.holderId) continue; const c = new THREE.Vector3(it.pos.x, it.pos.y + 0.15, it.pos.z); const toC = c.clone().sub(eye); const d = toC.length(); if (d > bestD || d > blockD + 0.4) continue; const proj = toC.dot(dir); if (proj < 0) continue; const perp = toC.clone().sub(dir.clone().multiplyScalar(proj)).length(); if (perp < 0.45 + d * 0.04) { bestD = d; best = { kind: 'item', item: it, dist: d }; } }
    // A dropped object at the player's feet should remain usable even when the camera is
    // level. Exact ray targeting still wins; this fallback only covers nearby visible items.
    if (!best) {
      const body = this.ctrl.body;
      for (const it of w.items()) {
        if (!it.pos || it.holderId) continue;
        const d = Math.hypot(it.pos.x - body.pos.x, it.pos.y - body.pos.y, it.pos.z - body.pos.z);
        if (d >= bestD || d > 1.7 || !w.grid.lineOfSight(o, { x: it.pos.x, y: it.pos.y + 0.15, z: it.pos.z }, 2.4)) continue;
        bestD = d; best = { kind: 'item', item: it, dist: d };
      }
    }
    if (!best && hit) { const id = w.grid.get(hit.x, hit.y, hit.z); const def = blockDef(id); if (id !== B.Air && id !== B.Grass && id !== B.Dirt && id !== B.Stone && id !== B.Cobble && id !== B.Path && id !== B.Planks && id !== B.Sand) best = { kind: 'block', x: hit.x, y: hit.y, z: hit.z, name: id === B.Door ? `${w.isDoorOpen({ x: hit.x, y: hit.y, z: hit.z }) ? 'open' : 'closed'} door` : def.name, dist: hit.dist }; }
    this.target = best;
  }
  attack(): void {
    const w = this.world; const t = this.target; const now = w.physicalTime; if (now - this.lastAttack < 0.55) return; this.lastAttack = now;
    const pb = this.ctrl.body; pb.pose = 'attack'; pb.poseUntil = now + 0.4; pb.lastAttackAt = now; this.onSwing?.();
    if (t?.kind === 'body' && t.dist < 3.2) this.sim.attack(this.player, pb, t.body);
  }
  interact(): void {
    const t = this.target; if (!t) return; const w = this.world;
    if (t.kind === 'body' && t.person) { if (t.body.dead) { this.onMessage?.(`${t.person.name} is dead.`); this.loot(t.person); return; } if (t.body.pose === 'sleep') { this.onMessage?.(`${t.person.name} is asleep.`); return; } this.onTalk?.(t.person); }
    else if (t.kind === 'body') { this.onMessage?.('The chicken regards you with suspicion.'); }
    else if (t.kind === 'item') { const it = t.item; const stolen = it.ownerId && it.ownerId !== this.player.id; this.sim.takeItem(this.player, it, stolen ? 'theft' : 'pickup'); this.onPickup?.(); this.onMessage?.(stolen ? `You take ${it.name}. It belongs to ${w.nameOf(it.ownerId)}.` : `You pick up ${it.name}.`); }
    else if (t.kind === 'block') { const id = w.grid.get(t.x, t.y, t.z);
      // v0.3: chop a tree / quarry a rock — the same canonical extraction NPCs use.
      if (id === B.Log || id === B.Log2 || id === B.Leaves || id === B.Leaves2 || id === B.StoneBrick) {
        const got = this.sim.extractResourceAt(this.player, { x: t.x + 0.5, y: t.y, z: t.z + 0.5 });
        if (got > 0) { this.onPickup?.(); this.onMessage?.(`You work loose ${got} ${id === B.StoneBrick ? 'stone' : 'logs'}, left at the site.`); return; }
      }
      // v0.8 "The Legible World" §D: harvest/sow a field plot through the same canonical
      // `harvestPlot`/`plantPlot` an NPC's own harvest/plant action uses — see
      // `Simulation.harvestWheatAt`/`plantWheatAt`. Mature wheat is the acceptance case; sowing
      // a fallow plot (bare ground above `B.Farmland`) is the natural symmetric counterpart.
      if (id === B.Wheat) {
        const yield_ = this.sim.harvestWheatAt(this.player, { x: t.x, y: t.y, z: t.z });
        if (yield_ > 0) { this.onPickup?.(); this.onMessage?.(`You harvest the wheat (+${yield_} grain, left at the field).`); return; }
      }
      if (id === B.Farmland) {
        // The crop cell sits one block above the (solid, raycast-hit) farmland itself.
        if (this.sim.plantWheatAt(this.player, { x: t.x, y: t.y + 1, z: t.z })) { this.onMessage?.('You sow the plot with grain.'); return; }
      }
      if (id === B.Door) { const wasOpen = w.isDoorOpen({ x: t.x, y: t.y, z: t.z }); w.toggleDoor({ x: t.x, y: t.y, z: t.z }, this.player.id); this.onMessage?.(`You ${wasOpen ? 'close' : 'open'} the door.`); } else if (id === B.Bed) { this.onMessage?.('Not your bed.'); } else if (id === B.Sign) this.onMessage?.('"The Gilded Boar — ale, stew, beds. No fighting."'); else if (id === B.Gravestone) { const gy = w.places().find(p => p.type === 'graveyard'); const g = gy?.anchors.find(a => a.kind === 'grave' && Math.floor(a.pos.x) === t.x && Math.floor(a.pos.z) === t.z + 1); this.onMessage?.(g ? `Here lies ${g.label}.` : 'A weathered headstone.'); } else if (id === B.Altar) this.onMessage?.('An altar to the Lantern-Bearer. A candle gutters.'); else if (id === B.Well) this.onMessage?.('Cold, clear water.'); else this.onMessage?.(`${t.name}.`); }
  }
  private loot(p: Person): void { const w = this.world; for (const id of [...p.inventory]) { const it = w.item(id); if (!it) continue; const b = w.primaryBody(p.id); this.sim.dropItem(p, it, { x: (b?.pos.x ?? 0) + (w.rng.next() - 0.5), y: b?.pos.y ?? 0, z: (b?.pos.z ?? 0) + (w.rng.next() - 0.5) }); } }
  drop(): void { const p = this.player; const id = p.inventory[p.inventory.length - 1]; const it = this.world.item(id); if (!it) return; const f = this.ctrl.forward(); const b = this.ctrl.body; this.sim.dropItem(p, it, { x: b.pos.x + f.x * 1.2, y: this.world.nav.floorY(Math.floor(b.pos.x + f.x * 1.2), Math.floor(b.pos.z + f.z * 1.2)) >= 0 ? this.world.nav.floorY(Math.floor(b.pos.x + f.x * 1.2), Math.floor(b.pos.z + f.z * 1.2)) : b.pos.y, z: b.pos.z + f.z * 1.2 }); this.onMessage?.(`You drop ${it.name}.`); }
}
