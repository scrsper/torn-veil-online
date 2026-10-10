import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const archive='assets/source/makehuman_system_assets_cc0.zip';
const expected=JSON.parse(readFileSync('assets/provenance/registry.json','utf8')).find(p=>p.id==='makehuman-system-cc0').sha256;
if(!existsSync(archive)){
 const url='https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip';
 const response=await fetch(url);if(!response.ok)throw Error(`Official source returned ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Upstream archive changed; review and record new provenance before use');
 mkdirSync('assets/source',{recursive:true});writeFileSync(archive,bytes);
}
if(createHash('sha256').update(readFileSync(archive)).digest('hex')!==expected)throw Error('Archive differs from recorded source');
const python=process.env.PYTHON_PATH??join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const result=spawnSync(python,['scripts/extract-makehuman.py',archive],{stdio:'inherit'});
if(result.error)throw result.error;if(result.status)process.exit(result.status);
