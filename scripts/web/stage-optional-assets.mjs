// Optional private art remains outside git. Run with TV_ASSETS_DIR=/path/to/torn-veil-assets.
import { readFile, writeFile, mkdir, copyFile, realpath, rm } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const out=resolve(dirname(fileURLToPath(import.meta.url)),'../../web/public/arena/creator/optional-assets');
export async function stageOptionalAssets(source, destination=out){
 await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});const assets=[];
 if(source)try{
  const root=await realpath(source),manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
  if(manifest.version===1&&Array.isArray(manifest.assets))for(const a of manifest.assets){
   if(!a||!/^[a-z0-9_-]+$/i.test(a.id)||typeof a.path!=='string'||! /^[a-z0-9_/-]+\.glb$/i.test(a.path)||a.path.startsWith('/')||a.path.split('/').some(p=>p==='..'||p==='.')||! /^[a-f0-9]{64}$/i.test(a.sha256)||typeof a.license!=='string'||!a.license.trim()||assets.some(e=>e.id===a.id))continue;
   try{const src=await realpath(resolve(root,a.path)),rel=relative(root,src);if(rel.startsWith('..')||isAbsolute(rel))continue;const bytes=await readFile(src);if(createHash('sha256').update(bytes).digest('hex')!==a.sha256.toLowerCase())continue;const dst=resolve(destination,a.path);await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);assets.push({id:a.id,path:a.path,sha256:a.sha256,license:a.license});}catch{}
  }
 }catch{}
 await writeFile(resolve(destination,'manifest.json'),JSON.stringify({version:1,assets},null,2));return assets;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await stageOptionalAssets(process.env.TV_ASSETS_DIR);
