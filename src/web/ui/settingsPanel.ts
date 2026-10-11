import { h } from './dom';
import type { TabDef } from './modal';
import { ACTIONS, DEFAULT_KEYBOARD, DEFAULT_PAD, bindingsFor, codeLabel, type Action, type Settings } from '../game/bindings';
import type { InputManager } from '../game/input';

/**
 * Settings and rebinding. Every control writes through `update`, which persists and applies
 * immediately (the caller owns what "apply" means: camera, quality, audio). Rebinding follows the
 * Unreal client's rule: pick an action, press its new key or button; a conflicting gameplay binding
 * on the same device swaps with the previous one, the other device's bindings are untouched, and
 * Escape (menus) is reserved.
 */
export interface SettingsServices {
  get(): Settings;
  update(patch: Partial<Settings>): void;
  input: InputManager;
  rendererName(): string;
  reset(): void;
}

const slider = (svc: SettingsServices, label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string = v => v.toFixed(2)) => {
  const value = svc.get()[key] as number, out = h('output', { text: fmt(value) });
  const input = h('input', { class: 'tv-range', type: 'range', min, max, step, value, 'data-fk': `s:${String(key)}`, aria: { label } });
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); svc.update({ [key]: v } as Partial<Settings>); });
  return h('div', { class: 'tv-setting' }, h('label', { text: label }), input, out);
};
const toggle = (svc: SettingsServices, label: string, key: keyof Settings, hint?: string) => {
  const input = h('input', { class: 'tv-check', type: 'checkbox', checked: !!svc.get()[key], 'data-fk': `s:${String(key)}`, aria: { label } });
  input.addEventListener('change', () => svc.update({ [key]: input.checked } as Partial<Settings>));
  return h('div', { class: 'tv-setting' }, h('label', null, label, hint ? h('small', { class: 'tv-muted', style: 'display:block', text: hint }) : null), h('span'), input);
};
const select = (svc: SettingsServices, label: string, key: keyof Settings, options: [string, string][]) => {
  const sel = h('select', { class: 'tv-input tv-select', 'data-fk': `s:${String(key)}`, aria: { label } }, ...options.map(([v, l]) => h('option', { value: v, text: l, ...(String(svc.get()[key]) === v ? { selected: 'selected' } : {}) })));
  sel.addEventListener('change', () => svc.update({ [key]: sel.value } as unknown as Partial<Settings>));
  return h('div', { class: 'tv-setting' }, h('label', { text: label }), sel, h('span'));
};

export function settingsTabs(svc: SettingsServices, rerender: () => void): TabDef[] {
  return [
    {
      id: 'dialogue', label: 'Dialogue', render(body) {
        body.append(h('h2', { class: 'tv-h2' }, 'Conversation'), h('p', { class: 'tv-sub' }, 'Your words can ask questions or share an account. Purchases, lessons and other commitments use the conversation choices.'));
      },
    },
    {
      id: 'controls', label: 'Controls', render(body) {
        const device: 'keyboard' | 'pad' = svc.input.device === 'keyboard' ? 'keyboard' : 'pad';
        const dev = svc.input.device;
        body.append(h('p', { class: 'tv-sub', text: `Showing ${device === 'keyboard' ? 'keyboard and mouse' : 'gamepad'} bindings. Select an action, then press its new ${device === 'keyboard' ? 'key or mouse button' : 'button'}. Escape cancels.` }));
        const grid = h('div', { class: 'tv-rebind' });
        let group = '';
        for (const a of ACTIONS) {
          if (a.group !== group) { group = a.group; grid.append(h('div', { class: 'grp tv-h2', text: group })); }
          const codes = bindingsFor(svc.get(), device, a.id);
          const label = codes.length ? codes.map(c => codeLabel(c, dev)).join(' / ') : 'Unbound';
          const btn = h('button', { class: 'tv-btn', type: 'button', disabled: !a.rebindable, 'data-fk': `rb:${a.id}`, on: { click: () => startCapture(a.id, device, btn) } }, label);
          grid.append(h('div', { text: a.label }), btn, h('span'));
        }
        body.append(grid, h('div', { style: 'margin-top:1rem;display:flex;gap:.6rem' }, h('button', { class: 'tv-btn', type: 'button', on: { click: () => { svc.update({ [device]: {} } as Partial<Settings>); rerender(); } } }, 'Restore defaults for this device')));
        function startCapture(action: Action, dv: 'keyboard' | 'pad', btn: HTMLElement) {
          btn.textContent = dv === 'keyboard' ? 'Press a key…' : 'Press a button…';
          const onEsc = (e: KeyboardEvent) => { if (e.code === 'Escape') { window.removeEventListener('keydown', onEsc, true); svc.input.cancelCapture(); rerender(); } };
          window.addEventListener('keydown', onEsc, true);
          svc.input.captureNext(code => {
            window.removeEventListener('keydown', onEsc, true);
            if (code === 'Escape' || (dv === 'keyboard') !== !code.startsWith('Pad')) { rerender(); return; }
            const s = svc.get(), map = { ...(dv === 'keyboard' ? DEFAULT_KEYBOARD : DEFAULT_PAD), ...(dv === 'keyboard' ? s.keyboard : s.pad) };
            const previous = map[action] ?? [];
            // A conflicting gameplay binding swaps with what this action had.
            for (const other of ACTIONS) { if (other.id === action || !other.rebindable) continue; const list = map[other.id] ?? []; if (list.includes(code)) map[other.id] = previous.length ? [...list.filter(c => c !== code), previous[0]] : list.filter(c => c !== code); }
            map[action] = [code];
            svc.update({ [dv]: map } as Partial<Settings>); rerender();
          });
        }
      },
    },
    {
      id: 'input', label: 'Input', render(body) {
        body.append(h('h2', { class: 'tv-h2', text: 'Mouse and camera' }),
          select(svc, 'View', 'viewMode', [['third-person', 'Third person'], ['isometric', 'Isometric'], ['orbit', 'Elevated exploration']]),
          toggle(svc, 'Capture mouse for camera', 'captureMouse', 'Turn off to look with middle-button drag. Left/right click still strike/guard; H/B are keyboard alternatives.'),
          slider(svc, 'Mouse sensitivity', 'mouseSensitivity', 0.5, 8, 0.1, v => v.toFixed(1)), toggle(svc, 'Invert mouse Y', 'invertY'),
          slider(svc, 'Field of view', 'fov', 50, 90, 1, v => `${Math.round(v)}°`), slider(svc, 'Camera shake', 'cameraShake', 0, 1, 0.05, v => `${Math.round(v * 100)}%`),
          h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'Gamepad' }),
          slider(svc, 'Look speed — horizontal', 'padSensitivityX', 0.8, 7, 0.1, v => v.toFixed(1)), slider(svc, 'Look speed — vertical', 'padSensitivityY', 0.8, 7, 0.1, v => v.toFixed(1)),
          toggle(svc, 'Invert gamepad Y', 'padInvertY'), slider(svc, 'Movement dead zone', 'moveDeadZone', 0.02, 0.4, 0.01, v => v.toFixed(2)), slider(svc, 'Look dead zone', 'lookDeadZone', 0.02, 0.4, 0.01, v => v.toFixed(2)), toggle(svc, 'Vibration', 'vibration'),
          h('h2', { class: 'tv-h2', style: 'margin-top:1rem', text: 'Hold or toggle' }),
          toggle(svc, 'Sprint is a toggle', 'sprintToggle'), toggle(svc, 'Focus is a toggle', 'focusToggle'), toggle(svc, 'Guard is a toggle', 'guardToggle'));
      },
    },
    {
      id: 'video', label: 'Video', render(body) {
        body.append(select(svc, 'Quality', 'quality', [['auto', 'Automatic'], ['high', 'High'], ['balanced', 'Balanced'], ['low', 'Low (reduced effects)']]),
          slider(svc, 'Render scale', 'resolutionScale', 0.5, 1.25, 0.05, v => `${Math.round(v * 100)}%`),
          h('p', { class: 'tv-sub', text: `Renderer: ${svc.rendererName()}` }));
      },
    },
    {
      id: 'audio', label: 'Audio', render(body) {
        body.append(slider(svc, 'Master', 'masterVolume', 0, 1, 0.05, v => `${Math.round(v * 100)}%`), slider(svc, 'Music', 'musicVolume', 0, 1, 0.05, v => `${Math.round(v * 100)}%`),
          slider(svc, 'Effects', 'effectsVolume', 0, 1, 0.05, v => `${Math.round(v * 100)}%`), slider(svc, 'Ambience', 'ambienceVolume', 0, 1, 0.05, v => `${Math.round(v * 100)}%`), slider(svc, 'Voice', 'voiceVolume', 0, 1, 0.05, v => `${Math.round(v * 100)}%`));
      },
    },
    {
      id: 'access', label: 'Accessibility', render(body) {
        body.append(slider(svc, 'Interface scale', 'uiScale', 0.85, 1.5, 0.05, v => `${Math.round(v * 100)}%`), select(svc, 'Text size', 'textSize', [['normal', 'Normal'], ['large', 'Large']]),
          toggle(svc, 'High contrast interface', 'highContrast'), toggle(svc, 'Reduced motion', 'reducedMotion', 'Removes camera shake and slows interface animation.'), toggle(svc, 'Subtitles', 'subtitles', 'Shows what people say.'), toggle(svc, 'First-steps hints', 'showHints'),
          select(svc, 'Colour assist', 'colorAssist', [['off', 'Off'], ['protanopia', 'Protanopia'], ['deuteranopia', 'Deuteranopia'], ['tritanopia', 'Tritanopia']]),
          h('div', { style: 'margin-top:1rem' }, h('button', { class: 'tv-btn danger', type: 'button', on: { click: () => { svc.reset(); rerender(); } } }, 'Reset all settings')));
      },
    },
  ];
}
