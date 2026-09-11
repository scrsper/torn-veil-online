import type { World } from '../core/world';
import { B } from '../physical/blocks';
import { makeBody, makePerson, makePlace } from './factory';
import { setExternalControl } from '../runtime/controllers';

/** Explicit isolated developer arena. No saved ordinary world is rearranged. */
export function generateCombatArena(w:World):void {
  w.clock.timeScale=1;
  w.initPhysical(48,8,48);
  for(let x=0;x<48;x++)for(let z=0;z<48;z++)w.grid.set(x,0,z,B.Stone);
  w.grid.initCaches();w.initNav();
  makePlace(w,'square','Contact arena',{x0:1,z0:1,x1:46,z1:46,y0:1,y1:4},{inside:{x:20,y:1,z:20},indoor:false});
  for(let i=0;i<3;i++) {
    const p=makePerson(w,{name:['Arena traveler','Reaction partner','Second partner'][i],gender:'f',age:25,occupation:'traveler',traits:{},appearance:{shirt:i===0?0x335b9e:0xa04c36},bio:'Isolated contact test participant.'});
    p.bodies.push(makeBody(w,p.id,{x:20+i*1.05,y:1,z:i===2?24:20}).id);
    p.mind.thinkInterval=1e12;p.mind.plan=[{type:'wait',duration:1e12,status:'pending'}];
    setExternalControl(p,true);if(i===0)w.playerId=p.id;
    w.primaryBody(p.id)!.yaw=i===0?-Math.PI/2:Math.PI/2;
  }
}
