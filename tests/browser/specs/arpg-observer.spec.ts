import type { BrowserSpec } from '../run';
import { startGame, advanceWorld, readCanonicalState, readHUD, captureEvidence } from '../helpers';
import { join } from 'node:path';

const ART = join(import.meta.dirname, '..', 'artifacts');

/**
 * v0.10 Part VIII: the elevated (ARPG) presentation mode and the observer overlay, driven through
 * the REAL client — the same index.html/main.ts a human plays, the same canonical World.
 *
 * What this proves, in order: entering the mode changes the CAMERA and nothing else; several
 * actors are actually on screen; an NPC can be selected and followed without that changing what
 * they do; the overlay explains why they are doing it; the time controls in the overlay drive the
 * same speed the T key does; a persistent purpose visibly advances while being watched; and
 * ordinary player interaction still works after returning to the immersive camera.
 *
 * The last point is the one worth being strict about — an alternate camera that quietly forked
 * the interaction path would be exactly the "second game implementation" the milestone forbids.
 */
export const arpgObserver: BrowserSpec = {
  name: 'the elevated ARPG/observer mode presents the same world, and normal play still works',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);
    await advanceWorld(page, 3600 * 9, 2);

    // ---- 1. the elevated mode is where the game STARTS (v0.10.1 Part I) — no keypress needed.
    // F2 is now the way OUT of it and back, which step 9 exercises.
    const entered = await readCanonicalState(page, () => {
      const g = (window as any).game;
      return {
        mode: g.ctrl.mode,
        badge: (document.getElementById('modebadge') as HTMLElement).classList.contains('on'),
        distance: g.ctrl.arpg.distance,
        camY: g.camera.position.y,
        playerY: g.ctrl.body.pos.y,
      };
    });
    if (entered.mode !== 'arpg') throw new Error(`the game did not boot into the elevated mode (mode=${entered.mode})`);
    if (!entered.badge) throw new Error('the elevated-mode badge is not shown');
    if (entered.camY - entered.playerY < 4) throw new Error(`the camera is not elevated (camera y ${entered.camY.toFixed(1)} vs player y ${entered.playerY.toFixed(1)})`);

    // ---- 2. it shows a meaningful chunk of the village: several actors on screen at once
    const visible = await readCanonicalState(page, () => {
      const g = (window as any).game;
      const cam = g.camera; const w = g.world;
      cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const THREE = (g.scene.constructor as any);
      void THREE;
      const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
      let n = 0;
      for (const b of w.bodies()) {
        if (!b.present || b.shape !== 'humanoid') continue;
        const v = { x: b.pos.x, y: b.pos.y + 1, z: b.pos.z, w: 1 };
        const e = m.elements;
        const cx = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12];
        const cy = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
        const cw = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15];
        if (cw <= 0) continue;
        if (Math.abs(cx / cw) <= 1 && Math.abs(cy / cw) <= 1) n++;
      }
      return n;
    });
    if (visible < 2) throw new Error(`the elevated camera should frame several people at once, saw ${visible}`);

    // ---- 3. zoom and rotation are real, and bounded
    const zoomed = await page.evaluate(() => {
      const g = (window as any).game;
      const before = g.ctrl.arpg.distance;
      g.ctrl.arpg.zoom(600); const out = g.ctrl.arpg.distance;
      g.ctrl.arpg.zoom(-1200); const inn = g.ctrl.arpg.distance;
      for (let i = 0; i < 40; i++) g.ctrl.arpg.zoom(-1000);
      const floor = g.ctrl.arpg.distance;
      g.ctrl.arpg.distance = before;
      const yaw0 = g.ctrl.arpg.yaw; g.ctrl.arpg.rotate(0.8, 0.1);
      return { before, out, inn, floor, turned: g.ctrl.arpg.yaw - yaw0 };
    });
    if (!(zoomed.out > zoomed.before && zoomed.inn < zoomed.out)) throw new Error(`wheel zoom did not change the boom (${JSON.stringify(zoomed)})`);
    if (zoomed.floor < 5) throw new Error(`zoom is not bounded (floor ${zoomed.floor})`);
    if (Math.abs(zoomed.turned - 0.8) > 1e-6) throw new Error('camera rotation did not apply');

    // ---- 4. open the observer overlay and select somebody with a live purpose, structurally
    await page.keyboard.press('F6');
    await page.waitForTimeout(120);
    if (!(await page.locator('#observer.open').count())) throw new Error('F6 did not open the observer overlay');

    // Give the village enough time that somebody is carrying a purpose, then pick whoever has the
    // most pressing one. Chosen by state, never by name.
    let watched = await pickSomeoneWithAPurpose(page);
    for (let i = 0; i < 6 && !watched; i++) { await advanceWorld(page, 3600 * 4, 2); watched = await pickSomeoneWithAPurpose(page); }
    if (!watched) throw new Error('no villager formed a persistent purpose to observe');

    await page.evaluate((id) => { const g = (window as any).game; g.observer.select(id); }, watched.id);
    await page.waitForTimeout(100);

    // ---- 5. the overlay explains, in words, what they are doing and what they are trying to do
    const panel = await page.evaluate(() => document.querySelector('#observer .body')?.textContent ?? '');
    for (const needle of [watched.name, 'doing', 'purposes', 'body', 'needs']) {
      if (!panel.includes(needle)) throw new Error(`the observer summary is missing "${needle}"\n${panel.slice(0, 600)}`);
    }
    if (!panel.includes(watched.purposeText)) throw new Error(`the observer summary does not name the purpose "${watched.purposeText}"\n${panel.slice(0, 600)}`);
    await captureEvidence(page, join(ART, 'arpg-observer-selected.png'));

    // ---- 6. follow them. The camera goes with them; their behaviour does not change.
    await page.click('#observer [data-a=follow]');
    await page.waitForTimeout(80);
    const followStart = await readCanonicalState(page, () => {
      const g = (window as any).game;
      const b = g.world.primaryBody(g.observer.sel);
      return { followId: g.followId, goal: g.world.person(g.observer.sel).mind.goal?.key ?? null, pos: { x: b.pos.x, z: b.pos.z }, camX: g.camera.position.x, camZ: g.camera.position.z };
    });
    if (followStart.followId !== watched.id) throw new Error('follow did not take');
    // Watching is not touching. Toggling follow must change the CAMERA and nothing about the
    // person being watched — no goal, no plan, no position, no cognition state. (The player
    // stands still while you watch someone else, which is a control decision about the player
    // and the less interfering of the two options: WASD still reaching a body you cannot see
    // would blunder it into walls and people.)
    // Written without a named local function on purpose: `page.evaluate` serializes this
    // callback and runs it in the page, and tsx/esbuild's keepNames rewrites a function assigned
    // to a `const` into `__name(fn, "...")` — a helper that exists in the bundler's output and
    // not in the browser. Taking the snapshot twice through a loop keeps the body free of it.
    const untouched = await page.evaluate((id) => {
      const g = (window as any).game;
      const shots: string[] = [];
      for (let i = 0; i < 2; i++) {
        const p = g.world.person(id); const b = g.world.primaryBody(id);
        shots.push(JSON.stringify({ goal: p.mind.goal?.key ?? null, plan: p.mind.plan.map((a: any) => `${a.type}:${a.status}`), pos: [b.pos.x, b.pos.y, b.pos.z], pursuits: (p.mind.pursuits ?? []).map((x: any) => `${x.id}:${x.status}:${x.attempts}`), concerns: (p.mind.concerns ?? []).length }));
        if (i === 0) { g.observer.setFollow(false); g.observer.setFollow(true); }
      }
      return { before: shots[0], after: shots[1] };
    }, watched.id);
    if (untouched.before !== untouched.after) throw new Error(`observing changed the observed person\n${untouched.before}\n${untouched.after}`);

    // ---- 7. time control from the overlay drives the same clock the T key does
    await page.click('#observer [data-s="16"]');
    await page.waitForTimeout(60);
    const fast = await readCanonicalState(page, () => ({ mult: (window as any).game.speedMult, clock: (window as any).game.world.clock.speedMultiplier }));
    if (fast.mult !== 16 || fast.clock !== 16) throw new Error(`the overlay's ×16 did not drive the one clock (${JSON.stringify(fast)})`);
    await page.click('#observer [data-s="pause"]');
    await page.waitForTimeout(60);
    if (!(await readCanonicalState(page, () => (window as any).game.paused))) throw new Error("the overlay's pause did not pause");
    await page.click('#observer [data-s="1"]');
    await page.waitForTimeout(60);
    const resumed = await readCanonicalState(page, () => ({ mult: (window as any).game.speedMult, paused: (window as any).game.paused }));
    if (resumed.mult !== 1 || resumed.paused) throw new Error('returning to ×1 did not resume normal speed');

    // ---- 8. watch persistent purposes actually move on while the camera is following.
    // Transitions are counted across the village rather than demanded of one particular person:
    // whether the individual being watched happens to reach the next step of THEIR purpose in
    // any given ten hours is up to the world, and requiring it would be asserting on luck. What
    // must be true is that purposes are visibly living and ending while the observer watches.
    const before = await purposeSnapshot(page, watched.id);
    const transitionsBefore = await pursuitTransitions(page);
    await advanceWorld(page, 3600 * 10, 2);
    await page.waitForTimeout(120);
    const after = await purposeSnapshot(page, watched.id);
    const transitionsAfter = await pursuitTransitions(page);
    if (transitionsAfter <= transitionsBefore) {
      throw new Error(`no persistent-purpose transition happened anywhere in ten world hours (${transitionsBefore} -> ${transitionsAfter})`);
    }
    const watchedMoved = after.goalKeys.some(k => !before.goalKeys.includes(k))
      || after.steps.length > before.steps.length || after.resolved > before.resolved || after.attempts > before.attempts;
    // The overlay must still be explaining the person it is following, live, after all that time.
    const stillExplaining = await page.evaluate(() => document.querySelector('#observer .body')?.textContent ?? '');
    if (!stillExplaining.includes(watched.name)) throw new Error('the observer overlay stopped explaining the person it is following');
    console.log(`        (purpose transitions across the village while watching: ${transitionsAfter - transitionsBefore}; the followed person's own purpose advanced: ${watchedMoved})`);

    // The camera followed them somewhere — it is not parked where it started.
    const followEnd = await readCanonicalState(page, () => {
      const g = (window as any).game;
      const b = g.world.primaryBody(g.observer.sel);
      return { pos: { x: b.pos.x, z: b.pos.z }, camX: g.camera.position.x, camZ: g.camera.position.z, playerMoved: false };
    });
    const subjectTravelled = Math.hypot(followEnd.pos.x - followStart.pos.x, followEnd.pos.z - followStart.pos.z);
    if (subjectTravelled > 3) {
      const camTravelled = Math.hypot(followEnd.camX - followStart.camX, followEnd.camZ - followStart.camZ);
      if (camTravelled < 1) throw new Error('the followed person moved but the camera did not go with them');
    }
    await captureEvidence(page, join(ART, 'arpg-observer-following.png'));

    // ---- 9. back to normal player control, and ordinary interaction still works
    await page.evaluate(() => { const g = (window as any).game; g.observer.setFollow(false); });
    await page.keyboard.press('F2');
    await page.waitForTimeout(120);
    const back = await readCanonicalState(page, () => {
      const g = (window as any).game;
      return { mode: g.ctrl.mode, followId: g.followId, observerOpen: (document.getElementById('observer') as HTMLElement).classList.contains('open') };
    });
    if (back.mode !== 'first') throw new Error(`F2 did not return to the immersive camera (mode=${back.mode})`);
    if (back.followId) throw new Error('leaving the elevated mode left the camera following someone');
    if (back.observerOpen) throw new Error('the developer overlay outlived the mode it belongs to');

    // Ordinary embodied play: eat what we carry, through the same key and the same canonical path
    // as before the detour. This is the assertion that the alternate camera did not fork anything.
    const hungerBefore = await readCanonicalState(page, () => (window as any).game.world.person((window as any).game.world.playerId).physiology.energy);
    await page.evaluate(() => { (window as any).game.world.person((window as any).game.world.playerId).physiology.energy = 0.3; });
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(120);
    const hud = await readHUD(page);
    const ate = await readCanonicalState(page, () => (window as any).game.world.person((window as any).game.world.playerId).physiology.energy);
    if (!(ate > 0.3)) throw new Error(`eating after returning to normal play did nothing (energy ${ate}; messages ${JSON.stringify(hud.messages)})`);
    void hungerBefore;
    await captureEvidence(page, join(ART, 'arpg-observer-back-to-play.png'));
  },
};

/** Whoever currently holds the most pressing persistent purpose. Structural, never by name. */
async function pickSomeoneWithAPurpose(page: import('playwright').Page): Promise<{ id: string; name: string; purposeText: string } | null> {
  return page.evaluate(() => {
    const w = (window as any).game.world;
    let best: any = null;
    for (const p of w.persons()) {
      if (!p.alive || (p.id === w.playerId)) continue;
      for (const pu of (p.mind.pursuits ?? [])) {
        if (pu.status !== 'active') continue;
        if (!best || pu.priority > best.pu.priority) best = { p, pu };
      }
    }
    if (!best) return null;
    const who = best.pu.subjectId ? w.nameOf(best.pu.subjectId) : 'someone';
    const what = best.pu.itemId ? w.nameOf(best.pu.itemId) : 'it';
    const text = best.pu.kind === 'tend' ? `see to ${who}`
      : best.pu.kind === 'recover' ? `get ${what} back${best.pu.subjectId ? ` to ${who}` : ''}`
      : best.pu.kind === 'discharge' ? `finish the work they took on for ${who}`
      : `do right by ${who}`;
    return { id: best.p.id, name: best.p.name, purposeText: text };
  });
}

/** How many persistent-purpose transitions the world has recorded so far. `runTally` counts
 * lifetime totals of exactly this kind of low-significance event, past compaction. */
async function pursuitTransitions(page: import('playwright').Page): Promise<number> {
  return page.evaluate(() => {
    const t = (window as any).game.world.runTally;
    return (t.pursuit_formed ?? 0) + (t.pursuit_resolved ?? 0);
  });
}

async function purposeSnapshot(page: import('playwright').Page, id: string): Promise<{ goalKeys: string[]; steps: string[]; attempts: number; resolved: number }> {
  return page.evaluate((personId) => {
    const p = (window as any).game.world.person(personId);
    const list = p.mind.pursuits ?? [];
    return {
      goalKeys: list.map((x: any) => x.currentStep).filter(Boolean),
      steps: list.flatMap((x: any) => x.steps),
      attempts: list.reduce((n: number, x: any) => n + x.attempts, 0),
      resolved: list.filter((x: any) => x.status !== 'active' && x.status !== 'deferred').length,
    };
  }, id);
}
