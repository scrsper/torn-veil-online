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
      // Fixture only: supported floor, fixed facing and an idle blindside defender.
      // The browser action and canonical simulation still perform the actual strike.
      for(let x=9;x<=12;x++)for(let z=9;z<=11;z++){
        w.grid.set(x,29,z,3);for(let y=30;y<w.grid.H;y++)w.grid.set(x,y,z,0);
      }
      w.nav.rebuildArea(9,9,12,11);
      ab.pos = { x: 10, y: 30, z: 10 }; tb.pos = { x: 11, y: 30, z: 10 };
      ab.yaw=game.ctrl.yaw=-Math.PI/2;tb.yaw=0;ab.vel=tb.vel={x:0,y:0,z:0};
      target.mind.plan=[{type:'wait',status:'active',duration:1e12,startedAt:w.now}];
      target.mind.thinkInterval=1e12;target.mind.lastThinkAt=w.now;
      ab.dead = false; ab.pose = 'stand'; ab.lastAttackAt = -99;ab.combatAction=undefined;
      const fatigue = player.physiology.fatigue, health = tb.health;
      game.inter.target = { kind: 'body', body: tb, dist: 1 };
      game.inter.attack();
      const actionId=ab.combatAction?.id,spent=player.physiology.fatigue;
      const undecided=ab.combatAction?.phase==='preparation'&&ab.combatAction.outcome==='pending'&&tb.health===health;
      game.inter.attack();
      const cooldown=ab.combatAction?.id===actionId&&player.physiology.fatigue===spent;
      game.stepSim(.2,1/60);
      const preparationSafe=tb.health===health;
      game.stepSim(.3,1/60);
      const event = w.events.filter((e: any) => e.type === 'attack' && e.actor === player.id).at(-1);
      return { undecided,preparationSafe,damaged:tb.health<health,cooldown,
        exerted:spent>fatigue,combat:event?.data.combat,contact:ab.combatAction?.contact,
        action:ab.combatAction,attackerPosition:ab.pos,targetPosition:tb.pos,targetPose:tb.pose };
    });
    if (!result.undecided || !result.preparationSafe || !result.damaged || !result.cooldown || !result.exerted || !result.combat?.hit || result.contact?.region!=='head') {
      throw new Error(`Canonical browser combat failed: ${JSON.stringify(result)}`);
    }
  },
};
