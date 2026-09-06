import type { BrowserSpec } from '../run';
import { startGame, readCanonicalState, captureEvidence } from '../helpers';
import { join } from 'node:path';

const ART = join(import.meta.dirname, '..', 'artifacts');

/**
 * v0.10.1 Part III — entering a building takes the roof off THAT building.
 *
 * The assertion is deliberately made against the geometry actually being drawn, not against the
 * reveal box the client computed. Counting vertices inside a world-space box, across the live
 * chunk meshes, is the difference between "the client decided to reveal building A" and "the
 * player can see into building A and the house next door is still a house": v0.10's world-wide
 * clipping plane would have satisfied the former and failed the latter, which is the entire
 * reason this part of the milestone exists.
 *
 * `drawnAbove` walks `game.voxels.group`'s chunk geometries and counts vertices lying inside a
 * given footprint above a given height. It is a page-side function passed by source to
 * `page.evaluate`, so it takes everything it needs as plain arguments.
 */
export const buildingInterior: BrowserSpec = {
  name: 'entering a building reveals that building only, and leaving puts its roof back',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);

    // Two indoor buildings that are genuinely different structures, plus somewhere out in the open.
    const scene = await readCanonicalState(page, () => {
      const w = (window as any).game.world;
      const indoor = w.places().filter((p: any) => p.indoor && p.door && p.bounds.x1 > p.bounds.x0 + 1);
      const pick = (p: any) => ({ id: p.id, name: p.name, bounds: { ...p.bounds }, inside: { ...p.inside } });
      const a = indoor[0], b = indoor.find((p: any) => p.id !== a.id
        && (p.bounds.x0 > a.bounds.x1 + 2 || p.bounds.x1 + 2 < a.bounds.x0 || p.bounds.z0 > a.bounds.z1 + 2 || p.bounds.z1 + 2 < a.bounds.z0));
      const square = w.places().find((p: any) => p.type === 'square');
      return { a: pick(a), b: pick(b), outside: { x: square.inside.x + 0.5, y: w.nav.floorY(Math.floor(square.inside.x), Math.floor(square.inside.z)), z: square.inside.z + 0.5 } };
    });
    if (!scene.b) throw new Error('the village did not offer two separate indoor buildings to compare');

    // How much geometry is currently drawn inside a footprint above a height. One frame is
    // allowed to pass first so the client has acted on wherever the player now stands.
    const drawnAbove = async (box: { x0: number; x1: number; z0: number; z1: number }, y: number): Promise<number> => {
      await page.waitForTimeout(200);
      return page.evaluate((args: { box: { x0: number; x1: number; z0: number; z1: number }; y: number }) => {
        const g = (window as any).game;
        let n = 0;
        for (const mesh of g.voxels.group.children) {
          const attr = mesh.geometry?.attributes?.position;
          if (!attr) continue;
          const arr = attr.array;
          for (let i = 0; i < arr.length; i += 3) {
            const x = arr[i], vy = arr[i + 1], z = arr[i + 2];
            if (vy >= args.y && x >= args.box.x0 && x <= args.box.x1 + 1 && z >= args.box.z0 && z <= args.box.z1 + 1) n++;
          }
        }
        return n;
      }, { box, y });
    };
    const stand = async (pos: { x: number; y: number; z: number }): Promise<void> => {
      await page.evaluate((p) => { const g = (window as any).game; g.ctrl.teleport(p); g.ctrl.vel.set(0, 0, 0); }, pos);
      await page.waitForTimeout(200);
    };

    // The height each building's roof sits above: one clear of a standing person on its floor.
    const cutA = Math.floor(scene.a.inside.y) + 3;
    const cutB = Math.floor(scene.b.inside.y) + 3;

    // ---- 1. outside every building: nothing is revealed, both roofs are on
    await stand(scene.outside);
    const outside = await readCanonicalState(page, () => (window as any).game.voxels.revealed);
    if (outside) throw new Error(`standing in the open revealed a building anyway (${JSON.stringify(outside)})`);
    const roofAIntact = await drawnAbove(scene.a.bounds, cutA);
    const roofBIntact = await drawnAbove(scene.b.bounds, cutB);
    if (roofAIntact === 0) throw new Error(`${scene.a.name} has no geometry above ${cutA} even with nothing revealed — the test cannot tell a removed roof from an absent one`);
    if (roofBIntact === 0) throw new Error(`${scene.b.name} has no geometry above ${cutB} even with nothing revealed`);
    await captureEvidence(page, join(ART, 'interior-1-outside.png'));

    // ---- 2. inside A: A opens, B stays exactly as it was
    await stand({ x: scene.a.inside.x + 0.5, y: scene.a.inside.y, z: scene.a.inside.z + 0.5 });
    const inA = await readCanonicalState(page, () => (window as any).game.voxels.revealed);
    if (!inA) throw new Error(`standing inside ${scene.a.name} revealed nothing`);
    const aOpened = await drawnAbove(scene.a.bounds, cutA);
    const bWhileInA = await drawnAbove(scene.b.bounds, cutB);
    if (aOpened >= roofAIntact) throw new Error(`${scene.a.name}'s roof is still drawn from inside it (${aOpened} vertices above the cut, was ${roofAIntact})`);
    if (bWhileInA !== roofBIntact) throw new Error(`entering ${scene.a.name} changed what is drawn at ${scene.b.name} (${roofBIntact} → ${bWhileInA} vertices) — the reveal is not bounded to one building`);
    await captureEvidence(page, join(ART, 'interior-2-inside-a.png'));

    // ---- 3. straight into B: the reveal moves, it does not accumulate
    await stand({ x: scene.b.inside.x + 0.5, y: scene.b.inside.y, z: scene.b.inside.z + 0.5 });
    const inB = await readCanonicalState(page, () => (window as any).game.voxels.revealed);
    if (!inB) throw new Error(`standing inside ${scene.b.name} revealed nothing`);
    const bOpened = await drawnAbove(scene.b.bounds, cutB);
    const aWhileInB = await drawnAbove(scene.a.bounds, cutA);
    if (bOpened >= roofBIntact) throw new Error(`${scene.b.name}'s roof is still drawn from inside it (${bOpened} vertices above the cut, was ${roofBIntact})`);
    if (aWhileInB !== roofAIntact) throw new Error(`${scene.a.name}'s roof did not come back when the player left it (${roofAIntact} → ${aWhileInB} vertices)`);
    await captureEvidence(page, join(ART, 'interior-3-inside-b.png'));

    // ---- 4. back outside: everything is whole again
    await stand(scene.outside);
    const cleared = await readCanonicalState(page, () => (window as any).game.voxels.revealed);
    if (cleared) throw new Error(`leaving the building left ${JSON.stringify(cleared)} revealed`);
    const aBack = await drawnAbove(scene.a.bounds, cutA);
    const bBack = await drawnAbove(scene.b.bounds, cutB);
    if (aBack !== roofAIntact || bBack !== roofBIntact) throw new Error(`the village did not return to its original geometry (${scene.a.name} ${roofAIntact}→${aBack}, ${scene.b.name} ${roofBIntact}→${bBack})`);

    // ---- 5. the canonical world never changed: this is presentation only
    const untouched = await readCanonicalState(page, () => {
      const g = (window as any).game;
      const w = g.world;
      const bs = w.places().filter((p: any) => p.indoor).map((p: any) => p.bounds);
      let solid = 0;
      for (const b of bs) for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) for (let y = b.y0; y <= b.y1; y++) if (w.grid.get(x, y, z) !== 0) solid++;
      return solid;
    });
    if (untouched <= 0) throw new Error('the canonical grid reports no solid blocks inside any building — the reveal has mutated world state');
  },
};
