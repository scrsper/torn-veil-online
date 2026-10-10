import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,dirname,join} from 'node:path';
import {existsSync} from 'node:fs';
export async function walk(dir){const result=[];for(const f of await readdir(dir,{withFileTypes:true})){const p=join(dir,f.name).replaceAll('\\','/');if(f.isDirectory())result.push(...await walk(p));else result.push(p);}return result;}
const packs=JSON.parse(await readFile('assets/provenance/quaternius-packs.json','utf8'));
const existingAssets=JSON.parse(await readFile('assets/registry.json','utf8').catch(()=>'[]'));
const existingProvenance=JSON.parse(await readFile('assets/provenance/registry.json','utf8').catch(()=>'[]'));
const provenance=[];
for(const pack of packs){const dir=`assets/imported/quaternius/${pack.id.replace('quaternius-','')}`;for(const path of await walk(dir)){const bytes=await readFile(path);provenance.push({...pack,id:`file-${createHash('sha256').update(path).digest('hex').slice(0,16)}`,name:basename(path),originalFilename:basename(path),localPath:path,sha256:createHash('sha256').update(bytes).digest('hex'),parentId:pack.id,notes:'Extracted from verified ZIP. License inherited from parent pack; all original files preserved locally.'});}}
const files=provenance.map(p=>p.localPath);
const find=s=>{const p=files.find(p=>p.endsWith(s));if(!p)throw Error(`Missing asset: ${s}`);return p;};
const selections=[
 ['quaternius-human','Superhero_Male_FullBody.gltf','body','humanoid_standard',['human','base'],'Source superhero proportions; sex/age/morph variants not applied'],
 ['quaternius-human-female','Superhero_Female_FullBody.gltf','body','humanoid_standard',['human','base','female'],'Source superhero proportions; age/morph variants not applied'],
 ['quaternius-ranger','Outfits/Male_Ranger.gltf','component','humanoid_standard',['outfit','ranger'],'Outfit source only; head assembly pending'],
 ['quaternius-peasant','Outfits/Female_Peasant.gltf','component','humanoid_standard',['outfit','peasant'],'Outfit source only; head assembly pending'],
 ['quaternius-imp','Imp.glb','body','humanoid_small',['monster','imp'],'Imp source reference; no animation clips in this file'],
 ['quaternius-puglin','Puglin.glb','body','humanoid_small',['monster','puglin'],'Puglin source reference, not an approved Torn Veil goblin'],
 ['quaternius-ual','UAL1_Standard.glb','animation','humanoid_standard',['animation','humanoid'],'Animation demonstration mannequin; retargeting not yet verified']
];
const assets=[];
for(const [id,suffix,kind,rigFamily,tags,limitation]of selections){
 const sourcePath=find(suffix),prov=provenance.find(p=>p.localPath===sourcePath);const dest=`public/assets/library/${id}`;await mkdir(dest,{recursive:true});
 if(sourcePath.endsWith('.gltf')){
 const gltf=JSON.parse(await readFile(sourcePath,'utf8'));
 // Flatten referenced buffers/images into the public asset folder, rewriting safe relative URIs.
 for(const item of [...(gltf.buffers??[]),...(gltf.images??[])]){if(!item.uri||item.uri.startsWith('data:'))continue;let original=join(dirname(sourcePath),decodeURIComponent(item.uri));const name=basename(original);if(!existsSync(original)){const repaired=name.replace('_png.png','.png');const packRoot=sourcePath.split('/').slice(0,4).join('/');const choices=files.filter(p=>p.startsWith(packRoot)&&basename(p)===repaired&&!p.includes('Normals Unity - Godot'));original=choices[0];if(!original)throw Error(`Missing texture ${name}`);console.log(`Repair texture reference ${name} → ${original}`);}await copyFile(original,`${dest}/${name}`);item.uri=name;}
 await writeFile(`${dest}/model.gltf`,JSON.stringify(gltf));
 }else await copyFile(sourcePath,`${dest}/model.glb`);
 assets.push({id,provider:'quaternius',kind,url:`/assets/library/${id}/model.${sourcePath.endsWith('.gltf')?'gltf':'glb'}`,sourcePath,provenanceId:prov.id,status:'PROTOTYPE',rigFamily,tags,limitations:[limitation],lods:[]});
}
await writeFile('assets/provenance/imported-files.json',JSON.stringify(provenance,null,2));
await writeFile('assets/registry.json',JSON.stringify([...existingAssets.filter(a=>!assets.some(n=>n.id===a.id)),...assets],null,2));
const updated=[...packs,...provenance,...JSON.parse(await readFile('assets/provenance/polyhaven.json','utf8')),...JSON.parse(await readFile('assets/provenance/monsters.json','utf8').catch(()=>'[]'))];
await writeFile('assets/provenance/registry.json',JSON.stringify([...existingProvenance.filter(p=>!updated.some(n=>n.id===p.id)),...updated],null,2));
await mkdir('public/assets/materials',{recursive:true});await copyFile('assets/imported/polyhaven/studio_small_09/studio_small_09_1k.hdr','public/assets/materials/studio_small_09_1k.hdr');
console.log(`${provenance.length} imported files inventoried; ${assets.length} catalog assets staged.`);
