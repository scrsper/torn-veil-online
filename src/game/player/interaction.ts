import { meleeStrike } from '../../sim/physical/melee';
import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { Body, Item, Person, Vec3 } from '../../sim/core/types';
import { Simulation } from '../../sim/mind/agent';
import { PlayerController } from './controller';
import { blockDef, B } from '../../sim/physical/blocks';
import { actionsForWorldItem, type PlayerAction } from '../../sim/core/interaction';

export type Target = { kind: 'body'; body: Body; person: Person | null; dist: number } | { kind: 'item'; item: Item; dist: number } | { kind: 'block'; x: number; y: number; z: number; name: string; dist: number } | null;

/** Targeting, attack, pickup, talk. The player's actions go through the same canonical Simulation calls NPCs use. */
export class Interaction {
  target: Target = null; lastAttack = -9; onTalk: ((p: Person) => void) | null = null; onInspect: ((p: Person) => void) | null = null; onMessage: ((s: string) => void) | null = null; onSwing: (() => void) | null = null; onPickup: (() => void) | null = null; onTrade: ((p: Person) => void) | null = null;
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
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      // Shift+E is the deliberate override: when the obvious reading of a situation is "buy this",
      // taking it anyway stays one keystroke away and is named theft when the player is told what
      // happened. Making it unreachable would be the tidy answer and the wrong one.
      if (e.code === 'KeyE') { if (e.shiftKey && this.target?.kind === 'item') this.actOnItem(this.target.item, this.itemTakeAnyway(this.target.item) ?? this.itemActions(this.target.item)[0]); else this.interact(); }
      if (e.code === 'KeyQ') this.drop();
      if (e.code === 'KeyX') this.attack();
      if (e.code === 'KeyC') this.eat();
      if (e.code === 'KeyG') this.work();
      if (e.code === 'KeyR' && this.target?.kind === 'body' && this.target.person) this.onTrade?.(this.target.person);
      if (e.code === 'KeyF' && this.target?.kind === 'body' && this.target.person) this.onInspect?.(this.target.person);
    });
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
    const t = this.target;
    const result = meleeStrike(this.sim, this.player, this.ctrl.body, t?.kind === 'body' ? t.body.id : null);
    if (result !== 'cooldown' && result !== 'incapacitated') this.onSwing?.();
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
    else if (t.kind === 'item') { this.actOnItem(t.item, this.itemActions(t.item)[0]); }
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
  /**
   * v0.10.1 Part IX: what this player may do with that object right now, derived from canonical
   * state (`sim/core/interaction.ts`) rather than from a menu written here. The FIRST entry is
   * what the interact key does — deliberately the least surprising reading of the situation, so
   * pressing E at a baker's counter buys the bread rather than stealing it.
   */
  itemActions(it: Item): PlayerAction[] { return actionsForWorldItem(this.world, this.player, it); }
  /** The theft, when the primary action is something else and taking it anyway is still possible.
   * Bound to a separate key rather than removed: the milestone is explicit that theft must remain
   * available, only correctly named and correctly consequential. */
  itemTakeAnyway(it: Item): PlayerAction | null {
    const acts = this.itemActions(it);
    return acts[0]?.kind === 'steal' || acts[0]?.kind === 'take' ? null : acts.find(a => a.kind === 'steal' || a.kind === 'take') ?? null;
  }
  /** Perform one derived action on a world item. Every branch is a canonical Simulation call. */
  actOnItem(it: Item, action: PlayerAction | undefined): void {
    const w = this.world; const p = this.player;
    if (!action) return;
    switch (action.kind) {
      case 'buy': {
        const seller = action.ownerId ? w.person(action.ownerId) : null;
        if (!seller) { this.onMessage?.('There is nobody here to pay.'); return; }
        if (it.quantity > 1) {
          const r = this.sim.buyUnits(p, seller, it, 1);
          if (!r.units) { this.onMessage?.(r.refused ? `${seller.name} will not sell it: ${r.refused.replace(/_/g, ' ')}.` : `You have ${p.wealth} silver — not enough.`); return; }
          this.onPickup?.(); this.onMessage?.(`You buy ${r.units} ${it.type} from ${seller.name} for ${r.paid} silver.`);
          return;
        }
        const ev = this.sim.buyItem(p, seller, it);
        if (!ev) { this.onMessage?.(`You have ${p.wealth} silver — not enough for that.`); return; }
        this.onPickup?.(); this.onMessage?.(`You buy ${it.name} from ${seller.name} for ${ev.data.price} silver.`);
        return;
      }
      case 'take': case 'steal': case 'recover': {
        const name = it.name;
        const ev = this.sim.takeItem(p, it, 'pickup');
        this.onPickup?.();
        this.onMessage?.(ev.type === 'theft' ? `You take ${name}. It belongs to ${w.nameOf(ev.target)} — that was theft.`
          : ev.type === 'recovered' ? `You pick up ${name}, to return to ${w.nameOf(it.ownerId)}.`
          : `You pick up ${name}.`);
        return;
      }
      case 'inspect': this.onMessage?.(`${it.name}. ${action.detail ?? ''}`.trim()); return;
      default: return;
    }
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
  /** Q: put down the last thing picked up — the quick version of what the inventory panel's
   * Drop does to a chosen item. Both end in the same `Simulation.dropItem`. */
  drop(): void { const p = this.player; const it = this.world.item(p.inventory[p.inventory.length - 1]); if (it) this.dropItem(it); }
  /** Put down one named carried thing, a step in front of the player. Cargo is a special case
   * only because setting it down genuinely abandons the job (`abandonHaul` fails the request and
   * drops the stack), which the player should be told rather than discovering later. */
  dropItem(it: Item): void {
    const p = this.player;
    if (it.holderId !== p.id) { this.onMessage?.(`You are not carrying that.`); return; }
    if (it.haulTaskId) { this.sim.abandonHaul(p); this.onMessage?.(`You set down the ${it.name} and give up the haul.`); return; }
    const f = this.ctrl.forward(); const b = this.ctrl.body;
    const fx = b.pos.x + f.x * 1.2, fz = b.pos.z + f.z * 1.2;
    const floor = this.world.nav.floorY(Math.floor(fx), Math.floor(fz));
    this.sim.dropItem(p, it, { x: fx, y: floor >= 0 ? floor : b.pos.y, z: fz });
    this.onMessage?.(`You drop ${it.name}.`);
  }
  /**
   * Hand something to someone — `Simulation.giveItem`, the same canonical transfer an NPC's own
   * `give` action performs, with the same consequences: ownership and possession both move, the
   * `gift` (or `returned_item`) event is emitted for anyone nearby to perceive, and whether that
   * amounts to anything socially is decided downstream by appraisal and `formObligations`, not
   * here. Refused when they are out of reach, which is the only condition this layer owns.
   */
  give(to: Person, it: Item): void {
    const w = this.world; const p = this.player;
    if (it.holderId !== p.id) { this.onMessage?.('You are not carrying that.'); return; }
    const tb = w.primaryBody(to.id); const pb = this.ctrl.body;
    if (!tb || !to.alive || Math.hypot(tb.pos.x - pb.pos.x, tb.pos.y - pb.pos.y, tb.pos.z - pb.pos.z) > 3.5) { this.onMessage?.(`${to.name} is not close enough.`); return; }
    const before = it.name;
    this.sim.giveItem(p, to, it);
    pb.yaw = Math.atan2(-(tb.pos.x - pb.pos.x), -(tb.pos.z - pb.pos.z));
    tb.pose = 'talk'; tb.poseUntil = w.physicalTime + 2;
    this.onPickup?.();
    this.onMessage?.(`You give ${before} to ${to.name}.`);
  }
}
