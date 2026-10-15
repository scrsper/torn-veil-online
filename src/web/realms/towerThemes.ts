import { RNG } from '../../sim/core/rng';
/** Palette only: floor state and all mechanics remain host-owned. */
export function towerTheme(floor:number, seed = 0){
 const band=Math.floor((Math.max(1,Math.min(100,Math.floor(floor)||1))-1)/10)%3;
 const themes = [
  {name:'Stone sanctum',wall:'#8a8174',floor:'#afa18a',metal:'#bd9b58'},
  {name:'Aether archive',wall:'#526d83',floor:'#819ca9',metal:'#72d9e6'},
  {name:'Brass foundry',wall:'#826853',floor:'#ac9274',metal:'#d4a05b'},
 ];
 return new RNG(seed).fork(0x5448454d).shuffle(themes)[band];
}
