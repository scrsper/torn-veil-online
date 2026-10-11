import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const commit=git('rev-parse','HEAD');
if(git('status','--porcelain','--untracked-files=no'))throw Error('Commit tracked changes before building the current launcher. Use web:dev for development.');
for(const args of [['node_modules/typescript/bin/tsc','--noEmit'],['scripts/web/stage-current-assets.mjs'],['scripts/web/arena/stage-creator.mjs'],['node_modules/vite/bin/vite.js','build','--config','vite.web.config.ts']]){
 const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
}
const index=readFileSync(resolve(root,'dist-web/index.html'));
const motion=JSON.parse(readFileSync(resolve(root,'web/public/arena/runtime-dependencies.json'),'utf8')).files.map(({relative,sha256})=>({relative,sha256}));
const manifest={kind:'torn-veil-current',commit,indexSha256:createHash('sha256').update(index).digest('hex'),motion,builtAt:new Date().toISOString(),entry:'/?realms',progression:'canonical-world',goldPolicy:'paused'};
writeFileSync(resolve(root,'dist-web/current-build.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Current Torn Veil build: ${commit}\nLaunch with Play Torn Veil.cmd. Historical labs require explicit URLs.`);
