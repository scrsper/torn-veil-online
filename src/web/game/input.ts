import { ACTIONS, bindingsFor, type Action, type Device, type Settings } from './bindings';

/**
 * Keyboard, mouse and gamepad, reduced to semantic actions once per frame.
 *
 * Nothing here knows about the simulation. `beginFrame` snapshots what happened since the last
 * frame (held / pressed / released per action, an analog move vector, a look delta), so game and UI
 * code read one consistent picture. Gamepad sticks stay analog (dead zone rescaled, never snapped),
 * the mouse turns the camera while locked or middle-dragging, and every event source can be lost
 * at any time (blur, disconnect, lock exit) without leaving a key stuck.
 */
export interface MoveVector { x: number; y: number }
export class InputManager {
  device: Device = 'keyboard';
  pointerLocked = false;
  /** Lost focus cancels latched gameplay state as well as physical held keys. */
  releaseSerial = 0;
  /** Set true when a menu is open: gameplay reads should be ignored by callers; UI actions still work. */
  readonly move: MoveVector = { x: 0, y: 0 };
  autoWalking = false;
  stopAutoWalk(): void { this.autoWalking = false; }
  readonly look = { x: 0, y: 0 };
  wheel = 0;
  readonly pointer = { x: 0, y: 0, active: false };
  padConnected = false;
  padName = '';
  private readonly held = new Set<string>();
  private pendingPressed = new Set<string>(); private pendingReleased = new Set<string>();
  private framePressed = new Set<string>(); private frameReleased = new Set<string>();
  private lookAccum = { x: 0, y: 0 };
  private wheelAccum = 0;
  private orbitDrag: { x: number; y: number } | null = null;
  private padPrev: boolean[] = [];
  private capture: ((code: string) => void) | null = null;
  private lastPadActivity = 0;
  onDeviceChange: ((d: Device) => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** Called for Escape-less pointer-lock exit so the app can open the pause menu. */
  private lockRequestedAt = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly settings: () => Settings) {
    const typing = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
    window.addEventListener('keydown', e => {
      if (typing() && e.code !== 'Escape') return;
      if (this.capture && e.code !== 'Escape') { e.preventDefault(); const c = this.capture; this.capture = null; c(e.code); return; }
      this.noteDevice('keyboard');
      if (['Tab', 'Space', 'AltLeft', 'AltRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F5', 'F6', 'F7'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down(e.code);
    });
    // Focus can move into a text field between down and up. Always release the physical key,
    // even though a text field's key presses never become gameplay intentions.
    window.addEventListener('keyup', e => { if (['AltLeft', 'AltRight'].includes(e.code) && !typing()) e.preventDefault(); this.up(e.code); });
    // Babylon consumes pointerdown and may suppress compatibility mouse events. Listen to
    // the original pointer stream so camera motion and combat work on the real canvas.
    canvas.addEventListener('pointerdown', e => {
      if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c(`Mouse${e.button}`); return; }
      this.noteDevice('keyboard'); e.preventDefault();
      // Primary/secondary combat works before capture and when capture is disabled or refused.
      // Reserve middle-drag for the free cursor camera, as in elevated orbit mode.
      if (!this.pointerLocked && this.settings().viewMode !== 'isometric' && e.button === 1) this.orbitDrag = { x: e.clientX, y: e.clientY };
      else this.down(`Mouse${e.button}`);
    });
    window.addEventListener('pointerup', e => { if (e.button === 1) this.orbitDrag = null; if (e.button >= 3) e.preventDefault(); this.up(`Mouse${e.button}`); });
    window.addEventListener('pointercancel', () => this.releaseAll());
    window.addEventListener('auxclick', e => { if (e.button >= 1) e.preventDefault(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('pointermove', e => {
      this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.active = true;
      if (this.pointerLocked) { this.lookAccum.x += e.movementX; this.lookAccum.y += e.movementY; }
      else if (this.orbitDrag) {
        this.lookAccum.x += e.clientX - this.orbitDrag.x; this.lookAccum.y += e.clientY - this.orbitDrag.y;
        this.orbitDrag = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.wheelAccum += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100 + 0.3); }, { passive: false });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (locked !== this.pointerLocked) { this.pointerLocked = locked; if (!locked) this.releaseAll(); this.onLockChange?.(locked); }
    });
    window.addEventListener('gamepadconnected', e => { this.padConnected = true; this.padName = (e as GamepadEvent).gamepad.id; this.device = this.family(this.padName); this.onDeviceChange?.(this.device); });
    window.addEventListener('gamepaddisconnected', () => { this.padConnected = !!this.activePad(); if (!this.padConnected) { this.device = 'keyboard'; for (const code of [...this.held]) if (code.startsWith('Pad')) this.up(code); this.padPrev = []; this.onDeviceChange?.('keyboard'); } });
  }

  private family(id: string): Device { return /054c|dualsense|dualshock|playstation|wireless controller/i.test(id) ? 'playstation' : 'xbox'; }
  private noteDevice(d: Device): void { if (this.device !== d) { this.device = d; this.onDeviceChange?.(d); } }
  private down(code: string): void { if (!this.held.has(code)) { this.held.add(code); this.pendingPressed.add(code); } }
  private up(code: string): void { if (this.held.delete(code)) this.pendingReleased.add(code); }
  releaseAll(): void {
    this.releaseSerial++;
    this.autoWalking = false; this.orbitDrag = null;
    for (const c of [...this.held]) { this.held.delete(c); this.pendingReleased.add(c); }
    // Pointer-lock exit can open Pause before the Escape key reaches beginFrame. That same
    // edge must not immediately close the newly opened menu or activate its focused button.
    this.pendingPressed.clear(); this.framePressed.clear();
    this.move.x = this.move.y = this.lookAccum.x = this.lookAccum.y = this.look.x = this.look.y = 0;
    this.wheelAccum = this.wheel = 0;
  }

  requestLock(): void {
    if (this.settings().viewMode === 'isometric' || this.settings().viewMode === 'orbit' || !this.settings().captureMouse || this.pointerLocked || performance.now() - this.lockRequestedAt < 400) return;
    this.lockRequestedAt = performance.now();
    // Raw (unadjusted) movement if the browser allows it, else ordinary pointer lock. Every promise is handled: a refusal
    // (menu opening at the same moment, tab not focused, document not valid for lock) is normal and must not surface as an error.
    const plain = () => { try { (this.canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined); } catch { /* denied */ } };
    try { (this.canvas.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown as Promise<void> | undefined)?.catch?.(plain); } catch { plain(); }
  }
  exitLock(): void { if (document.pointerLockElement) document.exitPointerLock(); }
  /** The next key, mouse button or gamepad button becomes the answer; Escape cancels through `cancelCapture`. */
  captureNext(cb: (code: string) => void): void { this.capture = cb; }
  cancelCapture(): void { this.capture = null; }
  get capturing(): boolean { return this.capture !== null; }

  private activePad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
  vibrate(strong: number, weak: number, ms: number): void {
    if (!this.settings().vibration) return;
    const pad = this.activePad(); const act = (pad as unknown as { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<unknown> } } | null)?.vibrationActuator;
    act?.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: weak, strongMagnitude: strong }).catch(() => undefined);
  }

  /** Call once at the start of each rendered frame. */
  beginFrame(dt: number): void {
    const s = this.settings();
    // Gamepad polling.
    const pad = this.activePad();
    let padMoveX = 0, padMoveY = 0, padLookX = 0, padLookY = 0;
    if (pad) {
      if (!this.padConnected) { this.padConnected = true; this.padName = pad.id; }
      const before = this.device;
      const btn = (i: number) => { const b = pad.buttons[i]; return !!b && (b.pressed || b.value > (this.padPrev[i] ? 0.3 : 0.6)); };
      for (let i = 0; i < Math.min(18, pad.buttons.length); i++) {
        const now = btn(i), was = !!this.padPrev[i], code = `Pad${i}`;
        if (now && !was) { if (this.capture) { const c = this.capture; this.capture = null; c(code); } else { this.down(code); this.noteDevice(this.family(pad.id)); this.lastPadActivity = performance.now(); } }
        else if (!now && was) this.up(code);
        this.padPrev[i] = now;
      }
      const dz = (x: number, y: number, zone: number): [number, number] => {
        const m = Math.hypot(x, y); if (m <= zone) return [0, 0];
        const k = Math.min(1, (m - zone) / (1 - zone)) / m; return [x * k, y * k];
      };
      const [lx, ly] = dz(pad.axes[0] ?? 0, pad.axes[1] ?? 0, s.moveDeadZone), [rx, ry] = dz(pad.axes[2] ?? 0, pad.axes[3] ?? 0, s.lookDeadZone);
      padMoveX = lx; padMoveY = -ly; padLookX = rx; padLookY = ry;
      if ((lx || ly || rx || ry) && this.device !== this.family(pad.id)) this.noteDevice(this.family(pad.id));
      if (lx || ly || rx || ry) this.lastPadActivity = performance.now();
      void before;
    }
    this.framePressed = this.pendingPressed; this.frameReleased = this.pendingReleased; this.pendingPressed = new Set(); this.pendingReleased = new Set();

    // Move: keyboard digital plus pad analog; the larger magnitude wins per axis, then clamp to the unit circle.
    const kx = (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0), ky = (this.isDown('moveForward') ? 1 : 0) - (this.isDown('moveBack') ? 1 : 0);
    let mx = Math.abs(padMoveX) > Math.abs(kx) ? padMoveX : kx, my = Math.abs(padMoveY) > Math.abs(ky) ? padMoveY : ky;
    if (this.pressed('autoWalk')) this.autoWalking = !this.autoWalking;
    if (mx || my || ['interact', 'lightAttack', 'heavyAttack', 'guard', 'dodge', 'pause', 'items', 'journal', 'abilities'].some(a => this.pressed(a as Action))) this.autoWalking = false;
    if (this.autoWalking) my = 1;
    const mag = Math.hypot(mx, my); if (mag > 1) { mx /= mag; my /= mag; }
    this.move.x = mx; this.move.y = my;

    // Look: mouse pixels and pad stick (analog).
    const ms = s.mouseSensitivity * 0.001, iy = s.invertY ? -1 : 1, piy = s.padInvertY ? -1 : 1;
    this.look.x = this.lookAccum.x * ms + padLookX * s.padSensitivityX * dt;
    this.look.y = (this.lookAccum.y * ms) * iy + padLookY * s.padSensitivityY * dt * piy;
    this.lookAccum.x = this.lookAccum.y = 0;
    this.wheel = this.wheelAccum; this.wheelAccum = 0;
  }

  private codes(action: Action): string[] { const s = this.settings(); return [...bindingsFor(s, 'keyboard', action), ...bindingsFor(s, 'pad', action)]; }
  isDown(action: Action): boolean { return this.codes(action).some(c => this.held.has(c)); }
  pressed(action: Action): boolean { return this.codes(action).some(c => this.framePressed.has(c)); }
  released(action: Action): boolean { return this.codes(action).some(c => this.frameReleased.has(c)); }
  /** Which physical code, if any, was pressed for the action this frame (for dodge modifiers etc.). */
  anyPressed(): boolean { return this.framePressed.size > 0; }
  /** Milliseconds since a gamepad was last touched; UI uses it to decide whether to show pad prompts. */
  get padIdleMs(): number { return performance.now() - this.lastPadActivity; }

  /** First bound code for an action on the active device, as a prompt label input. */
  promptCode(action: Action): string {
    const s = this.settings();
    const pad = this.device !== 'keyboard';
    const list = bindingsFor(s, pad ? 'pad' : 'keyboard', action);
    return list[0] ?? bindingsFor(s, pad ? 'keyboard' : 'pad', action)[0] ?? '';
  }
  allActions(): Action[] { return ACTIONS.map(a => a.id); }
}
