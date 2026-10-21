/** On-screen title, controls hint and loading line for the town page. */
export function mountHud(lite: boolean) {
  const root = document.getElementById('hud') ?? document.body;
  root.innerHTML = `
    <div class="title"><b>Cinderveil</b><span>starting town</span></div>
    <div class="hint" id="hint">
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp; <kbd>Shift</kbd> run</div>
      <div><kbd>Click</kbd> ground to walk there</div>
      <div><kbd>Drag</kbd> orbit (left or right) &nbsp; <kbd>Wheel</kbd> zoom</div>
      <div><kbd>Q</kbd><kbd>E</kbd> turn camera &nbsp; <kbd>L</kbd> mouse-look &nbsp; <kbd>H</kbd> hide</div>
      <div class="opts">${lite ? 'lite mode · <a href="?">full</a>' : '<a href="?lite">lite mode</a>'} · <a href="?time=dusk${lite ? '&lite' : ''}">dusk</a> · <a href="?time=golden${lite ? '&lite' : ''}">golden hour</a></div>
    </div>
    <div class="loading" id="loading">Loading…</div>`;
  const hint = root.querySelector<HTMLElement>('#hint')!, loading = root.querySelector<HTMLElement>('#loading')!;
  return {
    loading(text: string) { loading.textContent = text; },
    ready(status: Record<string, string>) {
      const missing = Object.entries(status).filter(([, v]) => v !== 'glb').map(([k]) => k);
      loading.textContent = missing.length ? `Some library models fell back to stand-ins: ${missing.join(', ')}` : '';
      if (!missing.length) loading.style.display = 'none';
    },
    toggle() { hint.style.display = hint.style.display === 'none' ? '' : 'none'; },
  };
}
