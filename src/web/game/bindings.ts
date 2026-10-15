/**
 * Semantic actions, default bindings and persisted player settings.
 *
 * The bindings mirror docs/LIVING_ALPHA_CONTROLS.md so a player moving between the Unreal client and
 * this one keeps the same hands. Codes are strings: `Key*` (KeyboardEvent.code), `Mouse0..4`,
 * `Pad<index>` (Standard Gamepad button index). Sticks are analog and are not rebindable per-axis.
 */
export type Action =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'sprint' | 'crouch' | 'autoWalk' | 'jump'
  | 'interact' | 'lightAttack' | 'heavyAttack' | 'guard' | 'dodge' | 'focus'
  | 'lockTarget' | 'switchTarget' | 'hush' | 'quickItem'
  | 'abilities' | 'items' | 'journal' | 'pause'
  | 'uiConfirm' | 'uiBack' | 'uiUp' | 'uiDown' | 'uiLeft' | 'uiRight' | 'uiTabPrev' | 'uiTabNext' | 'uiPageUp' | 'uiPageDown';

export interface ActionInfo { id: Action; label: string; group: 'Movement' | 'Interaction' | 'Combat' | 'Menus'; rebindable: boolean; description?: string }
export const ACTIONS: ActionInfo[] = [
  { id: 'autoWalk', label: 'Walk continuously / stop', group: 'Movement', rebindable: true, description: 'Walk in the camera direction. Any movement key, menu or combat action stops it.' },
  { id: 'moveForward', label: 'Move forward', group: 'Movement', rebindable: true },
  { id: 'moveBack', label: 'Move back', group: 'Movement', rebindable: true },
  { id: 'moveLeft', label: 'Move left', group: 'Movement', rebindable: true },
  { id: 'moveRight', label: 'Move right', group: 'Movement', rebindable: true },
  { id: 'sprint', label: 'Sprint', group: 'Movement', rebindable: true },
  { id: 'crouch', label: 'Crouch', group: 'Movement', rebindable: true },
  { id: 'jump', label: 'Jump / vault', group: 'Movement', rebindable: true, description: 'Vault a low obstacle or jump a gap ahead. While fighting (locked on, guarding or under attack) it rolls instead.' },
  { id: 'interact', label: 'Interact / talk', group: 'Interaction', rebindable: true },
  { id: 'hush', label: 'Hush (calm a beast)', group: 'Interaction', rebindable: true },
  { id: 'quickItem', label: 'Quick item', group: 'Interaction', rebindable: true },
  { id: 'lightAttack', label: 'Light strike', group: 'Combat', rebindable: true },
  { id: 'heavyAttack', label: 'Heavy strike', group: 'Combat', rebindable: true },
  { id: 'guard', label: 'Guard / timed parry', group: 'Combat', rebindable: true },
  { id: 'dodge', label: 'Dodge (with a direction)', group: 'Combat', rebindable: true },
  { id: 'focus', label: 'Focus', group: 'Combat', rebindable: true },
  { id: 'lockTarget', label: 'Lock target', group: 'Combat', rebindable: true },
  { id: 'switchTarget', label: 'Switch target', group: 'Combat', rebindable: true },
  { id: 'abilities', label: 'Abilities', group: 'Menus', rebindable: true },
  { id: 'items', label: 'Items', group: 'Menus', rebindable: true },
  { id: 'journal', label: 'Journal', group: 'Menus', rebindable: true },
  { id: 'pause', label: 'Pause', group: 'Menus', rebindable: false },
];

export type Device = 'keyboard' | 'xbox' | 'playstation';
type Map3 = Partial<Record<Action, string[]>>;
export const DEFAULT_KEYBOARD: Map3 = {
  moveForward: ['KeyW', 'ArrowUp'], moveBack: ['KeyS', 'ArrowDown'], moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'],
  autoWalk: ['NumLock', 'KeyV'],
  interact: ['KeyE'], lightAttack: ['Mouse0', 'KeyH'], heavyAttack: ['Mouse3', 'KeyG'], guard: ['Mouse2', 'KeyB'], dodge: ['AltLeft'], jump: ['Space'], focus: ['Mouse4', 'KeyZ'],
  lockTarget: ['KeyF', 'Mouse1'], switchTarget: ['KeyT'], hush: ['KeyQ'], quickItem: ['KeyR'],
  abilities: ['Tab'], items: ['KeyI'], journal: ['KeyJ'], pause: ['Escape'],
  uiConfirm: ['Enter', 'Space'], uiBack: ['Escape', 'Backspace'], uiUp: ['ArrowUp', 'KeyW'], uiDown: ['ArrowDown', 'KeyS'], uiLeft: ['ArrowLeft', 'KeyA'], uiRight: ['ArrowRight', 'KeyD'],
  uiTabPrev: ['KeyQ', 'BracketLeft'], uiTabNext: ['KeyE', 'BracketRight'], uiPageUp: ['PageUp'], uiPageDown: ['PageDown'],
};
/** Standard Gamepad indices: 0 A/Cross, 1 B/Circle, 2 X/Square, 3 Y/Triangle, 4 LB/L1, 5 RB/R1, 6 LT/L2, 7 RT/R2, 8 View/Create, 9 Menu/Options, 10 L3, 11 R3, 12-15 D-pad up/down/left/right, 17 touchpad. */
export const DEFAULT_PAD: Map3 = {
  sprint: ['Pad10'], crouch: [], jump: ['Pad1'], interact: ['Pad0'], lightAttack: ['Pad2'], heavyAttack: ['Pad3'], guard: ['Pad4'], dodge: ['Pad1'], focus: ['Pad6'],
  lockTarget: ['Pad11'], switchTarget: ['Pad15'], hush: ['Pad7'], quickItem: ['Pad5'], abilities: ['Pad13'], items: ['Pad14', 'Pad12'], journal: ['Pad8', 'Pad17'], pause: ['Pad9'],
  uiConfirm: ['Pad0'], uiBack: ['Pad1'], uiUp: ['Pad12'], uiDown: ['Pad13'], uiLeft: ['Pad14'], uiRight: ['Pad15'], uiTabPrev: ['Pad4'], uiTabNext: ['Pad5'], uiPageUp: ['Pad6'], uiPageDown: ['Pad7'],
};

export interface Settings {
  mouseSensitivity: number;          // radians per pixel * 1000
  padSensitivityX: number; padSensitivityY: number;   // radians per second at full deflection
  invertY: boolean; padInvertY: boolean;
  moveDeadZone: number; lookDeadZone: number;
  vibration: boolean;
  sprintToggle: boolean; focusToggle: boolean; guardToggle: boolean;
  viewMode: 'third-person' | 'isometric' | 'orbit';
  fov: number;
  cameraShake: number;              // 0..1 scale on hit shake
  reducedMotion: boolean;
  quality: 'auto' | 'high' | 'balanced' | 'low';
  resolutionScale: number;
  masterVolume: number; musicVolume: number; effectsVolume: number; ambienceVolume: number; voiceVolume: number;
  uiScale: number;                  // 0.85 .. 1.4
  textSize: 'normal' | 'large';
  highContrast: boolean;
  subtitles: boolean;
  showHints: boolean;
  captureMouse: boolean;
  colorAssist: 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  keyboard: Map3; pad: Map3;
}
export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 2.2, padSensitivityX: 3.2, padSensitivityY: 2.2, invertY: false, padInvertY: false, moveDeadZone: 0.16, lookDeadZone: 0.12, vibration: true,
  viewMode: 'third-person', sprintToggle: false, focusToggle: false, guardToggle: false, fov: 62, cameraShake: 1, reducedMotion: false, quality: 'auto', resolutionScale: 1,
  masterVolume: 0.8, musicVolume: 0.6, effectsVolume: 0.9, ambienceVolume: 0.8, voiceVolume: 0.9, uiScale: 1, textSize: 'normal', highContrast: false, subtitles: true, showHints: true, colorAssist: 'off',
  keyboard: {}, pad: {}, captureMouse: true,
};

const KEY = 'torn-veil-web.settings.v1';
/** Accepted range for each numeric setting; anything outside (or not a number) falls back to the default. */
const RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  mouseSensitivity: [0.2, 12], padSensitivityX: [0.5, 10], padSensitivityY: [0.5, 10], moveDeadZone: [0, 0.6], lookDeadZone: [0, 0.6], fov: [40, 100], cameraShake: [0, 1], resolutionScale: [0.5, 1],
  masterVolume: [0, 1], musicVolume: [0, 1], effectsVolume: [0, 1], ambienceVolume: [0, 1], voiceVolume: [0, 1], uiScale: [0.85, 1.4],
};
const BOOLS: (keyof Settings)[] = ['invertY', 'padInvertY', 'vibration', 'sprintToggle', 'focusToggle', 'guardToggle', 'reducedMotion', 'highContrast', 'subtitles', 'showHints', 'captureMouse'];
const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = { viewMode: ['third-person', 'isometric', 'orbit'], quality: ['auto', 'high', 'balanced', 'low'], textSize: ['normal', 'large'], colorAssist: ['off', 'protanopia', 'deuteranopia', 'tritanopia'] };
const validCode = (c: unknown): c is string => typeof c === 'string' && /^(Key[A-Z]|Digit\d|Mouse[0-4]|Pad\d{1,2}|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Tab|Enter|Escape|Backspace|Bracket(Left|Right)|Page(Up|Down)|F\d{1,2})$/.test(c);
function sanitizeMap(m: unknown): Map3 {
  const out: Map3 = {}; if (!m || typeof m !== 'object') return out;
  for (const a of ACTIONS) {
    const v = (m as Record<string, unknown>)[a.id];
    if (!Array.isArray(v) || !a.rebindable) continue;
    const codes = v.filter(validCode).slice(0, 4);
    if (codes.length || v.length === 0) out[a.id] = codes;   // an empty list is a deliberate unbind; a list of garbage keeps the default
  }
  return out;
}
/** Settings live in browser storage that anyone (or a bug, or an old version) can leave in any state: only well-formed values survive. */
export function sanitizeSettings(parsed: unknown): Settings {
  const base = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') return base as unknown as Settings;
  const p = parsed as Record<string, unknown>;
  for (const [k, [lo, hi]] of Object.entries(RANGES) as [string, [number, number]][]) { const v = p[k]; if (typeof v === 'number' && Number.isFinite(v)) base[k] = Math.min(hi, Math.max(lo, v)); }
  for (const k of BOOLS) if (typeof p[k] === 'boolean') base[k] = p[k];
  for (const [k, allowed] of Object.entries(ENUMS) as [string, readonly string[]][]) if (typeof p[k] === 'string' && allowed.includes(p[k] as string)) base[k] = p[k];
  base.keyboard = sanitizeMap(p.keyboard); base.pad = sanitizeMap(p.pad);
  return base as unknown as Settings;
}
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return sanitizeSettings(JSON.parse(raw));
  } catch { return structuredClone(DEFAULT_SETTINGS); }
}
export function saveSettings(s: Settings): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: settings last for the session */ } }

export function bindingsFor(s: Settings, device: 'keyboard' | 'pad', action: Action): string[] {
  return (device === 'keyboard' ? s.keyboard[action] ?? DEFAULT_KEYBOARD[action] : s.pad[action] ?? DEFAULT_PAD[action]) ?? [];
}

/** Friendly names for prompts, by device family. */
export function codeLabel(code: string, device: Device): string {
  if (code.startsWith('Pad')) {
    const i = Number(code.slice(3));
    const xbox = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', 'Guide', 'Share'];
    const ps = ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', 'PS', 'Touchpad'];
    return (device === 'playstation' ? ps : xbox)[i] ?? `Button ${i}`;
  }
  if (code.startsWith('Mouse')) return ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'][Number(code.slice(5))] ?? code;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = { ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', PageUp: 'PgUp', PageDown: 'PgDn', BracketLeft: '[', BracketRight: ']' };
  return names[code] ?? code;
}
