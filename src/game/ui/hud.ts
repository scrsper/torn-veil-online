import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { Item, Person } from '../../sim/core/types';
import type { Target } from '../player/interaction';
import { formatWorldTime } from '../../sim/core/time';
import { hungerBand, thirstBand, sleepBand, type Severity } from '../../sim/core/physiology';
import { activeHaulFor } from '../../sim/logistics/participation';
import { actionsForWorldItem, actionsForPerson } from '../../sim/core/interaction';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
export class HUD {
  topTime = $('#topbar .time'); topSub = $('#topbar .sub'); target = $('#target'); bar = $('#vitals .bar i'); inv = $('#inv'); needs = $('#needs'); purse = $('#purse'); job = $('#job'); msgs = $('#messages'); bubbles = $('#bubbles'); damage = $('#damage');
  labels = new Map<string, HTMLElement>(); selected: string | null = null; lastHurt = -9;
  constructor(private world: World, private camera: THREE.PerspectiveCamera) {}
  message(text: string): void { const d = document.createElement('div'); d.textContent = text; this.msgs.appendChild(d); setTimeout(() => d.remove(), 4000); while (this.msgs.children.length > 3) this.msgs.firstChild?.remove(); }
  /**
   * v0.8 "The Legible World" §G: a ground item's ownership status must respect what the PLAYER
   * actually knows, not the simulation's omniscient `ownerId` — the previous version of this
   * label named the true owner unconditionally the instant an item was merely looked at, before
   * the player had done anything to learn who it belonged to. Distinguishes:
   *  - unowned → no status at all (reads as abandoned, which it genuinely is);
   *  - on a shop's own display counter → "for sale", inferable by anyone without special
   *    knowledge (that's what a market stall display means);
   *  - the player has REAL acquired knowledge of the owner (`mind/knowledge.ts`'s
   *    `owner:<itemId>` KnowledgeItem — witnessed, told, or seeded prior knowledge) → names them;
   *  - otherwise → an honest "not sure whose this is", never a fabricated or omniscient answer.
   */
  private itemStatusFor(it: Item, player: Person): string {
    const w = this.world;
    if (!it.ownerId || it.ownerId === player.id) return '';
    const onDisplay = it.placeId && it.pos ? w.place(it.placeId)?.anchors.some(a => a.kind === 'display' && Math.hypot(a.pos.x - it.pos!.x, a.pos.z - it.pos!.z) < 1.5) : false;
    if (onDisplay) return ' · for sale';
    if (player.knowledge[`owner:${it.id}`]) return ` · belongs to ${w.nameOf(it.ownerId)}`;
    return ' · not sure whose this is';
  }
  update(target: Target, speedMult: number, paused: boolean): void {
    const w = this.world; const c = w.clock;
    this.topTime.textContent = `${formatWorldTime(c.worldSeconds)}${paused ? ' ⏸' : speedMult !== 1 ? ` ×${speedMult}` : ''}`;
    const place = w.placeAt(w.primaryBody(w.playerId)!.pos);
    this.topSub.textContent = `${w.weather.kind}${w.weather.kind === 'rain' || w.weather.kind === 'storm' ? ` (${Math.round(w.weather.intensity * 100)}%)` : ''} · ${place?.name ?? 'the wilds'} · ${w.persons().filter(p => p.alive && !p.controlled).length} people alive`;
    const player = w.person(w.playerId)!; const pb = w.primaryBody(player.id)!;
    this.bar.style.width = `${Math.max(0, pb.health / pb.maxHealth * 100)}%`;
    if (pb.lastHitAt > this.lastHurt) { this.lastHurt = pb.lastHitAt; this.damage.style.opacity = '1'; setTimeout(() => this.damage.style.opacity = '0', 250); }
    this.updateEmbodiment(player);
    this.inv.innerHTML = 'Carrying: ' + (player.inventory.map(id => w.item(id)).filter(Boolean).map(i => `<b>${i!.name}${i!.quantity > 1 ? ` ×${i!.quantity}` : ''}</b>`).join(', ') || 'nothing');
    if (!target) this.target.innerHTML = '';
    else if (target.kind === 'body') {
      const p = target.person;
      if (p) {
        const goal = p.mind.goal;
        const st = target.body.dead ? 'dead' : target.body.pose === 'downed' ? 'incapacitated' : target.body.pose === 'sleep' ? 'asleep' : goal ? `${goal.type}${goal.data?.label ? ': ' + goal.data.label : ''}` : 'idle';
        // v0.10.1 Part IX: the prompts are derived, not written here — "Trade" appears when this
        // person would genuinely sell the player something, and not otherwise.
        const acts = actionsForPerson(w, player, p, player.inventory.map(id => w.item(id)).filter((i): i is Item => !!i));
        const keys: string[] = ['[E] talk'];
        if (acts.some(a => a.kind === 'trade')) keys.push('[R] trade');
        if (acts.some(a => a.kind === 'give')) keys.push('[I] give');
        keys.push('[F] inspect', '[X] attack');
        this.target.innerHTML = `<div class="name">${p.name}</div><div class="hint">${p.occupation} · ${st} · ${Math.round(target.body.health)}/${target.body.maxHealth} hp<br>${keys.join(' · ')}</div>`;
      } else this.target.innerHTML = `<div class="name">${w.nameOf(target.body.ownerId)}</div>`;
    }
    else if (target.kind === 'item') {
      const it = target.item; const status = this.itemStatusFor(it, player);
      // What E will actually do, named before it is done. `actionsForWorldItem` puts the least
      // surprising reading first, so a shop's goods prompt "[E] Buy … — 3s" and the theft the
      // player may still commit is the explicitly-labelled alternative on Shift+E.
      const acts = actionsForWorldItem(w, player, it);
      const primary = acts[0];
      const alt = primary && primary.kind !== 'steal' && primary.kind !== 'take' ? acts.find(a => a.kind === 'steal' || a.kind === 'take') : undefined;
      const lines = [`${it.type}${status}`];
      if (primary) lines.push(`<b>[E] ${primary.label}</b>${primary.detail ? ` <span class="dim">— ${primary.detail}</span>` : ''}`);
      if (alt) lines.push(`<span class="${alt.grave ? 'grave' : ''}">[Shift+E] ${alt.label}${alt.detail ? ` — ${alt.detail}` : ''}</span>`);
      this.target.innerHTML = `<div class="name">${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ''}</div><div class="hint">${lines.join('<br>')}</div>`;
    }
    else this.target.innerHTML = `<div class="hint">${target.name} · [E] ${target.name === 'well' || target.name === 'water' ? 'drink' : 'use'}</div>`;
    this.updateLabels();
  }
  /**
   * Player embodiment: the Traveler's own canonical needs (the same `needs` every NPC has, fed
   * by the same `stepPhysiology`), purse (`wealth`, the one currency), and current haul job
   * (`world.haulTasks` — the same task an NPC would be carrying). Everything shown is the
   * player's OWN state — nothing here reads another person's mind.
   */
  private lastEmbodiment = '';
  private updateEmbodiment(player: Person): void {
    const w = this.world; const n = player.needs;
    const rows: [string, number, Severity][] = [['hunger', n.hunger, hungerBand(player)], ['thirst', n.thirst, thirstBand(player)], ['rest', n.energy, sleepBand(player)]];
    const task = activeHaulFor(w, player);
    let jobText = '';
    if (task) {
      const carrying = task.carried > 0;
      jobText = carrying
        ? `Job: deliver <b>${task.carried} ${task.resource}</b> to <b>${w.nameOf(task.destPlaceId)}</b> — press <b>G</b> there`
        : `Job: fetch <b>${task.quantity - task.delivered} ${task.resource}</b> at <b>${w.nameOf(task.sourcePlaceId)}</b> — press <b>G</b> there`;
    }
    const sig = rows.map(r => `${Math.round(r[1] * 20)}${r[2]}`).join('|') + '|' + player.wealth + '|' + jobText;
    if (sig === this.lastEmbodiment) return; this.lastEmbodiment = sig;
    this.needs.innerHTML = rows.map(([label, v, band]) => `<div class="row ${band}"><span>${label}</span><div class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></i></div><span class="band">${band}</span></div>`).join('');
    this.purse.textContent = `${player.wealth} silver`;
    this.job.innerHTML = jobText;
  }
  private updateLabels(): void {
    const w = this.world; const cam = this.camera; const seen = new Set<string>(); const v = new THREE.Vector3(); const W = window.innerWidth, H = window.innerHeight;
    const camPos = cam.position;
    for (const b of w.bodies()) {
      const p = w.person(b.ownerId); if (!p || p.controlled || !b.present) continue;
      const d = Math.hypot(b.pos.x - camPos.x, b.pos.z - camPos.z); const speech = p.speech;
      if (d > (speech ? 26 : 14) && this.selected !== p.id) continue;
      v.set(b.pos.x, b.pos.y + (b.pose === 'sleep' || b.pose === 'dead' ? 0.9 : 2.05) * p.appearance.height, b.pos.z).project(cam);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) continue;
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      if (!w.grid.lineOfSight({ x: camPos.x, y: camPos.y, z: camPos.z }, { x: b.pos.x, y: b.pos.y + 1.5, z: b.pos.z }, 40) && this.selected !== p.id) continue;
      seen.add(p.id);
      let el = this.labels.get(p.id); if (!el) { el = document.createElement('div'); this.bubbles.appendChild(el); this.labels.set(p.id, el); }
      const goal = p.mind.goal?.type; const urgent = !!goal && ['flee', 'report', 'investigate', 'confront', 'attack', 'help'].includes(goal);
      if (speech) { el.className = 'bubble' + (urgent ? ' alert' : ''); el.textContent = `${p.name}: ${speech.text}`; el.style.left = `${x}px`; el.style.top = `${y - 6}px`; }
      else { el.className = 'label' + (this.selected === p.id ? ' sel' : '') + (urgent ? ' alert' : ''); el.textContent = p.name + (b.dead ? ' †' : urgent ? ` · ${goal}` : ''); el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.opacity = String(Math.max(0.25, 1 - d / 16)); }
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }
}
