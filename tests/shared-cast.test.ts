import {describe,it,expect} from 'vitest';
import {sharedLook} from '../src/web/actors/sharedCast';
describe('shared cast identity',()=>{
 it('uses stable compatible sex-specific casts without changing body identity',()=>{
  const a={bodyId:'body-a',presentationSex:'f' as const},b={bodyId:'body-b',presentationSex:'m' as const};
  const before=JSON.stringify([a,b]);expect(['wren','raider_f']).toContain(sharedLook(a));expect(['ranger','brann','soldier','archer','mystic']).toContain(sharedLook(b));expect(sharedLook(a)).toBe(sharedLook({...a}));expect(JSON.stringify([a,b])).toBe(before);
  expect(new Set(Array.from({length:20},(_,i)=>sharedLook({bodyId:'b_'+(i*2+1),presentationSex:'f'}))).size).toBe(2);
 });
});
