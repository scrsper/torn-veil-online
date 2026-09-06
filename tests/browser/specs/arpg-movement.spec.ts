import type { BrowserSpec } from '../run';
import { startGame, readCanonicalState } from '../helpers';

/**
 * v0.10.1 Part II — WASD in the elevated view means what the SCREEN shows, and keeps meaning it
 * when the camera turns.
 *
 * The bug this exists to catch was not subtle once you knew to look for it: `moveYaw()` returned
 * `arpg.yaw + Math.PI`, the camera's forward direction negated, so W walked away from the camera
 * and A went right — and because the error was expressed in terms of the camera's own angle, it
 * rotated along with it and stayed wrong from every viewpoint. A test that only checked "W moves
 * the player" would have passed throughout.
 *
 * So this measures the movement against the camera's ACTUAL view direction, read from the live
 * camera matrix rather than recomputed from the yaw the controller used — otherwise the test
 * would just be restating the implementation. Displacement is projected onto the camera's own
 * ground-plane forward and right axes, and each key must move the player predominantly along the
 * axis a player would expect from what they can see.
 */
const KEYS = [
  { key: 'KeyW', label: 'W', axis: 'forward' as const, sign: +1 },
  { key: 'KeyS', label: 'S', axis: 'forward' as const, sign: -1 },
  { key: 'KeyD', label: 'D', axis: 'right' as const, sign: +1 },
  { key: 'KeyA', label: 'A', axis: 'right' as const, sign: -1 },
];

/**
 * Somewhere genuinely flat and open, so that a wall, a step or the well in the middle of the
 * square cannot deflect the measurement and make a correct direction look wrong. Found once and
 * reused: every tile within four blocks must be walkable and at the same height.
 */
let openGround: { x: number; y: number; z: number } | null = null;
async function findOpenGround(page: import('playwright').Page): Promise<{ x: number; y: number; z: number }> {
  if (openGround) return openGround;
  openGround = await page.evaluate(() => {
    const w = (window as any).game.world;
    const nav = w.nav;
    const sq = w.places().find((p: any) => p.type === 'square');
    const cx = Math.floor(sq.inside.x), cz = Math.floor(sq.inside.z);
    for (let r = 0; r < 40; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz, y = nav.floorY(x, z);
        if (y < 0) continue;
        let clear = true;
        for (let ax = -4; ax <= 4 && clear; ax++) for (let az = -4; az <= 4 && clear; az++) {
          if (!nav.isWalkable(x + ax, z + az) || nav.floorY(x + ax, z + az) !== y) clear = false;
          // and nothing solid standing in the space a person occupies
          for (let ay = 0; ay < 2 && clear; ay++) if (w.grid.isSolidAt(x + ax, y + ay, z + az)) clear = false;
        }
        if (clear) return { x: x + 0.5, y, z: z + 0.5 };
      }
    }
    return null;
  }) as { x: number; y: number; z: number };
  if (!openGround) throw new Error('found nowhere flat and open enough to measure movement in');
  return openGround;
}

async function placeOnOpenGround(page: import('playwright').Page): Promise<void> {
  const spot = await findOpenGround(page);
  await page.evaluate((p) => { const g = (window as any).game; g.ctrl.teleport(p); g.ctrl.vel.set(0, 0, 0); }, spot);
  await page.waitForTimeout(60);
}

/**
 * Hold a real key and run the real controller for `steps` fixed 50 ms ticks.
 *
 * The key press is genuine — `PlayerController`'s own window listener puts it in `keys`, and
 * `update()` is the same method the frame loop calls with the same clamped dt. Only the CLOCK is
 * supplied by the test. That is necessary rather than convenient: this harness renders a 192³
 * voxel world through software GL, which in practice yields about five animation frames a
 * second, so a key held for half a second of wall time produces two frames of movement and a
 * measurement dominated by acceleration. Waiting seconds per key instead would make the same
 * assertion take a minute and still depend on the host's frame rate.
 */
async function holdAndStep(page: import('playwright').Page, key: string, steps = 20): Promise<void> {
  await page.keyboard.down(key);
  await page.evaluate((n) => { const g = (window as any).game; for (let i = 0; i < n; i++) g.ctrl.update(0.05); }, steps);
  await page.keyboard.up(key);
  await page.waitForTimeout(30);
}

export const arpgMovement: BrowserSpec = {
  name: 'elevated-view movement is relative to the camera, and follows it when it turns',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);

    const booted = await readCanonicalState(page, () => (window as any).game.ctrl.mode);
    if (booted !== 'arpg') throw new Error(`the game should boot into the elevated view, not '${booted}'`);

    // Three camera orientations, including two that are not axis-aligned, so a fixed-world-axis
    // implementation cannot accidentally agree with a camera-relative one.
    for (const yaw of [Math.PI * 0.25, Math.PI * 0.9, -Math.PI * 0.4]) {
      await page.evaluate((y) => { (window as any).game.ctrl.arpg.yaw = y; }, yaw);
      await page.waitForTimeout(120);

      for (const k of KEYS) {
        await placeOnOpenGround(page);

        // The camera's true forward/right across the ground, from the rendered matrix.
        const basis = await readCanonicalState(page, () => {
          const cam = (window as any).game.camera;
          cam.updateMatrixWorld();
          const e = cam.matrixWorld.elements;
          // three.js camera looks down its own -Z; columns 0 and 2 of matrixWorld are right and back.
          const fwd = { x: -e[8], z: -e[10] };
          const right = { x: e[0], z: e[2] };
          const fl = Math.hypot(fwd.x, fwd.z) || 1, rl = Math.hypot(right.x, right.z) || 1;
          return { fwd: { x: fwd.x / fl, z: fwd.z / fl }, right: { x: right.x / rl, z: right.z / rl } };
        });

        const before = await readCanonicalState(page, () => {
          const b = (window as any).game.ctrl.body; return { x: b.pos.x, z: b.pos.z };
        });
        await holdAndStep(page, k.key);
        const after = await readCanonicalState(page, () => {
          const b = (window as any).game.ctrl.body; return { x: b.pos.x, z: b.pos.z };
        });

        const dx = after.x - before.x, dz = after.z - before.z;
        const travelled = Math.hypot(dx, dz);
        if (travelled < 1) throw new Error(`${k.label} at camera yaw ${yaw.toFixed(2)} barely moved the player (${travelled.toFixed(2)} blocks)`);

        const alongForward = dx * basis.fwd.x + dz * basis.fwd.z;
        const alongRight = dx * basis.right.x + dz * basis.right.z;
        const wanted = k.axis === 'forward' ? alongForward * k.sign : alongRight * k.sign;
        const other = k.axis === 'forward' ? alongRight : alongForward;
        const detail = `yaw ${yaw.toFixed(2)}: moved ${travelled.toFixed(2)} blocks, ${alongForward.toFixed(2)} along the camera's forward, ${alongRight.toFixed(2)} along its right`;
        // The expected component must dominate: positive, and the larger of the two.
        if (wanted <= 0) throw new Error(`${k.label} moved the player the WRONG way on screen — ${detail}`);
        if (Math.abs(other) > Math.abs(wanted)) throw new Error(`${k.label} moved the player sideways rather than where the key points — ${detail}`);
      }
    }

    // Turning the camera must turn the movement basis with it: the same key, two orientations,
    // must produce two genuinely different world directions.
    const worldDirFor = async (yaw: number): Promise<{ x: number; z: number }> => {
      await page.evaluate((y) => { (window as any).game.ctrl.arpg.yaw = y; }, yaw);
      await placeOnOpenGround(page);
      const before = await readCanonicalState(page, () => { const b = (window as any).game.ctrl.body; return { x: b.pos.x, z: b.pos.z }; });
      await holdAndStep(page, 'KeyW');
      const after = await readCanonicalState(page, () => { const b = (window as any).game.ctrl.body; return { x: b.pos.x, z: b.pos.z }; });
      const dx = after.x - before.x, dz = after.z - before.z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: dx / len, z: dz / len };
    };
    const north = await worldDirFor(0);
    const east = await worldDirFor(Math.PI / 2);
    const agreement = north.x * east.x + north.z * east.z;
    if (agreement > 0.4) throw new Error(`turning the camera 90° did not turn the movement basis with it (W went the same way both times, dot ${agreement.toFixed(2)})`);
  },
};
