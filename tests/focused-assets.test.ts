import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseFocusedManifest,joinPlacement,validateSceneConnections,type AssetScenePlan} from '../src/sim/world/assets/focused';
const raw=JSON.parse(readFileSync('web/public/focused/runtime_manifest.json','utf8'));
describe('verified focused handoff connector contract',()=>{
 it('accepts the exact delivered schema without converting GLB axes again',()=>{
  const m=parseFocusedManifest(raw);expect(m.assets).toHaveLength(21);expect(m.assets.find(a=>a.role==='home')!.id).toBe('tv_26_05_timber_house');expect(m.assets.find(a=>a.role==='home')!.strict_static_access_passed).toBe(true);
  expect(()=>parseFocusedManifest({...raw,import_scale:100})).toThrow();expect(()=>parseFocusedManifest({...raw,glb_axes:'Z-up'})).toThrow();
 });
 it('joins actual authored frames at arbitrary placement and rejects open seams',()=>{
  const m=parseFocusedManifest(raw),a=m.assets.find(a=>a.id==='tv_19_01_tower_hall')!,b=m.assets.find(a=>a.id==='tv_02_01_archive_room')!;
  const first={id:'floor:1:hall',assetId:a.id,position:[6208,1,64] as const,yaw:Math.PI/2,floorId:'floor:1'};
  const second=joinPlacement('floor:1:archive',b,b.connectors[0],first,a.connectors[1],'floor:1');
  const p:AssetScenePlan={version:1,id:'tower:floor:1',seed:918271,generatorVersion:'focused-1',packSha256:'f7b0869a795bb28551a31c7831fb6edbfb0716724fca733286e169c0d25926ce',placements:[first,second],connections:[{from:{placementId:first.id,connectorId:a.connectors[1].id},to:{placementId:second.id,connectorId:b.connectors[0].id}}]};
  expect(()=>validateSceneConnections(p,m)).not.toThrow();p.placements[1]={...second,position:[second.position[0]+1,second.position[1],second.position[2]]};expect(()=>validateSceneConnections(p,m)).toThrow('seam');
 });
});
