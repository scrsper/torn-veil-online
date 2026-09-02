import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { Person } from '../../sim/core/types';
import type { Target } from '../player/interaction';
import { formatWorldTime } from '../../sim/core/time';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
export class HUD {
  topTime = $('#topbar .time'); topSub = $('#topbar .sub'); target = $('#target'); bar = $('#vitals .bar i'); inv = $('#inv'); msgs = $('#messages'); bubbles = $('#bubbles'); damage = $('#damage');
  labels = new Map<string, HTMLElement>(); selected: string | null = null; lastHurt = -9;
  constructor(private world: World, private camera: THREE.PerspectiveCamera) {}
  message(text: string): void { const d = document.createElement('div'); d.textContent = text; this.msgs.appendChild(d); setTimeout(() => d.remove(), 4000); while (this.msgs.children.length > 3) this.msgs.firstChild?.remove(); }
  update(target: Target, speedMult: number, paused: boolean): void {
    const w = this.world; const c = w.clock;
    this.topTime.textContent = `${formatWorldTime(c.worldSeconds)}${paused ? ' ⏸' : speedMult !== 1 ? ` ×${speedMult}` : ''}`;
    const place = w.placeAt(w.primaryBody(w.playerId)!.pos);
    this.topSub.textContent = `${w.weather.kind}${w.weather.kind === 'rain' || w.weather.kind === 'storm' ? ` (${Math.round(w.weather.intensity * 100)}%)` : ''} · ${place?.name ?? 'the wilds'} · ${w.persons().filter(p => p.alive && !p.controlled).length} people alive`;
    const player = w.person(w.playerId)!; const pb = w.primaryBody(player.id)!;
    this.bar.style.width = `${Math.max(0, pb.health / pb.maxHealth * 100)}%`;
    if (pb.lastHitAt > this.lastHurt) { this.lastHurt = pb.lastHitAt; this.damage.style.opacity = '1'; setTimeout(() => this.damage.style.opacity = '0', 250); }
    this.inv.innerHTML = 'Carrying: ' + (player.inventory.map(id => w.item(id)).filter(Boolean).map(i => `<b>${i!.name}${i!.quantity > 1 ? ` ×${i!.quantity}` : ''}</b>`).join(', ') || 'nothing');
    if (!target) this.target.innerHTML = '';
    else if (target.kind === 'body') { const p = target.person; if (p) { const goal = p.mind.goal; const st = target.body.dead ? 'dead' : target.body.pose === 'downed' ? 'incapacitated' : target.body.pose === 'sleep' ? 'asleep' : goal ? `${goal.type}${goal.data?.label ? ': ' + goal.data.label : ''}` : 'idle'; this.target.innerHTML = `<div class="name">${p.name}</div><div class="hint">${p.occupation} · ${st} · ${Math.round(target.body.health)}/${target.body.maxHealth} hp<br>[E] talk · [F] inspect · [LMB] attack</div>`; } else this.target.innerHTML = `<div class="name">${w.nameOf(target.body.ownerId)}</div>`; }
    else if (target.kind === 'item') { const it = target.item; const owner = it.ownerId && it.ownerId !== w.playerId ? ` · belongs to ${w.nameOf(it.ownerId)}` : ''; this.target.innerHTML = `<div class="name">${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ''}</div><div class="hint">${it.type}${owner}<br>[E] take</div>`; }
    else this.target.innerHTML = `<div class="hint">${target.name} · [E] use</div>`;
    this.updateLabels();
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
      if (speech) { el.className = 'bubble'; el.textContent = speech.text; el.style.left = `${x}px`; el.style.top = `${y - 6}px`; }
      else { el.className = 'label' + (this.selected === p.id ? ' sel' : ''); el.textContent = p.name + (b.dead ? ' †' : ''); el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.opacity = String(Math.max(0.25, 1 - d / 16)); }
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }
}
