import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {deserialize,newWorld,serialize,SAVE_VERSION} from '../src/sim/persist/save';

const compact=readFileSync(new URL('./fixtures/save-schema30-compact.json',import.meta.url),'utf8');
const reference=JSON.parse(readFileSync(new URL('./fixtures/save-schema30-reference.json',import.meta.url),'utf8'));
const state=(raw:string)=>{const value=JSON.parse(raw);delete value.savedAt;return value;};

describe('historical compact save compatibility',()=>{
 it('loads the actual schema30 writer fixture without changing canonical history or state',()=>{
  const loaded=deserialize(compact);expect(loaded).not.toBeNull();
  const expected={...reference,version:SAVE_VERSION};delete expected.savedAt;
  expect(state(serialize(loaded!.world))).toEqual(expected);
  // A second current-format save/load does not drop receipts, injuries or possessions.
  const current=serialize(loaded!.world,true),again=deserialize(current);
  expect(again).not.toBeNull();expect(state(serialize(again!.world))).toEqual(expected);
  expect(JSON.parse(compact).version).toBe(30);
  expect(JSON.parse(compact).eventEncoding.format).toBe(1);
 });
 it.each([25,26,27,28,29,SAVE_VERSION])('continues compact schema%i village saves',version=>{
  const {world}=newWorld(731),raw=JSON.parse(serialize(world,true));raw.version=version;
  const loaded=deserialize(JSON.stringify(raw));expect(loaded).not.toBeNull();
  expect(state(serialize(loaded!.world))).toEqual(state(serialize(world)));
 });
 it('keeps unsupported versions and corrupt historical event tables fail-closed',()=>{
  for(const damage of [
   (v:any)=>v.version=24,
   (v:any)=>v.version=SAVE_VERSION+1,
   (v:any)=>v.eventEncoding.format=2,
   (v:any)=>v.events[0].pop(),
   (v:any)=>v.events[0][1]=v.eventEncoding.appearances.length,
  ]){const bad=JSON.parse(compact);damage(bad);expect(deserialize(JSON.stringify(bad))).toBeNull();}
 });
});
