import { Matrix, Vector3, type Camera, type Scene } from '@babylonjs/core';
import { ARENA, type ArenaWorld, type Fighter } from './world';
import { WEAPONS, type WeaponId } from './combat';
import type { SkillDef } from './tower/skills';
import { ALL_ELEMENTS, ALL_FORMS, ELEMENT_INFO, FORMS, REACTIONS, spellFor, type Form } from './magic';
import type { Element } from './tower/capability';
import { PAD_SKILL_LABELS } from './pad';
import { supportedControls, type CreatorCustomization, type CreatorLook } from '../actors/creatorAppearance';

/** DOM overlay for the Combat Arena: bars, combo badge, numbers, radar, cards. */
const css = `
.ar{position:fixed;inset:0;pointer-events:none;font:600 14px/1.2 "Segoe UI",system-ui,sans-serif;color:#fff;user-select:none}
.ar *{box-sizing:border-box}
.ar-frame{position:absolute;left:14px;top:12px;display:flex;gap:10px;align-items:flex-start}
.ar-portrait{width:54px;height:54px;border-radius:6px;background:linear-gradient(160deg,#5c6b85,#2a3142);border:2px solid #d6c08a;display:grid;place-items:center;font-size:26px;box-shadow:0 2px 8px #0008}
.ar-bars{width:300px}
.ar-lvl{font-size:12px;letter-spacing:.06em;color:#e9dcc0;text-shadow:0 1px 2px #000}
.ar-bar{position:relative;height:16px;margin-top:3px;background:#1d0d0d;border:1px solid #000;border-radius:2px;overflow:hidden;box-shadow:0 1px 4px #0007}
.ar-bar i{position:absolute;inset:0;transform-origin:left;background:linear-gradient(#e8382f,#9d1410)}
.ar-bar b{position:absolute;inset:0;transform-origin:left;background:#ffd9a0;opacity:.7}
.ar-bar span{position:absolute;inset:0;text-align:center;font-size:11px;line-height:15px;text-shadow:0 1px 2px #000}
.ar-bar.en{height:6px}.ar-bar.en i{background:linear-gradient(#ffe08a,#c8962c)}
.ar-bar.mana{height:9px}.ar-bar.mana i{background:linear-gradient(#6ec0ff,#2050c8)}.ar-bar.mana span{position:absolute;right:4px;top:-2px;font:700 9px sans-serif;color:#d8ecff}
.ar-bar.xp{height:5px;background:#222}.ar-bar.xp i{background:#e2c25b}
.ar-allies{margin-top:8px;display:flex;flex-direction:column;gap:4px}
.ar-ally{display:flex;align-items:center;gap:6px;font-size:11px;text-shadow:0 1px 2px #000}
.ar-ally .ar-bar{width:150px;height:9px;margin:0}.ar-ally .ar-bar i{background:linear-gradient(#3fd27a,#16803c)}
.ar-ally.down{color:#ff8a80}
.ar-combo{position:absolute;right:26px;top:40%;display:flex;align-items:center;gap:8px;transition:opacity .25s}
.ar-diamond{width:58px;height:58px;transform:rotate(45deg);background:linear-gradient(135deg,#ffe066,#c98a00);border:3px solid #1b1300;display:grid;place-items:center;box-shadow:0 0 18px #ffc80080}
.ar-diamond span{transform:rotate(-45deg);font:900 22px/1 "Segoe UI",sans-serif;color:#1b1300}
.ar-hits{font:900 26px/1 "Segoe UI",sans-serif;color:#ffd447;text-shadow:0 2px 0 #3a2500,0 0 8px #000}
.ar-hits small{font-size:16px;margin-left:3px}
.ar-weapons{position:absolute;left:16px;bottom:16px;display:flex;gap:10px;align-items:flex-end}
.ar-w{width:46px;height:46px;transform:rotate(45deg);background:#1c2230d0;border:2px solid #6c7891;display:grid;place-items:center}
.ar-w span{transform:rotate(-45deg);font-size:20px}
.ar-w.on{border-color:#ffd45c;background:#3b3220e0;box-shadow:0 0 12px #ffd45c80}
.ar-w em{position:absolute;transform:rotate(-45deg);bottom:-4px;right:-4px;font:700 10px sans-serif;color:#ffd45c;font-style:normal}
.ar-wname{position:absolute;left:4px;bottom:100%;margin-bottom:6px;white-space:nowrap;font-size:12px;color:#ddd;text-shadow:0 1px 2px #000}
.ar-radar{position:absolute;right:16px;bottom:16px;width:132px;height:132px;border-radius:50%;background:#10141cb0;border:2px solid #8a93a5}
.ar-wave{position:absolute;left:50%;top:14px;transform:translateX(-50%);max-width:max(260px,calc(100vw - 800px));text-align:center;text-shadow:0 2px 3px #000}
.ar-wave b{display:block;font:900 26px/1.1 "Segoe UI",sans-serif;letter-spacing:.08em;color:#f3e3b5}
.ar-wave span{display:block;font-size:12px;color:#ddd}
@media (max-width:1060px){.ar-wave{left:392px;transform:none;text-align:left;max-width:calc(100vw - 406px)}.ar-wave b{font-size:20px}}
/* Narrow windows: the skill row sits above the weapon row, scaled to fit between the weapons and the radar. */
@media (max-width:1180px){div.ar-skills{bottom:76px;transform:translateX(-50%) scale(.8);transform-origin:50% 100%}}
.ar-banner{position:absolute;left:50%;top:108px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 340px));padding:5px 14px;background:#0b0f18b0;border-radius:4px;text-align:center;font:900 18px/1.15 "Segoe UI",sans-serif;letter-spacing:.1em;color:#ffe6a8;text-shadow:0 2px 0 #4a2b00,0 0 8px #000;opacity:0;transition:opacity .3s;pointer-events:none}
.ar-banner .s{font:600 12px/1.3 "Segoe UI",sans-serif;letter-spacing:.03em;color:#e6dcc4;margin-top:3px}
.ar-help{position:absolute;right:14px;top:12px;max-width:290px;padding:10px 12px;background:#0d1118c8;border:1px solid #3b4558;border-radius:6px;font:500 12px/1.5 "Segoe UI",sans-serif;pointer-events:auto}
.ar-help b{color:#ffd45c}
.ar-help .x{float:right;cursor:pointer;color:#aaa}
.ar-num{position:absolute;font:900 20px/1 "Segoe UI",sans-serif;color:#fff;text-shadow:0 2px 0 #000,0 0 6px #000;white-space:nowrap;will-change:transform}
.ar-num.word{font:900 22px/1 'Segoe UI',sans-serif;letter-spacing:.08em;-webkit-text-stroke:1px #000}
.ar-num.crit{color:#ffd23d;font-size:28px}.ar-num.hurt{color:#ff5a4a}.ar-num.block{color:#9fd0ff;font-size:16px}.ar-num.heal{color:#6dff9a}
.ar-hp{position:absolute;width:56px;height:6px;background:#1a0606;border:1px solid #000;margin-left:-28px}
.ar-hp i{position:absolute;inset:0;transform-origin:left;background:#e8322a}.ar-hp.ally i{background:#35d06c}
.ar-tag{position:absolute;transform:translateX(-50%);font:600 15px "Segoe UI",sans-serif;text-shadow:0 1px 3px #000}
.ar-revive{position:absolute;transform:translate(-50%,-50%);font:700 12px sans-serif;text-shadow:0 1px 2px #000;text-align:center}
.ar-revive i{display:block;width:70px;height:6px;margin:3px auto 0;background:#222;border:1px solid #000}
.ar-revive i b{display:block;height:100%;background:#6dff9a}
.ar-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(190,0,0,.75) 100%);opacity:0}
.ar-modal{position:absolute;inset:0;background:#05070bd8;display:none;place-items:center;pointer-events:auto}
.ar-modal.on{display:grid}
.ar-card-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;max-width:1100px}
.ar-card{width:190px;padding:18px 14px;background:#151b26;border:2px solid #4b5770;border-radius:8px;text-align:center;cursor:pointer;transition:transform .12s,border-color .12s}
.ar-card:hover,.ar-card:focus{transform:translateY(-4px);border-color:#ffd45c;outline:none}
.ar-card .ic{font-size:44px;margin:8px 0}
.ar-card h3{margin:0 0 6px;font-size:16px;color:#ffe6a8}
.ar-card p{margin:0;font:500 12px/1.4 sans-serif;color:#c8cfdb}
.ar-modal h2{text-align:center;margin:0 0 4px;font:900 28px "Segoe UI",sans-serif;color:#ffd45c}
.ar-modal .sub{text-align:center;color:#ccc;margin-bottom:22px;font-weight:500}
.ar-toasts{position:absolute;left:14px;bottom:104px;display:flex;flex-direction:column-reverse;gap:4px;align-items:flex-start;max-width:min(360px,42vw)}
.ar-toast{padding:4px 10px;background:#0d1118c8;border:1px solid #3b4558;border-left-width:3px;border-radius:3px;font:600 12px/1.35 "Segoe UI",sans-serif;transition:opacity .4s}
.ar-fade{position:absolute;inset:0;background:#05070b;opacity:0;display:grid;place-items:center;font:900 40px "Segoe UI",sans-serif;letter-spacing:.14em;color:#ffe6a8;transition:opacity .35s}
.ar-boss{position:absolute;left:50%;top:70px;transform:translateX(-50%);width:520px;text-align:center;font:800 15px "Segoe UI",sans-serif;letter-spacing:.08em;color:#ffd0c0;text-shadow:0 1px 3px #000;display:none}
.ar-boss .ar-bar{height:12px;margin-top:4px}
.ar-codex{position:absolute;inset:8% 18%;background:#0d1118f0;border:1px solid #4b5770;border-radius:8px;padding:18px 22px;overflow:auto;display:none;pointer-events:auto;font:500 13px/1.5 "Segoe UI",sans-serif}
.ar-codex h2{margin:0 0 6px;color:#ffd45c;font:900 22px "Segoe UI",sans-serif}
.ar-codex table{width:100%;border-collapse:collapse;margin-top:8px}.ar-codex td,.ar-codex th{padding:4px 6px;border-bottom:1px solid #2a3140;text-align:left}
.ar-w.locked{opacity:.3}
.ar-skills{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:8px;align-items:flex-end}
.ar-sk{position:relative;width:52px;height:52px;border-radius:6px;background:#141a26e0;border:2px solid #56627a;display:grid;place-items:center;font-size:24px;overflow:hidden}
.ar-sk em{position:absolute;left:4px;top:2px;font:700 11px sans-serif;color:#ffd45c;font-style:normal}
.ar-sk i{position:absolute;left:0;right:0;bottom:0;background:#000a;transform-origin:bottom}
.ar-sk.locked{opacity:.25}
.padfocus{outline:3px solid #ffd76a !important;outline-offset:2px;transform:translateY(-3px)}
.ar-sk em.pad{font-size:9px;left:2px}
.ar-sk b{position:absolute;left:0;right:0;bottom:0;height:3px}
.ar-sk.empty{opacity:.35;font-size:14px;color:#56627a;border-style:dashed}
.ar-scroll{position:relative;width:44px;height:44px;border-radius:6px;background:#2a2114e0;border:2px solid #c9a35a;display:grid;place-items:center;font-size:20px}
.ar-scroll em{position:absolute;left:3px;top:1px;font:700 10px sans-serif;color:#ffd45c;font-style:normal}
.ar-scroll small{position:absolute;right:3px;bottom:1px;font:700 10px sans-serif;color:#fff}
.ar-ach{position:absolute;right:14px;bottom:166px;width:min(300px,40vw);background:#0b0f18e0;border:1px solid #5aa8ff;border-left-width:4px;border-radius:4px;padding:7px 10px;font:500 12px/1.35 "Segoe UI",sans-serif;color:#dfe8f5;opacity:0;transition:opacity .3s;box-shadow:0 2px 10px #0008;pointer-events:none}
.ar-ach h4{margin:0 0 1px;font:900 10px sans-serif;letter-spacing:.18em;color:#5aa8ff}
.ar-ach h3{margin:0 0 2px;font:800 14px "Segoe UI",sans-serif;color:#fff}
.ar-ach p{margin:0 0 3px;color:#b8c4d6;font-style:italic}
.ar-ach .rw{font-weight:800}
.ar-belt{display:flex;gap:4px;margin-left:8px}.ar-pot{width:34px;height:34px;border-radius:17px;background:#141a26e0;border:2px solid #56627a;display:grid;place-items:center;font-size:16px;position:relative}
.ar-pot em{position:absolute;left:-2px;top:-6px;font:700 10px sans-serif;color:#ffd45c;font-style:normal}
.ar-imbue{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);font:800 12px sans-serif;letter-spacing:.12em;text-shadow:0 1px 2px #000}
.ar-book{position:absolute;inset:5% 8%;background:#0a0e16f4;border:1px solid #6a5a2a;border-radius:8px;padding:16px 20px;overflow:auto;display:none;pointer-events:auto;font:500 12px/1.45 'Segoe UI',sans-serif;color:#dfe8f5}
.ar-book h2{margin:0 0 4px;font:900 22px 'Segoe UI',sans-serif;color:#ffd76a;letter-spacing:.06em}
.ar-book table{border-collapse:collapse;margin:8px 0}.ar-book td,.ar-book th{border:1px solid #2a3344;padding:3px 5px;text-align:center;min-width:86px}
.ar-book td.known{cursor:pointer;background:#16203a}.ar-book td.known:hover{background:#25345c}.ar-book td.dim{color:#3e4758}.ar-book td.sel{outline:2px solid #ffd76a}
.ar-book .slots{display:flex;gap:6px;margin:8px 0}.ar-book .slot{border:1px solid #56627a;border-radius:4px;padding:4px 8px;cursor:pointer;min-width:100px}.ar-book .slot:hover{border-color:#ffd76a}
.ar-dialog{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);width:min(820px,92%);background:linear-gradient(#0c1220f2,#070a12f2);border:1px solid #c9a23a;border-radius:6px;padding:14px 20px;display:none;pointer-events:auto;box-shadow:0 0 40px #000}
.ar-dialog h3{margin:0 0 6px;font:800 15px 'Segoe UI',sans-serif;color:#ffd76a;letter-spacing:.1em}.ar-dialog p{margin:0 0 10px;font:500 16px/1.5 Georgia,serif;color:#f1ead8}
.ar-dialog button{display:block;width:100%;text-align:left;margin:4px 0;padding:7px 10px;background:#141c2c;border:1px solid #3a4660;color:#dfe8f5;font:600 13px 'Segoe UI',sans-serif;border-radius:4px;cursor:pointer}.ar-dialog button:hover{border-color:#ffd76a}
.ar-flask{margin-left:10px;width:52px;height:52px;border-radius:26px;background:#1e1418e0;border:2px solid #b3485e;display:grid;place-items:center;font:800 15px sans-serif;color:#ffc6d0}
.ar-charge{position:absolute;left:50%;top:58%;transform:translateX(-50%);width:120px;height:8px;background:#0008;border:1px solid #000;display:none}.ar-charge i{display:block;height:100%;background:#ffd45c}
.ar-btn{margin-top:20px;padding:10px 22px;font:700 14px sans-serif;background:#ffd45c;color:#1a1300;border:0;border-radius:4px;cursor:pointer}
`;

const SOURCE_COLOR: Record<string, string> = { essence: '#b57bff', confluence: '#ff5ad1', book: '#5aa8ff', class: '#ffd45c', scroll: '#c9a35a', sign: '#8fa0b8' };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const ICON: Record<WeaponId, string> = { fists: '👊', greatsword: '🗡️', axe: '🪓', bow: '🏹' };

export interface Upgrade { id: string; name: string; icon: string; text: string; apply(w: ArenaWorld): void }
export const UPGRADES: Upgrade[] = [
  { id: 'heal', name: 'Full Heal', icon: '✚', text: 'Restore to full health', apply: w => { w.hero.hp = w.hero.maxHp; } },
  { id: 'dmg', name: 'Brute Force', icon: '💪', text: '+15% damage with every weapon', apply: w => { w.mods.damage *= 1.15; } },
  { id: 'spd', name: 'Quick Hands', icon: '⚡', text: '+12% attack speed', apply: w => { w.mods.atkSpeed *= 1.12; } },
  { id: 'hp', name: 'Vitality', icon: '❤️', text: '+20% max health, healed', apply: w => { const add = w.hero.maxHp * .2; w.bonus.maxHpUpgrades *= 1.2; w.hero.maxHp += add; w.hero.hp += add; } },
  { id: 'move', name: 'Fleet Foot', icon: '👟', text: '+10% movement speed', apply: w => { w.mods.move *= 1.1; } },
  { id: 'regen', name: 'Second Wind', icon: '🌀', text: '+30% energy recovery', apply: w => { w.mods.regen *= 1.3; } },
  { id: 'range', name: 'Cleave', icon: '🌙', text: '+15% melee reach', apply: w => { w.mods.range *= 1.15; } },
];

export class ArenaHud {
  readonly root = el('div', 'ar');
  private hp = el('i'); private hpLag = el('b'); private hpText = el('span'); private en = el('i'); private mana = el('i'); private manaText = el('span');
  private belt = el('div', 'ar-belt'); private beltSig = ''; private imbueEl = el('div', 'ar-imbue'); private bookEl = el('div', 'ar-book'); private dialogEl = el('div', 'ar-dialog');
  /** Potion belt and spellbook data (set by the tower). */
  magic: { belt: { icon: string; name: string; color: string }[]; spells: SkillDef[]; ley: Element | null; forms: string[]; affinity: (e: Element) => number; manaControl: number } | null = null; private xp = el('i'); private lvl = el('div', 'ar-lvl');
  private allies = el('div', 'ar-allies');
  private combo = el('div', 'ar-combo'); private mul = el('span'); private hits = el('div', 'ar-hits');
  private weapons = new Map<WeaponId, HTMLElement>(); private wname = el('div', 'ar-wname');
  private radar = el('canvas', 'ar-radar'); private rctx: CanvasRenderingContext2D;
  private waveEl = el('div', 'ar-wave'); private banner = el('div', 'ar-banner');
  private layer = el('div'); private vignette = el('div', 'ar-vignette');
  private modal = el('div', 'ar-modal');
  private help: HTMLElement;
  private nums: { e: HTMLElement; p: Vector3; t: number; vx: number }[] = [];
  private bars = new Map<number, HTMLElement>(); private tags = new Map<number, HTMLElement>(); private revives = new Map<number, HTMLElement>();
  private hurt = 0; private bannerT = 0;
  private toasts = el('div', 'ar-toasts'); private fadeEl = el('div', 'ar-fade'); private bossEl = el('div', 'ar-boss', '<span></span><div class="ar-bar"><i></i></div>');
  private codexEl = el('div', 'ar-codex');
  private skills = el('div', 'ar-skills'); private skillEls: HTMLElement[] = []; private skillSig = ''; private scrollEl = el('div', 'ar-scroll');
  private achEl = el('div', 'ar-ach'); private achQ: string[] = []; private achT = 0; private flaskEl = el('div', 'ar-flask'); private chargeEl = el('div', 'ar-charge', '<i></i>');
  /** Set by the tower: drives the floor panel, boss bar, tier/class line and weapon locks. */
  tower: { floor: number; plan: { objective: string; theme: { name: string; tier: string } }; boss: Fighter | null; summary(): { tier: string; cls: string; essences: string[]; confluence: string; gear: { name: string; color: string; text: string }[]; achievements: string[]; styles: [string, number][]; affinities: [string, number][] }; gear: Record<string, { name: string } | undefined>; scrolls: SkillDef[] } | null = null;
  modalOpen = false;
  /** Controller in use: skill slots show L2 combinations; menus take D-pad focus. */
  padMode = false; private focusI = 0;

  constructor() {
    const style = el('style'); style.textContent = css; document.head.append(style);
    const frame = el('div', 'ar-frame'), bars = el('div', 'ar-bars');
    frame.append(el('div', 'ar-portrait', '🛡️'), bars);
    const hpBar = el('div', 'ar-bar'); hpBar.append(this.hpLag, this.hp, this.hpText);
    const enBar = el('div', 'ar-bar en'); enBar.append(this.en);
    const manaBar = el('div', 'ar-bar mana'); manaBar.append(this.mana, this.manaText);
    const xpBar = el('div', 'ar-bar xp'); xpBar.append(this.xp);
    bars.append(this.lvl, hpBar, manaBar, enBar, xpBar, this.allies);
    const d = el('div', 'ar-diamond'); d.append(this.mul); this.combo.append(d, this.hits);
    const wrow = el('div', 'ar-weapons');
    for (const id of Object.keys(WEAPONS) as WeaponId[]) { const w = el('div', 'ar-w', `<span>${ICON[id]}</span><em>${WEAPONS[id].key}</em>`); this.weapons.set(id, w); wrow.append(w); }
    wrow.append(this.wname);
    this.radar.width = 132; this.radar.height = 132; this.rctx = this.radar.getContext('2d')!;
    this.help = el('div', 'ar-help', `<span class="x">✕</span><b>Combat Gym</b> · local feel lab<br>
      <b>WASD</b> move · <b>Shift</b> sprint · <b>Mouse</b> aim · <b>MMB drag</b> orbit · <b>Wheel</b> zoom<br><b>LMB</b> light attack (chain) · <b>RMB</b> heavy (hold to charge)<br><b>F</b> guard (parry if timed) · <b>1-4</b> signs · <b>Q</b> flask · <b>Tab</b> weapon<br>
      <b>Space</b> dodge or roll · bow: hold <b>RMB</b> to aim, release to loose<br>
      <b>E</b> hold near a fallen companion to revive<br><b>C</b> companions · <b>N</b> spawn enemies · <b>M</b> auto waves<br>
      <b>R</b> rebuild the gym · <b>L</b> state labels · <b>P</b> pause · <b>H</b> this help`);
    this.help.querySelector('.x')!.addEventListener('click', () => this.toggleHelp());
    this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden';
    this.skills.append(this.flaskEl, this.belt);
    this.root.append(this.vignette, this.layer, frame, this.combo, wrow, this.radar, this.waveEl, this.banner, this.bossEl, this.toasts, this.skills, this.imbueEl, this.achEl, this.bookEl, this.dialogEl, this.chargeEl, this.help, this.codexEl, this.modal, this.fadeEl);
    document.body.append(this.root);
  }

  toast(text: string, color = '#fff'): void {
    const t = el('div', 'ar-toast'); t.textContent = text; t.style.color = color; this.toasts.prepend(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 3200);
    while (this.toasts.childElementCount > 5) this.toasts.lastElementChild!.remove();
  }
  /** Black out for a floor transition, with a caption. */
  fade(seconds: number, caption: string): void {
    this.fadeEl.textContent = caption.toUpperCase(); this.fadeEl.style.opacity = '1';
    setTimeout(() => { this.fadeEl.style.opacity = '0'; }, seconds * 1000 + 250);
  }
  /** Generic card choice (god boons); resolves with the picked index. */
  choose(title: string, sub: string, cards: { icon: string; name: string; text: string }[]): Promise<number> {
    this.modalOpen = true; this.modal.classList.add('on');
    this.modal.innerHTML = `<div><h2>${title}</h2><div class="sub">${sub}</div><div class="ar-card-row"></div><div class="sub" style="margin-top:14px">Keys ${cards.map((_, i) => i + 1).join(' · ')}</div></div>`;
    const row = this.modal.querySelector('.ar-card-row')!;
    return new Promise(res => {
      const pick = (i: number) => { window.removeEventListener('keydown', key, true); this.modal.classList.remove('on'); this.modalOpen = false; res(i); };
      const key = (e: KeyboardEvent) => { const i = e.code.startsWith('Digit') ? Number(e.code.slice(5)) - 1 : -1; if (i >= 0 && i < cards.length) { e.stopPropagation(); pick(i); } };
      window.addEventListener('keydown', key, true);
      cards.forEach((c, i) => { const b = el('button', 'ar-card', `<div class="ic">${c.icon}</div><h3>${i + 1}. ${c.name}</h3><p>${c.text}</p>`); b.addEventListener('click', () => pick(i)); row.append(b); });
    });
  }
  /** Hero body choice shown in the Codex panel (applies from the next climb or reload). */
  heroCustom: { readonly value: CreatorCustomization; readonly drawn: CreatorLook | null; set(patch: Partial<CreatorCustomization>): void } | null = null;
  /** The Character section of the Codex panel: only controls the drawn creator body supports are live. */
  private renderCharacter(box: HTMLElement): void {
    const hc = this.heroCustom; if (!hc) { box.innerHTML = ''; return; }
    const c = hc.value, drawn = hc.drawn, sup = drawn ? supportedControls(drawn) : null;
    const off = (why: string) => `<span style="color:#9aa3b2">${why}</span>`;
    const note = drawn === 'creator_female' ? 'not available on the female body (it has no authored jaw morph or palette)' : 'needs a creator body';
    box.innerHTML = `<h3 style="margin:14px 0 6px;color:#ffd45c">Character</h3>
      <div><b>Body</b> (from the next climb or reload): ${(['male', 'female'] as const).map(k => `<button class="ar-btn" data-body="${k}"${k === c.body ? ' style="border-color:#ffd45c"' : ''}>${k === 'male' ? 'Male' : 'Female'}</button>`).join(' ')}</div>
      ${sup ? `<div style="margin-top:6px"><b>Height</b> <input id="cc-height" type="range" min="95" max="105" step="1" value="${Math.round(c.height * 100)}"> <span id="cc-height-v">${Math.round(c.height * 100)}%</span></div>
      <div style="margin-top:6px"><label><input id="cc-hair" type="checkbox"${c.hair ? ' checked' : ''}> <b>Hair</b></label></div>
      <div style="margin-top:6px"><b>Jaw width</b> ${sup.jaw ? `<input id="cc-jaw" type="range" min="0" max="100" step="1" value="${Math.round((c.jaw ?? .5) * 100)}"> <span id="cc-jaw-v">${c.jaw === null ? 'seeded' : Math.round(c.jaw * 100) + '%'}</span> <button class="ar-btn" id="cc-jaw-seeded">Use seeded</button>` : off(note)}</div>
      <div style="margin-top:6px"><b>Look</b> ${sup.reroll ? `<button class="ar-btn" id="cc-reroll">Re-roll jaw and cloth colours</button> <span style="color:#9aa3b2">seed ${c.seed}</span>` : off(note)}</div>` : `<div style="margin-top:6px">${off('Height, hair and jaw apply to the creator bodies only.')}</div>`}`;
    const re = () => this.renderCharacter(box);
    box.querySelectorAll<HTMLButtonElement>('[data-body]').forEach(b => b.addEventListener('click', () => { hc.set({ body: b.dataset.body as 'male' | 'female' }); re(); }));
    const h = box.querySelector<HTMLInputElement>('#cc-height'); h?.addEventListener('input', () => { hc.set({ height: Number(h.value) / 100 }); box.querySelector('#cc-height-v')!.textContent = `${h.value}%`; });
    const hair = box.querySelector<HTMLInputElement>('#cc-hair'); hair?.addEventListener('change', () => hc.set({ hair: hair.checked }));
    const j = box.querySelector<HTMLInputElement>('#cc-jaw'); j?.addEventListener('input', () => { hc.set({ jaw: Number(j.value) / 100 }); box.querySelector('#cc-jaw-v')!.textContent = `${j.value}%`; });
    box.querySelector('#cc-jaw-seeded')?.addEventListener('click', () => { hc.set({ jaw: null }); re(); });
    box.querySelector('#cc-reroll')?.addEventListener('click', () => { hc.set({ seed: (hc.value.seed + 1) >>> 0, jaw: null }); re(); });
  }
  /** The Codex: every class that has emerged (this browser), plus the current climber's capabilities. */
  toggleCodex(codex: { name: string; pattern: string; tier: string; floor: number; times: number; firstSeen: string }[]): void {
    if (this.codexEl.style.display === 'block') { this.codexEl.style.display = 'none'; return; }
    const sum = this.tower?.summary();
    const rows = codex.map(c => `<tr><td><b>${c.name}</b></td><td>${c.pattern}</td><td>${c.tier}</td><td>floor ${c.floor}</td><td>×${c.times}</td><td>${c.firstSeen.slice(0, 10)}</td></tr>`).join('');
    this.codexEl.innerHTML = `<h2>Codex of Emergent Classes</h2>
      ${sum ? `<div><b>You:</b> ${sum.tier} · ${sum.cls}<br><b>Styles</b> ${sum.styles.map(([k, v]) => `${k} ${v}`).join(' · ')}<br><b>Affinities</b> ${sum.affinities.map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'}<br><b>Essences</b> ${sum.essences.join(' · ') || 'none'}${sum.confluence ? ` → <b style="color:#ff5ad1">${sum.confluence}</b>` : ''}<br><b>Worn</b> ${sum.gear.map(g => `<span style="color:${g.color}" title="${g.text}">${g.name}</span>`).join(' · ') || 'plain cloth'}<br><b>Achievements</b> ${sum.achievements.length}</div>` : ''}
      <table><tr><th>Class</th><th>Qualifying pattern</th><th>Tier</th><th>First seen</th><th>Seen</th><th>Date</th></tr>${rows || '<tr><td colspan=6>No class has emerged yet. Fight, learn tomes, accept boons.</td></tr>'}</table>
      <button class="ar-btn" id="codex-export">Export codex (JSON)</button> <button class="ar-btn" id="codex-close">Close (K)</button>
      <div id="cc-character"></div>`;
    this.renderCharacter(this.codexEl.querySelector<HTMLElement>('#cc-character')!);
    this.codexEl.style.display = 'block';
    this.codexEl.querySelector('#codex-close')!.addEventListener('click', () => { this.codexEl.style.display = 'none'; });
    this.codexEl.querySelector('#codex-export')!.addEventListener('click', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(codex, null, 1)], { type: 'application/json' })); a.download = 'chrysanthus-codex.json'; a.click();
    });
  }

  /** A Dungeon Crawler Carl style system notice: achievement, flavour, and the box it awards. */
  achievement(head: string, name: string, text: string, reward: string, color: string): void {
    this.achQ.push(`<h4 style="color:${color}">${head}</h4><h3>${name}</h3><p>${text}</p><div class="rw" style="color:${color}">${reward}</div>`);
    this.achEl.style.borderColor = color;
  }

  /** A floating word over a body: reactions and statuses (FREEZE, ELECTROCUTE, SHATTER, STEAM...). */
  word(p: Vector3, text: string, color: string): void {
    const e = el('div', 'ar-num word', text); e.style.color = color; this.layer.append(e);
    this.nums.push({ e, p: p.add(new Vector3((Math.random() - .5) * .4, .5, 0)), t: -.25, vx: 0 });
    if (this.nums.length > 60) this.nums.shift()!.e.remove();
  }

  /**
   * The Spellbook (B): the element x form grid. Discovered spells are lit; click one, then a slot, to ready it.
   * Shows affinities, learned forms, the floor's ley and the reaction rules, so emergence can be read and planned.
   */
  toggleBook(slots: (SkillDef | null)[], assign: (slot: number, s: SkillDef) => void): void {
    if (this.bookEl.style.display === 'block') { this.bookEl.style.display = 'none'; this.modalOpen = false; return; }
    const M = this.magic; if (!M) return;
    const known = new Map(M.spells.map(x => [x.id, x]));
    let sel: SkillDef | null = null;
    const render = () => {
      const head = '<tr><th></th>' + ALL_FORMS.map(f => `<th title="${FORMS[f].text}" style="color:${M.forms.includes(f) ? '#ffd76a' : '#4b5568'}">${FORMS[f].name}</th>`).join('') + '<th>affinity</th></tr>';
      const rows = ALL_ELEMENTS.map(e => '<tr><th style="color:' + ELEMENT_INFO[e].color + '">' + ELEMENT_INFO[e].glyph + ' ' + ELEMENT_INFO[e].name + (M.ley === e ? ' ✦' : '') + '</th>' + ALL_FORMS.map(f => {
        const id = `sp:${e}:${f}`, k = known.get(id);
        return k ? `<td class="known${sel?.id === id ? ' sel' : ''}" data-id="${id}" title="${k.text} · ${k.mana} mana · ${k.cooldown}s">${k.icon} ${k.name}${k.rank > 1 ? ` <small>r${k.rank}</small>` : ''}</td>` : `<td class="dim" title="Needs ${ELEMENT_INFO[e].name} affinity 1 and the ${FORMS[f as Form].name} form">${spellFor(e, f as Form).name}</td>`;
      }).join('') + `<td>${M.affinity(e).toFixed(1)}</td></tr>`).join('');
      const others = M.spells.filter(x => x.source !== 'spell');
      this.bookEl.innerHTML = `<h2>Spellbook</h2>
        <div>Magic is an element (an affinity you hold) shaped by a form (a way you have learned to shape mana). Reach affinity 1 in an element and every form you know gives you its spell. Mana control ${M.manaControl.toFixed(1)}${M.ley ? ` · this floor's ley runs with <b style="color:${ELEMENT_INFO[M.ley].color}">${ELEMENT_INFO[M.ley].name}</b> (+35%)` : ''}.</div>
        <table>${head}${rows}</table>
        ${others.length ? `<div><b>Other skills:</b> ${others.map(o => `<span class="known" data-id="${o.id}" style="cursor:pointer;color:${o.color}">${o.icon} ${o.name}</span>`).join(' · ')}</div>` : ''}
        <div style="margin-top:8px"><b>Skill slots</b> ${sel ? `· choose a slot for <b style="color:${sel.color}">${sel.name}</b>` : '· pick a spell, then a slot'}</div>
        <div class="slots">${slots.map((x, i) => `<div class="slot" data-slot="${i}">${i + 1}. ${x ? `${x.icon} ${x.name}` : '<i>empty</i>'}</div>`).join('')}</div>
        <div><b>Reactions</b>${REACTIONS.map(r => `<div>${r.a} + ${r.b} → <b>${r.result}</b>: ${r.text}</div>`).join('')}</div>
        <button class="ar-btn" id="book-close">Close (B)</button>`;
      this.bookEl.querySelectorAll<HTMLElement>('[data-id]').forEach(c => c.addEventListener('click', () => { sel = known.get(c.dataset.id!) ?? null; render(); }));
      this.bookEl.querySelectorAll<HTMLElement>('[data-slot]').forEach(c => c.addEventListener('click', () => { if (!sel) return; assign(Number(c.dataset.slot), sel); slots = slots.map((x, i) => (i === Number(c.dataset.slot) ? sel : x)); sel = null; render(); }));
      this.bookEl.querySelector('#book-close')!.addEventListener('click', () => this.toggleBook(slots, assign));
    };
    render(); this.bookEl.style.display = 'block'; this.modalOpen = true;
  }

  /** A conversation panel: the speaker's line and the player's replies (keys 1-3 or click). */
  dialogue(speaker: string, line: string, replies: string[]): Promise<number> {
    this.modalOpen = true; this.dialogEl.style.display = 'block';
    this.dialogEl.innerHTML = `<h3>${speaker}</h3><p>${line}</p>`;
    return new Promise(res => {
      const done = (i: number) => { window.removeEventListener('keydown', key, true); this.dialogEl.style.display = 'none'; this.modalOpen = false; res(i); };
      const key = (e: KeyboardEvent) => { const i = e.code.startsWith('Digit') ? Number(e.code.slice(5)) - 1 : e.code === 'Enter' || e.code === 'Space' ? 0 : -1; if (i >= 0 && i < Math.max(1, replies.length)) { e.stopPropagation(); e.preventDefault(); done(i); } };
      window.addEventListener('keydown', key, true);
      (replies.length ? replies : ['Continue']).forEach((r, i) => { const b = el('button', '', `${i + 1}. ${r}`); b.addEventListener('click', () => done(i)); this.dialogEl.append(b); });
    });
  }

  setPadMode(on: boolean): void { this.padMode = on; this.skillSig = ''; }
  showHelp(on: boolean): void { this.help.style.display = on ? '' : 'none'; }
  /** Any menu that takes controller focus is open (cards, messages, dialogue, spellbook, codex). */
  menuOpen(): boolean { return this.modalOpen || this.bookEl.style.display === 'block' || this.codexEl.style.display === 'block'; }
  private focusables(): HTMLElement[] {
    const q = (root: HTMLElement, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
    if (this.dialogEl.style.display === 'block') return q(this.dialogEl, 'button');
    if (this.modal.classList.contains('on')) return q(this.modal, '.ar-card, .ar-btn');
    if (this.bookEl.style.display === 'block') return q(this.bookEl, '[data-id], [data-slot], #book-close');
    if (this.codexEl.style.display === 'block') return q(this.codexEl, 'button');
    return [];
  }
  /** D-pad focus: left/right steps one item, up/down steps a row (or one, in short lists). */
  padNav(dx: number, dy: number): void {
    const items = this.focusables(); if (!items.length) return;
    const row = this.bookEl.style.display === 'block' ? 8 : 1;
    this.focusI = Math.max(0, Math.min(items.length - 1, (items.findIndex(e => e.classList.contains('padfocus')) + 1 ? items.findIndex(e => e.classList.contains('padfocus')) : -1) + dx + dy * row));
    items.forEach((e, i) => e.classList.toggle('padfocus', i === this.focusI)); items[this.focusI].scrollIntoView?.({ block: 'nearest' });
  }
  padConfirm(): void {
    const items = this.focusables(); if (!items.length) return;
    const cur = items.find(e => e.classList.contains('padfocus')) ?? items[0];
    cur.click();
    // Re-rendered menus (the spellbook) keep their focus position.
    setTimeout(() => { const again = this.focusables(); again[Math.min(this.focusI, again.length - 1)]?.classList.add('padfocus'); }, 0);
  }
  padBack(): void {
    if (this.bookEl.style.display === 'block') this.bookEl.querySelector<HTMLElement>('#book-close')?.click();
    else if (this.codexEl.style.display === 'block') this.codexEl.style.display = 'none';
    else if (this.dialogEl.style.display === 'block' || this.modal.classList.contains('on')) { /* choices must be made */ }
  }

  setHelp(html: string): void { this.help.innerHTML = html; this.help.querySelector('.x')?.addEventListener('click', () => this.toggleHelp()); }

  toggleHelp(): void { this.help.style.display = this.help.style.display === 'none' ? '' : 'none'; }

  announce(text: string, sub = ''): void { this.banner.innerHTML = text + (sub ? `<div class="s">${sub}</div>` : ''); this.banner.style.opacity = '1'; this.bannerT = 2.2; }

  number(p: Vector3, amount: number, kind: 'hit' | 'crit' | 'block' | 'hurt' | 'heal'): void {
    const e = el('div', `ar-num ${kind}`, kind === 'block' ? 'BLOCK' : kind === 'heal' ? `+${amount}` : String(amount));
    this.layer.append(e);
    this.nums.push({ e, p: p.add(new Vector3((Math.random() - .5) * .6, .3, (Math.random() - .5) * .6)), t: 0, vx: (Math.random() - .5) * 40 });
    if (kind === 'hurt') this.hurt = 1;
    if (this.nums.length > 60) this.nums.shift()!.e.remove();
  }

  /** Level-up reward: three cards; resolves with the pick. */
  chooseUpgrade(level: number, gains: string): Promise<Upgrade> {
    const pool = [...UPGRADES].sort(() => Math.random() - .5).slice(0, 3);
    this.modalOpen = true; this.modal.classList.add('on');
    this.modal.innerHTML = `<div><h2>Level ${level}</h2><div class="sub">You have reached level ${level}. Choose a reward. <span style="color:#ffd45c">${gains}</span></div><div class="ar-card-row"></div><div class="sub" style="margin-top:14px">Keys 1 · 2 · 3</div></div>`;
    const row = this.modal.querySelector('.ar-card-row')!;
    return new Promise(res => {
      const pick = (u: Upgrade) => { window.removeEventListener('keydown', key, true); this.modal.classList.remove('on'); this.modalOpen = false; res(u); };
      const key = (e: KeyboardEvent) => { const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code); if (i >= 0) { e.stopPropagation(); pick(pool[i]); } };
      window.addEventListener('keydown', key, true);
      pool.forEach((u, i) => { const c = el('button', 'ar-card', `<div class="ic">${u.icon}</div><h3>${i + 1}. ${u.name}</h3><p>${u.text}</p>`); c.addEventListener('click', () => pick(u)); row.append(c); });
    });
  }

  message(title: string, sub: string, button: string, onClick: () => void): void {
    this.modalOpen = true; this.modal.classList.add('on');
    this.modal.innerHTML = `<div style="text-align:center"><h2>${title}</h2><div class="sub">${sub}</div><button class="ar-btn">${button}</button></div>`;
    this.modal.querySelector('button')!.addEventListener('click', () => { this.modal.classList.remove('on'); this.modalOpen = false; onClick(); });
  }
  closeModal(): void { this.modal.classList.remove('on'); this.modalOpen = false; }

  update(dt: number, w: ArenaWorld, scene: Scene, camera: Camera): void {
    const h = w.hero;
    if (!this.tower) this.lvl.textContent = `LVL ${w.level}  ·  ${w.kills} kills  ·  ${w.smashed} smashed`;
    this.hp.style.transform = `scaleX(${Math.max(0, h.hp / h.maxHp)})`;
    this.hpLag.style.transform = `scaleX(${Math.max(0, h.hpShown / h.maxHp)})`;
    this.hpText.textContent = `${Math.max(0, Math.ceil(h.hp))} / ${Math.round(h.maxHp)}`;
    this.en.style.transform = `scaleX(${h.energy / 100})`;
    this.mana.style.transform = `scaleX(${Math.max(0, h.mana / h.maxMana)})`; this.manaText.textContent = `${Math.floor(h.mana)}`;
    const ie = w.imbue?.e ?? w.weaponImbue[w.weapon];
    this.imbueEl.style.display = ie ? '' : 'none';
    if (ie) { this.imbueEl.textContent = `${ELEMENT_INFO[ie].glyph} ${ELEMENT_INFO[ie].name.toUpperCase()} WEAPON${w.imbue ? ` ${Math.ceil(w.imbue.t)}s` : ''}`; this.imbueEl.style.color = ELEMENT_INFO[ie].color; }
    const M = this.magic;
    const bs = M ? M.belt.map(b => b.name).join('|') : '';
    if (bs !== this.beltSig) { this.beltSig = bs; this.belt.replaceChildren(...(M?.belt ?? []).map((b, i) => { const e = el('div', 'ar-pot', `${i === 0 ? '<em>V</em>' : ''}${b.icon}`); e.style.borderColor = b.color; e.title = b.name; return e; })); }
    this.xp.style.transform = `scaleX(${w.xp / w.nextXp})`;
    const allies = w.fighters.filter(f => f.role === 'ally');
    if (this.allies.childElementCount !== allies.length) this.allies.replaceChildren(...allies.map(() => el('div', 'ar-ally', '<span></span><div class="ar-bar"><i></i></div>')));
    allies.forEach((a, i) => {
      const row = this.allies.children[i] as HTMLElement; row.classList.toggle('down', a.state === 'down');
      (row.firstChild as HTMLElement).textContent = a.state === 'down' ? `${a.name} — DOWN (hold E)` : a.name;
      (row.querySelector('i') as HTMLElement).style.transform = `scaleX(${Math.max(0, a.hp / a.maxHp)})`;
    });
    this.combo.style.opacity = w.combo.hits > 1 ? '1' : '0';
    this.mul.textContent = `x${w.comboMul.toFixed(1)}`;
    this.hits.innerHTML = `${w.combo.hits}<small>hits</small>`;
    // Skill slots are whatever the world holds now (they grow and change during a climb).
    const sig = w.skills.map(s => s ? s.id + s.name : '-').join('|') + (this.tower ? '|t' : '') + (this.padMode ? '|pad' : '');
    if (sig !== this.skillSig) {
      this.skillSig = sig; for (const e of this.skillEls) e.remove(); this.skillEls = [];
      w.skills.forEach((s, k) => {
        const key = this.padMode ? `<em class="pad">${PAD_SKILL_LABELS[k] ?? ''}</em>` : `<em>${k + 1}</em>`;
        const e = s ? el('div', 'ar-sk', `<span>${s.icon}</span>${key}<i></i><b style="background:${SOURCE_COLOR[s.source]}"></b>`) : el('div', 'ar-sk empty', `${key}empty`);
        e.title = s ? `${s.name} (${s.source}): ${s.text} · ${s.cost} stamina · ${s.cooldown}s` : 'Empty slot: absorb an essence, read a skill book, or let a class emerge';
        this.skillEls.push(e); this.skills.insertBefore(e, this.flaskEl);
      });
      if (this.tower) this.skills.insertBefore(this.scrollEl, this.flaskEl); else this.scrollEl.remove();
    }
    this.skillEls.forEach((e, k) => { const s = w.skills[k]; if (!s) return; (e.querySelector('i') as HTMLElement).style.transform = `scaleY(${s.cooldown ? w.skillCd[k] / s.cooldown : 0})`; e.style.borderColor = w.hero.energy >= s.cost ? s.color : '#56627a'; });
    if (this.tower) { const sc = this.tower.scrolls; this.scrollEl.innerHTML = `<em>G</em>${sc[0]?.icon ?? '📜'}<small>${sc.length}</small>`; this.scrollEl.style.opacity = sc.length ? '1' : '.35'; this.scrollEl.title = sc[0] ? `${sc[0].name}: ${sc[0].text}` : 'No scrolls'; }
    this.achT -= dt; if (this.achT <= 0) this.achEl.style.opacity = '0';
    if (this.achT <= -.4 && this.achQ.length) { this.achEl.innerHTML = this.achQ.shift()!; this.achEl.style.opacity = '1'; this.achT = 4.2; }
    this.flaskEl.textContent = `Q ${w.flasks}`; this.flaskEl.style.opacity = w.flasks ? '1' : '.4';
    this.chargeEl.style.display = w.hero.charging ? 'block' : 'none'; (this.chargeEl.firstChild as HTMLElement).style.width = `${w.hero.charge * 100}%`;
    for (const [id, e] of this.weapons) { e.classList.toggle('on', id === w.weapon); e.classList.toggle('locked', !w.unlocked.has(id)); }
    const g = this.tower?.gear[w.weapon];
    this.wname.textContent = g ? g.name : WEAPONS[w.weapon].name;
    const T = this.tower;
    if (T?.plan) {
      const sum = T.summary(), foesLeft = w.fighters.filter(f => f.role === 'foe' && f.alive).length;
      this.lvl.innerHTML = `LVL ${w.level} · <span style="color:#ffd45c">${sum.tier}</span> · ${sum.cls}`;
      this.waveEl.innerHTML = `<b>FLOOR ${T.floor}</b><span>${T.plan.theme.name} · ${T.plan.objective}${foesLeft ? ` · ${foesLeft} left` : ''}</span>`;
      const b = T.boss; this.bossEl.style.display = b ? 'block' : 'none';
      if (b) { (this.bossEl.firstChild as HTMLElement).textContent = b.boss!.name.toUpperCase(); (this.bossEl.querySelector('i') as HTMLElement).style.transform = `scaleX(${Math.max(0, b.hp / b.maxHp)})`; }
    }
    const foes = w.fighters.filter(f => f.role === 'foe' && f.alive).length;
    if (!this.tower) this.waveEl.innerHTML = w.wave ? `<b>WAVE ${w.wave}</b><span>${foes} enemies remain</span>` : `<b>COMBAT GYM</b><span>Sandbox: press N to spawn enemies, M for waves</span>`;
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.style.opacity = '0';
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    const low = h.hp / h.maxHp < .3 ? .35 + Math.sin(performance.now() / 180) * .15 : 0;
    this.vignette.style.opacity = String(Math.max(this.hurt * .9, low));

    const eng = scene.getEngine(), vw = eng.getRenderWidth(), vh = eng.getRenderHeight();
    const sx = this.layer.clientWidth / vw, sy = this.layer.clientHeight / vh;
    const vp = camera.viewport.toGlobal(vw, vh), tm = scene.getTransformMatrix();
    const project = (p: Vector3) => { const s = Vector3.Project(p, Matrix.IdentityReadOnly, tm, vp); return { x: s.x * sx, y: s.y * sy, ok: s.z > 0 && s.z < 1 }; };
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i]; n.t += dt;
      const s = project(n.p);
      const rise = n.t * 70, pop = n.t < .1 ? 1.5 - n.t * 5 : 1;
      n.e.style.transform = `translate(${s.x + n.vx * n.t - 12}px,${s.y - rise}px) scale(${pop})`;
      n.e.style.opacity = String(1 - Math.max(0, (n.t - .55) / .35));
      if (n.t > .9) { n.e.remove(); this.nums.splice(i, 1); }
    }
    const seen = new Set<number>();
    for (const f of w.fighters) {
      if (f.role === 'hero' || !f.alive || f.state === 'spawn' && f.st < .8) continue;
      const damaged = f.hp < f.maxHp - .5 || f.role === 'ally';
      if (!damaged || f.state === 'down') continue;
      seen.add(f.id);
      let b = this.bars.get(f.id);
      if (!b) { b = el('div', `ar-hp ${f.role === 'ally' ? 'ally' : ''}`, '<i></i>'); this.layer.append(b); this.bars.set(f.id, b); }
      const s = project(f.pos.add(new Vector3(0, 2.75, 0)));
      b.style.transform = `translate(${s.x}px,${s.y}px)`; b.style.display = s.ok ? '' : 'none';
      (b.firstChild as HTMLElement).style.transform = `scaleX(${Math.max(0, f.hp / f.maxHp)})`;
    }
    for (const [id, b] of this.bars) if (!seen.has(id)) { b.remove(); this.bars.delete(id); }
    // Debug state labels, as in the reference capture (toggle L).
    const tagged = new Set<number>();
    if (w.showLabels) for (const f of w.fighters) {
      if (!f.alive && f.role === 'foe') continue;
      tagged.add(f.id);
      let t = this.tags.get(f.id); if (!t) { t = el('div', 'ar-tag'); this.layer.append(t); this.tags.set(f.id, t); }
      const s = project(f.pos.add(new Vector3(0, f.role === 'hero' ? 3.4 : 3.1, 0)));
      t.style.left = s.x + 'px'; t.style.top = s.y + 'px'; t.textContent = f.label; t.style.fontSize = f.role === 'hero' ? '17px' : '12px';
    }
    for (const [id, t] of this.tags) if (!tagged.has(id)) { t.remove(); this.tags.delete(id); }
    const rev = new Set<number>();
    for (const f of w.fighters) if (f.role === 'ally' && f.state === 'down') {
      rev.add(f.id);
      let r = this.revives.get(f.id); if (!r) { r = el('div', 'ar-revive', `${f.name} is down<br>hold <b>E</b> to help<i><b></b></i>`); this.layer.append(r); this.revives.set(f.id, r); }
      const s = project(f.pos.add(new Vector3(0, 1.4, 0)));
      r.style.left = s.x + 'px'; r.style.top = s.y + 'px'; (r.querySelector('i b') as HTMLElement).style.width = `${f.reviveT / 1.6 * 100}%`;
    }
    for (const [id, r] of this.revives) if (!rev.has(id)) { r.remove(); this.revives.delete(id); }
    this.drawRadar(w, camera);
  }

  private drawRadar(w: ArenaWorld, camera: Camera): void {
    const c = this.rctx, R = 64, range = 30, h = w.hero.pos;
    c.clearRect(0, 0, 132, 132);
    c.save(); c.translate(66, 66);
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.clip();
    // Rotate so screen-up on the radar matches camera forward.
    const camYaw = Math.atan2(h.x - camera.position.x, h.z - camera.position.z);
    const rot = (x: number, z: number) => { const dx = x - h.x, dz = z - h.z, cs = Math.cos(-camYaw), sn = Math.sin(-camYaw); return [(dx * cs + dz * sn) / range * R, -(-dx * sn + dz * cs) / range * R]; };
    c.strokeStyle = '#ffffff30'; c.lineWidth = 1;
    const corners = [[-ARENA, -ARENA], [ARENA, -ARENA], [ARENA, ARENA], [-ARENA, ARENA]].map(([x, z]) => rot(x, z));
    c.beginPath(); corners.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.stroke();
    for (const f of w.fighters) {
      if (!f.alive || f.role === 'hero') continue;
      const [x, y] = rot(f.pos.x, f.pos.z);
      c.fillStyle = f.role === 'foe' ? '#ff3b30' : f.state === 'down' ? '#ffb000' : '#4ee07c';
      c.beginPath(); c.arc(x, y, f.role === 'foe' ? 2.6 : 3.4, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#ffd45c'; c.beginPath(); c.moveTo(0, -5); c.lineTo(4, 4); c.lineTo(-4, 4); c.closePath(); c.fill();
    c.restore();
  }
}
