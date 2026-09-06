import type { World } from '../../sim/core/world';
import type { Person } from '../../sim/core/types';
import { formatWorldTime, formatRelativeTime } from '../../sim/core/time';
import { hungerBand, thirstBand, sleepBand } from '../../sim/core/physiology';
import { woundSeverity } from '../../sim/core/attributes';
import { currentScheduleEntry } from '../../sim/mind/schedule';
import { activeConcerns, describeConcern } from '../../sim/mind/concern';
import { describePursuit, livePursuits, pursuitsOf } from '../../sim/mind/pursuit';
import { describeObligation, liveObligations } from '../../sim/social/obligation';
import { describeReport } from '../../sim/mind/reporting';
import { situationsInvolving, describeSituation } from '../../sim/social/situation';
import { esc } from './events';

/**
 * THE OBSERVER OVERLAY (v0.10 Part VI) — a simulation microscope, not a HUD.
 *
 * It is explicitly and deliberately OMNISCIENT, and says so on its own face: it reads canonical
 * state directly, including things no mind in the world could know. That is legitimate here and
 * nowhere else — this is developer tooling for watching the simulation, and the milestone grants
 * it that licence in exactly the same terms the Simulation Inspector already has it. Every
 * PLAYER-facing surface (the HUD's target panel, dialogue, the item labels) remains
 * epistemically constrained; nothing in this file feeds any of them.
 *
 * The design rule that matters is what it does NOT do. It never writes. It never nudges. It
 * never asks the simulation for anything the simulation would not otherwise compute. Following
 * someone is a camera decision made entirely on this side of the boundary; the person being
 * followed has no way to tell, and no code path here can change what they do.
 *
 * And it is a SUMMARY, not a dump. The goal is understanding causality in one glance: what are
 * they doing, what are they trying to bring about, since when, because of what, what else is
 * competing for them, and what their body is telling them. The full object graph is one keypress
 * away in the Inspector (F3) for anyone who wants it.
 */
export class Observer {
  el = document.getElementById('observer')!;
  private body!: HTMLElement;
  sel: string | null = null;
  follow = false;
  onFollow: ((id: string | null) => void) | null = null;
  onSpeed: ((mult: number) => void) | null = null;
  onPause: (() => void) | null = null;
  onOpenInspector: ((id: string) => void) | null = null;
  private lastRender = 0;

  constructor(private world: World) {
    this.el.innerHTML = `
      <div class="head">
        <b>Observer</b><span class="warn">developer view · omniscient</span>
        <button data-a="follow">follow</button>
        <button data-a="inspect">full inspector</button>
        <button data-a="close">✕</button>
      </div>
      <div class="clock">
        <span class="t">—</span>
        <button data-s="pause">⏸</button><button data-s="1">×1</button><button data-s="4">×4</button><button data-s="16">×16</button>
      </div>
      <div class="body"></div>`;
    this.body = this.el.querySelector('.body') as HTMLElement;
    (this.el.querySelector('[data-a=close]') as HTMLElement).onclick = () => this.toggle(false);
    (this.el.querySelector('[data-a=follow]') as HTMLElement).onclick = () => this.setFollow(!this.follow);
    (this.el.querySelector('[data-a=inspect]') as HTMLElement).onclick = () => { if (this.sel) this.onOpenInspector?.(this.sel); };
    this.el.querySelectorAll('[data-s]').forEach(btn => {
      (btn as HTMLElement).onclick = () => {
        const s = (btn as HTMLElement).dataset.s!;
        if (s === 'pause') this.onPause?.(); else this.onSpeed?.(Number(s));
      };
    });
  }

  get open(): boolean { return this.el.classList.contains('open'); }
  toggle(force?: boolean): void {
    this.el.classList.toggle('open', force);
    if (!this.open) this.setFollow(false);
    else this.render();
  }
  select(id: string | null): void {
    this.sel = id;
    if (this.follow) this.onFollow?.(id);
    this.render();
  }
  setFollow(on: boolean): void {
    this.follow = on && !!this.sel;
    (this.el.querySelector('[data-a=follow]') as HTMLElement).classList.toggle('on', this.follow);
    this.onFollow?.(this.follow ? this.sel : null);
    this.render();
  }
  update(speedMult: number, paused: boolean): void {
    if (!this.open) return;
    const t = this.el.querySelector('.clock .t') as HTMLElement;
    t.textContent = `${formatWorldTime(this.world.clock.worldSeconds)}${paused ? ' ⏸' : ` ×${speedMult}`}`;
    this.el.querySelectorAll('[data-s]').forEach(b => {
      const s = (b as HTMLElement).dataset.s!;
      b.classList.toggle('on', s === 'pause' ? paused : !paused && Number(s) === speedMult);
    });
    const now = performance.now();
    if (now - this.lastRender > 350) this.render();
  }

  render(): void {
    this.lastRender = performance.now();
    if (!this.open) return;
    const w = this.world;
    const p = w.person(this.sel);
    if (!p) {
      this.body.innerHTML = `<div class="hint">Click anyone in the world to watch them.<br><br>This panel reads canonical state directly — including what the person themselves does not know — because it exists to explain the simulation, not to play it. Normal play stays honest.</div>`;
      return;
    }
    this.body.innerHTML = this.summary(p);
  }

  private summary(p: Person): string {
    const w = this.world;
    const b = w.primaryBody(p.id);
    const m = p.mind;
    const action = m.plan.find(a => a.status === 'active') ?? m.plan.find(a => a.status === 'pending');
    const sched = currentScheduleEntry(p, w.clock.hourF);
    const rows: string[] = [];
    const row = (k: string, v: string) => rows.push(`<div class="k">${k}</div><div class="v">${v}</div>`);

    rows.push(`<div class="who"><b>${esc(p.name)}</b> · ${p.occupation}${p.title ? ` · ${esc(p.title)}` : ''}${p.alive ? '' : ' †'}</div>`);

    // ---- what they are doing right now
    const goal = m.goal;
    row('doing', goal
      ? `<b>${goal.type}</b>${goal.targetEntity ? ` → ${esc(w.nameOf(goal.targetEntity))}` : ''}${goal.targetPlace ? ` @ ${esc(w.nameOf(goal.targetPlace))}` : ''} <span class="dim">(u ${goal.utility.toFixed(2)}, since ${formatRelativeTime(goal.createdAt, w.now)})</span>`
      : '<span class="dim">nothing</span>');
    row('step', action ? `${action.type}${action.targetEntity ? ` → ${esc(w.nameOf(action.targetEntity))}` : ''}${action.placeId ? ` @ ${esc(w.nameOf(action.placeId))}` : ''} <span class="dim">· ${b?.pose ?? '—'}${b?.path ? `, path ${b.pathIndex}/${b.path.length}` : ''}</span>` : `<span class="dim">— · ${b?.pose ?? '—'}</span>`);
    if (goal?.reasons.length) row('because', goal.reasons.filter(Boolean).slice(0, 3).map(esc).join('<br>'));

    // ---- what they are trying to bring about (v0.10)
    const live = livePursuits(p);
    if (live.length) {
      rows.push('<div class="sect">purposes</div>');
      for (const pu of live.sort((a, x) => x.priority - a.priority)) {
        const cause = w.event(pu.causeEventId);
        const serving = pu.currentStep && goal && pu.currentStep === goal.key;
        rows.push(`<div class="k">${pu.status === 'active' ? '▶' : '⏸'}</div><div class="v">`
          + `<b class="${pu.status === 'active' ? 'on' : 'dim'}">${esc(describePursuit(w, pu))}</b>`
          + ` <span class="dim">(${pu.kind}, priority ${pu.priority.toFixed(2)}, since ${formatRelativeTime(pu.createdAt, w.now)})</span>`
          + (serving ? ' <span class="tag">this is what they are doing now</span>' : '')
          + (pu.steps.length ? `<div class="sub">steps so far: ${pu.steps.map(esc).join(' → ')}</div>` : '')
          + (cause ? `<div class="sub">caused by: ${esc(cause.summary)}</div>` : pu.reasons.length ? `<div class="sub">${esc(pu.reasons[0])}</div>` : '')
          + `</div>`);
      }
    }
    // Most recently finished first: `maintainPursuits` keeps the settled tail in resolved-at
    // order, so taking from the front shows what they have just seen through rather than the
    // oldest thing still being remembered.
    const settled = pursuitsOf(p).filter(x => x.status !== 'active' && x.status !== 'deferred')
      .sort((a, x) => (x.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    if (settled.length) rows.push(`<div class="k dim">finished</div><div class="v dim">${settled.slice(0, 3).map(x => `${esc(describePursuit(w, x))} — ${x.status}${x.resolution ? `:${x.resolution}` : ''}`).join('<br>')}</div>`);

    // ---- commitment (v0.5), the "why am I not dropping this" layer
    if (m.commitment) {
      row('committed to', `${m.commitment.goalType} <span class="dim">(${m.commitment.status}${m.commitment.suspendedBy ? `, set aside for ${esc(m.commitment.suspendedBy)}` : ''}; ${m.commitment.interruptibility})</span>`);
    }

    // ---- what they carry (v0.9 / v0.10)
    const concerns = activeConcerns(p);
    if (concerns.length) rows.push(`<div class="sect">concerns</div><div class="k"></div><div class="v">${concerns.sort((a, x) => x.intensity - a.intensity).slice(0, 5).map(c => `${esc(describeConcern(w, c))} <span class="dim">[${c.intensity.toFixed(2)}]</span>`).join('<br>')}</div>`);
    // v0.10.1 §XII: how the crimes this person knows of are actually going — the state that used
    // to be invisible, and whose absence is what made the report loop hard to see.
    const reports = Object.values(p.mind.reports ?? {}).filter(r => r.status !== 'moot');
    if (reports.length) rows.push(`<div class="sect">telling the watch</div><div class="k"></div><div class="v">${reports.slice(0, 4).map(r => `<span class="${r.status === 'delivered' ? 'dim' : r.status === 'no_authority' ? 'bad' : 'on'}">${esc(describeReport(w, r))}</span>`).join('<br>')}</div>`);
    const owed = liveObligations(p);
    if (owed.length) rows.push(`<div class="sect">obligations</div><div class="k"></div><div class="v">${owed.sort((a, x) => x.magnitude - a.magnitude).slice(0, 5).map(o => `${esc(describeObligation(w, o))} <span class="dim">[${o.magnitude.toFixed(2)}]${o.reasons[0] ? ` — ${esc(o.reasons[0])}` : ''}</span>`).join('<br>')}</div>`);

    // ---- body
    rows.push('<div class="sect">body</div>');
    const wound = b ? woundSeverity(b) : 0;
    row('condition', b ? `${Math.round(b.health)}/${b.maxHealth} hp${wound > 0.08 ? ` <span class="bad">· wound ${wound.toFixed(2)}</span>` : ''}${p.custody?.active ? ' <span class="bad">· in custody</span>' : ''}${p.surrender ? ' <span class="bad">· surrendered</span>' : ''}` : '—');
    row('needs', `hunger <b class="${hungerBand(p)}">${hungerBand(p)}</b> · thirst <b class="${thirstBand(p)}">${thirstBand(p)}</b> · rest <b class="${sleepBand(p)}">${sleepBand(p)}</b>`);
    row('where', `${b ? esc(w.placeAt(b.pos)?.name ?? 'outside') : '—'} <span class="dim">· home ${esc(w.nameOf(p.homeId))}${p.workId ? ` · works ${esc(w.nameOf(p.workId))}` : ''}</span>`);
    row('routine', sched ? `${esc(sched.label)} <span class="dim">(${sched.start}:00–${sched.end}:00)</span>` : '<span class="dim">nothing scheduled</span>');

    // ---- ongoing matters they are caught up in
    const sits = situationsInvolving(w, p.id).filter(s => s.status === 'active').slice(-3);
    if (sits.length) rows.push(`<div class="sect">unresolved matters</div><div class="k"></div><div class="v">${sits.map(s => `${esc(describeSituation(w, s))} <span class="dim">(${s.kind}, opened ${formatRelativeTime(s.openedAt, w.now)})</span>`).join('<br>')}</div>`);

    return `<div class="obs">${rows.join('')}</div>`;
  }
}
