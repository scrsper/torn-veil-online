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
  /** Lets the observer overlay claim the primary click for selection instead of a swing. Returns
   * true when it has handled the click. Null (the default) leaves the click as an attack. */
  onPrimaryClick: (() => boolean) | null = null;
  enabled = true;
  constructor(private world: World, private sim: Simulation, private ctrl: PlayerController, dom: HTMLElement) {
    dom.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      // Mouse actions need pointer lock in the immersive modes (that is what "the mouse is
      // driving the view" means there) but must NOT in the elevated mode, where the cursor is
      // free and is what picks the target in the first place. Watching someone else through the
      // observer camera is not playing, so it takes no actions either.
      const usable = this.ctrl.mode === 'arpg' ? !this.ctrl.followPos : this.ctrl.locked;
      if (!usable) return;
      if (e.button === 0) { if (this.onPrimaryClick?.()) return; this.attack(); }
      else if (e.button === 2) this.interact();
    });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return; if (e.code === 'KeyE') this.interact(); if (e.code === 'KeyQ') this.drop(); if (e.code === 'KeyX') this.attack(); if (e.code === 'KeyC') this.eat(); if (e.code === 'KeyG') this.work(); if (e.code === 'KeyF' && this.target?.kind === 'body' && this.target.person) this.onInspect?.(this.target.person); });
  }
  get player(): Person { return this.world.person(this.world.playerId)!; }
  update(): void {
    // v0.10 Part V: `aimOrigin`/`aimDir` (player/controller.ts) is the ONE place that knows how
    // the current camera turns "the player is reaching for that" into a ray. In the immersive
    // modes it is eye + look direction, exactly as before; in the elevated mode it is eye +
    // direction toward whatever the cursor is over. Everything below — the reach limit, the
    // ownership rules, the canonical calls — is identical in both, because the player's reach is
    // a property of their body, not of the camera watching it.
    const eye = this.ctrl.aimOrigin(); const dir = this.ctrl.aimDir(); const w = this.world;
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
    const pb = this.ctrl.body; pb.pose = 'attack'; pb.poseUntil = now + 0.4; pb.lastAttackAt = now;
    // Face what is being struck. In the immersive modes the body is already facing it (that is
    // how it got targeted); in the elevated mode the cursor picked it, so the body turns to it —
    // the same canonical `Simulation.attack` either way.
    if (t?.kind === 'body' && this.ctrl.mode === 'arpg') pb.yaw = Math.atan2(-(t.body.pos.x - pb.pos.x), -(t.body.pos.z - pb.pos.z));
    this.onSwing?.();
    if (t?.kind === 'body' && t.dist < 3.2) this.sim.attack(this.player, pb, t.body);
  }
  /** What the cursor is over right now, whatever its distance — the observer overlay's
   * click-to-select uses this, so selecting someone across the square does not require walking
   * over to them. Read-only: it never touches canonical state and never acts on anyone. */
  pickPersonUnderCursor(): Person | null {
    const w = this.world;
    const origin = this.ctrl.mode === 'arpg' ? this.ctrl.camera.position : this.ctrl.eye();
    const dir = this.ctrl.mode === 'arpg'
      ? new THREE.Vector3(this.ctrl.cursor.x, this.ctrl.cursor.y, 0.5).unproject(this.ctrl.camera).sub(this.ctrl.camera.position).normalize()
      : this.ctrl.forward();
    let best: Person | null = null; let bestScore = Infinity;
    for (const b of w.bodies()) {
      if (!b.present || b.shape !== 'humanoid') continue;
      const p = w.person(b.ownerId); if (!p) continue;
      const centre = new THREE.Vector3(b.pos.x, b.pos.y + 0.9, b.pos.z);
      const to = centre.clone().sub(origin);
      const along = to.dot(dir);
      if (along <= 0) continue;
      const perp = to.clone().sub(dir.clone().multiplyScalar(along)).length();
      if (perp > 0.9) continue;
      if (along < bestScore) { bestScore = along; best = p; }
    }
    return best;
  }
  interact(): void {
    const t = this.target; if (!t) return; const w = this.world;
    if (t.kind === 'body' && t.person) { if (t.body.dead) { this.onMessage?.(`${t.person.name} is dead.`); this.loot(t.person); return; } if (t.body.pose === 'sleep') { this.onMessage?.(`${t.person.name} is asleep.`); return; } this.onTalk?.(t.person); }
    else if (t.kind === 'body') { this.onMessage?.('The chicken regards you with suspicion.'); }
    else if (t.kind === 'item') { const it = t.item; const ev = this.sim.takeItem(this.player, it, 'pickup'); this.onPickup?.(); this.onMessage?.(ev.type === 'theft' ? `You take ${it.name}. It belongs to ${w.nameOf(it.ownerId)}.` : ev.type === 'recovered' ? `You pick up ${it.name}, to return to ${w.nameOf(it.ownerId)}.` : `You pick up ${it.name}.`); }
    else if (t.kind === 'block') { const id = w.grid.get(t.x, t.y, t.z);
      // v0.3: chop a tree / quarry a rock — the same canonical extraction NPCs use.
      if (id === B.Log || id === B.Log2 || id === B.Leaves || id === B.Leaves2 || id === B.StoneBrick) {
        const got = this.sim.extractResourceAt(this.player, { x: t.x + 0.5, y: t.y, z: t.z + 0.5 });
        if (got > 0) {
          // v0.8 §16: same visible "chop" silhouette an NPC's own extraction action gets — the
          // player's action briefly looks like what it is instead of nothing happening visually.
          const pb = this.ctrl.body; pb.pose = 'chop'; pb.poseUntil = w.physicalTime + 0.6;
          this.onPickup?.(); this.onMessage?.(`You work loose ${got} ${id === B.StoneBrick ? 'stone' : 'logs'}, left at the site.`); return;
        }
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
      if (id === B.Door) { const wasOpen = w.isDoorOpen({ x: t.x, y: t.y, z: t.z }); w.toggleDoor({ x: t.x, y: t.y, z: t.z }, this.player.id); this.onMessage?.(`You ${wasOpen ? 'close' : 'open'} the door.`); } else if (id === B.Bed) { this.onMessage?.('Not your bed.'); } else if (id === B.Sign) this.onMessage?.('"The Gilded Boar — ale, stew, beds. No fighting."'); else if (id === B.Gravestone) { const gy = w.places().find(p => p.type === 'graveyard'); const g = gy?.anchors.find(a => a.kind === 'grave' && Math.floor(a.pos.x) === t.x && Math.floor(a.pos.z) === t.z + 1); this.onMessage?.(g ? `Here lies ${g.label}.` : 'A weathered headstone.'); } else if (id === B.Altar) this.onMessage?.('An altar to the Lantern-Bearer. A candle gutters.'); else if (id === B.Well || id === B.Water) { if (this.sim.drinkHere(this.player)) { this.onPickup?.(); this.onMessage?.('You drink. Cold, clear water.'); } else this.onMessage?.('Cold, clear water, out of reach from here.'); } else this.onMessage?.(`${t.name}.`); }
  }
  /** Player embodiment: eat one unit of food to hand — `eatFood` via participation.ts, the same
   * function an NPC's `eat` action calls, with the same accessibility rule. */
  eat(): void {
    const p = this.player; const hungerBefore = p.needs.hunger;
    const type = this.sim.eatAtHand(p);
    if (!type) { this.onMessage?.('You have nothing to eat. Buy a meal from someone who sells food.'); return; }
    this.onPickup?.(); this.onMessage?.(`You eat ${type}.${hungerBefore < 0.25 ? ' You were not really hungry.' : ''}`);
  }
  /** Player embodiment: one physical step of the haul job you took on — load at the source,
   * deposit at the destination — through `loadHaulCargo`/`depositHaulCargo`, the same functions
   * an NPC hauler's own actions call. The wage arrives through `completeRequest`, like theirs. */
  work(): void {
    const w = this.world; const r = this.sim.progressHaul(this.player);
    switch (r.kind) {
      case 'no_job': this.onMessage?.('You have no work on. Ask someone whose business needs carrying — the baker, the miller, a stall-keeper.'); break;
      case 'loaded': this.onPickup?.(); this.onMessage?.(`You load ${r.units} ${r.task.resource}${r.task.carried < r.task.quantity - r.task.delivered ? ` — as much as you can carry` : ''}. Take it to ${w.nameOf(r.task.destPlaceId)}.`); break;
      case 'delivered': this.onPickup?.(); this.onMessage?.(r.complete ? `You deliver ${r.units} ${r.task.resource}.${r.paid > 0 ? ` ${w.nameOf(r.task.requesterId)} pays you ${r.paid} silver.` : ' Nobody is able to pay you for it.'}` : `You deliver ${r.units} ${r.task.resource}. More is still needed — back to ${w.nameOf(r.task.sourcePlaceId)}.`); break;
      case 'go_to': this.onMessage?.(`${r.leg === 'source' ? 'Fetch' : 'Deliver'} the ${r.task.resource} at ${r.place.name} — about ${Math.round(r.distance)} paces ${this.bearing(r.place.inside)}.`); break;
      case 'failed': this.onMessage?.(`The haul is off: ${r.reason}.`); break;
    }
  }
  private bearing(to: Vec3): string {
    const b = this.ctrl.body; const dx = to.x - b.pos.x, dz = to.z - b.pos.z;
    const ang = Math.atan2(dx, -dz); const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    return dirs[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
  }
  private loot(p: Person): void { const w = this.world; for (const id of [...p.inventory]) { const it = w.item(id); if (!it) continue; const b = w.primaryBody(p.id); this.sim.dropItem(p, it, { x: (b?.pos.x ?? 0) + (w.rng.next() - 0.5), y: b?.pos.y ?? 0, z: (b?.pos.z ?? 0) + (w.rng.next() - 0.5) }); } }
  drop(): void { const p = this.player; const id = p.inventory[p.inventory.length - 1]; const it = this.world.item(id); if (!it) return;
    if (it.haulTaskId) { this.sim.abandonHaul(p); this.onMessage?.(`You set down the ${it.name} and give up the haul.`); return; } const f = this.ctrl.forward(); const b = this.ctrl.body; this.sim.dropItem(p, it, { x: b.pos.x + f.x * 1.2, y: this.world.nav.floorY(Math.floor(b.pos.x + f.x * 1.2), Math.floor(b.pos.z + f.z * 1.2)) >= 0 ? this.world.nav.floorY(Math.floor(b.pos.x + f.x * 1.2), Math.floor(b.pos.z + f.z * 1.2)) : b.pos.y, z: b.pos.z + f.z * 1.2 }); this.onMessage?.(`You drop ${it.name}.`); }
}
