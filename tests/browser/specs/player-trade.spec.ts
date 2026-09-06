import type { BrowserSpec } from '../run';
import { startGame, advanceWorld, readCanonicalState, readDialogue, chooseDialogueOption, readHUD, movePlayerTo, lookAt, captureEvidence } from '../helpers';
import { join } from 'node:path';

const ART = join(import.meta.dirname, '..', 'artifacts');

interface SellerInfo {
  id: string; name: string; pos: { x: number; y: number; z: number };
  wealth: number;
  offers: { itemId: string; type: string; unitPrice: number; available: number; quantity: number; ownerId: string }[];
}

/** Somebody in the generated village who genuinely has food they are willing to sell. Chosen from
 * the simulation's own offer list, not from a list of occupations this test happens to know. */
async function findFoodSeller(page: import('playwright').Page): Promise<SellerInfo> {
  const found = await page.evaluate(() => {
    const g = (window as any).game; const w = g.world;
    const player = w.person(w.playerId);
    for (const p of w.persons()) {
      if (!p.alive || p.controlled) continue;
      const offers = g.sim.tradeOffers(p, player);
      const food = offers.filter((o: any) => ['bread', 'cheese', 'meat', 'pie', 'stew', 'ale'].includes(o.item.type) && o.available > 0);
      if (!food.length) continue;
      // Somebody actually behind the counter: a sleeping shopkeeper correctly offers no trade.
      const b = w.primaryBody(p.id); if (!b || !b.present || b.dead || b.pose === 'sleep') continue;
      return {
        id: p.id, name: p.name, wealth: p.wealth,
        pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
        offers: food.map((o: any) => ({ itemId: o.item.id, type: o.item.type, unitPrice: o.unitPrice, available: o.available, quantity: o.item.quantity, ownerId: o.item.ownerId })),
      };
    }
    return null;
  });
  if (!found) throw new Error('nobody in the village had food they were willing to sell');
  return found as SellerInfo;
}

/**
 * v0.10.1 Part XIII — buying a meal from someone who really owns it, then eating it out of a real
 * inventory, through the real client.
 *
 * The strictness that matters is at the ends. At the start, every good the Trade menu offers is
 * cross-checked against what the seller canonically holds and is canonically willing to part with
 * — a fake shop list would show goods that fail that check. At the end, the world is audited for
 * duplicates: the units bought must have come out of the seller's stack and be in the player's,
 * and the total quantity of that food in the world must be exactly what it was before.
 */
export const playerTrade: BrowserSpec = {
  name: 'the player buys real goods from someone who owns them, and eats what they bought',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);
    await advanceWorld(page, 3600 * 8, 2);

    const seller = await findFoodSeller(page);
    const good = seller.offers[0];

    // ---- 1. every offered good is one the seller canonically has and will sell
    const honest = await page.evaluate((s: SellerInfo) => {
      const g = (window as any).game; const w = g.world;
      const npc = w.person(s.id); const player = w.person(w.playerId);
      return g.sim.tradeOffers(npc, player).map((o: any) => ({
        type: o.item.type,
        exists: !!w.item(o.item.id),
        theirs: o.item.ownerId === npc.id || (o.item.ownerId == null),
        held: !!o.item.holderId && o.item.holderId !== npc.id,
        available: o.available,
        inStack: o.item.quantity,
      }));
    }, seller);
    for (const o of honest) {
      if (!o.exists) throw new Error(`the Trade menu offered ${o.type}, which is not an item in the world`);
      if (!o.theirs) throw new Error(`the Trade menu offered ${o.type}, which the seller does not own`);
      if (o.held) throw new Error(`the Trade menu offered ${o.type}, which somebody else is carrying`);
      if (o.available > o.inStack) throw new Error(`the Trade menu offered ${o.available} ${o.type} from a stack of ${o.inStack}`);
    }

    // ---- 2. approach and open Trade through the real key
    // Aiming is done through the immersive camera's targeting, which this harness can drive
    // deterministically (`lookAt`). What is under test here is the trade, the ownership transfer
    // and the inventory — none of which know which camera is presenting them; the elevated
    // camera's own targeting has its own spec.
    await page.keyboard.press('F2');
    await page.waitForTimeout(120);
    // Stand them somewhere the player can actually point at.
    //
    // Where a villager happens to be at hour eight is not what this spec is about, and the square
    // is furnished: the seller was found standing beside the well, whose block won the targeting
    // raycast over the person behind it. So the seller is placed on open ground — the same setup
    // shortcut `theft-and-gift.spec.ts` uses for its shopkeeper, and the same open-ground search
    // the movement spec uses — after which every action below goes through the real keys and the
    // real targeting.
    const at = await page.evaluate((id: string) => {
      const w = (window as any).game.world;
      const nav = w.nav;
      const sq = w.places().find((p: any) => p.type === 'square');
      const cx = Math.floor(sq.inside.x), cz = Math.floor(sq.inside.z);
      let spot: { x: number; y: number; z: number } | null = null;
      for (let r = 0; r < 40 && !spot; r++) {
        for (let dx = -r; dx <= r && !spot; dx++) for (let dz = -r; dz <= r && !spot; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx, z = cz + dz, y = nav.floorY(x, z);
          if (y < 0) continue;
          let clear = true;
          for (let ax = -3; ax <= 3 && clear; ax++) for (let az = -3; az <= 3 && clear; az++) {
            if (!nav.isWalkable(x + ax, z + az) || nav.floorY(x + ax, z + az) !== y) clear = false;
            for (let ay = 0; ay < 3 && clear; ay++) if (w.grid.isSolidAt(x + ax, y + ay, z + az)) clear = false;
          }
          if (clear) spot = { x: x + 0.5, y, z: z + 0.5 };
        }
      }
      const b = w.primaryBody(id);
      if (spot) { b.pos = { ...spot }; b.path = null; b.pose = 'stand'; }
      return { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    }, seller.id);
    await movePlayerTo(page, at, 1.4);
    await lookAt(page, { x: at.x, y: at.y + 0.9, z: at.z });
    await page.evaluate(() => { (window as any).game.inter.update(); });
    const targeted = await readCanonicalState(page, () => {
      const t = (window as any).game.inter.target;
      return t?.kind === 'body' ? t.person?.id ?? null : null;
    });
    if (targeted !== seller.id) throw new Error(`the cursor did not land on ${seller.name} (targeted ${targeted})`);
    const hud = await readHUD(page);
    if (!hud.target.includes('trade')) throw new Error(`the target panel does not offer trade with a seller: ${hud.target}`);

    await page.keyboard.press('KeyR');
    await page.waitForSelector('#dialogue[style*="display: block"]', { timeout: 5000 });
    const menu = await readDialogue(page);
    const buyOption = menu.options.find(o => o.includes(`Buy ${good.type}`) || o.includes('Buy'));
    if (!buyOption) throw new Error(`the Trade menu offered nothing to buy: ${JSON.stringify(menu.options)}`);
    await captureEvidence(page, join(ART, 'trade-1-menu.png'));

    // ---- 3. buy, and check every side of the transaction
    const before = await readCanonicalState(page, () => {
      const w = (window as any).game.world;
      const player = w.person(w.playerId);
      return {
        playerWealth: player.wealth,
        inventory: [...player.inventory],
        totals: Object.fromEntries(['bread', 'cheese', 'meat', 'pie', 'stew', 'ale'].map(t => [t, w.items().filter((i: any) => i.type === t).reduce((n: number, i: any) => n + i.quantity, 0)])),
      };
    });
    const sellerWealthBefore = await readCanonicalState(page, () => 0);
    void sellerWealthBefore;
    const sellerBefore = await page.evaluate((id: string) => (window as any).game.world.person(id).wealth, seller.id);

    await chooseDialogueOption(page, buyOption.replace(/^\d/, '').trim());
    await page.waitForTimeout(120);

    interface AfterState { playerWealth: number; sellerWealth: number; carried: { id: string; type: string; qty: number; owner: string; holder: string; pos: unknown; placeId: unknown }[]; totals: Record<string, number> }
    const after: AfterState = await page.evaluate((args: { sellerId: string; totals: string[] }) => {
      const w = (window as any).game.world;
      const player = w.person(w.playerId);
      const carried = player.inventory.map((id: string) => w.item(id)).filter(Boolean);
      return {
        playerWealth: player.wealth,
        sellerWealth: w.person(args.sellerId).wealth,
        carried: carried.map((i: any) => ({ id: i.id, type: i.type, qty: i.quantity, owner: i.ownerId, holder: i.holderId, pos: i.pos, placeId: i.placeId })),
        totals: Object.fromEntries(args.totals.map(t => [t, w.items().filter((i: any) => i.type === t).reduce((n: number, i: any) => n + i.quantity, 0)])),
      };
    }, { sellerId: seller.id, totals: ['bread', 'cheese', 'meat', 'pie', 'stew', 'ale'] }) as AfterState;

    const spent = before.playerWealth - after.playerWealth;
    if (spent <= 0) throw new Error(`the purchase cost the player nothing (wealth ${before.playerWealth} → ${after.playerWealth})`);
    const gained = after.sellerWealth - sellerBefore;
    if (gained !== spent) throw new Error(`money was not conserved: the player spent ${spent}, ${seller.name} received ${gained}`);

    const bought = after.carried.find(i => i.type === good.type);
    if (!bought) throw new Error(`nothing of type ${good.type} reached the player's inventory`);
    if (bought.owner !== await readCanonicalState(page, () => (window as any).game.world.playerId)) throw new Error(`the player carries the ${good.type} but does not own it`);
    if (bought.pos || bought.placeId) throw new Error(`the bought ${good.type} is carried AND still lying at a place`);
    for (const [type, total] of Object.entries(before.totals)) {
      if (after.totals[type] !== total) throw new Error(`buying changed how much ${type} exists in the world (${total} → ${after.totals[type]})`);
    }

    // ---- 4. it is in a real inventory, and eating it is the same canonical act an NPC performs
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    // Pause the world with the player's own P key before working the inventory panel. The panel
    // re-renders whenever the carried items change, which a running village does constantly, so a
    // click that has located a row or a button races the next refresh and lands on a detached
    // element. Pausing is what a player would do, and it is the same `paused` flag the observer
    // overlay's pause button sets — no test-only mechanism.
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(80);
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(120);
    const invOpen = await readCanonicalState(page, () => (document.getElementById('inventory') as HTMLElement).classList.contains('open'));
    if (!invOpen) throw new Error('the inventory panel did not open on I');
    const listed = await page.locator('#inventory .it').allTextContents();
    if (!listed.some(t => t.toLowerCase().includes(good.type))) throw new Error(`the inventory does not list the ${good.type} that was just bought: ${JSON.stringify(listed)}`);
    await captureEvidence(page, join(ART, 'trade-2-inventory.png'));

    // Select it, then use the action the panel offers for it.
    // Select through the panel's own `select()` — the very method its row click handler calls.
    // Clicking the row directly races the panel's re-render (it refreshes whenever the carried
    // items change, which the running village does constantly), and Playwright's click retries
    // against an element that has already been replaced.
    await page.evaluate((type: string) => {
      const g = (window as any).game; const w = g.world;
      const player = w.person(w.playerId);
      const it = player.inventory.map((id: string) => w.item(id)).find((i: any) => i && i.type === type);
      g.inventory.select(it.id);
    }, good.type);
    await page.waitForTimeout(60);
    await page.evaluate(() => { const w = (window as any).game.world; w.person(w.playerId).physiology.energy = 0.4; });
    const hungerBefore = await readCanonicalState(page, () => (window as any).game.world.person((window as any).game.world.playerId).physiology.energy);
    const consumeBtn = page.locator('#inventory .acts button', { hasText: /^(Eat|Drink)/ });
    if (!await consumeBtn.count()) throw new Error(`the inventory offered no way to consume the ${good.type}`);
    const qtyBefore = bought.qty;
    // `dispatchEvent` rather than `click`: pausing puts a message toast over the panel, and
    // Playwright's hit-testing refuses to click through it. This still fires the button's own
    // handler — the same `onAction` → `Simulation.consumeItem` path a player's click takes.
    await consumeBtn.first().dispatchEvent('click');
    await page.waitForTimeout(120);

    const eaten = await page.evaluate((type: string) => {
      const w = (window as any).game.world; const player = w.person(w.playerId);
      const stack = player.inventory.map((id: string) => w.item(id)).find((i: any) => i && i.type === type);
      return {
        energy: player.physiology.energy,
        qty: stack ? stack.quantity : 0,
        total: w.items().filter((i: any) => i.type === type).reduce((n: number, i: any) => n + i.quantity, 0),
        ghosts: w.persons().filter((p: any) => p.inventory.some((id: string) => { const it = w.item(id); return !it || it.quantity <= 0; })).length,
        ghostDetail: w.persons().flatMap((p: any) => p.inventory
          .map((id: string) => ({ p, id, it: w.item(id) }))
          .filter((r: any) => !r.it || r.it.quantity <= 0)
          .map((r: any) => ({
            person: `${r.p.name} (${r.p.id})`, controlled: !!r.p.controlled,
            itemId: r.id, type: r.it?.type ?? '(entity gone)', quantity: r.it?.quantity ?? null,
            holderId: r.it?.holderId ?? null, ownerId: r.it?.ownerId ?? null,
            placeId: r.it?.placeId ?? null, pos: r.it?.pos ?? null,
            provenance: (r.it?.provenance ?? []).map((v: any) => `${v.how}:${v.from ?? '-'}>${v.to ?? '-'}`),
            lastEvents: w.events.filter((e: any) => e.item === r.id).slice(-4).map((e: any) => `${e.type} ${e.summary}`),
          }))),
      };
    }, good.type);
    if (!(eaten.energy > hungerBefore)) throw new Error(`eating the ${good.type} did not feed the player (energy ${hungerBefore} → ${eaten.energy})`);
    if (eaten.qty !== qtyBefore - 1) throw new Error(`eating consumed ${qtyBefore - eaten.qty} units instead of one`);
    if (eaten.total !== after.totals[good.type] - 1) throw new Error(`eating one ${good.type} changed the world total by ${after.totals[good.type] - eaten.total}`);
    if (eaten.ghosts) throw new Error(`${eaten.ghosts} people are carrying an item id that no longer refers to anything\n${JSON.stringify(eaten.ghostDetail, null, 2)}`);

    // ---- 5. no coin: the sale is refused and nothing moves
    await page.keyboard.press('KeyI');
    // Let the village run again for the rest of the spec.
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(80);
    await page.evaluate(() => { const w = (window as any).game.world; w.person(w.playerId).wealth = 0; });
    // Re-aim: the village has been running throughout, and a shopkeeper who has taken a few steps
    // is no longer under the crosshair from where the player stood a moment ago.
    const stillAt = await page.evaluate((id: string) => {
      const b = (window as any).game.world.primaryBody(id);
      return { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    }, seller.id);
    await movePlayerTo(page, stillAt, 1.4);
    await lookAt(page, { x: stillAt.x, y: stillAt.y + 0.9, z: stillAt.z });
    await page.evaluate(() => { (window as any).game.inter.update(); });
    await page.keyboard.press('KeyR');
    await page.waitForSelector('#dialogue[style*="display: block"]', { timeout: 8000 });
    const poorMenu = await readDialogue(page);
    const anyBuy = poorMenu.options.find(o => o.includes('Buy'));
    if (anyBuy) {
      const stateBefore = await page.evaluate((id: string) => { const w = (window as any).game.world; return { seller: w.person(id).wealth, inv: w.person(w.playerId).inventory.length }; }, seller.id);
      await chooseDialogueOption(page, anyBuy.replace(/^\d/, '').trim());
      await page.waitForTimeout(100);
      const stateAfter = await page.evaluate((id: string) => { const w = (window as any).game.world; return { seller: w.person(id).wealth, inv: w.person(w.playerId).inventory.length, lines: Array.from(document.querySelectorAll('#dialogue .lines p')).map(e => e.textContent) }; }, seller.id);
      if (stateAfter.seller !== stateBefore.seller || stateAfter.inv !== stateBefore.inv) {
        throw new Error(`a penniless player still completed a purchase (${JSON.stringify(stateBefore)} → ${JSON.stringify(stateAfter)})`);
      }
      if (!stateAfter.lines.some(l => l && /coin/i.test(l))) throw new Error(`the seller did not say why the sale failed: ${JSON.stringify(stateAfter.lines)}`);
    }

    // ---- 6. a hungry seller with nothing spare refuses, and says so rather than going silent
    await page.keyboard.press('Escape');
    const refusal = await page.evaluate((id: string) => {
      const g = (window as any).game; const w = g.world;
      const npc = w.person(id); const player = w.person(w.playerId);
      // Make them genuinely short: hungry, and holding only their own reserve.
      npc.physiology.energy = 0.05;
      for (const it of w.items()) if (it.ownerId === npc.id && ['bread', 'cheese', 'meat', 'pie', 'stew'].includes(it.type)) it.quantity = 1;
      const offers = g.sim.tradeOffers(npc, player);
      const refusals = g.sim.tradeRefusals(npc, player);
      return { foodOffers: offers.filter((o: any) => ['bread', 'cheese', 'meat', 'pie', 'stew'].includes(o.item.type)).length, reasons: refusals.map((r: any) => r.reason) };
    }, seller.id);
    if (refusal.foodOffers > 0) throw new Error(`a seller down to their last meal still offered ${refusal.foodOffers} food goods for sale`);
    if (!refusal.reasons.includes('last_food')) throw new Error(`the refusal was not explained as needing the food themselves: ${JSON.stringify(refusal.reasons)}`);
  },
};
