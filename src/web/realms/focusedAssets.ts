import '@babylonjs/loaders/glTF';
import {SceneLoader,TransformNode,type AssetContainer,type Scene} from '@babylonjs/core';
import {parseFocusedManifest,type FocusedManifest,type AssetPlacement} from '../../sim/world/assets/focused';
import type {Atmosphere} from '../world/atmosphere';
const PACK='f7b0869a795bb28551a31c7831fb6edbfb0716724fca733286e169c0d25926ce';
const sha=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
/** Bounded reusable GLB ownership for the existing realm/Tower renderer. Only
 * the hash-verified handoff activates; missing assets fail visibly, without boxes. */
export class FocusedAssets {
 private containers=new Map<string,AssetContainer>();private loads=new Map<string,Promise<AssetContainer>>();private references=new Map<string,number>();
 private disposed=false;manifest:FocusedManifest|null=null;
 constructor(private scene:Scene,private atmosphere:Atmosphere,private base='/focused/'){}
 async loadManifest():Promise<FocusedManifest>{
  const lockResponse=await fetch(this.base+'pack.lock.json');if(!lockResponse.ok)throw Error('Approved focused asset pack is unavailable');const lock=await lockResponse.json();
  if(lock.schema!=='tornveil.verified-pack'||lock.archiveSha256!==PACK)throw Error('Focused asset handoff is unverified');
  const bytes=await this.bytes('runtime_manifest.json',lock.manifestSha256);this.manifest=parseFocusedManifest(JSON.parse(new TextDecoder().decode(bytes)));return this.manifest;
 }
 private async bytes(path:string,hash:string):Promise<ArrayBuffer>{const r=await fetch(this.base+path);if(!r.ok)throw Error('Focused source unavailable: '+path);const bytes=await r.arrayBuffer();if(await sha(bytes)!==hash)throw Error('Focused source hash differs: '+path);return bytes;}
 private async container(id:string):Promise<AssetContainer>{
  if(this.disposed)throw Error('Focused renderer disposed');const cached=this.containers.get(id);if(cached)return cached;const pending=this.loads.get(id);if(pending)return pending;
  const source=this.manifest?.assets.find(a=>a.id===id);if(!source)throw Error('Unknown focused asset: '+id);
  const loading=(async()=>{const bytes=await this.bytes(source.glb,source.glb_sha256);const c=await SceneLoader.LoadAssetContainerAsync('',new Uint8Array(bytes),this.scene,undefined,'.glb');
   if(this.disposed){c.dispose();throw Error('Focused load cancelled');}this.containers.set(id,c);this.trim();return c;})();
  this.loads.set(id,loading);try{return await loading;}finally{this.loads.delete(id);}
 }
 async instantiate(p:AssetPlacement,origin:{x:number;z:number}={x:0,z:0}){
  const c=await this.container(p.assetId);if(this.disposed)throw Error('Focused load cancelled');const entries=c.instantiateModelsToScene(n=>p.id+':'+n,false,{doNotInstantiate:false});
  const root=new TransformNode(p.id,this.scene);root.position.set(p.position[0]-origin.x,p.position[1],p.position[2]-origin.z);root.rotation.y=p.yaw;
  root.metadata={assetId:p.assetId,placementId:p.id,packSha256:PACK,floorId:p.floorId};for(const n of entries.rootNodes)n.parent=root;
  const meshes=root.getChildMeshes();for(const m of meshes){m.receiveShadows=true;this.atmosphere.addCaster(m);}
  this.references.set(p.assetId,(this.references.get(p.assetId)??0)+1);let released=false;
  return {root,dispose:()=>{if(released)return;released=true;for(const m of meshes)this.atmosphere.removeCaster(m);entries.dispose();root.dispose();this.references.set(p.assetId,Math.max(0,(this.references.get(p.assetId)??1)-1));this.trim();}};
 }
 private trim(){for(const [id,c] of this.containers){if(this.containers.size<=16)break;if((this.references.get(id)??0)===0&&!this.loads.has(id)){c.dispose();this.containers.delete(id);}}}
 dispose(){this.disposed=true;for(const c of this.containers.values())c.dispose();this.containers.clear();}
}
