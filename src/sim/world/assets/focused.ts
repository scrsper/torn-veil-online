/** Exact cloud handoff wire contract. Coordinates here are GLB Y-up, already
 * converted; source Z-up metadata must never be applied to rendering a second time. */
export type AssetPoint = readonly [number,number,number];
export interface FocusedConnector {id:string;gltf_position_m:AssetPoint;gltf_outward:AssetPoint;[key:string]:unknown}
export interface FocusedSource {id:string;role:string;glb:string;metadata:string;glb_sha256:string;metadata_sha256:string;
 connectors:FocusedConnector[];strict_static_access_passed?:boolean;runtime_controller_tested:boolean;
 safe_spawn_suggestion?:{gltf_feet_position_m:AssetPoint;runtime_validated:boolean};}
export interface FocusedManifest {schema:'tornveil.focused-runtime-handoff';schema_version:1;units:'meters';import_scale:1;
 glb_axes:'right-handed Y-up';assets:FocusedSource[];components_catalog:string;}
export interface AssetPlacement {id:string;assetId:string;position:AssetPoint;yaw:number;floorId:string;}
export interface AssetConnection {from:{placementId:string;connectorId:string};to:{placementId:string;connectorId:string};}
export interface AssetScenePlan {version:1;id:string;seed:number;generatorVersion:string;packSha256:string;
 placements:AssetPlacement[];connections:AssetConnection[];}
const validPoint=(p:unknown):p is AssetPoint=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const relative=(p:unknown):p is string=>typeof p==='string'&&!p.startsWith('/')&&!p.includes('..')&&!p.includes(':')&&!p.includes('\\');
const hash=(h:unknown)=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
export function parseFocusedManifest(value:unknown):FocusedManifest {
 const m=value as FocusedManifest;
 if(!m||m.schema!=='tornveil.focused-runtime-handoff'||m.schema_version!==1||m.units!=='meters'||m.import_scale!==1||m.glb_axes!=='right-handed Y-up'||!Array.isArray(m.assets)||!relative(m.components_catalog))throw Error('Unsupported focused asset manifest');
 const ids=new Set<string>();
 for(const a of m.assets){if(!a.id||ids.has(a.id)||!relative(a.glb)||!relative(a.metadata)||!hash(a.glb_sha256)||!hash(a.metadata_sha256)||!Array.isArray(a.connectors))throw Error('Invalid focused source identity');ids.add(a.id);
  const ports=new Set<string>();for(const c of a.connectors){if(!c.id||ports.has(c.id)||!validPoint(c.gltf_position_m)||!validPoint(c.gltf_outward)||Math.hypot(...c.gltf_outward)<.99)throw Error('Invalid connector frame');ports.add(c.id);}}
 return m;
}
export function placedPoint(p:AssetPoint,placement:AssetPlacement):AssetPoint {
 const c=Math.cos(placement.yaw),s=Math.sin(placement.yaw);
 return [placement.position[0]+c*p[0]+s*p[2],placement.position[1]+p[1],placement.position[2]-s*p[0]+c*p[2]];
}
/** Align actual authored connector frames, retaining the source's literal layout. */
export function joinPlacement(id:string,source:FocusedSource,port:FocusedConnector,target:AssetPlacement,targetPort:FocusedConnector,floorId:string):AssetPlacement {
 const direction=placedPoint(targetPort.gltf_outward,{...target,position:[0,0,0]}),yaw=Math.atan2(-direction[0],-direction[2])-Math.atan2(port.gltf_outward[0],port.gltf_outward[2]);
 const provisional:AssetPlacement={id,assetId:source.id,position:[0,0,0],yaw,floorId},want=placedPoint(targetPort.gltf_position_m,target),offset=placedPoint(port.gltf_position_m,provisional);
 return {...provisional,position:[want[0]-offset[0],want[1]-offset[1],want[2]-offset[2]]};
}
/** Topology validation is separate from actual capsule/support certification. */
export function validateSceneConnections(plan:AssetScenePlan,manifest:FocusedManifest):void {
 if(!hash(plan.packSha256)||!Number.isInteger(plan.seed)||new Set(plan.placements.map(p=>p.id)).size!==plan.placements.length)throw Error('Invalid stable scene identity');
 const placements=new Map(plan.placements.map(p=>[p.id,p])),sources=new Map(manifest.assets.map(a=>[a.id,a]));
 for(const p of plan.placements)if(!sources.has(p.assetId)||!validPoint(p.position)||!Number.isFinite(p.yaw)||!p.floorId)throw Error('Invalid asset placement');
 const connected=new Map(plan.placements.map(p=>[p.id,new Set<string>()]));
 for(const edge of plan.connections){const a=placements.get(edge.from.placementId),b=placements.get(edge.to.placementId),pa=a&&sources.get(a.assetId)?.connectors.find(c=>c.id===edge.from.connectorId),pb=b&&sources.get(b.assetId)?.connectors.find(c=>c.id===edge.to.connectorId);
  if(!a||!b||!pa||!pb||a.floorId!==b.floorId)throw Error('Unknown or unsupported cross-floor connector');
  const ap=placedPoint(pa.gltf_position_m,a),bp=placedPoint(pb.gltf_position_m,b);if(Math.hypot(...ap.map((v,i)=>v-bp[i]))>.051)throw Error('Unsupported connector seam');
  const ad=placedPoint(pa.gltf_outward,{...a,position:[0,0,0]}),bd=placedPoint(pb.gltf_outward,{...b,position:[0,0,0]});if(ad.reduce((n,v,i)=>n+v*bd[i],0)>-.98)throw Error('Connector directions do not oppose');
  connected.get(a.id)!.add(b.id);connected.get(b.id)!.add(a.id);
 }
 const seen=new Set<string>(),pending=plan.placements.length?[plan.placements[0].id]:[];while(pending.length){const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);pending.push(...connected.get(id)!);}
 if(seen.size!==plan.placements.length)throw Error('Disconnected asset scene');
}
