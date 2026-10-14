/** Only the exact user-downloaded, approved pack can activate the focused kit. */
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep, dirname } from 'node:path';
import { homedir } from 'node:os';
const root=resolve(import.meta.dirname,'../..'),source=resolve(process.argv[2]??resolve(root,'.debug/focused-pack'));
const archive=resolve(process.argv[3]??resolve(homedir(),'Downloads/Torn_Veil_Focused_World_Assets.zip'));
const digest=b=>createHash('sha256').update(b).digest('hex');
const expected='f7b0869a795bb28551a31c7831fb6edbfb0716724fca733286e169c0d25926ce',zip=readFileSync(archive);
if(zip.length!==1817892||digest(zip)!==expected)throw Error('Focused ZIP differs from the authorized handoff. Preserve it; do not activate.');
const manifest=JSON.parse(readFileSync(resolve(source,'runtime_manifest.json'),'utf8'));
if(manifest.schema!=='tornveil.focused-runtime-handoff'||manifest.schema_version!==1||manifest.units!=='meters'||manifest.import_scale!==1||manifest.glb_axes!=='right-handed Y-up')throw Error('Unsupported focused manifest');
const records=readFileSync(resolve(source,'MANIFEST.sha256'),'utf8').trim().split(/\r?\n/).map(line=>{const m=/^([a-f0-9]{64})  (.+)$/.exec(line);if(!m)throw Error('Malformed source hash manifest');return {sha256:m[1],path:m[2]};});
for(const r of records){const p=resolve(source,r.path);if(!p.startsWith(source+sep)||digest(readFileSync(p))!==r.sha256)throw Error('Source file differs: '+r.path);}
for(const a of manifest.assets){if(digest(readFileSync(resolve(source,a.glb)))!==a.glb_sha256||digest(readFileSync(resolve(source,a.metadata)))!==a.metadata_sha256)throw Error('Asset identity differs: '+a.id);}
const destination=resolve(root,'web/public/focused');
for(const r of records){const p=resolve(destination,r.path);if(!p.startsWith(destination+sep))throw Error('Unsafe destination');mkdirSync(dirname(p),{recursive:true});copyFileSync(resolve(source,r.path),p);}
copyFileSync(resolve(source,'MANIFEST.sha256'),resolve(destination,'MANIFEST.sha256'));
writeFileSync(resolve(destination,'pack.lock.json'),JSON.stringify({schema:'tornveil.verified-pack',version:1,archiveSha256:expected,archiveBytes:zip.length,manifestSha256:digest(readFileSync(resolve(source,'runtime_manifest.json'))),files:records},null,2)+'\n');
console.log(JSON.stringify({verified:true,assets:manifest.assets.length,files:records.length,archiveSha256:expected,destination}));
