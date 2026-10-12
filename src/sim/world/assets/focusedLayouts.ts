import {RNG} from '../../core/rng';
import {FOCUSED_CATALOG,placementBounds,type CatalogSource} from './focusedRuntime';
import {joinPlacement,placedPoint,type AssetPlacement,type AssetConnection,type AssetScenePlan} from './focused';
export const FOCUSED_GENERATOR='chrysanthus-focused-2';
const source=(id:string)=>{const s=FOCUSED_CATALOG.sources[id];if(!s)throw Error('Missing approved layout source: '+id);return s;};
const manifestSource=(s:CatalogSource)=>({...s,metadata:'',glb_sha256:s.sha256,metadata_sha256:s.sha256,runtime_controller_tested:false});
export interface FocusedFloorPlan extends AssetScenePlan {start:{x:number;y:number;z:number};exit:{x:number;y:number;z:number};rooms:{id:string;x:number;z:number;w:number;d:number;role:string}[];}
/** Seeded curated grammar: a processional hall, branching junction, finite stores,
 * archive/crypt and periodic boss chamber. Catalog rooms retain their authored form. */
export function focusedFloorPlan(id:string,seed:number,floor:number,origin:{x:number;z:number}):FocusedFloorPlan{
 if(!Number.isInteger(floor)||floor<1||floor>100)throw Error('Tower floor outside 1..100');const rng=new RNG((seed^Math.imul(floor,7349))>>>0);
 const hall=source(`tv_19_0${1+Math.floor(rng.next()*3)}_tower_hall`),junction=source(`tv_44_0${1+Math.floor(rng.next()*3)}_dungeon_junction`),end=source(floor%10===0?'tv_45_01_boss_hall':'tv_02_01_archive_room');
 const a:AssetPlacement={id:id+':hall',assetId:hall.id,position:[origin.x,1,origin.z+20],yaw:0,floorId:id};
 const b=joinPlacement(id+':junction',manifestSource(junction),junction.connectors[0],a,hall.connectors[1],id);
 const c=joinPlacement(id+':archive',manifestSource(end),end.connectors[0],b,junction.connectors[1],id);
 const placements=[a,b,c],connections:AssetConnection[]=[{from:{placementId:a.id,connectorId:hall.connectors[1].id},to:{placementId:b.id,connectorId:junction.connectors[0].id}},{from:{placementId:b.id,connectorId:junction.connectors[1].id},to:{placementId:c.id,connectorId:end.connectors[0].id}}];
 const occupied=new Set(connections.flatMap(e=>[e.from.placementId+':'+e.from.connectorId,e.to.placementId+':'+e.to.connectorId]));
 // One bounded side chamber, chosen independently of simulation RNG.
 const side=source(floor%3===0?'tv_07_01_crypt_rooms':'tv_20_01_cellar_vaults'),sidePort=junction.connectors[2+Math.floor(rng.next()*2)],d=joinPlacement(id+':stores',manifestSource(side),side.connectors[0],b,sidePort,id);
 const db=placementBounds(d),overlap=placements.some(p=>{const box=placementBounds(p);return Math.max(0,Math.min(box.x1,db.x1)-Math.max(box.x0,db.x0))*Math.max(0,Math.min(box.z1,db.z1)-Math.max(box.z0,db.z0))>12;});if(!overlap&&Math.max(Math.abs(db.x0-origin.x),Math.abs(db.x1-origin.x),Math.abs(db.z0-origin.z),Math.abs(db.z1-origin.z))<61){placements.push(d);connections.push({from:{placementId:b.id,connectorId:sidePort.id},to:{placementId:d.id,connectorId:side.connectors[0].id}});occupied.add(b.id+':'+sidePort.id);occupied.add(d.id+':'+side.connectors[0].id);}
 const roomPlacements=[...placements];
 for(const p of roomPlacements)for(const port of source(p.assetId).connectors){if(occupied.has(p.id+':'+port.id)||p===a&&port===hall.connectors[0]||p===c&&port===end.connectors[1])continue;const point=placedPoint(port.gltf_position_m,p),out=placedPoint(port.gltf_outward,{...p,position:[0,0,0]});placements.push({id:p.id+':seal:'+port.id,assetId:'module:wall',position:point,yaw:Math.atan2(out[0],out[2]),floorId:id});}
 const entry=[...placedPoint(hall.connectors[0].gltf_position_m,a)],out=[...placedPoint(end.connectors[1].gltf_position_m,c)];
 // Fold the layout around the slot centre; nothing may spill into a neighbouring address.
 const boxes=roomPlacements.map(placementBounds),z0=Math.min(...boxes.map(b=>b.z0)),z1=Math.max(...boxes.map(b=>b.z1)),shift=origin.z-(z0+z1)/2;
 for(const p of placements)p.position=[p.position[0],p.position[1],p.position[2]+shift];entry[2]+=shift;out[2]+=shift;
 return {version:1,id,seed,generatorVersion:FOCUSED_GENERATOR,packSha256:FOCUSED_CATALOG.packSha256,placements,connections,
  start:{x:entry[0],y:1.0625,z:entry[2]-2},exit:{x:out[0],y:1.0625,z:out[2]+2},rooms:roomPlacements.map(p=>{const b=placementBounds(p);return {id:p.id,x:b.x0+1,z:b.z0+1,w:b.x1-b.x0-2,d:b.z1-b.z0-2,role:'room'};})};
}

export interface FocusedTownPlan extends AssetScenePlan {tower:{id:string;x:number;z:number;w:number;d:number;entry:{x:number;y:number;z:number}};spawn:{x:number;y:number;z:number};bounds:{x0:number;z0:number;x1:number;z1:number};}
/** A curated town/ruins/woodland journey in the existing brass realm. Literal
 * house plans are placed as whole instances; seed variation does not alter rooms. */
export function focusedTownPlan(seed:number):FocusedTownPlan{
 const origin={x:8192+3072+48.5,z:3072+20.5},id='veil:brass:focused-town:v1',floorId=id+':ground';
 const placements:AssetPlacement[]=[],connections:AssetConnection[]=[];
 const add=(key:string,assetId:string,x:number,z:number,yaw=0,y=1)=>{const p:AssetPlacement={id:id+':'+key,assetId,position:[x,y,z],yaw,floorId};placements.push(p);return p;};
 const street=source('tv_36_10_city_street'),main=add('street',street.id,origin.x,origin.z);
 for(const [key,assetId,portId]of [['home-west','tv_26_05_timber_house','P13'],['home-east','tv_26_05_timber_house','P04'],['tavern','tv_31_01_tavern','P03'],['store','tv_32_01_general_store','P14']]){
  const asset=source(assetId),port=asset.connectors.find(c=>c.id===(asset.role==='home'?'frontdoor':'P00'))!,bay=street.connectors.find(c=>c.id===portId);if(!bay)throw Error('Missing town attachment bay');
  const p=joinPlacement(id+':'+key,manifestSource(asset),port,main,bay,floorId);placements.push(p);connections.push({from:{placementId:main.id,connectorId:bay.id},to:{placementId:p.id,connectorId:port.id}});
 }
 // Source paving modules make explicit supported approaches; no invisible ground
 // is laid over the forest's continuous authored terrain.
 const paving=(key:string,x:number,z:number)=>add('path:'+key,'module:floor_paving',origin.x+x,origin.z+z);
 for(const z of [24,28,32,36])paving('wood:'+z,0,z);
 for(const x of [-16,-20,-24,-28])paving('portal:'+x,x,0);
 for(const z of [4,8,12])paving('portal-turn:'+z,-28,z);
 add('veil-arch','module:high_arch',origin.x-28,origin.z+10);
 const wood=source('tv_47_01_pine_forest'),forest=add('forest-cross',wood.id,origin.x,origin.z+64,Math.PI);
 const branch=source('tv_47_03_pine_forest'),f2=joinPlacement(id+':forest-branches',manifestSource(branch),branch.connectors[0],forest,wood.connectors[1],floorId);placements.push(f2);connections.push({from:{placementId:forest.id,connectorId:wood.connectors[1].id},to:{placementId:f2.id,connectorId:branch.connectors[0].id}});
 const broadleaf=source('tv_48_01_broadleaf_forest'),f3=joinPlacement(id+':forest-turn',manifestSource(broadleaf),broadleaf.connectors[0],f2,branch.connectors[1],floorId);placements.push(f3);connections.push({from:{placementId:f2.id,connectorId:branch.connectors[1].id},to:{placementId:f3.id,connectorId:broadleaf.connectors[0].id}});
 const ruin=source('tv_03_01_ruined_cloister'),r=joinPlacement(id+':ruins',manifestSource(ruin),ruin.connectors[0],forest,wood.connectors[2],floorId);placements.push(r);connections.push({from:{placementId:forest.id,connectorId:wood.connectors[2].id},to:{placementId:r.id,connectorId:ruin.connectors[0].id}});
 const exitPort=broadleaf.connectors.find(c=>c.id==='P01')!,point=placedPoint(exitPort.gltf_position_m,f3),out=placedPoint(exitPort.gltf_outward,{...f3,position:[0,0,0]}),yaw=Math.atan2(out[0],out[2]);
 const towerOrigin={x:point[0]+out[0]*6,z:point[2]+out[2]*6};
 const towerPoint=(x:number,z:number,y=1)=>placedPoint([x,y-1,z],{id:'tower-placement',assetId:'module:arch',position:[towerOrigin.x,1,towerOrigin.z],yaw,floorId});
 const module=(key:string,assetId:string,x:number,z:number,rotation=0,y=1)=>{const p=towerPoint(x,z,y);add('tower:'+key,assetId,p[0],p[2],yaw+rotation,p[1]);};
 for(const x of [-4,0,4])for(const z of [-4,0,4])module(`floor:${x}:${z}`,'module:floor_stone',x,z);
 module('entry','module:high_arch',0,-6,Math.PI);
 for(const level of [0,1])for(const x of [-4,0,4]){if(x!==0||level)module(`south:${level}:${x}`,'module:tower_shell_wall',x,-6,0,1+level*7.725);module(`north:${level}:${x}`,'module:tower_shell_wall',x,6,0,1+level*7.725);}
 for(const level of [0,1])for(const z of [-4,0,4])for(const side of [-1,1])module(`side:${level}:${side}:${z}`,'module:tower_shell_wall',side*6,z,Math.PI/2,1+level*7.725);
 module('entry-crown','module:wall',0,-6,0,5.8);module('altar','module:altar',0,3);
 const towerPositions=[towerPoint(-6,-6),towerPoint(6,6)],entry=towerPoint(0,-3),boxes=placements.map(placementBounds),spawn=placedPoint(street.spawn,main);
 return {version:1,id,seed,generatorVersion:FOCUSED_GENERATOR,packSha256:FOCUSED_CATALOG.packSha256,placements,connections,
  spawn:{x:spawn[0],y:1.0625,z:spawn[2]},tower:{id:'veil:brass:chrysanthus',x:Math.min(...towerPositions.map(p=>p[0])),z:Math.min(...towerPositions.map(p=>p[2])),w:12,d:12,entry:{x:entry[0],y:1.0625,z:entry[2]}},
  bounds:{x0:Math.min(...boxes.map(b=>b.x0)),z0:Math.min(...boxes.map(b=>b.z0)),x1:Math.max(...boxes.map(b=>b.x1)),z1:Math.max(...boxes.map(b=>b.z1))}};
}
