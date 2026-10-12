import '@babylonjs/loaders/glTF';
import {Color3,PBRMaterial,SceneLoader,TransformNode,type AssetContainer,type Scene} from '@babylonjs/core';
import {parseFocusedManifest,type FocusedManifest,type AssetPlacement} from '../../sim/world/assets/focused';
import type {Atmosphere} from '../world/atmosphere';
import {loadScannedMaps,useScannedMaps} from '../render/materials';
const PACK='f7b0869a795bb28551a31c7831fb6edbfb0716724fca733286e169c0d25926ce';
const sha=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
/** Bounded reusable GLB ownership for the existing realm/Tower renderer. Only
 * the hash-verified handoff activates; missing assets fail visibly, without boxes. */
export class FocusedAssets {
 private containers=new Map<string,AssetContainer>();private loads=new Map<string,Promise<AssetContainer>>();private references=new Map<string,number>();
 private disposed=false;manifest:FocusedManifest|null=null;
 private scanned=new Map<string,ReturnType<typeof loadScannedMaps>>();
 constructor(private scene:Scene,private atmosphere:Atmosphere,private base='/focused/'){}
 async loadManifest():Promise<FocusedManifest>{
  const lockResponse=await fetch(this.base+'pack.lock.json');if(!lockResponse.ok)throw Error('Approved focused asset pack is unavailable');const lock=await lockResponse.json();
  if(lock.schema!=='tornveil.verified-pack'||lock.archiveSha256!==PACK)throw Error('Focused asset handoff is unverified');
  const bytes=await this.bytes('runtime_manifest.json',lock.manifestSha256);this.manifest=parseFocusedManifest(JSON.parse(new TextDecoder().decode(bytes)));
  const record=lock.files.find((f:{path:string})=>f.path===this.manifest!.components_catalog);if(!record)throw Error('Missing verified module catalog');
  const components=JSON.parse(new TextDecoder().decode(await this.bytes(this.manifest.components_catalog,record.sha256))) as Record<string,{glb:string;sha256:string}>;
  for(const [id,c]of Object.entries(components))this.manifest.assets.push({id:'module:'+id,role:'module',glb:c.glb,glb_sha256:c.sha256,metadata:this.manifest.components_catalog,metadata_sha256:record.sha256,connectors:[],runtime_controller_tested:false});
  return this.manifest;
 }
 private async bytes(path:string,hash:string):Promise<ArrayBuffer>{const r=await fetch(this.base+path);if(!r.ok)throw Error('Focused source unavailable: '+path);const bytes=await r.arrayBuffer();if(await sha(bytes)!==hash)throw Error('Focused source hash differs: '+path);return bytes;}
 private async container(id:string):Promise<AssetContainer>{
  if(this.disposed)throw Error('Focused renderer disposed');const cached=this.containers.get(id);if(cached)return cached;const pending=this.loads.get(id);if(pending)return pending;
  const source=this.manifest?.assets.find(a=>a.id===id);if(!source)throw Error('Unknown focused asset: '+id);
  const loading=(async()=>{const bytes=await this.bytes(source.glb,source.glb_sha256);const c=await SceneLoader.LoadAssetContainerAsync('',new Uint8Array(bytes),this.scene,undefined,'.glb');
   if(this.disposed){c.dispose();throw Error('Focused load cancelled');}this.finishMaterials(c,id);this.containers.set(id,c);this.trim();return c;})();
  this.loads.set(id,loading);try{return await loading;}finally{this.loads.delete(id);}
 }
 private finishMaterials(container:AssetContainer,id:string){
  // Existing CC0 scan set; original GLBs and literal architectural topology stay
  // immutable. Source UVs, glass and emissive accents retain their authored roles.
  for(const material of container.materials){if(!(material instanceof PBRMaterial))continue;const name=material.name.toLowerCase().replace(/^tv_/,'').replace(/\.\d+$/,'');let surface='',tint:[number,number,number]=[1,1,1];
   if(name==='plaster'){surface='plastered_wall';tint=[1.05,1,.89];}
   else if(/wood|floor_wood|door/.test(name)){surface=id.includes('forest')?'bark_brown_02':'weathered_planks';tint=name.includes('dark')?[.7,.66,.59]:[1.15,1.08,.93];}
   else if(name==='roof'){surface='roof_slates_02';tint=[.7,.78,.82];}
   else if(name.startsWith('stone')){surface='rock_wall_08';tint=name.includes('dark')?[.7,.78,.72]:[1.1,1.06,.95];}
   else if(/^(earth|soil|grass)$/.test(name)){surface='forest_ground_04';tint=[.85,.95,.78];}
   if(surface){let maps=this.scanned.get(surface);if(!maps){maps=loadScannedMaps(this.scene,surface);this.scanned.set(surface,maps);}useScannedMaps(material,maps);material.albedoColor=new Color3(...tint);material.roughness=.9;material.metallic=0;material.environmentIntensity=.8;}
  }
 }
 async instantiate(p:AssetPlacement,origin:{x:number;z:number}={x:0,z:0}){
  const c=await this.container(p.assetId);if(this.disposed)throw Error('Focused load cancelled');const entries=c.instantiateModelsToScene(n=>p.id+':'+n,false,{doNotInstantiate:false});
  const root=new TransformNode(p.id,this.scene);root.position.set(p.position[0]-origin.x,p.position[1],p.position[2]-origin.z);root.rotation.y=p.yaw;
  root.metadata={assetId:p.assetId,placementId:p.id,packSha256:PACK,floorId:p.floorId};for(const n of entries.rootNodes)n.parent=root;
  const meshes=root.getChildMeshes();for(const m of meshes){m.metadata={...m.metadata,focusedPart:true,placementId:p.id};m.receiveShadows=true;this.atmosphere.addCaster(m);}
  this.references.set(p.assetId,(this.references.get(p.assetId)??0)+1);let released=false;
  return {root,dispose:()=>{if(released)return;released=true;for(const m of meshes)this.atmosphere.removeCaster(m);entries.dispose();root.dispose();this.references.set(p.assetId,Math.max(0,(this.references.get(p.assetId)??1)-1));this.trim();}};
 }
 private trim(){for(const [id,c] of this.containers){if(this.containers.size<=16)break;if((this.references.get(id)??0)===0&&!this.loads.has(id)){c.dispose();this.containers.delete(id);}}}
 dispose(){this.disposed=true;for(const c of this.containers.values())c.dispose();this.containers.clear();for(const maps of this.scanned.values())for(const texture of Object.values(maps))texture.dispose();this.scanned.clear();}
}
