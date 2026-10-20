import { h } from './dom';
import type { TabDef } from './modal';
import type { ActionRow, BodyState, CarriedRow, HandInteraction, SnapshotMessage } from '../net/messages';
import { pct, titleCase } from '../game/text';

/**
 * The player's own things: what they carry (and what is in reach), what they can do about their
 * body and skills, and their journal. Every row is a projection of what the server derived for this
 * person right now (`carried`, `abilities`, `journal`, `container`, `interactions`); a button sends
 * that row's own request and nothing else, and unavailable rows say why instead of vanishing.
 */
export interface PanelServices {
  snapshot(): SnapshotMessage | null;
  ownBody(): BodyState | null;
  /** Send an action row's request (person_action / interact / ...). */
  act(request: Record<string, unknown>, label: string): Promise<void>;
  transfer(containerId: string, itemId: string, direction: 'into' | 'out'): Promise<void>;
  interact(id: string, label: string): Promise<void>;
  crouch: { get(): boolean; toggle(): void };
  practice(mode: 'passive' | 'repeat' | 'reset' | 'recovery' | 'normal'): void;
  close(): void;
}

const qty = (n: number | undefined) => (n && n > 1 ? ` ×${n}` : '');

function actionButton(a: { id: string; label: string; available: boolean; reason?: string; request?: unknown }, svc: PanelServices): HTMLElement {
  const btn = h('button', { class: 'tv-btn', type: 'button', 'data-fk': `act:${a.id}`, disabled: !a.available, title: a.available ? undefined : a.reason, on: { click: () => { if (a.request) void svc.act(a.request as Record<string, unknown>, a.label); } } }, a.label);
  return btn;
}

export function itemsTab(svc: PanelServices): TabDef {
  return {
    id: 'items', label: 'Items', render(body) {
      const s = svc.snapshot(); if (!s) { body.append(h('p', { class: 'tv-muted', text: 'Waiting for the world…' })); return; }
      const own = svc.ownBody(), carried = s.carried as CarriedRow[];
      const container = s.container as { id: string; name: string; capacity: number; used: number; items: { id: string; name: string; type: string; quantity: number }[] } | null;
      const nearby = (s.interactions as HandInteraction[]).filter(i => i.slot === 'nearby' || i.kind === 'take' || i.kind === 'buy' || i.kind === 'steal' || i.kind === 'recover');
      const mob = s.mobility;
      const left = h('div', null, h('h2', { class: 'tv-h2', text: 'Carried' }));
      if (mob) left.append(h('div', { class: 'tv-sub' }, `Load ${mob.knownLoadKg.toFixed(1)} of ${mob.safeCarryKg.toFixed(0)} kg safe · ${pct(mob.fatigue)} fatigue${mob.restriction ? ` · ${mob.restriction}` : ''}${mob.unweighedStacks ? ` · ${mob.unweighedStacks} unweighed` : ''}`));
      left.append(h('div', { class: 'tv-sub', text: `${Math.round(own?.wealth ?? 0)} silver` }), h('hr', { class: 'tv-rule' }));
      if (!carried.length) left.append(h('p', { class: 'tv-muted', text: 'You are carrying nothing.' }));
      for (const c of carried) {
        left.append(h('div', { class: 'tv-row', style: 'flex-direction:column;align-items:stretch;cursor:default' },
          h('div', { style: 'display:flex;gap:.6rem;align-items:baseline' }, h('strong', { text: `${c.name}${qty(c.quantity)}` }), c.type ? h('span', { class: 'tv-chip', text: titleCase(c.type) }) : null),
          ...(c.description ?? []).map(d => h('small', { text: d })),
          h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.35rem' },
            ...c.actions.map(a => actionButton(a as never, svc)),
            container ? h('button', { class: 'tv-btn', type: 'button', 'data-fk': `store:${c.id}`, on: { click: () => void svc.transfer(container.id, c.id, 'into') } }, `Store in ${container.name}`) : null)));
      }
      const right = h('div', null);
      if (container) {
        right.append(h('h2', { class: 'tv-h2', text: container.name }), h('div', { class: 'tv-sub', text: `${container.used} of ${container.capacity} used` }), h('hr', { class: 'tv-rule' }));
        if (!container.items.length) right.append(h('p', { class: 'tv-muted', text: 'Empty.' }));
        for (const it of container.items) right.append(h('div', { class: 'tv-row', style: 'cursor:default' }, h('div', { class: 'grow', text: `${it.name}${qty(it.quantity)}` }), h('button', { class: 'tv-btn', type: 'button', 'data-fk': `take:${it.id}`, on: { click: () => void svc.transfer(container.id, it.id, 'out') } }, 'Take')));
      }
      right.append(h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'In reach' }));
      if (!nearby.length) right.append(h('p', { class: 'tv-muted', text: 'Nothing within reach.' }));
      for (const n of nearby) right.append(h('div', { class: 'tv-row', style: 'cursor:default' }, h('div', { class: 'grow', text: n.label }), h('button', { class: 'tv-btn', type: 'button', 'data-fk': `hand:${n.id}`, on: { click: () => void svc.interact(n.id, n.label) } }, titleCase(n.kind))));
      body.append(h('div', { class: 'tv-two' }, left, right));
    },
  };
}

export function abilitiesTab(svc: PanelServices): TabDef {
  return {
    id: 'abilities', label: 'Abilities', render(body) {
      const s = svc.snapshot(); if (!s) return;
      const rows = s.abilities as ActionRow[];
      body.append(h('h2', { class: 'tv-h2', text: 'What you can do' }));
      const list = h('div', { class: 'tv-grid' });
      for (const a of rows) {
        list.append(h('div', { class: 'tv-row', style: 'cursor:default;flex-wrap:wrap' },
          h('div', { class: 'grow' }, h('strong', { text: a.label }), a.detail ? h('small', { text: a.detail }) : null, !a.available && a.reason ? h('small', { class: 'tv-warn', text: a.reason }) : null),
          h('button', { class: 'tv-btn primary', type: 'button', 'data-fk': `ab:${a.id}`, disabled: !a.available, on: { click: () => { if (a.request) void svc.act(a.request as Record<string, unknown>, a.label); } } }, titleCase(a.kind))));
      }
      list.append(h('div', { class: 'tv-row', style: 'cursor:default' }, h('div', { class: 'grow' }, h('strong', { text: 'Crouch' }), h('small', { text: 'Low and quiet; slower, and it fits under low beams.' })),
        h('button', { class: 'tv-btn', type: 'button', 'data-fk': 'crouch', on: { click: () => { svc.crouch.toggle(); svc.close(); } } }, svc.crouch.get() ? 'Stand up' : 'Crouch')));
      body.append(list);
      const j = s.journal;
      body.append(h('h2', { class: 'tv-h2', style: 'margin-top:1.2rem', text: 'Known techniques' }));
      body.append((j.techniques as string[]).length ? h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap' }, ...(j.techniques as string[]).map(t => h('span', { class: 'tv-chip', text: titleCase(t) }))) : h('p', { class: 'tv-muted', text: 'None yet. Practice, or find someone willing to teach you.' }));
      const practice = j.practice as { skill: string; hours: number; level: string; days: number }[];
      if (practice.length) {
        body.append(h('h2', { class: 'tv-h2', style: 'margin-top:1.2rem', text: 'Practice' }));
        for (const p of practice) body.append(h('div', { class: 'tv-row', style: 'cursor:default' }, h('div', { class: 'grow', text: titleCase(p.skill) }), h('span', { class: 'tv-muted', text: `${p.hours.toFixed(1)} h${j.practiceHoursRequired ? ` of ${j.practiceHoursRequired} h` : ''} · ${p.days} day${p.days === 1 ? '' : 's'} · ${p.level}` })));
      }
      body.append(h('h2', { class: 'tv-h2', style: 'margin-top:1.2rem', text: 'Practice mode' }),
        h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap' },
          ...([['passive', 'Passive'], ['repeat', 'Repeat'], ['reset', 'Reset'], ['recovery', 'Recovery'], ['normal', 'Normal']] as const).map(([m, l]) => h('button', { class: 'tv-btn', type: 'button', 'data-fk': `pm:${m}`, on: { click: () => svc.practice(m) } }, l))));
    },
  };
}

export function journalTab(svc: PanelServices): TabDef {
  return {
    id: 'journal', label: 'Journal', render(body) {
      const s = svc.snapshot(); if (!s) return; const j = s.journal;
      const own = svc.ownBody();
      const meter = (label: string, v: number, good = true) => h('div', { style: 'display:grid;grid-template-columns:8rem 1fr 3.5rem;gap:.6rem;align-items:center' }, h('span', { class: 'tv-muted', text: label }), h('div', { class: 'tv-meter' }, h('i', { style: { width: `${Math.max(0, Math.min(1, v)) * 100}%`, ...(good ? {} : { background: 'linear-gradient(90deg,#8e2f38,#d15660)' }) } })), h('span', { class: 'tv-gold', text: pct(v) }));
      const xp = j.experience;
      const left = h('div', null, h('h2', { class: 'tv-h2', text: own?.name ?? 'You' }), h('div', { class: 'tv-sub', text: `Stage: ${j.stage}` }),
        ...(xp?.leveled ? [h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: `${xp.label} · level ${xp.level}` }),
          h('div', { class: 'tv-meter' }, h('i', { style: { width: `${xp.peak ? 100 : Math.min(100, xp.xpIntoLevel / Math.max(1, xp.xpForLevel) * 100)}%` } })),
          h('div', { class: 'tv-sub', text: xp.peak ? `${xp.peakText} ${xp.lifetimeXp.toLocaleString()} lifetime experience`
            : `${xp.xpIntoLevel.toLocaleString()} / ${xp.xpForLevel.toLocaleString()} experience · ${xp.rankXp.toLocaleString()} of ${xp.peakXp.toLocaleString()} to peak ${xp.stage}` }),
          xp.vessel ? h('div', { class: 'tv-sub', text: `${xp.vessel.stage} vessel: ×${xp.vessel.resilience} resilience, ×${xp.vessel.force} force, foundations to ${xp.vessel.ceiling}` }) : null] : []),
        h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'Condition' }),
        h('div', { class: 'tv-grid', style: 'gap:.35rem' }, meter('Energy', j.condition.energy), meter('Hydration', j.condition.hydration), meter('Fatigue', j.condition.fatigue, false), meter('Sleep debt', Math.min(1, j.condition.sleepDebt / 24), false)),
        h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'Foundations' }),
        h('div', { class: 'tv-grid', style: 'gap:.35rem' }, ...j.foundations.map(f => h('div', { style: 'display:grid;grid-template-columns:8rem 2rem 1fr;gap:.6rem;align-items:center' }, h('span', { class: 'tv-muted', text: titleCase(f.id) }), h('strong', { text: String(f.value) }), h('div', { class: 'tv-meter' }, h('i', { style: { width: `${f.progress * 100}%` } }))))));
      const right = h('div', null, h('h2', { class: 'tv-h2', text: 'Commitments' }));
      const commitments = j.commitments as { kind: string; reward: number; requester: string | null; cause?: string }[];
      right.append(...(commitments.length ? commitments.map(c => h('div', { class: 'tv-row', style: 'cursor:default' }, h('div', { class: 'grow' }, h('strong', { text: c.kind }), c.requester ? h('small', { text: `for ${c.requester}` }) : null), h('span', { class: 'tv-gold', text: `${c.reward} silver` }))) : [h('p', { class: 'tv-muted', text: 'You have made no promises.' })]));
      const owed = j.obligations as { kind: string; toward: string; weight: string }[];
      right.append(h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'What you owe' }), ...(owed.length ? owed.map(o => h('div', { class: 'tv-row', style: 'cursor:default' }, h('div', { class: 'grow', text: `${titleCase(o.kind)} — ${o.toward}` }), h('span', { class: 'tv-chip', text: o.weight }))) : [h('p', { class: 'tv-muted', text: 'Nothing weighs on you.' })]));
      const injuries = j.injuries as { region: string; severity: string }[];
      right.append(h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'Injuries' }), ...(injuries.length ? injuries.map(i => h('div', { class: 'tv-row', style: 'cursor:default' }, h('div', { class: 'grow', text: titleCase(i.region) }), h('span', { class: `tv-chip ${i.severity === 'severe' ? 'tv-bad' : 'tv-warn'}`, text: i.severity }))) : [h('p', { class: 'tv-muted', text: 'Unhurt.' })]));
      const skills = j.skills as { skill: string; level: string }[];
      right.append(h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'Skills' }), skills.length ? h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap' }, ...skills.map(k => h('span', { class: 'tv-chip', text: `${titleCase(k.skill)} · ${k.level}` }))) : h('p', { class: 'tv-muted', text: 'Nothing you would call a skill yet.' }));
      if (j.veil) right.append(h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'The veil' }), h('div', { class: 'tv-sub', text: `Strain ${(j.veil as { strain: number }).strain}` }));
      if (xp?.achievements.length) right.append(h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'Achievements' }),
        h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap' }, ...xp.achievements.map(a => h('span', { class: 'tv-chip', text: a.title }))));
      const adv = j.advancement;
      right.append(h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: adv.next ? `Breakthrough to ${adv.next}` : 'Breakthrough' }), adv.eligible ? h('p', { class: 'tv-good', text: 'You are ready to attempt the breakthrough (Abilities).' }) : h('ul', { style: 'margin:.2rem 0 0 1.1rem;padding:0;color:var(--muted)' }, ...(adv.remaining as string[]).slice(0, 4).map(r => h('li', { text: r }))));
      body.append(h('div', { class: 'tv-two' }, left, right));
    },
  };
}
