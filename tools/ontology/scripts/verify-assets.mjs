import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import validator from 'gltf-validator';
const registry=JSON.parse(await readFile('assets/registry.json','utf8'));
const provenance=JSON.parse(await readFile('assets/provenance/registry.json','utf8'));
const staged=JSON.parse(await readFile('assets/provenance/public-files.json','utf8'));
for(const p of staged){const bytes=await readFile(p.localPath);if(p.license!=='CC0-1.0'||createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error(`Public provenance mismatch: ${p.localPath}`);}
let errors=0;const reports=[];
for(const asset of registry){
 const path=`public${asset.url}`,bytes=await readFile(path);const p=provenance.find(p=>p.id===asset.provenanceId);if(!p)throw Error(`No provenance: ${asset.id}`);
 const source=await readFile(p.localPath);if(createHash('sha256').update(source).digest('hex')!==p.sha256)throw Error(`Source hash mismatch: ${p.localPath}`);
 const options={uri:path,externalResourceFunction:async uri=>new Uint8Array(await readFile(join(dirname(path),decodeURIComponent(uri))))};
 const report=path.endsWith('.glb')?await validator.validateBytes(new Uint8Array(bytes),options):await validator.validateString(bytes.toString(),options);
 reports.push({id:asset.id,issues:report.issues,info:report.info});errors+=report.issues.numErrors;
 console.log(asset.id,`${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings`);
}
await writeFile('generated/validation/gltf-reports.json',JSON.stringify(reports,null,2));if(errors)process.exitCode=1;
