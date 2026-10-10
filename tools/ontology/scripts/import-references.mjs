import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
// Read-only source access. Run from the ontology project root.
const source=join(process.env.USERPROFILE,'Desktop/projects/character-models');
const manifest=JSON.parse(readFileSync('references/manifest.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const actual=readdirSync(source,{withFileTypes:true});
if(actual.some(d=>!d.isFile())||actual.length!==manifest.images.length)throw Error('Reference inventory changed; inspect new files before importing');
for(const entry of manifest.images){
 const bytes=readFileSync(join(source,entry.originalFilename));
 if(hash(bytes)!==entry.sha256)throw Error(`Source changed: ${entry.originalFilename}`);
 const target=resolve(entry.localPath);
 if(!target.startsWith(resolve('references')+'/')&&!target.startsWith(resolve('references')+'\\'))throw Error('Unsafe destination');
 if(existsSync(target)&&hash(readFileSync(target))!==entry.sha256)throw Error(`Refusing to overwrite a different reference: ${target}`);
 mkdirSync(resolve(target,'..'),{recursive:true});
 if(!existsSync(target))copyFileSync(join(source,entry.originalFilename),target);
}
writeFileSync('generated/reference-inspection/copy-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),count:manifest.images.length,allSourceAndCopyHashesMatch:true},null,2));
console.log(`Verified ${manifest.images.length} originals and byte-identical local copies; originals untouched.`);
