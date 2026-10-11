import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../src/web/game/input';
import { DEFAULT_SETTINGS } from '../src/web/game/bindings';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(isometric = false, orbit = false, captureMouse = true) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { activeElement: null as null | { tagName: string }, hidden: false, pointerLockElement: null as EventTarget | null });
  const canvas = new EventTarget();
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const input = new InputManager(canvas as HTMLCanvasElement, () => ({ ...DEFAULT_SETTINGS, captureMouse, viewMode: orbit ? 'orbit' : isometric ? 'isometric' : 'third-person' }));
  const key = (type: string, code: string) => win.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  const frame = () => input.beginFrame(1 / 60);
  return { win, doc, canvas, input, key, frame };
}

describe('gameplay input and UI focus boundaries', () => {
  it('orbits and attacks from pointer events even when the renderer suppresses mouse compatibility events', () => {
    const { canvas, win, input, frame } = setup();
    const pointer = (target: EventTarget, type: string, values: object) => target.dispatchEvent(Object.assign(new Event(type), values));
    pointer(canvas, 'pointerdown', { button: 1, clientX: 100, clientY: 100 });
    pointer(win, 'pointermove', { clientX: 300, clientY: 140 }); frame();
    expect(input.look.x).toBeGreaterThan(0); expect(input.look.y).toBeGreaterThan(0);
    expect(input.pressed('lightAttack')).toBe(false);
    pointer(win, 'pointerup', { button: 1 }); frame();
    pointer(canvas, 'pointerdown', { button: 0 }); frame(); expect(input.pressed('lightAttack')).toBe(true);
    pointer(win, 'pointerup', { button: 0 }); frame();
    input.pointerLocked = true;
    pointer(canvas, 'pointerdown', { button: 0 }); frame(); expect(input.pressed('lightAttack')).toBe(true);
    pointer(win, 'pointerup', { button: 0 }); frame(); expect(input.isDown('lightAttack')).toBe(false);
  });
  it.each([false, true])('strikes and holds/releases guard in free-cursor third-person with capture=%s', captureMouse => {
    const { canvas, win, input, frame } = setup(false, false, captureMouse);
    const pointer = (target: EventTarget, type: string, button: number) => target.dispatchEvent(Object.assign(new Event(type), { button, clientX: 100, clientY: 100 }));
    pointer(canvas, 'pointerdown', 0); frame(); expect(input.pressed('lightAttack')).toBe(true);
    frame(); expect(input.pressed('lightAttack')).toBe(false);
    pointer(win, 'pointerup', 0); pointer(canvas, 'pointerdown', 2); frame();
    expect(input.isDown('guard')).toBe(true); expect(input.pressed('guard')).toBe(true);
    pointer(win, 'pointermove', 2); frame(); expect(input.look).toEqual({ x: 0, y: 0 });
    pointer(win, 'pointerup', 2); frame(); expect(input.isDown('guard')).toBe(false); expect(input.released('guard')).toBe(true);
  });
  it('keeps mouse combat available after rejected capture and never repeats a strike on capture entry', async () => {
    const { canvas, doc, input, frame } = setup();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const request = vi.fn(() => Promise.reject(new Error('Pointer capture refused')));
    Object.assign(canvas, { requestPointerLock: request });
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 })); input.requestLock(); frame();
    expect(input.pressed('lightAttack')).toBe(true);
    await Promise.resolve(); await Promise.resolve(); expect(request).toHaveBeenCalledTimes(2);
    frame(); expect(input.pressed('lightAttack')).toBe(false);
    doc.pointerLockElement = canvas; doc.dispatchEvent(new Event('pointerlockchange')); frame();
    expect(input.pressed('lightAttack')).toBe(false);
  });
  it.each(['blur', 'pointercancel'])('releases free-cursor guard on %s', type => {
    const { canvas, win, input, frame } = setup(false, false, false);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 2 })); frame(); expect(input.isDown('guard')).toBe(true);
    win.dispatchEvent(new Event(type)); frame(); expect(input.isDown('guard')).toBe(false);
  });
  it('releases a movement key when focus enters dialogue before keyup', () => {
    const { doc, input, key, frame } = setup();
    key('keydown', 'KeyW'); frame(); expect(input.move.y).toBe(1);
    doc.activeElement = { tagName: 'TEXTAREA' };
    key('keyup', 'KeyW'); frame(); expect(input.move.y).toBe(0);
    key('keydown', 'KeyW'); frame(); expect(input.move.y).toBe(0);
    key('keydown', 'Escape'); frame(); expect(input.pressed('pause')).toBe(true);
  });
  it('does not replay Escape into the pause menu opened by pointer-lock exit', () => {
    const { doc, canvas, input, key, frame } = setup();
    doc.pointerLockElement = canvas; doc.dispatchEvent(new Event('pointerlockchange'));
    key('keydown', 'Escape');
    doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange'));
    frame(); expect(input.pressed('uiBack')).toBe(false);
    key('keyup', 'Escape'); key('keydown', 'Escape'); frame();
    expect(input.pressed('uiBack')).toBe(true);
  });
  it('stops continuous walking on interaction, manual movement and lost focus', () => {
    const { input, key, frame, win } = setup();
    const walk = () => { key('keydown', 'NumLock'); key('keyup', 'NumLock'); frame(); };
    walk(); expect(input.move.y).toBe(1);
    key('keydown', 'KeyE'); key('keyup', 'KeyE'); frame(); expect(input.move.y).toBe(0);
    walk(); key('keydown', 'KeyS'); frame(); expect(input.autoWalking).toBe(false);
    key('keyup', 'KeyS'); frame(); expect(input.move.y).toBe(0);
    walk(); win.dispatchEvent(new Event('blur')); frame(); expect(input.move.y).toBe(0);
  });
});

describe('isometric pointer controls', () => {
  it('accepts mouse combat without pointer lock and releases it on blur', () => {
    const { canvas, win, input, frame } = setup(true);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 120, clientY: 90 }));
    frame(); expect(input.pressed('lightAttack')).toBe(true); expect(input.isDown('lightAttack')).toBe(true);
    win.dispatchEvent(new Event('blur')); frame(); expect(input.isDown('lightAttack')).toBe(false);
  });
});


it('elevated orbit reserves middle drag while left click still emits attack without pointer lock', () => {
  const {canvas,win,input,frame}=setup(false,true);
  const pointer=(target:EventTarget,type:string,values:object)=>target.dispatchEvent(Object.assign(new Event(type),values));
  pointer(canvas,'pointerdown',{button:1,clientX:100,clientY:100});
  pointer(win,'pointermove',{clientX:300,clientY:150});frame();
  expect(input.look.x).toBeGreaterThan(0);expect(input.pressed('lightAttack')).toBe(false);expect(input.isDown('guard')).toBe(false);
  pointer(win,'pointerup',{button:1});pointer(canvas,'pointerdown',{button:0});frame();expect(input.pressed('lightAttack')).toBe(true);
  pointer(win,'pointerup',{button:0});frame();expect(input.isDown('lightAttack')).toBe(false);
});
