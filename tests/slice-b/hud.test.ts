import { describe,it,expect } from 'vitest';
import { hudReducer,initialHudState,progressFraction,stubObjectives } from '../../src/web/ui/sliceHudState';
import { spawnReveal } from '../../src/web/presentation/spawn';
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
