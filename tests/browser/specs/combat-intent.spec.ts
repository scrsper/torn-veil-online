import type { BrowserSpec } from '../run';
import { startGame } from '../helpers';

export const combatIntent: BrowserSpec = {
  name: 'browser attack sends canonical intent and spends fatigue with shared cooldown',
  run: async (page, baseURL) => {
    await startGame(page, 123, baseURL);
    const result = await page.evaluate(() => {
      const game = (window as any).game, w = game.world;
      const player = w.person(w.playerId), ab = game.ctrl.body;
      const target = w.persons().find((p: any) => p.alive && !(p.id === w.playerId));
      const tb = w.primaryBody(target.id);
      // Fixture only: place both bodies in clear canonical space, then use the client action.
      ab.pos = { x: 10, y: 30, z: 10 }; tb.pos = { x: 11, y: 30, z: 10 };
      ab.dead = false; ab.pose = 'stand'; ab.lastAttackAt = -99;
      const fatigue = player.physiology.fatigue, health = tb.health;
      game.inter.target = { kind: 'body', body: tb, dist: 1 };
      game.inter.attack();
      const afterFirst = tb.health;
      game.inter.attack();
      const event = w.events.filter((e: any) => e.type === 'attack' && e.actor === player.id).at(-1);
      return { damaged: afterFirst < health, cooldown: tb.health === afterFirst,
        exerted: player.physiology.fatigue > fatigue, combat: event?.data.combat };
    });
    if (!result.damaged || !result.cooldown || !result.exerted || !result.combat?.hit) {
      throw new Error(`Canonical browser combat failed: ${JSON.stringify(result)}`);
    }
  },
};
