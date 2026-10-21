import { describe,it,expect } from 'vitest';
import { hudReducer,initialHudState,progressFraction,stubObjectives } from '../../src/web/ui/sliceHudState';
import { spawnReveal,onboarding } from '../../src/web/presentation/spawn';
import { towerTheme } from '../../src/web/realms/towerThemes';
describe('presentation reducers',()=>{
 it('uses an empty objective stub, never inventing world needs',()=>expect(stubObjectives.getActiveObjectives()).toEqual([]));
 it('deduplicates updates and reflects authoritative objective corrections',()=>{const objective={id:'scarcity',title:'Deliver grain',description:'Reported shortage',current:3,target:3};let s=hudReducer(initialHudState(),{type:'objective:complete',objective});s=hudReducer(s,{type:'objective:update',objective:{...objective,current:1}});expect(s.objectives).toHaveLength(1);expect(s.objectives[0].complete).toBe(false);expect(s.objectives[0].current).toBe(1);expect(initialHudState().objectives).toEqual([]);});
 it('clamps XP, and does not substitute invented XP for source ranks',()=>{let s=hudReducer(initialHudState(),{type:'progress',rank:'Iron'});expect(s.xp).toBeNull();s=hudReducer(s,{type:'progress',rank:'Iron',xp:120,nextXp:100});expect(progressFraction(s)).toBe(1);expect(progressFraction(hudReducer(s,{type:'progress',rank:'Iron',xp:NaN,nextXp:0}))).toBe(0);});
 it('toggles journal without mutating prior state',()=>{const s=initialHudState();expect(hudReducer(s,{type:'journal'}).journal).toBe(true);expect(s.journal).toBe(false);});
 it('bounds camera reveal and honors reduced motion',()=>{expect(spawnReveal(0,false)).toBe(.22);expect(spawnReveal(4,false)).toBe(0);expect(spawnReveal(0,true)).toBe(0);});
 it('changes themes only at deterministic bands',()=>{expect(towerTheme(1)).toEqual(towerTheme(10));expect(towerTheme(11).name).not.toBe(towerTheme(10).name);expect(towerTheme(21)).toEqual(towerTheme(30));});
});

import { realmWeather,streamingFog } from '../../src/web/realms/realmAtmosphere';
it('reads weather only from supplied state and veils pending streaming',()=>{
 const weather={kind:'rain',intensity:.8,wind:.6};
 expect(realmWeather({weather})).toEqual(weather);
 expect(realmWeather({weather})).not.toBe(weather);
 expect(realmWeather({worldTime:3600,seed:12})).toEqual(realmWeather({worldTime:7200,seed:99}));
 expect(streamingFog(.006,4)).toBe(.008);expect(streamingFog(.01,0)).toBe(.01);
});

it('HUD actions derive only from supplied snapshots/events without rewards or inferred completion',()=>{
 const objective=Object.freeze({id:'need',title:'Need',description:'Host supplied',current:10,target:10,complete:false});
 const start=initialHudState();
 const a=hudReducer(start,{type:'objectives',objectives:[objective]});
 expect(a.objectives[0]).toEqual(objective);expect(a.objectives[0]).not.toBe(objective);
 const b=hudReducer(a,{type:'progress',rank:'Gold'});
 expect(b.objectives).toEqual([objective]);expect(b.xp).toBeNull();
 expect(hudReducer(b,{type:'objectives',objectives:[]}).objectives).toEqual([]);
 expect(hudReducer(start,{type:'objectives',objectives:[objective]})).toEqual(a);
 expect(start).toEqual(initialHudState());
});

import { welcomeKey } from '../../src/web/presentation/spawn';
it('consumes J throughout onboarding and releases it only after dismissal', () => {
 let open = true;
 const welcome = { get open() { return open; }, close() { open = false; } };
 for (let i = 0; i < 3; i++) expect(welcomeKey(welcome, 'KeyJ')).toBe(true);
 expect(open).toBe(true);
 expect(welcomeKey(welcome, 'Enter')).toBe(true);
 expect(open).toBe(false);
 expect(welcomeKey(welcome, 'KeyJ')).toBe(false);
});

describe('welcome ownership across ordinary reloads',()=>{
 const host=(blocked=false)=>{
  const values=new Map<string,string>(),buttons:{onclick?:()=>void}[]=[],removed:unknown[]=[],mounted:unknown[]=[];
  const document={defaultView:{get sessionStorage(){if(blocked)throw Error('Storage denied');return{
   getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};}},
   createElement:()=>{const button={};buttons.push(button);return{className:'',innerHTML:'',querySelector:()=>button,remove(){removed.push(this);}};}};
  return{parent:{ownerDocument:document,append:(element:unknown)=>mounted.push(element)} as unknown as HTMLElement,values,buttons,removed,mounted};
 };
 it('releases interaction keys after a dismissed welcome survives a reload in the same tab',()=>{
  const h=host(),first=onboarding(h.parent,'town');expect(first.open).toBe(true);expect(welcomeKey(first,'KeyE')).toBe(true);
  h.buttons[0].onclick!();expect(first.open).toBe(false);expect(h.removed).toHaveLength(1);
  const reloaded=onboarding(h.parent,'town');expect(reloaded.open).toBe(false);expect(welcomeKey(reloaded,'KeyE')).toBe(false);
  expect(h.mounted).toHaveLength(1);expect(onboarding(h.parent,'other-mode').open).toBe(true);
 });
 it('still permits dismissal when browser storage is unavailable',()=>{
  const h=host(true),welcome=onboarding(h.parent,'town');expect(welcome.open).toBe(true);
  expect(()=>welcome.close()).not.toThrow();expect(welcome.open).toBe(false);expect(h.removed).toHaveLength(1);
 });
 it('leaves views without the town session option unchanged',()=>{
  const h=host();onboarding(h.parent).close();expect(onboarding(h.parent).open).toBe(true);expect(h.values.size).toBe(0);
 });
});
