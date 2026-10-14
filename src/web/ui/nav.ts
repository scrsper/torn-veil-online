import type { InputManager } from '../game/input';

/**
 * Menu navigation shared by keyboard and gamepad. The active modal's root is the scope; directional
 * presses move focus to the nearest focusable in that direction, the pad's confirm clicks it, back
 * closes, shoulder buttons switch tabs, triggers scroll. Sliders and dropdowns respond to
 * left/right and up/down without leaving the control. Native keyboard behaviour (Tab, Enter, Space)
 * is left alone so the keyboard never double-activates.
 */
export interface NavScope { root: HTMLElement; onBack?: () => void; onTab?: (dir: -1 | 1) => void; onDetail?: () => void }
const FOCUSABLE = 'button:not([disabled]), [tabindex="0"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]';

export class UiNav {
  private readonly stack: NavScope[] = [];
  private repeat = { code: '', at: 0, next: 0 };
  constructor(private readonly input: InputManager) {}
  get active(): NavScope | null { return this.stack[this.stack.length - 1] ?? null; }
  get open(): boolean { return this.stack.length > 0; }
  push(scope: NavScope, focusFirst = true): void {
    this.stack.push(scope);
    if (focusFirst) queueMicrotask(() => this.focusFirst(scope.root));
  }
  pop(scope: NavScope): void { const i = this.stack.indexOf(scope); if (i >= 0) this.stack.splice(i, 1); }
  clear(): void { this.stack.length = 0; }

  focusables(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
  }
  focusFirst(root: HTMLElement): void {
    const preferred = root.querySelector<HTMLElement>('[data-autofocus]') ?? this.focusables(root)[0];
    preferred?.focus({ preventScroll: false });
  }
  private move(root: HTMLElement, dx: number, dy: number): void {
    const list = this.focusables(root); if (!list.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !root.contains(cur)) { list[0].focus(); return; }
    const cr = cur.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), ex = r.left + r.width / 2, ey = r.top + r.height / 2, vx = ex - cx, vy = ey - cy;
      const along = vx * dx + vy * dy; if (along <= 1) continue;
      const across = Math.abs(vx * dy) + Math.abs(vy * dx);
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
  }
  private scrollBy(root: HTMLElement, dir: number): void {
    const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.body, .tv-transcript, .tv-options') ?? root.querySelector<HTMLElement>('.body') ?? root;
    el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: 'smooth' });
  }

  /** Call every frame while any modal is open. */
  update(): void {
    const scope = this.active; if (!scope) return;
    const inp = this.input;
    const cur = document.activeElement as HTMLElement | null;
    const isRange = cur instanceof HTMLInputElement && cur.type === 'range', isSelect = cur instanceof HTMLSelectElement, isText = cur instanceof HTMLInputElement && (cur.type === 'text' || cur.type === 'search') || cur instanceof HTMLTextAreaElement;
    const padUse = inp.device !== 'keyboard';
    const held = (a: 'uiUp' | 'uiDown' | 'uiLeft' | 'uiRight') => inp.isDown(a);
    const dirs: [typeof this.repeat.code, number, number][] = [['uiUp', 0, -1], ['uiDown', 0, 1], ['uiLeft', -1, 0], ['uiRight', 1, 0]];
    const now = performance.now();
    for (const [code, dx, dy] of dirs) {
      const a = code as 'uiUp' | 'uiDown' | 'uiLeft' | 'uiRight', edge = inp.pressed(a);
      let fire = edge;
      if (!edge && held(a) && this.repeat.code === code && now >= this.repeat.next) { fire = true; this.repeat.next = now + 90; }
      if (edge) this.repeat = { code, at: now, next: now + 340 };
      if (!held(a) && this.repeat.code === code) this.repeat.code = '';
      if (!fire) continue;
      if (isText) continue;
      if (isRange && dx) { const r = cur as HTMLInputElement; if (dx > 0) r.stepUp(); else r.stepDown(); r.dispatchEvent(new Event('input', { bubbles: true })); continue; }
      if (isSelect && dy) { const s = cur as HTMLSelectElement; s.selectedIndex = Math.max(0, Math.min(s.options.length - 1, s.selectedIndex + dy)); s.dispatchEvent(new Event('change', { bubbles: true })); continue; }
      if (!padUse && (isRange || isSelect)) continue;
      this.move(scope.root, dx, dy);
    }
    if (padUse && inp.pressed('uiConfirm') && cur && scope.root.contains(cur)) { if (cur instanceof HTMLInputElement && cur.type === 'checkbox') cur.click(); else if (!isText && !isSelect && !isRange) cur.click(); }
    if (inp.pressed('uiBack') && !isText) { if (isSelect && (cur as HTMLSelectElement).matches(':focus-visible') && false) return; scope.onBack?.(); }
    if (inp.pressed('uiTabPrev') && !isText) scope.onTab?.(-1);
    if (inp.pressed('uiTabNext') && !isText) scope.onTab?.(1);
    if (inp.pressed('uiPageUp')) this.scrollBy(scope.root, -1);
    if (inp.pressed('uiPageDown')) this.scrollBy(scope.root, 1);
  }
}
