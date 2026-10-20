import type { JohnSmithView, QuestView } from '../../sim/orchestrator/overview';
import type { JohnSmithCommand } from '../../sim/orchestrator/types';

/**
 * John Smith's interface in the browser: an attention sigil, the watched-quest tracker, notices,
 * the tabbed Overview and the cache reveal. A projection of the host's John Smith view; every
 * action is a request the host validates (`john_smith` commands) or the ordinary canonical
 * container transfer. Nothing here decides what a quest is, whether it ended or what a cache holds.
 */
export interface JohnSmithHost {
  request(command: JohnSmithCommand): void;
  /** Take one item from an open coffer through the ordinary container transfer command. */
  take(containerId: string, itemId: string): void;
  /** The overview opened or closed; the host releases held input while it is open. */
  onOpenChange(open: boolean): void;
  /** The controlled body's position and the camera's ground yaw, for tracker bearings. */
  pose(): { x: number; y: number; z: number; yaw: number } | null;
}

const TIER = ['#c8874a', '#dfe6ee', '#ffd45c', '#9fe8ff', '#ff8c2e', '#ff5ad1'];
const ATTENTION = ['#7d8794', '#c9d3db', '#8fb5e3', '#86b078', '#e0a24a', '#d15660'];
const LEGEND = ['#9aa1b0', '#cfc8b6', '#8fb5e3', '#ff8c2e'];
const KIND_LABEL: Record<string, string> = { attention: 'Attention', feat: 'Recognition', cache: 'Cache', quest: 'Matter', objective: 'Objective', reserve: 'Reserve', archive: 'Archive' };
const QUEST_GLYPH: Record<string, string> = { trial: '⚔', award: '❖', coffer: '✦', study: '✎', veil: '◈', landmark: '⌂', recover: '⟲', reclaim: '⟲', protect: '⛨', work: '⚒', tend: '♡', justice: '⚖', repay: '⇄', fight: '⚔' };
const TABS = ['quests', 'watch', 'feats', 'loot', 'archive'] as const;
type Tab = typeof TABS[number];

const STYLE = `
.js-root{position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#f0eadb;--js-top:18px;--js-gold:#dcc27e}
.js-root [hidden]{display:none!important}
.js-root.js-covered .js-sigil,.js-root.js-covered .js-tracker{visibility:hidden}
.js-root[data-side=left] .js-sigil,.js-root[data-side=left] .js-tracker{right:auto;left:22px}
.js-root[data-side=left] .js-track{border-left-width:2px}
.js-root button{font:inherit;color:inherit;cursor:pointer}
.js-sigil{position:absolute;top:var(--js-top);right:18px;display:flex;align-items:center;gap:10px;pointer-events:auto;background:linear-gradient(135deg,#0f1722ee,#131c28d8);border:1px solid #dcc27e40;border-radius:3px;padding:7px 12px 7px 9px;min-width:178px;box-shadow:0 8px 30px #0006;text-align:left}
.js-sigil:hover{border-color:#dcc27eaa}
.js-eye{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:17px;border:1px solid currentColor;box-shadow:0 0 14px currentColor inset;transition:color .6s}
.js-sigil.js-pulse .js-eye{animation:js-pulse 1.8s ease-out 2}
@keyframes js-pulse{0%{box-shadow:0 0 0 0 currentColor}70%{box-shadow:0 0 0 16px transparent}100%{box-shadow:0 0 0 0 transparent}}
.js-sigil small{display:block;font-size:9px;letter-spacing:.22em;color:#dcc27e}
.js-sigil b{display:block;font:15px Georgia,serif;letter-spacing:.03em}
.js-badge{margin-left:auto;min-width:22px;padding:2px 6px;border-radius:10px;background:#ffd45c;color:#1a1408;font-size:11px;font-weight:700;text-align:center}
.js-tracker{position:absolute;top:calc(var(--js-top) + 58px);right:18px;width:300px;display:flex;flex-direction:column;gap:8px}
.js-track{background:#0d141ecc;border-left:2px solid var(--js-gold);padding:8px 11px 9px;pointer-events:auto;text-shadow:0 1px 3px #000}
.js-track header{display:flex;gap:7px;align-items:baseline;font:14px Georgia,serif}
.js-track header span{color:var(--js-gold)}
.js-track header em{margin-left:auto;font:10px system-ui;font-style:normal;letter-spacing:.08em;color:#9aa1b0}
.js-track ul{list-style:none;margin:5px 0 0;padding:0;font-size:12px;line-height:1.55;color:#cfc8b6}
.js-track li.js-done{color:#86b078;text-decoration:line-through;text-decoration-color:#86b07888}
.js-bearing{display:flex;align-items:center;gap:7px;margin-top:4px;font-size:11px;color:#8fb5e3}
.js-arrow{display:inline-block;width:16px;text-align:center;transition:transform .12s linear;font-size:14px}
.js-toasts{position:absolute;right:18px;bottom:74px;width:380px;display:flex;flex-direction:column-reverse;gap:8px}
.js-toast{background:linear-gradient(135deg,#0e1520f2,#141d2aee);border:1px solid #ffffff1a;border-left:3px solid var(--c,#dcc27e);padding:10px 14px;box-shadow:0 10px 40px #0007;animation:js-in .45s cubic-bezier(.2,.9,.3,1.2);pointer-events:auto}
.js-toast.js-out{animation:js-out .5s forwards}
.js-toast small{font-size:9px;letter-spacing:.24em;color:var(--c,#dcc27e)}
.js-toast b{display:block;font:16px Georgia,serif;margin:2px 0 4px}
.js-toast p{margin:0;font-size:12px;line-height:1.5;color:#cfc8b6}
.js-toast.js-feat{border-color:var(--c);box-shadow:0 0 30px color-mix(in srgb,var(--c) 35%,transparent),0 10px 40px #0008}
.js-toast.js-feat b{font-size:19px;color:var(--c)}
@keyframes js-in{from{opacity:0;transform:translateX(40px) scale(.96)}to{opacity:1;transform:none}}
@keyframes js-out{to{opacity:0;transform:translateX(30px)}}
.js-overview{position:absolute;inset:0;display:grid;place-items:center;background:#03070dcc;pointer-events:auto;backdrop-filter:blur(3px)}
.js-panel{width:min(1000px,94vw);height:min(720px,88vh);display:grid;grid-template-rows:auto auto 1fr;background:linear-gradient(160deg,#111a26fa,#0c121bfa);border:1px solid #dcc27e55;box-shadow:0 30px 120px #000c;position:relative}
.js-panel::before,.js-panel::after{content:'';position:absolute;width:18px;height:18px;border:2px solid #dcc27e;pointer-events:none}
.js-panel::before{top:-2px;left:-2px;border-right:0;border-bottom:0}.js-panel::after{bottom:-2px;right:-2px;border-left:0;border-top:0}
.js-head{display:flex;align-items:center;gap:16px;padding:18px 24px 10px;border-bottom:1px solid #ffffff12}
.js-head h2{margin:0;font:26px Georgia,serif;letter-spacing:.04em}
.js-head small{display:block;font-size:10px;letter-spacing:.3em;color:#dcc27e}
.js-head .js-close{margin-left:auto;background:#25435577;border:1px solid #cedde22b;padding:7px 14px}
.js-tabs{display:flex;gap:4px;padding:8px 20px 0;border-bottom:1px solid #ffffff12}
.js-tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:9px 14px;letter-spacing:.12em;font-size:12px;text-transform:uppercase;color:#9aa1b0}
.js-tabs button.js-on{color:#f0eadb;border-color:#dcc27e}
.js-tabs button i{font-style:normal;margin-left:6px;color:#ffd45c}
.js-body{overflow:auto;padding:18px 24px 26px}
.js-body h3{font:17px Georgia,serif;margin:18px 0 8px;color:#dcc27e;letter-spacing:.04em}
.js-body h3:first-child{margin-top:0}
.js-voice{font:italic 13px/1.6 Georgia,serif;color:#a9b4c2;border-left:2px solid #dcc27e55;padding:2px 0 2px 12px;margin:0 0 14px}
.js-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px}
.js-card{background:#162030;border:1px solid #ffffff14;padding:12px 14px;position:relative}
.js-card.js-tiered{border-top:2px solid var(--c)}
.js-card b{font:15px Georgia,serif}
.js-card p{margin:6px 0 0;font-size:12px;line-height:1.55;color:#bfc6cf}
.js-card .js-meta{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8a93a1;margin-top:8px}
.js-quest{border-left:3px solid #dcc27e66;background:#152030;margin-bottom:9px;padding:11px 14px}
.js-quest.js-closed{opacity:.72;border-left-color:#ffffff22}
.js-quest header{display:flex;gap:9px;align-items:baseline}
.js-quest header b{font:16px Georgia,serif}
.js-quest header .js-st{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9aa1b0}
.js-quest header .js-actions{margin-left:auto;display:flex;gap:6px}
.js-quest header .js-actions button{background:#20304188;border:1px solid #ffffff22;padding:3px 9px;font-size:11px}
.js-quest header .js-actions button.js-on{border-color:#8fb5e3;color:#8fb5e3}
.js-quest ul{list-style:none;margin:7px 0 0;padding:0;font-size:12.5px;line-height:1.6}
.js-quest li::before{content:'○ ';color:#9aa1b0}.js-quest li.js-done::before{content:'✓ ';color:#86b078}
.js-quest .js-sum{font-size:12.5px;color:#bfc6cf;margin:5px 0 0;line-height:1.55}
.js-reward{display:inline-block;margin-top:7px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:2px 7px;border:1px solid var(--c);color:var(--c)}
.js-bar{height:6px;background:#ffffff14;margin-top:6px;position:relative}.js-bar i{position:absolute;inset:0 auto 0 0;background:var(--c,#dcc27e)}
.js-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #ffffff0d;font-size:13px}
.js-row em{font-style:normal;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.js-reserve{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:6px}
.js-reserve div{background:#141e2c;border-top:2px solid var(--c);padding:8px;text-align:center;font-size:11px;color:#bfc6cf}
.js-reserve b{display:block;font:20px Georgia,serif;color:var(--c)}
.js-btn{background:#2a3f52;border:1px solid #dcc27e66;padding:7px 14px;margin-top:9px}
.js-btn:hover:not([disabled]){background:#3a556b}
.js-btn[disabled]{opacity:.45;cursor:not-allowed}
.js-empty{color:#7d8794;font-style:italic;font-size:13px}
.js-reveal{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 42%,color-mix(in srgb,var(--c) 20%,#060b13f0),#02050af5 62%);backdrop-filter:blur(6px);pointer-events:auto;animation:js-fade .3s}
.js-reveal-box{width:min(560px,92vw);text-align:center}
.js-reveal small{letter-spacing:.4em;font-size:11px;color:var(--c)}
.js-reveal h2{font:34px Georgia,serif;margin:6px 0 18px;color:var(--c);text-shadow:0 0 30px var(--c)}
.js-reveal ol{list-style:none;padding:0;margin:0 0 18px;display:grid;gap:8px}
.js-reveal li{background:#101824ee;border:1px solid #ffffff1c;border-left:3px solid var(--c);padding:10px 14px;text-align:left;opacity:0;animation:js-in .5s forwards}
.js-reveal li b{font:16px Georgia,serif}.js-reveal li span{float:right;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9aa1b0}
.js-reveal .js-btn{display:inline-block;margin:0 5px}
@keyframes js-fade{from{opacity:0}}
@media(max-width:800px){.js-tracker{width:220px}.js-toasts{width:280px}.js-sigil{min-width:0}.js-sigil small{display:none}}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'class') node.className = v; else if (k === 'style') node.setAttribute('style', v); else node.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}
/** Drop absent optional nodes. */
const compact = (...nodes: (Node | null | undefined | false)[]): Node[] => nodes.filter((n): n is Node => !!n);
const when = (t: number) => { const day = Math.floor(t / 86400) + 1, h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60); return `Day ${day}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
const objectiveText = (o: QuestView['objectives'][number]) => o.need !== undefined && o.need > 1 ? `${o.text} (${o.have ?? 0}/${o.need})` : o.text;

export class JohnSmithInterface {
  private view: JohnSmithView | null = null;
  private tab: Tab = 'quests';
  private showDismissed = false;
  private seen = -1;
  private seenKey = '';
  private queue: JohnSmithView['notices'] = [];
  private live: HTMLElement[] = [];
  private revealed = new Set<string>();
  private tierShown = -1;
  private readonly root: HTMLElement;
  private readonly sigil: HTMLButtonElement;
  private readonly tracker: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly overview: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly reveal: HTMLElement;
  private arrows: { node: HTMLElement; text: HTMLElement; target: { x: number; z: number } }[] = [];

  /** `layout` places the sigil and tracker in a corner the host page leaves free. */
  constructor(parent: HTMLElement, private readonly host: JohnSmithHost, layout: { side: 'left' | 'right'; top: number } = { side: 'right', top: 18 }) {
    if (!document.getElementById('js-style')) document.head.append(el('style', { id: 'js-style' }, STYLE));
    this.root = el('div', { class: 'js-root', style: `--js-top:${layout.top}px`, 'data-side': layout.side });
    this.sigil = el('button', { class: 'js-sigil', title: 'John Smith · Overview (O)' });
    this.tracker = el('section', { class: 'js-tracker', 'aria-label': 'Watched quests' });
    this.toasts = el('div', { class: 'js-toasts', 'aria-live': 'polite' });
    this.tabs = el('nav', { class: 'js-tabs' });
    this.body = el('div', { class: 'js-body' });
    const close = el('button', { class: 'js-close' }, 'Close · O');
    close.onclick = () => this.toggle(false);
    this.overview = el('section', { class: 'js-overview', hidden: '' },
      el('div', { class: 'js-panel', role: 'dialog', 'aria-label': 'John Smith overview' },
        el('header', { class: 'js-head' }, el('div', {}, el('small', {}, 'THE ORCHESTRATOR'), el('h2', {}, 'John Smith')), close), this.tabs, this.body));
    this.overview.addEventListener('pointerdown', e => { if (e.target === this.overview) this.toggle(false); });
    this.reveal = el('section', { class: 'js-reveal', hidden: '' });
    this.sigil.onclick = () => this.toggle();
    this.root.append(this.sigil, this.tracker, this.toasts, this.overview, this.reveal);
    parent.append(this.root);
    this.sigil.hidden = true;
    window.addEventListener('keydown', e => {
      if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'KeyO') { this.toggle(); e.preventDefault(); }
      else if (e.code === 'Escape' && (this.open || !this.reveal.hidden)) { this.reveal.hidden = true; this.toggle(false); }
    });
  }

  get open(): boolean { return !this.overview.hidden; }

  /** Hide the sigil and tracker while another panel occupies their corner. */
  set covered(covered: boolean) { this.root.classList.toggle('js-covered', covered); }

  toggle(open = !this.open): void {
    if (open === this.open) return;
    this.overview.hidden = !open;
    if (open) this.renderOverview();
    this.host.onOpenChange(open);
  }

  /** A fresh projection from the host. */
  update(view: JohnSmithView): void {
    const first = !this.view;
    this.view = view;
    this.sigil.hidden = false;
    this.renderSigil();
    this.renderTracker();
    const key = `tv.johnsmith.seen.${view.holderId}.${view.epoch}`, mark = (n: { at: number; title: string }) => `${n.at}:${n.title}`;
    if (this.seenKey !== key) {
      this.seenKey = key;
      let stored: string | null = null;
      try { stored = localStorage.getItem(key); } catch { /* storage may be unavailable */ }
      const cut = (stored ?? '').indexOf('|'), seq = Number(cut < 0 ? stored : stored!.slice(0, cut)), signature = cut < 0 ? '' : stored!.slice(cut + 1);
      const at = view.notices.find(n => n.seq === seq);
      // A remembered position from another record (a reset world can reuse the same ids) is
      // discarded; a first visit shows only the latest notice rather than replaying the archive.
      const valid = stored !== null && Number.isFinite(seq) && seq <= (view.notices.at(-1)?.seq ?? 0) && (!at || !signature || mark(at) === signature);
      this.seen = valid ? seq : (view.notices.at(-2)?.seq ?? 0);
    }
    for (const n of view.notices) if (n.seq > this.seen) { this.queue.push(n); this.seen = n.seq; }
    if (this.queue.length > 6) {
      // A long backlog (a reconnect, a burst of recognitions) is summarized, not replayed for minutes.
      const skipped = this.queue.length - 4;
      this.queue = [{ seq: -1, at: 0, kind: 'archive', title: `${skipped} earlier notices`, text: 'Filed in the overview. Press O to read them.' }, ...this.queue.slice(-4)];
    }
    const last = view.notices.find(n => n.seq === this.seen);
    try { localStorage.setItem(key, last ? `${this.seen}|${mark(last)}` : String(this.seen)); } catch { /* storage may be unavailable */ }
    this.pumpToasts();
    if (view.loot.coffer && !this.revealed.has(view.loot.coffer.id) && !first) this.showReveal(view.loot.coffer);
    if (view.loot.coffer) this.revealed.add(view.loot.coffer.id);
    if (this.open) this.renderOverview();
  }

  /** The host's reply to a request. */
  result(m: { command: string | null; result: string }): void {
    // Opening and refusals to open arrive as John Smith's own notices; only plain refusals need words here.
    if (m.result.startsWith('unsafe:') || m.result === 'opened' || m.result === 'accepted') return;
    this.queue.push({ seq: -1, at: 0, kind: 'archive', title: 'Request refused', text: m.result.replace(/_/g, ' ') });
    this.pumpToasts();
  }

  /** Per-frame: keep tracker bearings pointing at their targets from the current view. */
  frame(): void {
    const pose = this.host.pose(); if (!pose) return;
    for (const a of this.arrows) {
      const dx = a.target.x - pose.x, dz = a.target.z - pose.z, distance = Math.hypot(dx, dz);
      const forward = -dx * Math.sin(pose.yaw) - dz * Math.cos(pose.yaw), right = dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw);
      const here = distance < 3;
      a.node.textContent = here ? '◎' : '↑';
      a.node.style.transform = here ? 'none' : `rotate(${Math.atan2(right, forward)}rad)`;
      a.text.textContent = here ? 'here' : `${Math.round(distance)} m`;
    }
  }

  private renderSigil(): void {
    const v = this.view!, s = v.standing, color = ATTENTION[s.tier] ?? ATTENTION[1];
    this.sigil.replaceChildren(...compact(el('span', { class: 'js-eye', style: `color:${color}` }, '◉'),
      el('span', {}, el('small', {}, 'JOHN SMITH'), el('b', {}, s.tierName)),
      s.unopened ? el('span', { class: 'js-badge', title: `${s.unopened} unopened cache${s.unopened === 1 ? '' : 's'}` }, String(s.unopened)) : null));
    if (this.tierShown >= 0 && s.tier > this.tierShown) { this.sigil.classList.remove('js-pulse'); void this.sigil.offsetWidth; this.sigil.classList.add('js-pulse'); }
    this.tierShown = s.tier;
  }

  private renderTracker(): void {
    const v = this.view!;
    this.arrows = [];
    this.tracker.replaceChildren(...v.tracker.map(q => {
      const node = el('div', { class: 'js-track' },
        el('header', {}, el('span', {}, QUEST_GLYPH[q.kind] ?? '•'), q.title, q.rewardTierName ? el('em', { style: `color:${TIER[q.rewardTier]}` }, q.rewardTierName) : null),
        el('ul', {}, ...q.objectives.map(o => el('li', { class: o.done ? 'js-done' : '' }, objectiveText(o)))));
      if (q.target?.reach === 'here') {
        const arrow = el('span', { class: 'js-arrow' }, '↑'), text = el('span', {}, '');
        node.append(el('div', { class: 'js-bearing' }, arrow, text, el('span', { style: 'color:#9aa1b0' }, `· ${q.target.label}`)));
        this.arrows.push({ node: arrow, text, target: { x: q.target.x, z: q.target.z } });
      } else if (q.target) {
        node.append(el('div', { class: 'js-bearing', style: 'color:#9aa1b0' }, `${q.target.label} · ${q.target.reach === 'walls' ? 'beyond these walls' : 'beyond the Veil'}`));
      }
      node.onclick = () => { this.tab = 'quests'; this.toggle(true); };
      return node;
    }));
    this.frame();
  }

  private pumpToasts(): void {
    while (this.queue.length && this.live.length < 3) {
      const n = this.queue.shift()!, color = n.tier !== undefined ? (n.kind === 'attention' ? ATTENTION[n.tier] : TIER[n.tier]) : '#dcc27e';
      const toast = el('div', { class: `js-toast${n.kind === 'feat' ? ' js-feat' : ''}`, style: `--c:${color}` },
        el('small', {}, n.kind === 'feat' ? 'NEW RECOGNITION' : (KIND_LABEL[n.kind] ?? n.kind).toUpperCase()), el('b', {}, n.title), el('p', {}, n.text));
      toast.onclick = () => dismiss();
      this.toasts.append(toast); this.live.push(toast);
      let gone = false;
      const dismiss = () => {
        if (gone) return; gone = true; toast.classList.add('js-out');
        setTimeout(() => { toast.remove(); this.live = this.live.filter(t => t !== toast); this.pumpToasts(); }, 480);
      };
      setTimeout(dismiss, n.kind === 'feat' || n.kind === 'cache' ? 9000 : 6500);
    }
  }

  private showReveal(coffer: NonNullable<JohnSmithView['loot']['coffer']>): void {
    const color = TIER[coffer.tier] ?? TIER[0];
    const takeAll = el('button', { class: 'js-btn' }, 'Take everything'), keep = el('button', { class: 'js-btn' }, 'Leave it here for now');
    takeAll.onclick = () => { for (const i of coffer.items) this.host.take(coffer.id, i.id); this.reveal.hidden = true; };
    keep.onclick = () => { this.reveal.hidden = true; };
    this.reveal.setAttribute('style', `--c:${color}`);
    this.reveal.replaceChildren(el('div', { class: 'js-reveal-box' },
      el('small', {}, 'A SEAL BREAKS'), el('h2', {}, coffer.name),
      el('ol', {}, ...coffer.items.map((i, n) => el('li', { style: `animation-delay:${.25 + n * .32}s` }, el('b', {}, i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name), el('span', {}, i.kind)))),
      takeAll, keep,
      el('p', { class: 'js-voice', style: 'text-align:left;margin-top:16px' }, 'The coffer stays where it unfolded until you empty it. Carrying things has a weight; the archive has noticed you forget this.')));
    this.reveal.hidden = false;
  }

  private renderOverview(): void {
    const v = this.view; if (!v) return;
    const counts: Record<Tab, number> = { quests: v.quests.filter(q => q.status === 'open').length, watch: 0, feats: 0, loot: v.standing.unopened, archive: 0 };
    this.tabs.replaceChildren(...TABS.map(t => {
      const b = el('button', { class: t === this.tab ? 'js-on' : '' }, t, counts[t] ? el('i', {}, String(counts[t])) : null);
      b.onclick = () => { this.tab = t; this.renderOverview(); };
      return b;
    }));
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(...(this.tab === 'quests' ? this.questsTab(v) : this.tab === 'watch' ? this.watchTab(v) : this.tab === 'feats' ? this.featsTab(v) : this.tab === 'loot' ? this.lootTab(v) : this.archiveTab(v)));
    this.body.scrollTop = scroll;
  }

  private questsTab(v: JohnSmithView): Node[] {
    const open = v.quests.filter(q => q.status === 'open'), closed = v.quests.filter(q => q.status !== 'open');
    const card = (q: QuestView) => {
      const actions = el('span', { class: 'js-actions' });
      if (q.status === 'open') {
        const watch = el('button', { class: q.watched ? 'js-on' : '', title: 'Show in the tracker' }, q.watched ? '◉ Watching' : '○ Watch');
        watch.onclick = () => this.host.request({ type: 'watch_quest', questId: q.id, watch: !q.watched });
        actions.append(watch);
      }
      const hide = el('button', { title: q.dismissed ? 'Return to the journal' : 'Hide from the journal' }, q.dismissed ? 'Restore' : 'Hide');
      hide.onclick = () => this.host.request({ type: 'dismiss_quest', questId: q.id, dismiss: !q.dismissed });
      actions.append(hide);
      return el('article', { class: `js-quest${q.status !== 'open' ? ' js-closed' : ''}` },
        el('header', {}, el('span', { style: 'color:#dcc27e' }, QUEST_GLYPH[q.kind] ?? '•'), el('b', {}, q.title), el('span', { class: 'js-st' }, q.status === 'open' ? q.kind : q.status), actions),
        el('p', { class: 'js-sum' }, q.summary),
        el('ul', {}, ...q.objectives.map(o => el('li', { class: o.done ? 'js-done' : '' }, objectiveText(o)))),
        q.target ? el('p', { class: 'js-sum', style: 'color:#8fb5e3' }, `Last known: ${q.target.label}`) : null,
        q.outcome ? el('p', { class: 'js-sum', style: 'color:#dcc27e' }, q.outcome) : null,
        q.rewardTierName ? el('span', { class: 'js-reward', style: `--c:${TIER[q.rewardTier]}` }, q.cacheId ? `${q.rewardTierName} cache granted` : `${q.rewardTierName} cache on completion`) : null,
        el('div', { class: 'js-meta', style: 'font-size:10px;color:#7d8794;margin-top:6px' }, `Recognized ${when(q.recognizedAt)}${q.closedAt !== null ? ` · closed ${when(q.closedAt)}` : ''}`));
    };
    const toggle = el('button', { class: 'js-btn' }, this.showDismissed ? 'Hide dismissed' : `Show dismissed (${v.dismissed})`);
    toggle.onclick = () => { this.showDismissed = !this.showDismissed; this.renderOverview(); };
    return compact(
      el('p', { class: 'js-voice' }, 'Open matters you know of. The archive did not make any of them; it only noticed that you noticed. Watch up to four in the tracker.'),
      el('h3', {}, `Open (${open.length})`), ...(open.length ? open.map(card) : [el('p', { class: 'js-empty' }, 'Nothing open that you know of. Go and find out something.')]),
      el('h3', {}, 'Recently closed'), ...(closed.length ? closed.map(card) : [el('p', { class: 'js-empty' }, 'No closed matters yet.')]),
      v.dismissed ? toggle : null);
  }

  private watchTab(v: JohnSmithView): Node[] {
    const s = v.standing, color = ATTENTION[s.tier];
    const progress = s.nextTierAt ? Math.min(1, s.significance / s.nextTierAt) : 1;
    return compact(
      el('p', { class: 'js-voice' }, 'The archive allocates attention to whatever history makes consequential. You carry its interface, so you are always at least Noted. Everyone else has to earn it.'),
      el('div', { class: 'js-card js-tiered', style: `--c:${color}` },
        el('b', {}, `${v.name}: ${s.tierName}`),
        el('p', {}, `Historical significance ${s.significance}${s.nextTierAt ? `; ${s.nextTierName} begins at ${s.nextTierAt}` : '; the archive has no closer drawer'}.`),
        el('div', { class: 'js-bar', style: `--c:${color}` }, el('i', { style: `width:${Math.round(progress * 100)}%` })),
        el('p', {}, `Renown: ${s.renown} living ${s.renown === 1 ? 'person carries' : 'people carry'} a memory of something you did. ${s.recognitions} recognitions; ${s.opened} caches opened, ${s.unopened} waiting.`)),
      el('h3', {}, 'Others under watch'),
      ...(v.watch.known.filter(k => !k.self).length ? v.watch.known.filter(k => !k.self).map(k => el('div', { class: 'js-row' }, el('span', {}, k.name), el('em', { style: `color:${ATTENTION[k.tier]}` }, k.tierName)))
        : [el('p', { class: 'js-empty' }, 'Nobody you know by name has drawn the archive\'s eye.')]),
      v.watch.beyond ? el('p', { class: 'js-voice', style: 'margin-top:12px' }, `…and ${v.watch.beyond} more beyond your knowledge. The archive will not say who. Finding out is the interesting part.`) : null);
  }

  private featsTab(v: JohnSmithView): Node[] {
    return [
      el('p', { class: 'js-voice' }, `Recognitions: ${v.feats.earned.length} of ${v.feats.total}. Each is a reading of things that actually happened. The archive has not yet learned to invent achievements, and does not intend to.`),
      ...(v.feats.next.length ? [el('h3', {}, 'Within reach'), el('div', { class: 'js-grid' }, ...v.feats.next.map(f => el('div', { class: 'js-card js-tiered', style: `--c:${TIER[f.tier]}` },
        el('b', {}, f.name), el('p', {}, f.hint), el('div', { class: 'js-bar', style: `--c:${TIER[f.tier]}` }, el('i', { style: `width:${Math.round(f.have / f.need * 100)}%` })),
        el('div', { class: 'js-meta' }, `${f.have} / ${f.need} · ${f.reward ? `${f.tierName} cache` : 'recognition only'}`))))] : []),
      el('h3', {}, 'Earned'),
      v.feats.earned.length ? el('div', { class: 'js-grid' }, ...v.feats.earned.map(f => el('div', { class: 'js-card js-tiered', style: `--c:${TIER[f.tier]}` },
        el('b', {}, f.name), el('p', {}, f.line), el('div', { class: 'js-meta' }, `${f.reward ? f.tierName : 'Recognition'} · ${f.group} · ${when(f.at)}${f.reward && !f.cacheId ? ' · reserve exhausted' : ''}`)))) : el('p', { class: 'js-empty' }, 'Nothing yet. Do something.'),
    ];
  }

  private lootTab(v: JohnSmithView): Node[] {
    const l = v.loot, unopened = l.caches.filter(c => !c.opened), opened = l.caches.filter(c => c.opened);
    const coffer = l.coffer;
    return compact(
      el('p', { class: 'js-voice' }, 'The reserve is finite and fixed by the world itself. Every cache is a numbered portion of it. When a tier runs out, it runs out.'),
      el('div', { class: 'js-reserve' }, ...l.reserve.map(r => el('div', { style: `--c:${TIER[r.tier]}` }, el('b', {}, String(r.remaining)), `${r.name} of ${r.total}`))),
      coffer ? el('h3', {}, `Open coffer: ${coffer.name}`) : null,
      coffer && !coffer.withinReach ? el('p', { class: 'js-sum', style: 'color:#e0a24a' }, 'Step closer to the coffer to take from it.') : null,
      coffer ? el('div', { class: 'js-grid' }, ...coffer.items.map(i => {
        const take = el('button', { class: 'js-btn' }, 'Take');
        if (!coffer.withinReach) take.setAttribute('disabled', '');
        take.onclick = () => this.host.take(coffer.id, i.id);
        return el('div', { class: 'js-card js-tiered', style: `--c:${TIER[coffer.tier]}` }, el('b', {}, i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name), el('div', { class: 'js-meta' }, i.kind), take);
      })) : null,
      el('h3', {}, `Sealed caches (${unopened.length})`),
      el('p', { class: 'js-sum', style: `color:${l.safety === 'ok' ? '#86b078' : '#e0a24a'}` }, l.safetyText),
      ...(unopened.length ? [el('div', { class: 'js-grid' }, ...unopened.map(c => {
        const open = el('button', { class: 'js-btn' }, 'Unseal');
        if (l.safety !== 'ok') { open.setAttribute('disabled', ''); open.title = l.safetyText; }
        open.onclick = () => this.host.request({ type: 'open_cache', cacheId: c.id });
        return el('div', { class: 'js-card js-tiered', style: `--c:${TIER[c.tier]}` }, el('b', { style: `color:${TIER[c.tier]}` }, `${c.tierName} cache`), el('p', {}, c.reason), el('div', { class: 'js-meta' }, `${c.id} · ${when(c.grantedAt)}`), open);
      }))] : [el('p', { class: 'js-empty' }, 'No sealed caches. Recognitions and settled matters earn them.')]),
      el('h3', {}, 'Rarity is history'),
      el('p', { class: 'js-voice' }, 'The archive appraises a weapon by what it has done, not how it was made. A plain blade with a long past outranks a pristine one with none.'),
      ...(l.appraisals.length ? l.appraisals.map(a => el('div', { class: 'js-row' }, el('span', {}, a.name), el('em', { style: `color:${LEGEND[a.legend]}` }, `${a.legendName} · ${a.hits} blows · ${a.downs} grounded${a.kills ? ` · ${a.kills} ended` : ''}`)))
        : [el('p', { class: 'js-empty' }, 'Nothing you carry has a history worth filing yet.')]),
      opened.length ? el('h3', {}, 'Opened') : null,
      ...opened.slice(0, 20).map(c => el('div', { class: 'js-row' }, el('span', { style: `color:${TIER[c.tier]}` }, `${c.tierName} · ${c.items.join(', ') || 'emptied'}`), el('em', {}, c.reason))));
  }

  private archiveTab(v: JohnSmithView): Node[] {
    return [
      el('p', { class: 'js-voice' }, 'Your file, as the archive keeps it. Only things you did, or came to know. Newest first.'),
      ...(v.archive.length ? [...v.archive].reverse().map(a => el('div', { class: 'js-row' }, el('span', {}, a.text), el('em', { style: 'color:#7d8794' }, when(a.at))))
        : [el('p', { class: 'js-empty' }, 'Your file is empty. It will not stay that way.')]),
    ];
  }
}
