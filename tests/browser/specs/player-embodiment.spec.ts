import type { BrowserSpec } from '../run';
import { startGame, advanceWorld, movePlayerTo, openDialogueWith, readDialogue, chooseDialogueOption, readHUD } from '../helpers';

/**
 * Player embodiment (docs/PLAYER_EMBODIMENT.md): in the REAL client, the Traveler's needs are on
 * the HUD, a haul job is taken from the person who raised it, worked with the real G key at the
 * real places, paid into `wealth`, and a meal is bought and eaten through the same functions an
 * NPC uses. Canonical state is read only to ASSERT; every action goes through the UI.
 */
export const playerEmbodiment: BrowserSpec = {
  name: 'player takes a haul job from its requester, works it with G, is paid, buys and eats a meal',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);
    await page.keyboard.press('Escape');

    // HUD shows the player's own needs and purse (no coin item).
    const hud0 = await page.evaluate(() => ({ needs: document.querySelector('#needs')?.textContent ?? '', purse: document.querySelector('#purse')?.textContent ?? '' }));
    if (!/hunger/.test(hud0.needs) || !/thirst/.test(hud0.needs)) throw new Error(`HUD needs panel missing: "${hud0.needs}"`);
    if (!/\d+ silver/.test(hud0.purse)) throw new Error(`HUD purse missing: "${hud0.purse}"`);
    const coinItem = await page.evaluate(() => { const w = (window as any).game.world; return w.person(w.playerId).inventory.map((id: string) => w.item(id)?.type).includes('coins'); });
    if (coinItem) throw new Error('Player still carries a coin item as currency');

    // Let the village raise a real haul request (logistics needs are generated on the upkeep
    // cadence), then find someone who speaks for one.
    let found: { npcId: string; taskId: string; src: any; dst: any; reward: number } | null = null;
    for (let i = 0; i < 12 && !found; i++) {
      await advanceWorld(page, 3600 * 2, 2);
      found = await page.evaluate(() => {
        const g = (window as any).game; const w = g.world;
        for (const p of w.persons()) {
          if (!p.alive || (p.id === w.playerId)) continue;
          const offers = g.sim.haulOffersFrom(p);
          if (offers.length) { const o = offers[0]; return { npcId: p.id, taskId: o.task.id, src: o.source.inside, dst: o.destination.inside, reward: o.request.reward }; }
        }
        return null;
      });
    }
    if (!found) throw new Error('No open haul request was raised by anyone within 24 world-hours');

    await openDialogueWith(page, found.npcId);
    const d = await readDialogue(page);
    if (!d.options.some(o => /Any work going/.test(o))) throw new Error(`No work option offered: ${d.options.join(' | ')}`);
    await chooseDialogueOption(page, 'Any work going');
    await chooseDialogueOption(page, 'Carry ');
    await page.keyboard.press('Escape');
    const claimed = await page.evaluate((taskId) => { const w = (window as any).game.world; const t = w.haulTasks.find((t: any) => t.id === taskId); return t && t.claimantId === w.playerId && t.status === 'claimed'; }, found.taskId);
    if (!claimed) throw new Error('Accepting the job in dialogue did not claim the HaulTask for the player');
    const hudJob = await page.evaluate(() => document.querySelector('#job')?.textContent ?? '');
    if (!/Job:/.test(hudJob)) throw new Error(`HUD did not show the job: "${hudJob}"`);

    // Work it with the real G key: at the source loads, at the destination deposits.
    const wealthBefore = await page.evaluate(() => { const w = (window as any).game.world; return w.person(w.playerId).wealth; });
    await page.keyboard.press('KeyG'); // far away: nothing should load
    let carried = await page.evaluate((id) => (window as any).game.world.haulTasks.find((t: any) => t.id === id).carried, found.taskId);
    if (carried !== 0) throw new Error('Cargo loaded while the player was nowhere near the source');
    await movePlayerTo(page, found.src, 0.5); await page.keyboard.press('KeyG'); await page.waitForTimeout(50);
    carried = await page.evaluate((id) => (window as any).game.world.haulTasks.find((t: any) => t.id === id).carried, found.taskId);
    if (carried <= 0) throw new Error('G at the source did not load cargo');
    const hud1 = await readHUD(page);
    if (!hud1.inventory.includes('Carrying')) throw new Error('inventory line missing');
    let status = '';
    for (let trips = 0; trips < 12 && status !== 'delivered'; trips++) {
      await movePlayerTo(page, found.dst, 0.5); await page.keyboard.press('KeyG'); await page.waitForTimeout(50);
      status = await page.evaluate((id) => (window as any).game.world.haulTasks.find((t: any) => t.id === id).status, found.taskId);
      if (status === 'claimed') { await movePlayerTo(page, found.src, 0.5); await page.keyboard.press('KeyG'); await page.waitForTimeout(50); }
      if (status === 'failed') throw new Error('haul failed mid-way');
    }
    if (status !== 'delivered') throw new Error(`haul never completed (status ${status})`);
    const after = await page.evaluate((id) => { const w = (window as any).game.world; const req = w.requests.find((r: any) => r.payload.haulTaskId === id); return { wealth: w.person(w.playerId).wealth, req: req?.status, paid: w.events.some((e: any) => e.type === 'wage_paid' && e.target === w.playerId) }; }, found.taskId);
    if (after.req !== 'completed') throw new Error(`Request not completed: ${after.req}`);
    if (!(after.wealth > wealthBefore) || !after.paid) throw new Error(`Player was not paid a real wage (wealth ${wealthBefore} -> ${after.wealth}, wage_paid=${after.paid})`);

    // Eat: the Traveler starts with bread; C consumes one through eatFood.
    const energy0 = await page.evaluate(() => { const w = (window as any).game.world; const p = w.person(w.playerId); p.physiology.energy = 0.3; return p.physiology.energy; });
    await page.keyboard.press('KeyC'); await page.waitForTimeout(50);
    const energy1 = await page.evaluate(() => { const w = (window as any).game.world; return w.person(w.playerId).physiology.energy; });
    if (!(energy1 > energy0 + 0.3)) throw new Error(`C did not restore energy through eatFood (${energy0} -> ${energy1})`);
    const ate = await page.evaluate(() => { const w = (window as any).game.world; return w.events.some((e: any) => e.type === 'food_consumed' && e.actor === w.playerId); });
    if (!ate) throw new Error('no food_consumed event for the player');
  },
};
