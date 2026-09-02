import type { World } from '../../sim/core/world';
import type { WorldEvent, EventCategory } from '../../sim/core/types';
import { formatWorldTime } from '../../sim/core/time';

/** Live structured event feed with category filters and causal chain view. */
export class EventFeed {
  el = document.getElementById('events')!; chain = document.getElementById('chainpane')!; list!: HTMLElement; filters: Record<EventCategory, boolean> = { world: true, social: true, cognition: true, history: false };
  focus: string | null = null; pending: WorldEvent[] = []; onlySignificant = false; onSelectPerson: ((id: string) => void) | null = null; highlighted: string | null = null;
  constructor(private world: World) {
    this.el.innerHTML = `<div class="head"><b>Events</b></div><div class="list"></div>`;
    const head = this.el.querySelector('.head')!; this.list = this.el.querySelector('.list') as HTMLElement;
    for (const c of ['world', 'social', 'cognition', 'history'] as EventCategory[]) { const b = document.createElement('button'); b.textContent = c; b.className = this.filters[c] ? 'on' : ''; b.onclick = () => { this.filters[c] = !this.filters[c]; b.className = this.filters[c] ? 'on' : ''; this.rebuild(); }; head.appendChild(b); }
    const sig = document.createElement('button'); sig.textContent = 'significant only'; sig.onclick = () => { this.onlySignificant = !this.onlySignificant; sig.className = this.onlySignificant ? 'on' : ''; this.rebuild(); }; head.appendChild(sig);
    const clr = document.createElement('button'); clr.textContent = 'clear'; clr.onclick = () => { this.list.innerHTML = ''; }; head.appendChild(clr);
    const pf = document.createElement('button'); pf.textContent = 'all people'; pf.onclick = () => { this.focus = null; pf.textContent = 'all people'; this.rebuild(); }; head.appendChild(pf); (this as any).pf = pf;
    world.onEvent(e => { this.pending.push(e); });
  }
  get open(): boolean { return this.el.classList.contains('open'); }
  toggle(): void { this.el.classList.toggle('open'); if (this.open) this.rebuild(); }
  setFocus(id: string | null): void { this.focus = id; ((this as any).pf as HTMLElement).textContent = id ? `focus: ${this.world.nameOf(id)} ✕` : 'all people'; this.rebuild(); }
  private passes(e: WorldEvent): boolean { if (!this.filters[e.category]) return false; if (this.onlySignificant && e.significance < 0.3) return false; if (this.focus && e.actor !== this.focus && e.target !== this.focus) return false; return true; }
  update(): void {
    if (!this.pending.length) return; const items = this.pending.splice(0); if (!this.open) return;
    const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 30;
    for (const e of items) if (this.passes(e)) this.list.appendChild(this.row(e));
    while (this.list.children.length > 400) this.list.firstChild?.remove();
    if (atBottom) this.list.scrollTop = this.list.scrollHeight;
  }
  rebuild(): void { this.list.innerHTML = ''; const evs = this.world.events.filter(e => this.passes(e)).slice(-300); for (const e of evs) this.list.appendChild(this.row(e)); this.list.scrollTop = this.list.scrollHeight; }
  private row(e: WorldEvent): HTMLElement { const d = document.createElement('div'); d.className = `ev-row ${e.category}` + (this.highlighted === e.id ? ' hl' : ''); d.dataset.id = e.id; d.innerHTML = `<span class="t">${formatWorldTime(e.tick).slice(-5)} ${e.type}</span> ${esc(e.summary)}`; d.onclick = () => this.showChain(e.id); return d; }
  showChain(id: string): void {
    const w = this.world; const e = w.event(id); if (!e) return; this.highlighted = id; this.chain.classList.add('open');
    const ancestors: WorldEvent[] = []; const seen = new Set<string>();
    const up = (ev: WorldEvent, depth: number) => { if (depth > 12) return; for (const c of ev.causes) { const ce = w.event(c); if (ce && !seen.has(ce.id)) { seen.add(ce.id); up(ce, depth + 1); ancestors.push(ce); } } };
    up(e, 0);
    const lines: string[] = [];
    const render = (ev: WorldEvent, depth: number, mark: string) => lines.push(`<div class="ev ${ev.category}" data-id="${ev.id}"><span class="depth">${'│ '.repeat(depth)}${mark}</span>${formatWorldTime(ev.tick).slice(-5)} <b>${ev.type}</b> ${esc(ev.summary)}${ev.perceivedBy.length ? ` <span class="src">[perceived by ${ev.perceivedBy.map(p => `${w.nameOf(p.who)} (${p.how})`).join(', ')}]</span>` : ''}</div>`);
    for (const a of ancestors) render(a, 0, '↑ ');
    render(e, 0, '● ');
    const down = (ev: WorldEvent, depth: number) => { if (depth > 8) return; for (const f of ev.effects) { const fe = w.event(f); if (fe) { render(fe, depth + 1, '└ '); down(fe, depth + 1); } } };
    down(e, 0);
    this.chain.innerHTML = `<b>Causal chain</b> <span class="src">(click any event to re-centre · ↑ causes · └ effects)</span><div class="chain">${lines.join('')}</div>`;
    this.chain.querySelectorAll('.ev').forEach(el => (el as HTMLElement).onclick = () => this.showChain((el as HTMLElement).dataset.id!));
    this.list.querySelectorAll('.ev-row').forEach(el => el.classList.toggle('hl', (el as HTMLElement).dataset.id === id));
  }
}
export function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
