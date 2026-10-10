import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const packs = process.argv.length>2?process.argv.slice(2):['universal-base-characters','modular-character-outfits-fantasy','universal-animation-library','bestiary-dungeon-monsters-kit'];
await mkdir('assets/source',{recursive:true});
const records=JSON.parse(await readFile('assets/provenance/quaternius-packs.json','utf8').catch(()=>'[]')).filter(r=>!packs.some(p=>r.id===`quaternius-${p}`));
for(const slug of packs) {
 const url=`https://quaternius.itch.io/${slug}`;
 const response=await fetch(url); const html=await response.text();
 const cookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const csrf=html.match(/name="csrf_token" value="([^"]+)/)?.[1];
 if(!csrf) throw Error('Free download form changed');
 const session=await (await fetch(url+'/download_url',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie,Referer:url},body:new URLSearchParams({csrf_token:csrf})})).json();
 const page=await (await fetch(session.url,{headers:{Cookie:cookie}})).text();
 const upload=page.match(/data-upload_id="(\d+)"/)?.[1];
 const filename=page.match(/title="([^"<>]*\[Standard\]\.zip)"/)?.[1];
 if(!upload||!filename) throw Error('Standard edition not found');
 const link=await (await fetch(`https://quaternius.itch.io/${slug}/file/${upload}?source=game_download&as_props=1`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie,Referer:session.url},body:new URLSearchParams({csrf_token:csrf})})).json();
 if(!link.url) throw Error(JSON.stringify(link));
 const path=`assets/source/${slug}.zip`; let bytes;
 try{bytes=await readFile(path)}catch{const r=await fetch(link.url);if(!r.ok)throw Error(`${r.status}`);bytes=Buffer.from(await r.arrayBuffer());await writeFile(path,bytes)}
 if(bytes.readUInt32LE(0)!==0x04034b50) throw Error('Not a ZIP');
 records.push({id:`quaternius-${slug}`,name:filename,creator:'Quaternius',source:'Quaternius official itch.io',sourceUrl:url,license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',downloadDate:new Date().toISOString(),originalFilename:filename,localPath:path,modificationStatus:'unmodified',redistributionRestrictions:'None (CC0)',sha256:createHash('sha256').update(bytes).digest('hex'),notes:'Free Standard edition only. Upstream did not publish a checksum; SHA-256 records acquired bytes.'});
 console.log(slug,bytes.length);
}
await writeFile('assets/provenance/quaternius-packs.json',JSON.stringify(records,null,2));
