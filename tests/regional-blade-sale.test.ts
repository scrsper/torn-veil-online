import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { actionsForWorldItem } from '../src/sim/core/interaction';

/**
 * A newcomer to the regional world must be able to equip themselves for field work by ordinary
 * purchase. The tavern's skinning knife used to lie in the middle of the room, off any display, so a
 * stranger (who does not know whose it is) was offered only to take it — the seed-918273 hunt
 * adventure tried for a whole world day and never could buy a blade.
 * Disclosed fixture: the keeper and the newcomer are placed at the bar; nothing else is touched.
 */
describe('regional blade sale', () => {
  it('the tavern keeper at the bar offers a stranger the skinning knife for sale', () => {
    const s = new BridgeSession(918273, { playable: true }), w = s.world;
    const player = w.person(w.playerId!)!;
    for (const tavern of w.places().filter(pl => pl.type === 'tavern')) {
      const knife = w.items().find(i => i.type === 'dagger' && i.placeId === tavern.id)!;
      const bar = tavern.anchors.find(a => a.kind === 'display')!;
      expect(Math.hypot(knife.pos!.x - bar.pos.x, knife.pos!.z - bar.pos.z)).toBeLessThan(1.5);
      const keeper = w.person(tavern.ownerId!)!, kb = w.primaryBody(keeper.id)!, pb = w.primaryBody(player.id)!;
      kb.pos = { ...bar.pos, x: bar.pos.x + 0.8 }; kb.pose = 'stand';
      pb.pos = { ...bar.pos, x: bar.pos.x - 0.8 };
      const actions = actionsForWorldItem(w, player, knife);
      expect(actions[0]).toMatchObject({ kind: 'buy', ownerId: keeper.id });
    }
  }, 120_000);
});
