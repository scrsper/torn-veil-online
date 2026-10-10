import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const records=[];const visited=new Set();
async function folder(id,dir){
 if(visited.has(id))return;visited.add(id);
 const html=await (await fetch(`https://drive.google.com/drive/folders/${id}`)).text();
 const entries=new Map([...html.matchAll(/data-id="([^"]+)"[\s\S]{0,1000}?aria-label="([^"]+)"/g)].filter(m=>!m[2].startsWith('Modified')&&m[2]!=='Shared').map(m=>[m[1],m[2]]));
 for(const [fid,label]of entries){
 if(label.endsWith('Shared folder')){await folder(fid,`${dir}/${label.replace(' Shared folder','')}`);continue;}
 const name=label.match(/^(.+\.(?:fbx|glb|gltf|bin|png|txt|blend|zip))\b/i)?.[1];if(!name)continue;
 // Prefer glTF/FBX sources; avoid redundant OBJ and Blender copies.
 if(/\.blend$/i.test(name))continue;
 await mkdir(dir,{recursive:true});const path=`${dir}/${name}`;let bytes;
 try{bytes=await readFile(path)}catch{const r=await fetch(`https://drive.google.com/uc?export=download&id=${fid}`);if(!r.ok){console.error(`Unavailable ${name}: ${r.status}`);continue;}bytes=Buffer.from(await r.arrayBuffer());if(bytes.subarray(0,100).toString().includes('<!DOCTYPE html')){console.error(`Unavailable (Drive quota/confirmation): ${name}`);continue;}await writeFile(path,bytes);}
 records.push({id:`quaternius-monsters-${fid}`,name,creator:'Quaternius',source:'Ultimate Monsters official linked Google Drive',sourceUrl:'https://quaternius.com/packs/ultimatemonsters.html',downloadUrl:`https://drive.google.com/uc?export=download&id=${fid}`,license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',downloadDate:new Date().toISOString(),originalFilename:name,localPath:path,modificationStatus:'unmodified',redistributionRestrictions:'None (CC0)',sha256:createHash('sha256').update(bytes).digest('hex'),notes:'Official creator-linked Drive source. Upstream checksum unavailable.'});
 console.log(name,bytes.length);
 }
}
try{await folder('18m4KpzpEzhC9wl7jzr6dUc0N8Jozr79C','assets/imported/quaternius/ultimate-monsters');}finally{await writeFile('assets/provenance/monsters.json',JSON.stringify(records,null,2));}
