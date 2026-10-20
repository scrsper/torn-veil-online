import { it, expect, vi } from 'vitest';
import { RNG } from '../../src/sim/core/rng';
import { towerTheme } from '../../src/web/realms/towerThemes';
import { facadeDressing } from '../../src/web/presentation/dressing';
it('replays themes and dressing for the same seed independently of clocks and unrelated draws',()=>{
 const render=(seed:number)=>Array.from({length:30},(_,i)=>({theme:towerTheme(i+1,seed),dressing:facadeDressing(seed+i)}));
 const expected=render(918271);
 const random=vi.spyOn(Math,'random').mockImplementation(()=>{throw Error('unseeded random');});
 const clock=vi.spyOn(Date,'now').mockImplementation(()=>{throw Error('wall clock');});
 try {
  const unrelated=new RNG(918271);for(let i=0;i<100;i++)unrelated.next();
  expect(render(918271)).toEqual(expected);
  expect(render(42)).not.toEqual(expected);
 } finally {random.mockRestore();clock.mockRestore();}
});
