import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const registry=JSON.parse(await readFile('assets/provenance/registry.json','utf8'));
async function walk(p){const result=[];for(const f of await readdir(p,{withFileTypes:true})){const path=`${p}/${f.name}`;if(f.isDirectory())result.push(...await walk(path));else if(!f.name.startsWith('.'))result.push(path);}return result;}
const assets=JSON.parse(await readFile('assets/registry.json','utf8'));const publicRecords=[];
for(const path of await walk('public/assets')){
 // Exact model ownership precedes directory ownership: multiple providers may share entities/.
 const asset=assets.find(a=>path===`public${a.url}`)??assets.find(a=>a.url.endsWith('.gltf')&&path.startsWith(`public${a.url.slice(0,a.url.lastIndexOf('/')+1)}`));
 const parent=asset?registry.find(p=>p.id===asset.provenanceId):registry.find(p=>p.originalFilename===path.split('/').pop());if(!parent)throw Error(`Unlicensed public asset: ${path}`);
 if(parent.license!=='CC0-1.0')throw Error(`Public redistribution requires an explicit policy: ${path}`);
 publicRecords.push({...parent,id:`public-${createHash('sha256').update(path).digest('hex').slice(0,16)}`,parentId:parent.id,localPath:path,name:path.split('/').pop(),sha256:createHash('sha256').update(await readFile(path)).digest('hex'),modificationStatus:path.endsWith('.gltf')?'URI normalization and same-pack missing texture filename repairs':parent.modificationStatus,notes:'Local public staging only; provenance chain identifies original pack and file. No upload or publication performed.'});
}
await writeFile('assets/provenance/public-files.json',JSON.stringify(publicRecords,null,2));console.log(publicRecords.length,'public files covered by CC0 provenance');
