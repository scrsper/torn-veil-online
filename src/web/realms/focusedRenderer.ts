import {Material,Mesh,Ray,Vector3,VertexData,type AbstractMesh} from '@babylonjs/core';
import {FocusedAssets} from './focusedAssets';
import type {AssetPlacement,AssetScenePlan} from '../../sim/world/assets/focused';
import type {RenderContext} from '../render/engine';
import type {Atmosphere} from '../world/atmosphere';
import type {MaterialLibrary} from '../render/materials';
import type {FocusedTerrain} from '../../sim/world/assets/focusedTerrain';
import type {SolidBox} from './cameraSolids';
const CAMERA_ARCHITECTURE=/roof|ceiling|wall|crown|door_jamb|column|post/i;
/** Existing scene owner: streamed actual GLB instances, cancellation by stable ID,
 * with camera rays over rendered source geometry. No gameplay lives in this class. */
export class FocusedRenderer {
 private assets:FocusedAssets;private manifest:Promise<unknown>|null=null;private wanted=new Map<string,AssetPlacement>();
 private active=new Map<string,Awaited<ReturnType<FocusedAssets['instantiate']>>>();private loading=new Set<string>();
 private architectureBounds=new Map<string,SolidBox[]>();
 error='';private revision=0;private terrain:Mesh|null=null;private terrainId='';private terrainLoading=false;private terrainAbort:AbortController|null=null;
 constructor(private ctx:RenderContext,private atmosphere:Atmosphere,private origin:{x:number;z:number},private surfaces:MaterialLibrary,private terrainUrl:string|null='/realms/focused/terrain'){this.assets=new FocusedAssets(ctx.scene,atmosphere);}
 get pending(){return this.loading.size+Number(this.terrainLoading);}
 get count(){return this.active.size;}
 /** Cached actual imported-node bounds constrain only the camera cutaway.
  * Actor movement keeps canonical triangles; distant buildings cannot lift it. */
 cameraSolids(position:{x:number;z:number}):SolidBox[]{const result:SolidBox[]=[];
  for(const [id,v]of this.active){let boxes=this.architectureBounds.get(id);if(!boxes){boxes=v.root.getChildMeshes().filter(m=>CAMERA_ARCHITECTURE.test(m.name)&&m.getTotalVertices()>0).map(m=>{m.computeWorldMatrix(true);const b=m.getBoundingInfo().boundingBox,lo=b.minimumWorld,hi=b.maximumWorld;return {x:lo.x-v.root.position.x,y:lo.y-v.root.position.y,z:lo.z-v.root.position.z,w:hi.x-lo.x,h:hi.y-lo.y,d:hi.z-lo.z};});this.architectureBounds.set(id,boxes);}
   for(const b of boxes){const box={...b,x:b.x+v.root.position.x,y:b.y+v.root.position.y,z:b.z+v.root.position.z};if(box.x<position.x+8&&box.x+box.w>position.x-8&&box.z<position.z+8&&box.z+box.d>position.z-8)result.push(box);}
  }return result;
 }
 get forestDetails(){return [...this.active.values()].filter(v=>v.root.metadata?.assetId?.includes('forest')).map(v=>({id:v.root.name,...v.root.metadata,hiddenProxies:v.root.getChildMeshes().filter(m=>m.metadata?.decorativeCanopyProxy&&!m.isEnabled()).length,foliage:v.root.getChildMeshes().filter(m=>m.metadata?.focusedSoftFoliage).map(m=>m.metadata)}));}
 reconcile(plan:AssetScenePlan|null,position:{x:number;z:number}){
  if(this.terrainUrl)this.reconcileTerrain(plan);
  const desired=new Map((plan?.placements??[]).filter(p=>Math.hypot(p.position[0]-position.x,p.position[2]-position.z)<(p.id.includes(':tower:')?230:150)).map(p=>[p.id,p]));this.wanted=desired;
  for(const [id,v]of this.active)if(!desired.has(id)){v.dispose();this.active.delete(id);this.architectureBounds.delete(id);}
  for(const p of desired.values()){
   const existing=this.active.get(p.id);if(existing){existing.root.position.set(p.position[0]-this.origin.x,p.position[1],p.position[2]-this.origin.z);for(const m of existing.root.getChildMeshes())if(m.metadata?.focusedSoftFoliage){const near=Math.hypot(p.position[0]-position.x,p.position[2]-position.z)<85;m.setEnabled(m.metadata.foliageLod==='far'?!near:near);}continue;}
   if(this.loading.has(p.id))continue;this.loading.add(p.id);const revision=this.revision;
   this.manifest??=this.assets.loadManifest();
   void this.manifest.then(()=>this.assets.instantiate(p,this.origin)).then(v=>{if(revision!==this.revision||!this.wanted.has(p.id)){v.dispose();return;}this.active.set(p.id,v);}).catch(e=>{if(this.wanted.has(p.id))this.error=String(e);}).finally(()=>this.loading.delete(p.id));
  }
 }
 private reconcileTerrain(plan:AssetScenePlan|null){
  const id=plan?.id??'';if(id===this.terrainId){if(this.terrain)this.terrain.position.set(-this.origin.x,0,-this.origin.z);return;}
  this.terrainId=id;this.terrainAbort?.abort();this.terrain?.dispose();this.terrain=null;this.terrainLoading=false;if(!id)return;
  const abort=new AbortController();this.terrainAbort=abort;this.terrainLoading=true;
  void fetch(this.terrainUrl!,{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error('Canonical terrain unavailable');return await r.json() as FocusedTerrain;}).then(t=>{
   if(abort.signal.aborted||this.terrainId!==id)return;if(t.id!==id+':terrain')throw Error('Canonical terrain identity differs');
   const mesh=new Mesh(t.id,this.ctx.scene),data=new VertexData(),normals:number[]=[];data.positions=t.positions;data.indices=t.indices;VertexData.ComputeNormals(t.positions,t.indices,normals,{useRightHandedSystem:true});data.normals=normals;data.colors=t.positions.flatMap((_v,i)=>i%3===0?[1,1,1,.7]:[]);data.uvs=t.positions.flatMap((v,i)=>i%3===0?[v*this.surfaces.tilesPerMetre('terrain'),t.positions[i+2]*this.surfaces.tilesPerMetre('terrain')]:[]);data.applyToMesh(mesh);mesh.hasVertexAlpha=false;
   mesh.position.set(-this.origin.x,0,-this.origin.z);mesh.material=this.assets.forestFloorMaterial();mesh.sideOrientation=Material.CounterClockWiseSideOrientation;mesh.receiveShadows=true;mesh.metadata={focusedPart:true,canonicalTerrain:true};this.terrain=mesh;
  }).catch(e=>{if(!abort.signal.aborted)this.error=String(e);}).finally(()=>{if(this.terrainAbort===abort)this.terrainLoading=false;});
 }
 private meshes():AbstractMesh[]{return [...this.active.values()].flatMap(v=>v.root.getChildMeshes());}
 obstruction(from:{x:number;y:number;z:number},dir:{x:number;y:number;z:number},max:number):number|null{
  if(!this.active.size)return null;const ray=new Ray(new Vector3(from.x,from.y,from.z),new Vector3(dir.x,dir.y,dir.z),max),hit=this.ctx.scene.pickWithRay(ray,m=>!!m.metadata?.focusedPart&&m.isEnabled());return hit?.hit?Math.max(0,hit.distance-.45):max;
 }
 blocked(x:number,y:number,z:number):boolean{if(!this.active.size)return false;const point=new Vector3(x,y,z);for(const d of [Vector3.Right(),Vector3.Left(),Vector3.Up(),Vector3.Down(),Vector3.Forward(),Vector3.Backward()]){const hit=this.ctx.scene.pickWithRay(new Ray(point,d,.35),m=>!!m.metadata?.focusedPart&&m.isEnabled());if(hit?.hit)return true;}return false;}
 cutaway(eye:Vector3,body:Vector3){const point=body.add(new Vector3(0,1.3,0)),delta=eye.subtract(point),worldRay=new Ray(point,delta.normalizeToNew(),delta.length());for(const m of this.meshes()){if(!CAMERA_ARCHITECTURE.test(m.name))continue;const localRay=Ray.Transform(worldRay,m.computeWorldMatrix(true).clone().invert());m.visibility=m.intersects(localRay,false).hit?.valueOf()? .12:1;}}
 dispose(){this.revision++;this.terrainAbort?.abort();this.terrain?.dispose();this.wanted.clear();for(const v of this.active.values())v.dispose();this.active.clear();this.architectureBounds.clear();this.assets.dispose();}
}
