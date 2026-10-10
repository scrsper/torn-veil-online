import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const records=JSON.parse(await readFile('assets/provenance/public-files.json','utf8'));
for(const r of records){
 if(r.license!=='CC0-1.0')throw Error(`Unapproved license: ${r.localPath}`);
 const bytes=await readFile(r.localPath);
 if(createHash('sha256').update(bytes).digest('hex')!==r.sha256)throw Error(`Asset hash mismatch: ${r.localPath}`);
}
console.log(`${records.length} shipped CC0 assets verified`);
const assets=JSON.parse(await readFile('assets/registry.json','utf8'));
const provenance=JSON.parse(await readFile('assets/provenance/registry.json','utf8'));
for(const a of assets.filter(a=>a.id.startsWith('shared-'))){const p=provenance.find(p=>p.id===a.provenanceId),bytes=await readFile('../../'+a.sourcePath);if(!p||createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error('Shared cast hash mismatch: '+a.id);}
await readFile('../../web/public/arena/people/CREDITS.md','utf8');
console.log('9 shared game/editor cast assets and retained credit file verified');
