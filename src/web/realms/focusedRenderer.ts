import {Ray,Vector3,type AbstractMesh} from '@babylonjs/core';
import {FocusedAssets} from './focusedAssets';
import type {AssetPlacement,AssetScenePlan} from '../../sim/world/assets/focused';
import type {RenderContext} from '../render/engine';
import type {Atmosphere} from '../world/atmosphere';
/** Existing scene owner: streamed actual GLB instances, cancellation by stable ID,
 * with camera rays over rendered source geometry. No gameplay lives in this class. */
export class FocusedRenderer {
 private assets:FocusedAssets;private manifest:Promise<unknown>|null=null;private wanted=new Map<string,AssetPlacement>();
 private active=new Map<string,Awaited<ReturnType<FocusedAssets['instantiate']>>>();private loading=new Set<string>();
 error='';private revision=0;
 constructor(private ctx:RenderContext,private atmosphere:Atmosphere,private origin:{x:number;z:number}){this.assets=new FocusedAssets(ctx.scene,atmosphere);}
 get pending(){return this.loading.size;}
 get count(){return this.active.size;}
 reconcile(plan:AssetScenePlan|null,position:{x:number;z:number}){
  const desired=new Map((plan?.placements??[]).filter(p=>Math.hypot(p.position[0]-position.x,p.position[2]-position.z)<(p.id.includes(':tower:')?230:150)).map(p=>[p.id,p]));this.wanted=desired;
  for(const [id,v]of this.active)if(!desired.has(id)){v.dispose();this.active.delete(id);}
  for(const p of desired.values()){
   const existing=this.active.get(p.id);if(existing){existing.root.position.set(p.position[0]-this.origin.x,p.position[1],p.position[2]-this.origin.z);continue;}
   if(this.loading.has(p.id))continue;this.loading.add(p.id);const revision=this.revision;
   this.manifest??=this.assets.loadManifest();
   void this.manifest.then(()=>this.assets.instantiate(p,this.origin)).then(v=>{if(revision!==this.revision||!this.wanted.has(p.id)){v.dispose();return;}this.active.set(p.id,v);}).catch(e=>{if(this.wanted.has(p.id))this.error=String(e);}).finally(()=>this.loading.delete(p.id));
  }
 }
 private meshes():AbstractMesh[]{return [...this.active.values()].flatMap(v=>v.root.getChildMeshes());}
 obstruction(from:{x:number;y:number;z:number},dir:{x:number;y:number;z:number},max:number):number|null{
  if(!this.active.size)return null;const ray=new Ray(new Vector3(from.x,from.y,from.z),new Vector3(dir.x,dir.y,dir.z),max),hit=this.ctx.scene.pickWithRay(ray,m=>!!m.metadata?.focusedPart&&m.isEnabled());return hit?.hit?Math.max(0,hit.distance-.3):max;
 }
 blocked(x:number,y:number,z:number):boolean{if(!this.active.size)return false;const point=new Vector3(x,y,z);for(const d of [Vector3.Right(),Vector3.Left(),Vector3.Up(),Vector3.Down(),Vector3.Forward(),Vector3.Backward()]){const hit=this.ctx.scene.pickWithRay(new Ray(point,d,.35),m=>!!m.metadata?.focusedPart&&m.isEnabled());if(hit?.hit)return true;}return false;}
 cutaway(eye:Vector3,body:Vector3){for(const m of this.meshes()){const architectural=/roof|ceiling|wall|crown/i.test(m.name);if(!architectural)continue;const point=body.add(new Vector3(0,1.3,0)),delta=eye.subtract(point);m.visibility=m.intersects(new Ray(point,delta.normalizeToNew(),delta.length()),false).hit?.valueOf()? .12:1;}}
 dispose(){this.revision++;this.wanted.clear();for(const v of this.active.values())v.dispose();this.active.clear();this.assets.dispose();}
}
