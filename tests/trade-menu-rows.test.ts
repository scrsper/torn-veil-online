import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';

/**
 * The trade menu shows one row per good and price with whole units, and pages instead of silently
 * dropping goods. A regional seller used to show "Buy log" three times (three stacks) and "9.375
 * planks to be had", with anything past the eighth offer cut off. Disclosed fixture: the player is
 * stood beside the seller; the sale itself goes through the ordinary dialogue path.
 */
let seq = 0;
const say = (s: BridgeSession, m: Record<string, unknown>) => s.intent({ version: 1, sequence: ++seq, ...m }).result;

describe('trade menu rows', () => {
  it('lists each good once, in whole units, pages the rest, and a grouped purchase still conserves', () => {
    const s = new BridgeSession(918271, { playable: true }), w = s.world, player = w.person(w.playerId!)!;
    // A seller with several stacks of one good (the sawyer-type stock that showed the duplicates).
    const seller = w.livingPersons().find(q => {
      if (q.id === player.id) return false;
      // The case that showed the defect: one good at one price in several stacks, or a fractional stock.
      const stacks = s.sim.tradeOffers(q, player).filter(o => o.item.quantity > 1);
      const keys = stacks.map(o => `${o.item.type}@${o.unitPrice}`);
      return keys.length !== new Set(keys).size || stacks.some(o => !Number.isInteger(o.available));
    })!;
    expect(seller).toBeTruthy();
    const pb = w.primaryBody(player.id)!, sb = w.primaryBody(seller.id)!;
    pb.pos = { ...sb.pos, x: sb.pos.x + 1 };
    for (let i = 0; i < 30; i++) s.stepInteraction();
    expect(say(s, { type: 'talk', targetBodyId: sb.id })).toBe('accepted');
    const trade = s.snapshot(false).dialogue!.options.find(o => o.label === 'Trade')!;
    expect(say(s, { type: 'dialogue_option', optionId: trade.id })).toBe('accepted');
    const labels: string[] = [];
    for (let page = 0; page < 6; page++) {
      const opts = s.snapshot(false).dialogue!.options.map(o => o.label);
      labels.push(...opts.filter(l => l.startsWith('Buy ')));
      const more = s.snapshot(false).dialogue!.options.find(o => o.label === 'More goods…');
      if (!more) break;
      expect(say(s, { type: 'dialogue_option', optionId: more.id })).toBe('accepted');
    }
    // One row per good AND price: bread sold from two stacks at 2s and 3s is two real offers.
    const goods = labels.map(l => l.replace(/, \d+ to be had/, ''));
    expect(new Set(goods).size, labels.join(" | ")).toBe(goods.length);
    for (const l of labels) expect(l).not.toMatch(/\d+\.\d+ to be had/);
    // Buying through a grouped row: one unit, paid for, received.
    say(s, { type: 'dialogue_close' });
    say(s, { type: 'talk', targetBodyId: sb.id });
    say(s, { type: 'dialogue_option', optionId: s.snapshot(false).dialogue!.options.find(o => o.label === 'Trade')!.id });
    const row = s.snapshot(false).dialogue!.options.find(o => /each, \d+ to be had/.test(o.label))!;
    const units = () => player.inventory.reduce((n, id) => n + (w.item(id)?.quantity ?? 0), 0);
    const before = player.wealth, sellerBefore = seller.wealth, carried = units();
    expect(say(s, { type: 'dialogue_option', optionId: row.id })).toBe('accepted');
    expect(units(), `${row.label} -> ${s.snapshot(false).dialogue?.lines.join(" ")}; wealth ${player.wealth}`).toBe(carried + 1); // one unit, merged into a carried stack of the same good if there is one
    expect(before - player.wealth).toBe(seller.wealth - sellerBefore);
    expect(before - player.wealth).toBeGreaterThan(0);
  }, 120_000);
});
