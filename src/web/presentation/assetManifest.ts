export interface AssetEntry { id:string; path:string; sha256:string; license:string }
export interface AssetManifest { version:1; assets:AssetEntry[] }
export function validAsset(entry: unknown): entry is AssetEntry {
 const a=entry as AssetEntry;return !!a&&typeof a.id==='string'&&/^[a-z0-9_-]+$/i.test(a.id)&&typeof a.path==='string'&&/^[a-z0-9_/-]+\.glb$/i.test(a.path)&&!a.path.split('/').some(p=>p==='..'||p==='.')&&!a.path.startsWith('/')&&/^[a-f0-9]{64}$/i.test(a.sha256)&&typeof a.license==='string'&&a.license.trim().length>0;
}
export function parseManifest(value:unknown):AssetManifest {
 const m=value as AssetManifest;if(m?.version!==1||!Array.isArray(m.assets))return {version:1,assets:[]};
 const ids=new Set<string>();return {version:1,assets:m.assets.filter(a=>{if(!validAsset(a)||ids.has(a.id))return false;ids.add(a.id);return true;})};
}
/** Missing, corrupt or unavailable optional art must preserve the existing fallback. */
export async function loadOptionalAsset<T>(manifest:AssetManifest,id:string,load:(url:string,sha256:string)=>Promise<T>,fallback:()=>T|Promise<T>):Promise<T>{
 const entry=manifest.assets.find(a=>a.id===id&&validAsset(a));if(entry)try{return await load(`/arena/creator/optional-assets/${entry.path}`,entry.sha256);}catch{}
 return fallback();
}
