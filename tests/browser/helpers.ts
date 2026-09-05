import type { Page } from 'playwright';

/**
 * v0.8 §10 "Reusable browser functional harness": thin, reusable helpers around the REAL game
 * client (the same `index.html`/`main.ts` a human plays) — no disposable one-off scripts. Every
 * helper either drives the actual UI (mouse/keyboard, DOM reads) the way a player would, or, for
 * setup/introspection where AGENTS.md explicitly endorses it, reads `window.game` directly. A
 * helper that reads canonical state (`readCanonicalState`) is for ASSERTING on truth, never for
 * bypassing the UI action a test is meant to exercise — e.g. `harvest()` still clicks/presses the
 * real interact key; only the verification step reads `CropPlot.state` directly.
 */

/** Navigate to the app and start a fresh, deterministic village at `seed` (bypassing any
 * existing save — see main.ts's `requestedSeed()`). Waits until `window.game` exists and the
 * player's body is present in the world, i.e. the frame loop has started. */
export async function startGame(page: Page, seed: number, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/?seed=${seed}`);
  await page.click('#btn-new');
  await page.waitForFunction(() => !!(window as any).game?.world?.playerId, undefined, { timeout: 20_000 });
}

/** Advance simulated time without waiting on real wall-clock frames — `Game.stepSim`, the exact
 * same deterministic sub-stepping the headless runner and tests use, just invoked in-browser.
 * `sub` (world-seconds per physics step, like the headless runner's own `stepSeconds`) defaults
 * coarser than the render-frame default (0.05s) since a test fast-forwarding hours of village
 * life cares about throughput, not frame-smooth motion. */
export async function advanceWorld(page: Page, seconds: number, sub = 1): Promise<void> {
  await page.evaluate((args: { seconds: number; sub: number }) => (window as any).game.stepSim(args.seconds, args.sub), { seconds, sub });
}

/** Read arbitrary canonical state from the live `window.game` for assertions. The function runs
 * INSIDE the page (Playwright ships its source, not a Node closure) — grab `(window as any).game`
 * yourself at the top, e.g. `readCanonicalState(page, () => (window as any).game.world.person(id).wealth)`. */
export async function readCanonicalState<T>(page: Page, fn: () => T): Promise<T> {
  return page.evaluate(fn);
}

export interface PersonSummary { id: string; name: string; occupation: string; alive: boolean; pos: { x: number; y: number; z: number } | null; }

/** Find a person by exact or partial name match (case-insensitive). Throws if none found. */
export async function findPerson(page: Page, nameMatch: string): Promise<PersonSummary> {
  const result = await page.evaluate((needle) => {
    const w = (window as any).game.world;
    const p = w.persons().find((p: any) => p.name.toLowerCase().includes(needle.toLowerCase()));
    if (!p) return null;
    const body = w.primaryBody(p.id);
    return { id: p.id, name: p.name, occupation: p.occupation, alive: p.alive, pos: body ? { x: body.pos.x, y: body.pos.y, z: body.pos.z } : null };
  }, nameMatch);
  if (!result) throw new Error(`No person matching "${nameMatch}" found`);
  return result;
}

/** Teleport the player next to a position and face it — the harness's equivalent of "walk over
 * there," without needing to simulate realistic pathing through keyboard input for setup. Real
 * gameplay actions (interact/attack/dialogue) still go through the actual UI once positioned. */
export async function movePlayerTo(page: Page, pos: { x: number; y: number; z: number }, standoff = 1.5): Promise<void> {
  await page.evaluate(({ pos, standoff }) => {
    const game = (window as any).game;
    const ctrl = game.ctrl;
    const dest = { x: pos.x - standoff, y: pos.y, z: pos.z };
    ctrl.teleport(dest);
    ctrl.yaw = Math.atan2(-(pos.x - dest.x), -(pos.z - dest.z));
  }, { pos, standoff });
}

/** Point the player's camera exactly at a world position (yaw AND pitch) from wherever they
 * currently stand — used so the real crosshair-raycast targeting in `Interaction.update()` (the
 * same targeting the HUD/interact key use) reliably lands on a specific block/entity without
 * needing to simulate realistic mouse-look. The subsequent `interact()`/`attack()` still goes
 * through the real interaction code path; only the AIMING is set directly, exactly the kind of
 * setup shortcut AGENTS.md endorses using `window.game` for. */
export async function lookAt(page: Page, pos: { x: number; y: number; z: number }): Promise<void> {
  await page.evaluate((pos) => {
    const ctrl = (window as any).game.ctrl;
    const eye = ctrl.eye();
    const dx = pos.x - eye.x, dy = pos.y - eye.y, dz = pos.z - eye.z;
    ctrl.yaw = Math.atan2(-dx, -dz);
    ctrl.pitch = Math.max(-1.5, Math.min(1.5, Math.atan2(dy, Math.hypot(dx, dz))));
  }, pos);
}

/** Walk the player using real WASD input for `ms` milliseconds — for tests that specifically
 * want to exercise the actual movement/collision path rather than teleporting. */
export async function walk(page: Page, direction: 'forward' | 'backward' | 'left' | 'right', ms: number): Promise<void> {
  const key = { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD' }[direction];
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

export interface TargetSummary { kind: 'body' | 'item' | 'block' | null; name: string | null; dist: number | null; }

/** What the player's crosshair currently targets — mirrors `Interaction.target`, the same state
 * the HUD's target panel reads. Requires the mouse to have been positioned via `lookAt` or the
 * player to be facing the target already (this harness does not simulate mouse movement for
 * aiming; tests position the player with `movePlayerTo` + an explicit yaw instead). */
export async function currentTarget(page: Page): Promise<TargetSummary> {
  return page.evaluate(() => {
    const t = (window as any).game.inter.target;
    if (!t) return { kind: null, name: null, dist: null };
    const w = (window as any).game.world;
    const name = t.kind === 'body' ? (t.person?.name ?? w.nameOf(t.body.ownerId)) : t.kind === 'item' ? t.item.name : t.name;
    return { kind: t.kind, name, dist: t.dist };
  });
}

/** Press the real interact key (E) — routes through `Interaction.interact()`, the exact code
 * path a player uses for talk/pickup/harvest/sow/doors/etc. */
export async function interact(page: Page): Promise<void> {
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(50);
}

/** Read the HUD's current on-screen text: top status line, target panel, inventory line, and any
 * queued messages — real rendered DOM, not canonical state. */
export interface HUDSnapshot { time: string; sub: string; target: string; inventory: string; messages: string[]; }
export async function readHUD(page: Page): Promise<HUDSnapshot> {
  // Note: deliberately no local named helper function in this closure (e.g. `const $ = (s) =>
  // document.querySelector(s)`) — under this project's tsx/esbuild transpilation, a named local
  // function assignment inside a page.evaluate callback gets wrapped in an esbuild `__name(...)`
  // helper call that only exists in the surrounding Node module, not in the isolated browser
  // evaluation scope, and throws `ReferenceError: __name is not defined` at runtime. Inlining
  // `document.querySelector` calls avoids the transform entirely.
  return page.evaluate(() => ({
    time: document.querySelector('#topbar .time')?.textContent ?? '',
    sub: document.querySelector('#topbar .sub')?.textContent ?? '',
    target: document.querySelector('#target')?.textContent ?? '',
    inventory: document.querySelector('#inv')?.textContent ?? '',
    messages: Array.from(document.querySelectorAll('#messages > div')).map(d => d.textContent ?? ''),
  }));
}

export interface DialogueSnapshot { open: boolean; speaker: string; lines: string[]; options: string[]; }

/** Open dialogue with a person by id — same `Game.openDialogue` a real "talk" interaction
 * triggers (requires the player be close enough for `interact()`/talk to have worked; tests that
 * need dialogue open regardless of distance call this directly, which is the harness's one
 * "setup shortcut" for dialogue-focused specs that aren't testing proximity itself). */
export async function openDialogueWith(page: Page, personId: string): Promise<void> {
  await page.evaluate((id) => {
    const game = (window as any).game;
    game.openDialogue(game.world.person(id));
  }, personId);
  await page.waitForSelector('#dialogue[style*="display: block"]', { timeout: 5000 });
}

/** Read the currently open dialogue panel's text + option labels from the real DOM (see
 * `game/ui/dialogue.ts`'s `render()`: `.who` is the speaker line, `.lines p` the spoken text,
 * `.opts .opt` each numbered option button). */
export async function readDialogue(page: Page): Promise<DialogueSnapshot> {
  return page.evaluate(() => {
    const panel = document.getElementById('dialogue');
    const open = !!panel && panel.style.display === 'block';
    const speaker = panel?.querySelector('.who')?.textContent ?? '';
    const lines = Array.from(panel?.querySelectorAll('.lines p') ?? []).map(el => el.textContent ?? '');
    const options = Array.from(panel?.querySelectorAll('.opts .opt') ?? []).map(el => el.textContent ?? '');
    return { open, speaker, lines, options };
  });
}

/** Click a dialogue option by its (exact or substring) label text. */
export async function chooseDialogueOption(page: Page, labelMatch: string): Promise<void> {
  const options = page.locator('#dialogue .opts .opt');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const text = await options.nth(i).textContent();
    if (text && text.includes(labelMatch)) { await options.nth(i).click(); return; }
  }
  throw new Error(`No dialogue option matching "${labelMatch}" (available: ${(await options.allTextContents()).join(' | ')})`);
}

/** Open the Simulation Inspector (F3) on a specific person and read its rendered explanation —
 * the real debugging panel a developer/player uses, not a re-derivation of its logic. Defaults
 * to the 'mind' tab (goal/plan/utility candidates — exactly "why is this person doing what
 * they're doing"), matching the Inspector's own default. */
export async function inspect(page: Page, personId: string): Promise<string> {
  await page.evaluate((id) => {
    const game = (window as any).game;
    game.inspector.toggle(true);
    game.inspector.select(id);
  }, personId);
  await page.waitForTimeout(50);
  return page.evaluate(() => document.querySelector('#inspector .body')?.textContent ?? '');
}

/** Save a screenshot for debugging/evidence — never the primary assertion mechanism, just a
 * breadcrumb for a human reviewing a failure. */
export async function captureEvidence(page: Page, outPath: string): Promise<void> {
  await page.screenshot({ path: outPath });
}
