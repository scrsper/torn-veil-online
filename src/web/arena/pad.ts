/**
 * PlayStation 5 DualSense (and any standard-mapping gamepad) for the arena and the Tower of Chrysanthus.
 *
 * Layout (Elden Ring / Witcher 3 style, Diablo 4 style skill access):
 *   Left stick   move (camera-relative)              Right stick  orbit the camera     R3  recentre camera
 *   R1           light attack (chain)                R2           heavy (hold to charge) · bow: hold to aim, release to loose
 *   L1           guard (raise just in time to parry) L2 (hold)    skill modifier: L2+□ 1 · L2+△ 2 · L2+○ 3 · L2+✕ 4 · L2+R1 5 · L2+R2 6 · L2+L1 7
 *   ○            tap: dodge / roll · hold: sprint    ✕            interact (shrine, revive), confirm in menus
 *   □            flask                               △            next weapon
 *   D-pad ↑      drink from the belt                 D-pad ↓      read a scroll        D-pad ← →  previous / next weapon
 *   Touchpad     Spellbook                           Create       Codex                Options    pause
 * In menus: D-pad or left stick moves the focus, ✕ confirms, ○ backs out.
 * Standard Gamepad API mapping (Chrome/Edge on Windows map the DualSense this way over USB and Bluetooth).
 */
export const BTN = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16, touch: 17 } as const;
type B = keyof typeof BTN;

/** On-screen names for the skill slots when a controller is in use. */
export const PAD_SKILL_LABELS = ['L2□', 'L2△', 'L2○', 'L2✕', 'L2R1', 'L2R2', 'L2L1'];
const SKILL_BUTTONS: B[] = ['square', 'triangle', 'circle', 'cross', 'r1', 'r2', 'l1'];

export interface PadFrame {
  move: { x: number; y: number }; look: { x: number; y: number };
  light: boolean; lightPressed: boolean;
  heavy: boolean; heavyPressed: boolean; heavyReleased: boolean;
  guard: boolean; dodge: boolean; sprint: boolean; interact: boolean; flask: boolean;
  cycle: boolean; weaponStep: -1 | 0 | 1; drink: boolean; scroll: boolean; skill: number;
  book: boolean; codex: boolean; pause: boolean; recentre: boolean;
  /** Menu navigation edges (D-pad or a flick of the left stick), confirm and back. */
  nav: { x: number; y: number }; confirm: boolean; back: boolean;
}

export class DualSense {
  /** True once the controller has been used; the HUD shows controller glyphs while it is. */
  active = false;
  name = '';
  private prev: boolean[] = []; private prevR2 = false; private circleT = 0; private circleUsedForSkill = false;
  private navPrev = { x: 0, y: 0 }; private l2Used = false;
  private lastKeyboard = 0;

  constructor() {
    window.addEventListener('gamepadconnected', e => { this.name = e.gamepad.id; this.onConnect?.(this.label()); });
    // Keyboard or mouse use hands the glyphs back to the keyboard layout.
    for (const ev of ['keydown', 'pointerdown'] as const) window.addEventListener(ev, () => { this.lastKeyboard = performance.now(); if (this.active) { this.active = false; this.onModeChange?.(false); } });
  }
  onConnect: ((label: string) => void) | null = null;
  onModeChange: ((pad: boolean) => void) | null = null;

  label(): string { return /dualsense|wireless controller|054c/i.test(this.name) ? 'DualSense' : this.name ? 'Controller' : ''; }

  private get pad(): Gamepad | null { return [...(navigator.getGamepads?.() ?? [])].find(p => p && p.connected) ?? null; }

  /** Read one frame. Returns null with no controller connected. */
  poll(dt: number): PadFrame | null {
    const p = this.pad; if (!p) return null;
    if (!this.name) this.name = p.id;
    const b = p.buttons.map(x => x.pressed), v = (k: B) => p.buttons[BTN[k]]?.value ?? 0;
    const held = (k: B) => !!b[BTN[k]], down = (k: B) => !!b[BTN[k]] && !this.prev[BTN[k]], up = (k: B) => !b[BTN[k]] && !!this.prev[BTN[k]];
    // Radial dead zone with rescale, so small drift is ignored but full range remains.
    const stick = (x: number, y: number, dz = .16) => { const m = Math.hypot(x, y); if (m < dz) return { x: 0, y: 0 }; const k = Math.min(1, (m - dz) / (1 - dz)) / m; return { x: x * k, y: y * k }; };
    const move = stick(p.axes[0] ?? 0, p.axes[1] ?? 0), look = stick(p.axes[2] ?? 0, p.axes[3] ?? 0, .12);
    const any = b.some(Boolean) || move.x || move.y || look.x || look.y;
    if (any && !this.active && performance.now() - this.lastKeyboard > 150) { this.active = true; this.onModeChange?.(true); }
    const l2 = v('l2') > .35 || held('l2');
    const r2 = v('r2') > .35 || held('r2');
    // L2 is a modifier: while held, face and shoulder buttons cast skills instead of their own action.
    let skill = -1;
    if (l2) SKILL_BUTTONS.forEach((k, i) => { const pressedNow = k === 'r2' ? r2 && !this.prevR2 : down(k); if (pressedNow) { skill = i; this.l2Used = true; if (k === 'circle') this.circleUsedForSkill = true; } });
    if (!l2) this.l2Used = false;
    // Circle: tap = dodge (on release, if it was short), hold = sprint.
    if (held('circle')) this.circleT += dt;
    const circleUp = up('circle'), tap = circleUp && this.circleT < .22 && !this.circleUsedForSkill;
    const sprint = (held('circle') && this.circleT >= .22 && !l2) || held('l3');
    if (!held('circle')) { this.circleT = 0; if (circleUp) this.circleUsedForSkill = false; }
    // Menu navigation: D-pad edges, or a flick of the left stick.
    const sx = Math.abs(move.x) > .6 ? Math.sign(move.x) : 0, sy = Math.abs(move.y) > .6 ? Math.sign(move.y) : 0;
    const nav = { x: down('right') ? 1 : down('left') ? -1 : sx !== this.navPrev.x ? sx : 0, y: down('down') ? 1 : down('up') ? -1 : sy !== this.navPrev.y ? sy : 0 };
    this.navPrev = { x: sx, y: sy };
    const f: PadFrame = {
      move, look,
      light: held('r1') && !l2, lightPressed: down('r1') && !l2,
      heavy: r2 && !l2, heavyPressed: r2 && !this.prevR2 && !l2, heavyReleased: !r2 && this.prevR2 && !this.l2Used,
      guard: held('l1') && !l2, dodge: tap && !l2, sprint, interact: held('cross') && !l2, flask: down('square') && !l2,
      cycle: down('triangle') && !l2, weaponStep: down('right') ? 1 : down('left') ? -1 : 0, drink: down('up'), scroll: down('down'), skill,
      book: down('touch'), codex: down('create'), pause: down('options'), recentre: down('r3'),
      nav, confirm: down('cross'), back: down('circle'),
    };
    this.prev = b; this.prevR2 = r2;
    return f;
  }

  /** Rumble (DualSense supports dual-rumble through Chrome's vibrationActuator). */
  rumble(strong: number, weak: number, ms: number): void {
    const a = (this.pad as unknown as { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } } | null)?.vibrationActuator;
    a?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => undefined);
  }
}
