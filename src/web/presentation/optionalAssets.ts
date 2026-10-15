import { SceneLoader, type Scene, type AssetContainer } from '@babylonjs/core';
import { loadOptionalAsset, parseManifest, type AssetManifest } from './assetManifest';
/** GLBs are self-contained; stage script verifies provenance before exposing them. */
export class OptionalAssets {
 private manifest:Promise<AssetManifest>;
 constructor(private scene:Scene){this.manifest=fetch('/arena/creator/optional-assets/manifest.json').then(r=>r.ok?r.json():null).then(parseManifest).catch(()=>parseManifest(null));}
 async load(id:string):Promise<AssetContainer|null>{return loadOptionalAsset(await this.manifest,id,async(url,hash)=>{
  const r=await fetch(url);if(!r.ok)throw Error('unavailable');const bytes=await r.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);const got=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(got!==hash.toLowerCase())throw Error('hash');
  const blob=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'}));try{return await SceneLoader.LoadAssetContainerAsync('',blob,this.scene,undefined,'.glb');}finally{URL.revokeObjectURL(blob);}
 },()=>null);}
}
