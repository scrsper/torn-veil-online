import {Vector3} from '@babylonjs/core';
import {Vfx} from '../arena/vfx';
import type {Element} from '../arena/tower/capability';
import type {ArcaneCast} from '../../sim/physical/arcana/types';

/** Bounded presentation of observed receipts. No predicted hit or browser damage. */
export class ObservedArcaneEffects {
 private seen=new Set<string>();
 constructor(private readonly vfx:Vfx){}
 show(casts:(ArcaneCast&{origin:{x:number;y:number;z:number}})[],time:number,offset={x:0,z:0}){
  for(const cast of casts){
   const key=`${cast.id}:${cast.resolved?'resolved':'windup'}`;
   if(cast.cancelled||this.seen.has(key))continue;
   this.seen.add(key);if(this.seen.size>128)this.seen.delete(this.seen.values().next().value!);
   const elements=['flame','frost','storm','swift','iron','shadow','verdance','water','gravity','time'];
   const element=(cast.riders.find(r=>elements.includes(r))??'iron') as Element;
   const from=new Vector3(cast.origin.x-offset.x,cast.origin.y+1.2,cast.origin.z-offset.z),to=new Vector3(cast.target.x-offset.x,cast.origin.y+1.2,cast.target.z-offset.z);
   if(!cast.resolved)this.vfx.core(element,from,.2,Math.max(.05,cast.activeAt-time));
   else if(cast.kernel==='cone'||cast.kernel==='wave')this.vfx.spray(element,from,to.subtract(from).normalize(),cast.range,.65);
   else this.vfx.core(element,['heal','ward','frenzy','imbue'].includes(cast.kernel)?from:to,.6,.35);
  }
 }
}
