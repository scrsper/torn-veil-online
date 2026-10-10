import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const headers={'User-Agent':'TornVeilOntology/0.1 (local asset authoring; Poly Haven attribution)'};
const curated=['studio_small_09','poly_haven_studio','forest_slope','rock_boulder_dry','wood_planks_dirt','metal_plate','brown_mud_03','fabric_pattern_07'];
const selected=process.argv.slice(2); const ids=selected.length?selected:curated.filter(x=>x!=='poly_haven_studio');
const records=[];
for(const id of ids){
 const response=await fetch(`https://api.polyhaven.com/files/${id}`,{headers});if(!response.ok){console.error(id,response.status);continue;}
 const files=await response.json();const metaResponse=await fetch(`https://api.polyhaven.com/info/${id}`,{headers});const meta=metaResponse.ok?await metaResponse.json():{};
 const choices=files.hdri?[['hdri',files.hdri['1k']?.hdr]]:Object.entries(files).filter(([k])=>/^(diff|diffuse|nor_gl|rough|metal|ao)$/i.test(k)).map(([k,v])=>[k,v['1k']?.jpg??v['1k']?.png]);
 for(const [map,file] of choices){if(!file?.url)continue;const filename=decodeURIComponent(new URL(file.url).pathname.split('/').pop());const path=`assets/imported/polyhaven/${id}/${filename}`;await mkdir(`assets/imported/polyhaven/${id}`,{recursive:true});let bytes;try{bytes=await readFile(path)}catch{const r=await fetch(file.url,{headers});if(!r.ok)throw Error(`${id}: ${r.status}`);bytes=Buffer.from(await r.arrayBuffer());await writeFile(path,bytes);}
 if(file.md5&&createHash('md5').update(bytes).digest('hex')!==file.md5)throw Error(`Checksum mismatch: ${path}`);
 records.push({id:`polyhaven-${id}-${map}`,name:meta.name??id,creator:Object.keys(meta.authors??{}).join(', ')||'Poly Haven contributors',source:'Poly Haven',sourceUrl:`https://polyhaven.com/a/${id}`,license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',downloadDate:new Date().toISOString(),originalFilename:filename,localPath:path,modificationStatus:'unmodified',redistributionRestrictions:'None (CC0); live API requires attribution and unique User-Agent',sha256:createHash('sha256').update(bytes).digest('hex'),notes:`Curated 1K ${map}; upstream MD5 ${file.md5??'not supplied'}`});
 }console.log('Poly Haven',id,choices.length);
}
await writeFile('assets/provenance/polyhaven.json',JSON.stringify(records,null,2));
if(!records.length)process.exitCode=1;
