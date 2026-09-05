import type { BrowserSpec } from '../run';
import { startGame, movePlayerTo, lookAt, interact, openDialogueWith, readDialogue, chooseDialogueOption, readCanonicalState } from '../helpers';

/**
 * v0.8 §1A/§1B/§10: authorized item recovery is not theft, and the promised reward is really
 * paid — driven through the actual dialogue UI (hear the request), the real pickup interaction,
 * and the real "give" dialogue flow, not direct Simulation calls. The one setup shortcut (seeding
 * the lost-item request itself) uses the real canonical `makeItem` factory, dynamically imported
 * from the actual running app's module graph — never a hand-built fake Item shape.
 */
export const recoverItem: BrowserSpec = {
  name: 'authorized recovery via dialogue is not theft, and the reward is really paid',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);

    const setup = await page.evaluate(async () => {
      const w = (window as any).game.world;
      // @ts-expect-error -- resolves in the browser's own Vite module graph at runtime, not statically from this Node-side test file
      const { makeItem } = await import('/src/sim/world/factory.ts');
      const requester = w.persons().find((p: any) => p.alive && p.occupation === 'farmer');
      const place = w.places()[0];
      const ring = makeItem(w, 'ring', `${requester.name}'s ring`, { owner: requester.id, pos: { ...place.inside }, placeId: place.id });
      requester.desires.push({ type: 'recover_item', targetId: ring.id, note: 'My ring was lost.', reward: 15, fulfilled: false });
      return { requesterId: requester.id, requesterName: requester.name, ringId: ring.id, ringPos: ring.pos, wealthBefore: requester.wealth };
    });

    // 1. Learn about the request through the real dialogue UI (hearDesire) — the same knowledge
    //    path that authorizes a subsequent pickup as 'recovered' rather than 'theft'.
    await openDialogueWith(page, setup.requesterId);
    let dlg = await readDialogue(page);
    if (!dlg.options.some(o => o.includes('anything you need'))) throw new Error(`Expected a "Is there anything you need?" option, got: ${JSON.stringify(dlg.options)}`);
    await chooseDialogueOption(page, 'anything you need');
    dlg = await readDialogue(page);
    if (!dlg.lines.join(' ').toLowerCase().includes('ring')) throw new Error(`Expected the requester to mention the ring, got: ${JSON.stringify(dlg.lines)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);

    // 2. Walk to the item and pick it up via the REAL interact key — must be recorded as an
    //    authorized recovery, not theft (v0.8 §1A).
    await movePlayerTo(page, setup.ringPos, 1.2);
    await lookAt(page, setup.ringPos);
    await page.waitForTimeout(150);
    await interact(page);
    await page.waitForTimeout(100);

    const pickupOutcome = await page.evaluate((id) => {
      const w = (window as any).game.world;
      const item = w.item(id);
      const ev = [...w.events].reverse().find((e: any) => e.item === id);
      return { holderId: item.holderId, playerId: w.playerId, lastEventType: ev?.type };
    }, setup.ringId);
    if (pickupOutcome.holderId !== pickupOutcome.playerId) throw new Error('Player never actually picked up the ring');
    if (pickupOutcome.lastEventType !== 'recovered') throw new Error(`Expected pickup to be recorded as 'recovered' (authorized), got '${pickupOutcome.lastEventType}'`);

    // 3. Return it via the real "Give something…" dialogue flow — the reward must be really paid.
    await openDialogueWith(page, setup.requesterId);
    dlg = await readDialogue(page);
    if (!dlg.options.some(o => o.includes('Give something'))) throw new Error(`Expected a "Give something…" option, got: ${JSON.stringify(dlg.options)}`);
    await chooseDialogueOption(page, 'Give something');
    dlg = await readDialogue(page);
    if (!dlg.options.some(o => o.includes('ring'))) throw new Error(`Expected a give option for the ring, got: ${JSON.stringify(dlg.options)}`);
    await chooseDialogueOption(page, 'ring');
    await page.waitForTimeout(50);

    const finalState = await page.evaluate(({ requesterId, ringId }) => {
      const w = (window as any).game.world;
      const requester = w.person(requesterId);
      return {
        fulfilled: requester.desires.find((d: any) => d.targetId === ringId)?.fulfilled,
        requesterWealth: requester.wealth,
        playerWealth: w.person(w.playerId).wealth,
        rewardPaid: w.events.some((e: any) => e.type === 'reward_paid'),
      };
    }, { requesterId: setup.requesterId, ringId: setup.ringId });
    if (!finalState.fulfilled) throw new Error('Recovery desire was not marked fulfilled after returning the item');
    if (!finalState.rewardPaid) throw new Error('No reward_paid event was emitted — reward was not actually paid');
    if (finalState.requesterWealth >= setup.wealthBefore) throw new Error(`Expected requester's wealth to decrease after paying the reward (before=${setup.wealthBefore}, after=${finalState.requesterWealth})`);
  },
};
