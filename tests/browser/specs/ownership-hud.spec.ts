import type { BrowserSpec } from '../run';
import { startGame, movePlayerTo, lookAt, readHUD } from '../helpers';

/**
 * v0.8 §G/§10: the ground-item ownership label in the HUD must respect what the PLAYER actually
 * knows (an acquired `owner:<id>` KnowledgeItem), never the simulation's omniscient `ownerId` —
 * see `game/ui/hud.ts`'s `itemStatusFor`. Reads the real rendered `#target` panel.
 */
export const ownershipHud: BrowserSpec = {
  name: 'ownership HUD label respects player knowledge, not omniscient ownerId',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);

    const setup = await page.evaluate(async () => {
      const w = (window as any).game.world;
      // @ts-expect-error -- resolves in the browser's own Vite module graph at runtime, not statically from this Node-side test file
      const { makeItem } = await import('/src/sim/world/factory.ts');
      const player = w.person(w.playerId);
      const owner = w.persons().find((p: any) => p.alive && p.id !== player.id);
      const pos = { x: player.bodies.length ? w.primaryBody(player.id).pos.x + 1 : 0, y: w.primaryBody(player.id).pos.y, z: w.primaryBody(player.id).pos.z };
      const item = makeItem(w, 'lantern', "someone's lantern", { owner: owner.id, pos });
      return { itemId: item.id, itemPos: item.pos, ownerId: owner.id, ownerName: owner.name };
    });

    await movePlayerTo(page, setup.itemPos, 1.0);
    await lookAt(page, setup.itemPos);
    await page.waitForTimeout(200);

    const hudBefore = await readHUD(page);
    if (!/not sure whose this is/i.test(hudBefore.target)) throw new Error(`Expected an honest "not sure whose this is" before the player knows the owner, got target panel: "${hudBefore.target}"`);
    if (hudBefore.target.includes(setup.ownerName)) throw new Error(`HUD leaked the true owner name '${setup.ownerName}' before the player ever learned it: "${hudBefore.target}"`);

    await page.evaluate(async (args: { itemId: string; ownerId: string }) => {
      const w = (window as any).game.world;
      const player = w.person(w.playerId);
      // @ts-expect-error -- resolves in the browser's own Vite module graph at runtime, not statically from this Node-side test file
      const { learn } = await import('/src/sim/mind/knowledge.ts');
      learn(w, player, { key: `owner:${args.itemId}`, kind: 'ownership', claim: { itemId: args.itemId, ownerId: args.ownerId }, confidence: 1, source: { type: 'witnessed' } }, true);
    }, { itemId: setup.itemId, ownerId: setup.ownerId });
    await page.waitForTimeout(200);

    const hudAfter = await readHUD(page);
    if (!hudAfter.target.includes(setup.ownerName)) throw new Error(`Expected the HUD to name the real owner '${setup.ownerName}' once the player actually learned it, got: "${hudAfter.target}"`);
  },
};
