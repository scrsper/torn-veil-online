import type { BrowserSpec } from '../run';
import { startGame, advanceWorld, readCanonicalState, readHUD, movePlayerTo, lookAt, captureEvidence } from '../helpers';
import { join } from 'node:path';

const ART = join(import.meta.dirname, '..', 'artifacts');

/**
 * v0.10.1 Parts XIV and XV — the same physical act, two different canonical meanings.
 *
 * The milestone's rule is that being able to pick something up must not silently make it yours.
 * So this spec puts two identical objects on a merchant's counter and does the two different
 * things to them through the real client: pays for one, and takes the other. Both end with the
 * object in the player's hands. Only one of them is a theft, and the difference has to show up in
 * the canonical record — the event type, the ownership, the provenance — and in what the player
 * was told BEFORE they acted.
 *
 * Then it gives something away and checks that the transfer is a real one with real provenance,
 * that a trinket does not manufacture a debt, and that a valuable gift can.
 */
export const theftAndGift: BrowserSpec = {
  name: 'purchase and theft are different canonical acts, and a gift is a real transfer',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);
    await advanceWorld(page, 3600 * 8, 2);

    // A shop counter in the generated village with at least two things on it that its keeper
    // genuinely owns and would genuinely sell. NOTHING is placed by this test: the goods, the
    // counter and the keeper are all the world's own, so the two paths below are performed on the
    // same kind of object a player would actually find.
    const scene = await page.evaluate(() => {
      const g = (window as any).game; const w = g.world;
      const player = w.person(w.playerId);
      for (const place of w.places()) {
        if (!place.anchors.some((a: any) => a.kind === 'display')) continue;
        const keeperId = place.ownerId ?? place.workers[0];
        const keeper = keeperId ? w.person(keeperId) : null;
        if (!keeper || !keeper.alive) continue;
        // Somebody actually behind the counter: a sale needs a person to hand the money to, and a
        // sleeping keeper correctly offers none.
        const kb0 = w.primaryBody(keeper.id);
        if (!kb0 || !kb0.present || kb0.dead || kb0.pose === 'sleep') continue;
        const onCounter = g.sim.tradeOffers(keeper, player)
          .filter((o: any) => o.item.placeId === place.id && o.item.pos && o.item.quantity === 1)
          .sort((a: any, b: any) => b.unitPrice - a.unitPrice);
        if (onCounter.length < 2) continue;
        const pick = (o: any) => ({ id: o.item.id, name: o.item.name, price: o.unitPrice, pos: { x: o.item.pos.x, y: o.item.pos.y, z: o.item.pos.z } });
        player.wealth = 500;
        // The keeper stands at their own counter. Buying needs somebody to hand the money to
        // (`SELLER_REACH`), and where a villager happens to be at hour eight of a run is not what
        // this spec is about — so their position is setup, like the player's own.
        const kb = w.primaryBody(keeper.id);
        if (kb) { kb.pos = { x: onCounter[0].item.pos.x + 1, y: onCounter[0].item.pos.y, z: onCounter[0].item.pos.z }; kb.pose = 'stand'; }
        return { placeName: place.name, keeperId: keeper.id, keeperName: keeper.name, a: pick(onCounter[0]), b: pick(onCounter[1]) };
      }
      return null;
    });
    if (!scene) throw new Error('no shop in the village had two things on its counter that its keeper would sell');

    // ---- 1. the honest path: the client offers to BUY, and says so before the key is pressed
    // Immersive targeting, for the reason given in the trade spec: what is under test is the
    // difference between paying and taking, not which camera is drawing it.
    await page.keyboard.press('F2');
    await page.waitForTimeout(120);
    await movePlayerTo(page, scene.a.pos, 1.2);
    await lookAt(page, { x: scene.a.pos.x, y: scene.a.pos.y + 0.15, z: scene.a.pos.z });
    await page.evaluate(() => { (window as any).game.inter.update(); });
    const targetedA = await readCanonicalState(page, () => {
      const t = (window as any).game.inter.target;
      return t?.kind === 'item' ? t.item.id : null;
    });
    if (targetedA !== scene.a.id) throw new Error(`the cursor did not land on the first ring (targeted ${targetedA})`);
    const promptA = await readHUD(page);
    if (!/\[E\] Buy/.test(promptA.target)) throw new Error(`the client did not offer to buy goods on a shop counter: ${promptA.target}`);
    if (!/Shift\+E/.test(promptA.target)) throw new Error(`taking it anyway was not offered as the alternative: ${promptA.target}`);
    await captureEvidence(page, join(ART, 'theft-1-buy-prompt.png'));

    const beforeBuy = await page.evaluate((id: string) => {
      const w = (window as any).game.world;
      return { player: w.person(w.playerId).wealth, keeper: w.person(id).wealth, thefts: w.events.filter((e: any) => e.type === 'theft').length };
    }, scene.keeperId);

    await page.keyboard.press('KeyE');
    await page.waitForTimeout(150);

    const afterBuy = await page.evaluate((args: { itemId: string; keeperId: string }) => {
      const w = (window as any).game.world;
      const it = w.item(args.itemId); const player = w.person(w.playerId);
      return {
        owner: it.ownerId, holder: it.holderId, pos: it.pos, inInventory: player.inventory.includes(it.id),
        player: player.wealth, keeper: w.person(args.keeperId).wealth,
        thefts: w.events.filter((e: any) => e.type === 'theft').length,
        provenance: it.provenance.at(-1)?.how ?? null,
        playerId: w.playerId,
      };
    }, { itemId: scene.a.id, keeperId: scene.keeperId });

    if (!afterBuy.inInventory) throw new Error('the purchased ring never reached the player');
    if (afterBuy.owner !== afterBuy.playerId) throw new Error('the player paid for the ring but does not own it');
    if (afterBuy.provenance !== 'bought') throw new Error(`the purchase recorded provenance '${afterBuy.provenance}' rather than 'bought'`);
    const paid = beforeBuy.player - afterBuy.player;
    if (paid <= 0) throw new Error('the purchase cost nothing');
    if (afterBuy.keeper - beforeBuy.keeper !== paid) throw new Error(`the ${scene.keeperName} did not receive what the player paid (${paid} vs ${afterBuy.keeper - beforeBuy.keeper})`);
    if (afterBuy.thefts !== beforeBuy.thefts) throw new Error('paying for something emitted a theft event');

    // ---- 2. the other path: physically possible, canonically different, and named as such
    await lookAt(page, { x: scene.b.pos.x, y: scene.b.pos.y + 0.15, z: scene.b.pos.z });
    await page.evaluate(() => { (window as any).game.inter.update(); });
    const targetedB = await readCanonicalState(page, () => {
      const t = (window as any).game.inter.target;
      return t?.kind === 'item' ? t.item.id : null;
    });
    if (targetedB !== scene.b.id) throw new Error(`the cursor did not land on the second ring (targeted ${targetedB})`);

    const beforeTake = await page.evaluate((id: string) => {
      const w = (window as any).game.world;
      return { player: w.person(w.playerId).wealth, keeper: w.person(id).wealth, thefts: w.events.filter((e: any) => e.type === 'theft').length };
    }, scene.keeperId);

    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyE');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);

    const afterTake = await page.evaluate((args: { itemId: string; keeperId: string }) => {
      const w = (window as any).game.world;
      const it = w.item(args.itemId); const player = w.person(w.playerId);
      const theft = [...w.events].reverse().find((e: any) => e.type === 'theft' && e.item === args.itemId);
      return {
        owner: it.ownerId, holder: it.holderId, inInventory: player.inventory.includes(it.id),
        player: player.wealth, keeper: w.person(args.keeperId).wealth,
        thefts: w.events.filter((e: any) => e.type === 'theft').length,
        theftTarget: theft?.target ?? null, theftSummary: theft?.summary ?? null,
        provenance: it.provenance.at(-1)?.how ?? null,
        playerId: w.playerId,
      };
    }, { itemId: scene.b.id, keeperId: scene.keeperId });

    if (!afterTake.inInventory) throw new Error('taking the second ring did not give the player possession — theft must remain physically possible');
    if (afterTake.thefts !== beforeTake.thefts + 1) throw new Error(`taking someone else's property emitted ${afterTake.thefts - beforeTake.thefts} theft events`);
    if (afterTake.theftTarget !== scene.keeperId) throw new Error(`the theft was not recorded against ${scene.keeperName}`);
    if (afterTake.owner === afterTake.playerId) throw new Error('taking without paying made the player the rightful OWNER — possession must not confer ownership');
    if (afterTake.owner !== scene.keeperId) throw new Error(`the stolen ring's owner became ${afterTake.owner}`);
    if (afterTake.provenance !== 'stolen') throw new Error(`the take recorded provenance '${afterTake.provenance}' rather than 'stolen'`);
    if (afterTake.player !== beforeTake.player || afterTake.keeper !== beforeTake.keeper) throw new Error('taking without paying moved money');
    const msgs = (await readHUD(page)).messages.join(' ');
    if (!/theft/i.test(msgs)) throw new Error(`the player was not told they had committed a theft: ${msgs}`);
    await captureEvidence(page, join(ART, 'theft-2-taken.png'));

    // ---- 3. a gift is a real transfer with real provenance, and the social weight is earned.
    // The two things given are the shop good just BOUGHT (worth real money, honestly acquired)
    // and the cheapest thing the Traveler was already carrying.
    const giftScene = await page.evaluate((args: { keeperId: string; valuableId: string }) => {
      const w = (window as any).game.world;
      const player = w.person(w.playerId);
      const other = w.persons().find((p: any) => p.alive && !p.controlled && p.id !== args.keeperId && w.primaryBody(p.id));
      const carried = player.inventory.map((id: string) => w.item(id)).filter((i: any) => i && i.id !== args.valuableId && i.quantity > 0);
      const trinket = carried.sort((a: any, b: any) => a.value - b.value)[0];
      const b = w.primaryBody(other.id);
      return {
        otherId: other.id, otherName: other.name,
        pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
        trinketId: trinket ? trinket.id : null, trinketName: trinket ? trinket.name : null, trinketValue: trinket ? trinket.value : 0,
        valuableId: args.valuableId,
        obligationsBefore: (other.mind.obligations ?? []).length,
      };
    }, { keeperId: scene.keeperId, valuableId: scene.a.id });
    if (!giftScene.trinketId) throw new Error('the Traveler had nothing small to give away');

    await movePlayerTo(page, giftScene.pos, 1.3);
    await lookAt(page, { x: giftScene.pos.x, y: giftScene.pos.y + 0.9, z: giftScene.pos.z });
    await page.evaluate(() => { (window as any).game.inter.update(); });
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(120);

    const giveOne = async (itemId: string): Promise<void> => {
      const rows = page.locator('#inventory .it');
      const n = await rows.count();
      let clicked = false;
      for (let i = 0; i < n; i++) {
        const id = await rows.nth(i).getAttribute('data-id');
        if (id === itemId) { await rows.nth(i).click(); clicked = true; break; }
      }
      if (!clicked) throw new Error(`the inventory does not list item ${itemId}`);
      await page.waitForTimeout(60);
      const giveBtn = page.locator('#inventory .acts button', { hasText: /^Give to/ });
      if (!await giveBtn.count()) throw new Error(`the inventory offered no way to give ${itemId} to ${giftScene.otherName}`);
      await giveBtn.first().click();
      await page.waitForTimeout(150);
    };

    await giveOne(giftScene.trinketId);
    const afterTrinket = await page.evaluate((args: { itemId: string; otherId: string }) => {
      const w = (window as any).game.world;
      const it = w.item(args.itemId); const other = w.person(args.otherId); const player = w.person(w.playerId);
      const ev = [...w.events].reverse().find((e: any) => e.type === 'gift' && e.item === args.itemId);
      return {
        owner: it.ownerId, holder: it.holderId,
        inTheirs: other.inventory.includes(it.id), inPlayers: player.inventory.includes(it.id),
        event: ev ? { actor: ev.actor, target: ev.target } : null,
        provenance: it.provenance.at(-1)?.how ?? null,
        obligations: (other.mind.obligations ?? []).map((o: any) => ({ kind: o.kind, magnitude: o.magnitude, toward: o.towardId })),
        playerId: w.playerId,
      };
    }, { itemId: giftScene.trinketId, otherId: giftScene.otherId });

    if (!afterTrinket.inTheirs || afterTrinket.inPlayers) throw new Error('the gift did not move between inventories');
    if (afterTrinket.holder !== giftScene.otherId || afterTrinket.owner !== giftScene.otherId) throw new Error('a gift must move possession AND ownership');
    if (!afterTrinket.event || afterTrinket.event.actor !== afterTrinket.playerId || afterTrinket.event.target !== giftScene.otherId) throw new Error('no canonical gift event names the giver and the recipient');
    if (afterTrinket.provenance !== 'gift') throw new Error(`the gift recorded provenance '${afterTrinket.provenance}'`);
    const trinketStake = afterTrinket.obligations.filter((o: { toward: string }) => o.toward === afterTrinket.playerId);
    if (trinketStake.some((o: { magnitude: number }) => o.magnitude > 0.3)) throw new Error(`handing over a ${giftScene.trinketName} (worth ${giftScene.trinketValue}) created a substantial debt: ${JSON.stringify(trinketStake)}`);

    await giveOne(giftScene.valuableId);
    const afterValuable = await page.evaluate((args: { itemId: string; otherId: string }) => {
      const w = (window as any).game.world;
      const it = w.item(args.itemId); const other = w.person(args.otherId);
      return {
        owner: it.ownerId, holder: it.holderId,
        obligations: (other.mind.obligations ?? []).map((o: any) => ({ kind: o.kind, magnitude: o.magnitude, toward: o.towardId, cause: o.causeEventId, reasons: o.reasons })),
        playerId: w.playerId,
      };
    }, { itemId: giftScene.valuableId, otherId: giftScene.otherId });
    if (afterValuable.owner !== giftScene.otherId) throw new Error('the valuable gift did not transfer ownership');
    const stake = afterValuable.obligations.filter((o: { toward: string }) => o.toward === afterValuable.playerId);
    console.log(`        (giving away ${scene.a.name} left ${giftScene.otherName} with ${stake.length} stake(s) toward the player: ${stake.map((o: { kind: string; magnitude: number }) => `${o.kind} ${o.magnitude.toFixed(2)}`).join(', ') || 'none'})`);
    for (const o of stake) {
      if (!o.cause) throw new Error('an obligation formed without naming the canonical event that caused it');
    }

    // ---- 4. nothing was duplicated anywhere along the way
    const audit = await readCanonicalState(page, () => {
      const w = (window as any).game.world;
      const problems: string[] = [];
      for (const it of w.items()) {
        if (it.quantity <= 0) continue;
        const holders = w.persons().filter((p: any) => p.inventory.includes(it.id));
        if (holders.length > 1) problems.push(`${it.name} is in ${holders.length} inventories`);
        if (it.holderId && (it.pos || it.placeId)) problems.push(`${it.name} is held and also lying at a place`);
        if (it.holderId && !holders.some((h: any) => h.id === it.holderId)) problems.push(`${it.name} says it is held by someone whose inventory does not list it`);
        if (!it.holderId && holders.length) problems.push(`${it.name} is unheld but listed in an inventory`);
      }
      return problems;
    });
    if (audit.length) throw new Error(`item integrity problems after buy/steal/give: ${audit.join('; ')}`);
  },
};
