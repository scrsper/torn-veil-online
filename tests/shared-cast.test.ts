import {describe,it,expect} from 'vitest';
import {sharedLook,worldCastRole,castLookFor} from '../src/web/actors/sharedCast';
import {CAST_BODIES} from '../src/web/presentation/library';
describe('shared cast identity',()=>{
 it('uses stable compatible sex-specific casts without changing body identity',()=>{
  const a={bodyId:'body-a',presentationSex:'f' as const},b={bodyId:'body-b',presentationSex:'m' as const};
  const before=JSON.stringify([a,b]);expect(sharedLook(a)).toBe('npc_f');expect(sharedLook(b)).toBe('npc_m');expect(sharedLook(a)).toBe(sharedLook({...a}));expect(JSON.stringify([a,b])).toBe(before);
  expect(new Set(Array.from({length:20},(_,i)=>sharedLook({bodyId:'b_'+(i*2+1),presentationSex:'f'}))).size).toBe(1);
 });
});
describe('world client cast roles (Combat Gym, town)',()=>{
 it('draws the controlled body as the provisional player and everyone else as residents',()=>{
  expect(worldCastRole('body-1','body-1')).toBe('player');expect(worldCastRole('body-2','body-1')).toBe('resident');expect(worldCastRole('','')).toBe('resident');
  const m={bodyId:'body-1',presentationSex:'m' as const},f={bodyId:'body-2',presentationSex:'f' as const};
  expect(castLookFor(m,worldCastRole(m.bodyId,'body-1'))).toBe('player_m');expect(castLookFor(f,worldCastRole(f.bodyId,'body-2'))).toBe('player_f');
  expect(castLookFor(f,worldCastRole(f.bodyId,'body-1'))).toBe('npc_f');expect(castLookFor(m,'warden')).toBe('warden');
  expect(CAST_BODIES.player_m.file).toBe('tv-human-male-v2.glb');
 });
});
