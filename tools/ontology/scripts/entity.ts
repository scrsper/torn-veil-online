import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {entities,species,providers,states} from '../src/ontology/data';
import {resolveVisual} from '../src/visual/resolver';
const [operation,id]=process.argv.slice(2);
if(!['build','render','validate'].includes(operation)||!id)throw Error('Usage: npm run entity:build -- human_001');
const entity=entities.find(e=>e.id===id||e.biological.species===id);if(!entity)throw Error(`Unknown entity: ${id}`);
const resolved=resolveVisual(entity,species,providers,states);const asset=resolved.bodyAssetId?providers.get(resolved.bodyAssetId):undefined;if(!asset)throw Error(`${entity.name}: unresolved geometry; add licensed source art before building.`);
const stem=`${entity.id}-${resolved.fingerprint}`;
mkdirSync('generated/manifests',{recursive:true});writeFileSync(`generated/manifests/${stem}.json`,JSON.stringify({entity,resolved,asset,artDirectionStatus:'UNSET'},null,2));
const output=operation==='build'?`public/assets/entities/${stem}.glb`:`generated/previews/${stem}`;
const args=[operation,'--input',`public${asset.url}`,'--height',String(resolved.heightM),'--report',`generated/validation/${stem}.json`,'--output',output];
const r=spawnSync(process.execPath,['scripts/blender.mjs',...args],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
if(operation==='build'){
 const registry=JSON.parse(readFileSync('assets/registry.json','utf8'));const provenance=JSON.parse(readFileSync('assets/provenance/registry.json','utf8'));
 const parent=provenance.find((p:{id:string})=>p.id===asset.provenanceId);
 const newId=`processed-${stem}`,provId=`derived-${stem}`;
 const record={...parent,id:provId,parentId:parent.id,name:`Processed ${entity.name}`,originalFilename:parent.originalFilename,localPath:output,sha256:createHash('sha256').update(readFileSync(output)).digest('hex'),modificationStatus:'Blender import, texture-reference repair, uniform meter-scale normalization and ground pivot; GLB export',notes:`Resolver ${resolved.version}; fingerprint ${resolved.fingerprint}. Visual review pending.`};
 const a={...asset,id:newId,provider:'generated',url:output.replace('public',''),sourcePath:output,provenanceId:provId,tags:[...asset.tags,'blender-roundtrip'],limitations:[...asset.limitations,'Processed asset; visual approval pending']};
 writeFileSync('assets/registry.json',JSON.stringify([...registry.filter((a:{id:string})=>a.id!==newId),a],null,2));
 writeFileSync('assets/provenance/registry.json',JSON.stringify([...provenance.filter((p:{id:string})=>p.id!==provId),record],null,2));
 const provenanceCheck=spawnSync(process.execPath,['scripts/public-provenance.mjs'],{stdio:'inherit'});if(provenanceCheck.status!==0)process.exit(provenanceCheck.status??1);
 console.log(`Built ${output}; available under Sources in catalog.`);
}
