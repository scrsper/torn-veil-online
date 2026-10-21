import {it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
it('stages only licensed matching hashes and rejects symlink escapes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tv-assets-'));try{
 const source=join(dir,'source'),out=join(dir,'out');await mkdir(source);const bytes=Buffer.from('test glb');const hash=createHash('sha256').update(bytes).digest('hex');await writeFile(join(source,'chest.glb'),bytes);await writeFile(join(dir,'outside.glb'),bytes);await symlink(join(dir,'outside.glb'),join(source,'escape.glb'));
 const entry={id:'chest',path:'chest.glb',license:'CC0-1.0',sha256:hash};await writeFile(join(source,'manifest.json'),JSON.stringify({version:1,assets:[entry,{...entry,id:'wrong',sha256:'0'.repeat(64)},{...entry,id:'escape',path:'escape.glb'},{...entry,id:'no-license',license:''}]}));
 const modulePath=pathToFileURL(join(process.cwd(),'scripts/web/stage-optional-assets.mjs')).href;
 const {stageOptionalAssets}=await import(/* @vite-ignore */ modulePath);expect(await stageOptionalAssets(source,out)).toEqual([entry]);expect(await readFile(join(out,'chest.glb'))).toEqual(bytes);
 expect(await stageOptionalAssets(undefined,out)).toEqual([]);expect(JSON.parse(await readFile(join(out,'manifest.json'),'utf8')).assets).toEqual([]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
