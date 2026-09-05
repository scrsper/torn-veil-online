import type { World } from '../../sim/core/world';
import type { Person, Relationship, KnowledgeItem, Body } from '../../sim/core/types';
import { describeRel } from '../../sim/mind/relationships';
import { describeClaim, recognizedUses } from '../../sim/mind/knowledge';
import { currentScheduleEntry } from '../../sim/mind/schedule';
import { formatWorldTime, formatRelativeTime } from '../../sim/core/time';
import { esc } from './events';

type Tab = 'mind' | 'identity' | 'relations' | 'memory' | 'knowledge' | 'perception' | 'items' | 'state' | 'schedule';
const TABS: Tab[] = ['mind', 'identity', 'state', 'relations', 'memory', 'knowledge', 'perception', 'items', 'schedule'];

/** The simulation inspector: open any mind and see exactly why it is doing what it is doing. */
export class Inspector {
  el = document.getElementById('inspector')!; body!: HTMLElement; sel: string | null = null; tab: Tab = 'mind'; follow = false; onFollow: ((id: string | null) => void) | null = null; onVisit: ((id: string) => void) | null = null; onShowChain: ((id: string) => void) | null = null; onFocusEvents: ((id: string) => void) | null = null; select_!: HTMLSelectElement; lastRender = 0;
  constructor(private world: World) {
    this.el.innerHTML = `<div class="head"><b style="color:var(--accent)">Inspector</b><select></select><button data-a="visit">go to</button><button data-a="follow">follow</button><button data-a="events">events</button><button data-a="close">✕</button></div><div class="tabs"></div><div class="body"></div>`;
    this.body = this.el.querySelector('.body') as HTMLElement; this.select_ = this.el.querySelector('select')!;
    this.select_.onchange = () => this.select(this.select_.value || null);
    const tabs = this.el.querySelector('.tabs')!; for (const t of TABS) { const b = document.createElement('button'); b.textContent = t; b.dataset.t = t; b.onclick = () => { this.tab = t; this.render(true); }; tabs.appendChild(b); }
    (this.el.querySelector('[data-a=close]') as HTMLElement).onclick = () => this.toggle();
    (this.el.querySelector('[data-a=visit]') as HTMLElement).onclick = () => { if (this.sel) this.onVisit?.(this.sel); };
    (this.el.querySelector('[data-a=follow]') as HTMLElement).onclick = () => { this.follow = !this.follow; this.onFollow?.(this.follow ? this.sel : null); this.render(true); };
    (this.el.querySelector('[data-a=events]') as HTMLElement).onclick = () => { if (this.sel) this.onFocusEvents?.(this.sel); };
    this.body.addEventListener('click', (e) => { const t = (e.target as HTMLElement).closest('[data-ev]') as HTMLElement | null; if (t) this.onShowChain?.(t.dataset.ev!); const p = (e.target as HTMLElement).closest('[data-p]') as HTMLElement | null; if (p) this.select(p.dataset.p!); });
    this.fillSelect();
  }
  get open(): boolean { return this.el.classList.contains('open'); }
  toggle(force?: boolean): void { this.el.classList.toggle('open', force); if (this.open) this.render(true); }
  fillSelect(): void { const cur = this.sel; this.select_.innerHTML = '<option value="">— select a person —</option>' + this.world.persons().filter(p => !p.controlled).sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}">${p.name}${p.alive ? '' : ' †'}</option>`).join('') + `<option value="${this.world.playerId}">the Traveler (you)</option>`; this.select_.value = cur ?? ''; }
  select(id: string | null): void { this.sel = id; this.select_.value = id ?? ''; if (this.follow) this.onFollow?.(id); this.render(true); }
  update(): void { if (!this.open) return; const now = performance.now(); if (now - this.lastRender > 400) this.render(false); }
  render(force: boolean): void {
    this.lastRender = performance.now();
    this.el.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', (b as HTMLElement).dataset.t === this.tab));
    (this.el.querySelector('[data-a=follow]') as HTMLElement).classList.toggle('on', this.follow);
    const p = this.world.person(this.sel); if (!p) { this.body.innerHTML = `<div style="color:var(--dim)">Look at someone and press <b>F</b>, or pick a person above.<br><br>The inspector shows the canonical simulated mind: its goal and plan, the utilities behind the last decision, what it knows and how it learned it, what it remembers, how it feels about everyone, and what it currently perceives.</div>`; return; }
    const scrollTop = this.body.scrollTop;
    const fn = (this as any)[`tab_${this.tab}`] as (p: Person) => string; this.body.innerHTML = fn.call(this, p); if (!force) this.body.scrollTop = scrollTop;
  }
  private meter(v: number, signed = false): string { const w = signed ? Math.abs(v) * 50 : v * 100; const cls = signed ? (v < 0 ? 'neg' : 'pos') : ''; return `<span class="meter ${cls}"><i style="width:${Math.min(100, w)}%;margin-left:${signed ? (v < 0 ? 50 - w : 50) : 0}%"></i></span>${v.toFixed(2)}`; }
  tab_mind(p: Person): string {
    const w = this.world; const m = p.mind; const g = m.goal; const b = w.primaryBody(p.id);
    const cur = m.plan.find(a => a.status === 'active') ?? m.plan.find(a => a.status === 'pending');
    let s = `<h4>Current goal</h4>`;
    s += g ? `<div class="kv"><div>goal</div><div><b>${g.type}</b>${g.targetEntity ? ` → <span data-p="${g.targetEntity}" style="cursor:pointer;color:var(--blue)">${w.nameOf(g.targetEntity)}</span>` : ''}${g.targetPlace ? ` @ ${w.nameOf(g.targetPlace)}` : ''} (utility ${g.utility.toFixed(2)})</div><div>reasons</div><div>${g.reasons.filter(Boolean).map(esc).join('<br>')}</div><div>since</div><div>${formatWorldTime(g.createdAt)} (${formatRelativeTime(g.createdAt, w.now)})</div>${g.causeEvent ? `<div>caused by</div><div><span data-ev="${g.causeEvent}" style="cursor:pointer;color:var(--accent)">${esc(w.event(g.causeEvent)?.summary ?? g.causeEvent)}</span></div>` : ''}</div>` : `<div style="color:var(--dim)">none${p.controlled ? ' (player-controlled)' : ''}</div>`;
    s += `<h4>Current action</h4>`;
    s += cur ? `<div class="kv"><div>action</div><div><b>${cur.type}</b> ${cur.targetEntity ? '→ ' + w.nameOf(cur.targetEntity) : ''}${cur.placeId ? '@ ' + w.nameOf(cur.placeId) : ''}${cur.pos ? ` to (${Math.round(cur.pos.x)}, ${Math.round(cur.pos.z)})` : ''}${cur.run ? ' (running)' : ''}</div><div>status</div><div>${cur.status}${cur.duration ? `, ${Math.max(0, Math.round((cur.duration - (w.now - (cur.startedAt ?? w.now))) / 60))} min left` : ''}</div><div>pose</div><div>${b?.pose}${b?.path ? ` · path ${b.pathIndex}/${b.path.length}` : ''}</div></div>` : `<div style="color:var(--dim)">none</div>`;
    s += `<h4>Plan</h4><div>${m.plan.map(a => `<span style="opacity:${a.status === 'done' ? 0.4 : 1}">${a.status === 'active' ? '▶ ' : a.status === 'done' ? '✓ ' : a.status === 'failed' ? '✗ ' : '· '}${a.type}${a.targetEntity ? ' ' + w.nameOf(a.targetEntity) : ''}</span>`).join(' &nbsp; ') || '—'}</div>`;
    s += `<h4>Last decision ${m.decision ? `(${formatWorldTime(m.decision.tick)}, ${esc(m.decision.note)})` : ''}</h4>`;
    if (m.decision) s += m.decision.candidates.map(c => `<div class="cand ${c.key === m.decision!.chosen ? 'chosen' : ''}"><b>${c.type}</b> ${c.utility.toFixed(2)}<div class="r">${c.reasons.map(esc).join(' · ')}</div></div>`).join('');
    s += `<h4>Cognition</h4><div class="kv"><div>subjective rate</div><div>${p.timeRate}× (thinks every ${(m.thinkInterval / p.timeRate).toFixed(2)}s physical)</div><div>alarm</div><div>${this.meter(m.alarm)}</div><div>attention</div><div>${m.attention ? w.nameOf(m.attention) : '—'}</div></div>`;
    // v0.6 §VI/§XVI: intention + commitment — "why is this NPC doing this", not just what.
    s += `<h4>Intention</h4>`;
    s += m.intention
      ? `<div class="kv"><div>intending</div><div><b>${esc(m.intention.type)}</b>${m.intention.target ? ` → ${w.nameOf(m.intention.target)}` : ''}</div><div>because</div><div>${esc(m.intention.reason)}</div><div>grounded</div><div>${m.intention.grounded ? 'yes — known/remembered source' : 'no — searching, uninformed'}</div></div>`
      : `<div style="color:var(--dim)">none</div>`;
    s += `<h4>Commitment</h4>`;
    s += m.commitment
      ? `<div class="kv"><div>committed to</div><div><b>${m.commitment.goalType}</b>${m.commitment.targetPlace ? ` @ ${w.nameOf(m.commitment.targetPlace)}` : ''}</div><div>status</div><div>${m.commitment.status}${m.commitment.suspendedBy ? ` (set aside for ${m.commitment.suspendedBy})` : ''}</div><div>interruptibility</div><div>${m.commitment.interruptibility}</div><div>since</div><div>${formatWorldTime(m.commitment.startedAt)}</div></div>`
      : `<div style="color:var(--dim)">none</div>`;
    return s;
  }
  tab_identity(p: Person): string {
    const w = this.world; const fam = Object.entries(p.relationships).filter(([, r]) => r.tags.length).map(([id, r]) => `<span data-p="${id}" style="cursor:pointer;color:var(--blue)">${w.nameOf(id)}</span> (${r.tags.join(', ')})`);
    return `<h4>${esc(p.name)}</h4><div class="kv"><div>id</div><div>${p.id}</div><div>occupation</div><div>${p.occupation}${p.title ? ' · ' + p.title : ''}</div><div>age / gender</div><div>${p.age} · ${p.gender}</div><div>home</div><div>${w.nameOf(p.homeId)}</div><div>work</div><div>${p.workId ? w.nameOf(p.workId) : '—'}</div><div>faction</div><div>${p.factionId ? w.nameOf(p.factionId) : '—'}</div><div>alive</div><div>${p.alive ? 'yes' : `no (died ${p.deathTick ? formatWorldTime(p.deathTick) : ''})`}</div><div>bodies</div><div>${p.bodies.map(b => { const bb = w.body(b)!; return `${b} @ (${bb.pos.x.toFixed(1)}, ${bb.pos.y.toFixed(1)}, ${bb.pos.z.toFixed(1)}) ${bb.present ? '' : '(withdrawn)'}`; }).join('<br>')}</div><div>wealth</div><div>${p.wealth} silver</div><div>ties</div><div>${fam.join('<br>') || '—'}</div></div><h4>Traits</h4><div class="kv">${Object.entries(p.traits).map(([k, v]) => `<div>${k}</div><div>${this.meter(v)}</div>`).join('')}</div><h4>Biography</h4><div>${esc(p.bio)}</div><h4>Desires</h4><div>${p.desires.map(d => `${d.fulfilled ? '✓ ' : '○ '}${esc(d.note)}`).join('<br>') || '—'}</div>`;
  }
  tab_state(p: Person): string {
    const b = this.world.primaryBody(p.id);
    const phys = p.physiology;
    return `<h4>Body</h4><div class="kv"><div>health</div><div>${b ? `${Math.round(b.health)} / ${b.maxHealth}` : '—'}</div><div>pose</div><div>${b?.pose}</div><div>position</div><div>${b ? `${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(1)}, ${b.pos.z.toFixed(1)} — ${this.world.placeAt(b.pos)?.name ?? 'outside'}` : '—'}</div></div>`
      + this.fieldSectionFor(p, b)
      + `<h4>Attributes</h4><div class="kv"><div>strength</div><div>${this.meter(p.attributes.strength)}</div><div>dexterity</div><div>${this.meter(p.attributes.dexterity)}</div></div>`
      // v0.6 §V/§XVI: learned skill, distinct from the body attributes above — only shown when
      // it's above novice (0), so an ordinary person's tab isn't padded with a wall of zeroes.
      + `<h4>Skills</h4><div class="kv">${Object.entries(p.skills ?? {}).filter(([, v]) => (v ?? 0) > 0.001).map(([k, v]) => `<div>${k}</div><div>${this.meter(v ?? 0)}</div>`).join('') || '<div style="color:var(--dim)">novice at everything</div>'}</div>`
      + `<h4>Physiology (1 = full/comfortable, sleep debt in hours)</h4><div class="kv"><div>energy (calories)</div><div>${this.meter(phys.energy)}</div><div>hydration</div><div>${this.meter(phys.hydration)}</div><div>fatigue</div><div>${this.meter(phys.fatigue)}</div><div>sleep debt</div><div>${phys.sleepDebt.toFixed(1)}h</div><div>body heat</div><div>${this.meter(phys.bodyHeat)}</div><div>wetness</div><div>${this.meter(phys.wetness)}</div></div>`
      + `<h4>Needs (0 = satisfied)</h4><div class="kv">${Object.entries(p.needs).map(([k, v]) => `<div>${k}</div><div>${this.meter(v)}</div>`).join('')}</div><h4>Emotions</h4><div class="kv">${Object.entries(p.emotions).map(([k, v]) => `<div>${k}</div><div>${this.meter(v)}</div>`).join('')}</div>`;
  }
  /**
   * v0.8 "The Legible World" §H/§C: the Inspector previously had no view onto `world.fields`'
   * canonical crop-lifecycle state at all — a developer diagnosing "why hasn't this farmer
   * harvested" had no faster path than reading source. Shown for whichever farm the selected
   * person is currently at or assigned to work; the Inspector may be omniscient here (per-plot
   * state, not just the same block the player would see) since this is the developer/debug
   * surface, not player-facing UI.
   */
  private fieldSectionFor(p: Person, b?: Body): string {
    const w = this.world;
    const here = b ? w.placeAt(b.pos) : undefined;
    const farmPlace = (here?.type === 'farm' ? here : undefined) ?? (p.workId ? w.place(p.workId) : undefined);
    if (!farmPlace || farmPlace.type !== 'farm') return '';
    const field = w.fields.find(f => f.placeId === farmPlace.id);
    if (!field) return '';
    const counts: Record<string, number> = {};
    for (const plot of field.plots) counts[plot.state] = (counts[plot.state] ?? 0) + 1;
    return `<h4>Field: ${esc(farmPlace.name)}</h4><div class="kv"><div>soil moisture</div><div>${this.meter(field.soilMoisture)}</div>`
      + Object.entries(counts).map(([state, n]) => `<div>${state}</div><div>${n} plot${n === 1 ? '' : 's'}</div>`).join('') + `</div>`;
  }
  tab_relations(p: Person): string {
    const w = this.world; const rows = Object.entries(p.relationships).filter(([id]) => w.get(id)).sort((a, b) => (Math.abs(b[1].affection) + b[1].fear + b[1].grudge + Math.abs(b[1].trust)) - (Math.abs(a[1].affection) + a[1].fear + a[1].grudge + Math.abs(a[1].trust)));
    return `<h4>Directional relationships (${rows.length})</h4><table><tr><td></td><td style="color:var(--dim)">trust · affection · fear · grudge · respect</td></tr>${rows.slice(0, 40).map(([id, r]: [string, Relationship]) => `<tr><td><span data-p="${id}" style="cursor:pointer;color:var(--blue)">${w.nameOf(id)}</span><br><span class="src">${describeRel(r)}</span></td><td>${this.meter(r.trust, true)} ${this.meter(r.affection, true)}<br>${this.meter(r.fear)} ${this.meter(r.grudge)}<br>${this.meter(r.respect, true)} <span class="src">updated ${formatRelativeTime(r.lastUpdated, w.now)}</span></td></tr>`).join('')}</table>`;
  }
  tab_memory(p: Person): string {
    const w = this.world; const mems = [...p.memories].sort((a, b) => b.tick - a.tick);
    return `<h4>Episodic memories (${mems.length}, most recent first)</h4>${mems.map(m => `<div class="mem"><div>${m.eventId ? `<span data-ev="${m.eventId}" style="cursor:pointer">${esc(m.summary)}</span>` : esc(m.summary)}</div><div class="t">${formatWorldTime(m.tick)} · ${formatRelativeTime(m.tick, w.now)} · sig ${m.significance.toFixed(2)} · valence ${m.valence.toFixed(1)} · <span class="src ${m.source.type}">${m.source.type}${m.source.from ? ' by ' + w.nameOf(m.source.from) : ''}</span></div></div>`).join('') || '—'}`;
  }
  tab_knowledge(p: Person): string {
    const w = this.world; const ks = Object.values(p.knowledge).sort((a, b) => b.learnedAt - a.learnedAt);
    const ev = ks.filter(k => k.kind === 'event'), loc = ks.filter(k => k.kind === 'location');
    // v0.6 §III/§XVI: economic-opportunity ("service") knowledge gets its own section — this is
    // exactly the belief the food/knownFoodPlace decision reads, so it must stay visible even
    // when a person's 'other' bucket is dominated by dozens of same-timestamp 'home:<id>' facts
    // seeded at generation (which would otherwise crowd it out of a plain top-30 cut).
    const svc = ks.filter(k => k.kind === 'service');
    // v0.7 §Affordances: same reasoning as v0.6's "Known services" section above — this is the
    // literal belief `recognizedUses` reads, so it gets its own visible section.
    const aff = ks.filter(k => k.kind === 'affordance');
    const other = ks.filter(k => k.kind !== 'event' && k.kind !== 'location' && k.kind !== 'service' && k.kind !== 'affordance');
    const row = (k: KnowledgeItem) => `<div class="mem"><div>${k.claim.eventId ? `<span data-ev="${k.claim.eventId}" style="cursor:pointer">${esc(describeClaim(w, k))}</span>` : esc(describeClaim(w, k))}${k.handled ? ' <span class="src">(handled)</span>' : ''}</div><div class="t"><span class="src ${k.source.type}">${k.source.type}${k.source.from ? ' by ' + w.nameOf(k.source.from) : ''}</span>${k.source.viaEvent ? ` <span data-ev="${k.source.viaEvent}" style="cursor:pointer;color:var(--accent)">[evidence]</span>` : ''} · ${k.hops === 0 ? 'first-hand' : `${k.hops} hop${k.hops > 1 ? 's' : ''}`} · confidence ${k.confidence.toFixed(2)} · learned ${formatRelativeTime(k.learnedAt, w.now)}${k.lastConfirmedAt ? ` · confirmed ${formatRelativeTime(k.lastConfirmedAt, w.now)}` : ''}${k.sharedWith.length ? ` · told ${k.sharedWith.map(id => w.nameOf(id)).join(', ')}` : ''}</div></div>`;
    const affRow = (k: KnowledgeItem) => { const uses = recognizedUses(p, k.claim.itemType); return `<div class="mem"><div>${esc(k.claim.itemType)}: ${uses.join(', ')}</div><div class="t"><span class="src ${k.source.type}">${k.source.type}</span> · learned ${formatRelativeTime(k.learnedAt, w.now)}</div></div>`; };
    return `<h4>Known services (${svc.length})</h4>${svc.map(row).join('') || '<div style="color:var(--dim)">none — would have to search/discover one</div>'}<h4>Known affordances (${aff.length})</h4>${aff.map(affRow).join('') || '<div style="color:var(--dim)">none — would not recognize a tool\'s conventional uses</div>'}<h4>Events known (${ev.length})</h4>${ev.map(row).join('') || '—'}<h4>Locations (${loc.length})</h4>${loc.slice(0, 20).map(row).join('') || '—'}<h4>Other (${other.length})</h4>${other.slice(0, 30).map(row).join('') || '—'}`;
  }
  tab_perception(p: Person): string {
    const w = this.world; const pc = p.mind.percepts;
    return `<h4>Currently perceiving (${pc.length})</h4><table>${pc.sort((a, b) => a.distance - b.distance).map(x => `<tr><td><span data-p="${x.entityId}" style="cursor:pointer;color:var(--blue)">${w.nameOf(x.entityId)}</span></td><td>${x.how} · ${x.distance.toFixed(1)}m · ${w.placeAt(x.pos)?.name ?? 'outside'}</td></tr>`).join('') || '<tr><td colspan=2>nothing</td></tr>'}</table><h4>Sensing</h4><div class="kv"><div>sight</div><div>~28 m in daylight, cone in front, needs line of sight through the voxel world</div><div>hearing</div><div>loud events by loudness radius; muffled when asleep</div></div>`;
  }
  tab_items(p: Person): string {
    const w = this.world; const inv = p.inventory.map(id => w.item(id)).filter(Boolean); const owned = w.items().filter(i => i.ownerId === p.id && i.holderId !== p.id);
    const prov = (i: NonNullable<typeof inv[0]>) => i.provenance.map(pr => `<div class="t">${formatWorldTime(pr.tick)} · ${pr.from ? w.nameOf(pr.from) + ' → ' : ''}${pr.to ? w.nameOf(pr.to) : '—'} · ${esc(pr.how)}${pr.eventId ? ` <span data-ev="${pr.eventId}" style="cursor:pointer;color:var(--accent)">[event]</span>` : ''}</div>`).join('');
    const row = (i: NonNullable<typeof inv[0]>) => `<div class="mem"><div><b>${esc(i.name)}</b> (${i.type}${i.quantity > 1 ? ' ×' + i.quantity : ''}${i.damage ? ', dmg ' + i.damage : ''}, value ${i.value}) — owner ${w.nameOf(i.ownerId)}, ${i.holderId ? 'held by ' + w.nameOf(i.holderId) : i.pos ? `lying at ${w.placeAt(i.pos)?.name ?? `(${Math.round(i.pos.x)}, ${Math.round(i.pos.z)})`}` : '?'}</div>${i.description ? `<div class="t">${esc(i.description)}</div>` : ''}${prov(i)}</div>`;
    return `<h4>Carrying (${inv.length})</h4>${inv.map(i => row(i!)).join('') || '—'}<h4>Owns but not carrying (${owned.length})</h4>${owned.map(row).join('') || '—'}`;
  }
  tab_schedule(p: Person): string {
    const w = this.world; const cur = currentScheduleEntry(p, w.clock.hourF);
    return `<h4>Routine (interruptible)</h4><table>${p.schedule.map(s => `<tr style="${s === cur ? 'color:var(--accent)' : ''}"><td>${String(s.start).padStart(2, '0')}:00–${String(s.end).padStart(2, '0')}:00</td><td>${s.activity} · ${esc(s.label)}${s.placeId ? ` @ ${w.nameOf(s.placeId)}` : ''}</td></tr>`).join('')}</table>${p.patrol ? `<h4>Patrol route</h4><div>${p.patrol.map(v => `(${v.x}, ${v.z})`).join(' → ')}</div>` : ''}`;
  }
}
