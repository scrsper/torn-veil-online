import type { Person } from '../../sim/core/types';
import { DialogueSystem, type DialogueState } from '../../sim/mind/dialogue';

export class DialogueUI {
  el = document.getElementById('dialogue')!; state: DialogueState | null = null; onClose: (() => void) | null = null; onOption: (() => void) | null = null;
  constructor(private ds: DialogueSystem) {
    window.addEventListener('keydown', (e) => { if (!this.state) return; if (e.code === 'Escape') { this.close(); return; } const n = parseInt(e.key); if (n >= 1 && n <= 9) { const o = this.state.options[n - 1]; if (o) this.choose(o.next); } });
  }
  get open(): boolean { return !!this.state; }
  start(npc: Person, player: Person): void { this.show(this.ds.start(npc, player)); }
  private show(s: DialogueState | null): void { if (!s) { this.close(); return; } this.state = s; this.render(); }
  private choose(next: () => DialogueState | null): void { this.onOption?.(); this.show(next()); }
  close(): void { this.state = null; this.el.style.display = 'none'; this.onClose?.(); }
  private render(): void {
    const s = this.state!; this.el.style.display = 'block';
    this.el.innerHTML = `<div class="who">${s.speaker.name}<span>${s.speaker.occupation}${s.speaker.mind.goal ? ` · ${s.speaker.mind.goal.type}` : ''}</span></div><div class="lines">${s.lines.map(l => `<p>${l}</p>`).join('')}</div><div class="opts"></div>`;
    const opts = this.el.querySelector('.opts')!;
    s.options.forEach((o, i) => { const b = document.createElement('button'); b.className = 'opt'; b.innerHTML = `<b>${i + 1}</b>${o.label}`; b.onclick = () => this.choose(o.next); opts.appendChild(b); });
  }
}
