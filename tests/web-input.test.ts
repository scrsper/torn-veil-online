import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../src/web/game/input';
import { DEFAULT_SETTINGS } from '../src/web/game/bindings';

afterEach(() => vi.unstubAllGlobals());
function setup(isometric = false, orbit = false) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { activeElement: null as null | { tagName: string }, hidden: false, pointerLockElement: null as EventTarget | null });
  const canvas = new EventTarget();
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const input = new InputManager(canvas as HTMLCanvasElement, () => ({ ...DEFAULT_SETTINGS, viewMode: orbit ? 'orbit' : isometric ? 'isometric' : 'third-person' }));
  const key = (type: string, code: string) => win.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  const frame = () => input.beginFrame(1 / 60);
  return { win, doc, canvas, input, key, frame };
}

describe('gameplay input and UI focus boundaries', () => {
  it('orbits and attacks from pointer events even when the renderer suppresses mouse compatibility events', () => {
    const { canvas, win, input, frame } = setup();
    const pointer = (target: EventTarget, type: string, values: object) => target.dispatchEvent(Object.assign(new Event(type), values));
    pointer(canvas, 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    pointer(win, 'pointermove', { clientX: 300, clientY: 140 }); frame();
    expect(input.look.x).toBeGreaterThan(0); expect(input.look.y).toBeGreaterThan(0);
    expect(input.pressed('lightAttack')).toBe(false);
    pointer(win, 'pointerup', { button: 0 }); frame();
    input.pointerLocked = true;
    pointer(canvas, 'pointerdown', { button: 0 }); frame(); expect(input.pressed('lightAttack')).toBe(true);
    pointer(win, 'pointerup', { button: 0 }); frame(); expect(input.isDown('lightAttack')).toBe(false);
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
  it('releases held controller combat buttons on disconnect without releasing keyboard movement', () => {
    const {win,input,key,frame}=setup(false,true);
    let pad:any={id:'Xbox',connected:true,buttons:Array.from({length:18},()=>({pressed:false,value:0})),axes:[0,0,0,0]};
    vi.stubGlobal('navigator',{getGamepads:()=>pad?[pad]:[]});
    pad.buttons[4]={pressed:true,value:1};key('keydown','KeyW');frame();expect(input.isDown('guard')).toBe(true);
    pad=null;win.dispatchEvent(new Event('gamepaddisconnected'));frame();expect(input.isDown('guard')).toBe(false);expect(input.move.y).toBe(1);
  });
  it('does not replay wheel input after losing focus', () => {
    const {win,canvas,input,frame}=setup(false,true);canvas.dispatchEvent(Object.assign(new Event('wheel'),{deltaY:100}));win.dispatchEvent(new Event('blur'));frame();expect(input.wheel).toBe(0);
  });
  it('continues middle orbit drag after a simultaneous attack button is released', () => {
    const {win,canvas,input,frame}=setup(false,true);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'),{button:1,clientX:10,clientY:10}));
    win.dispatchEvent(Object.assign(new Event('pointerup'),{button:0}));win.dispatchEvent(Object.assign(new Event('pointermove'),{clientX:110,clientY:10}));frame();expect(input.look.x).toBeGreaterThan(0);
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
