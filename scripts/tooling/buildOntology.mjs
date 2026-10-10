import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(process.env.TORN_VEIL_ONTOLOGY_ROOT??'tools/ontology');
for(const args of [['scripts/run-omni.mjs'],['node_modules/typescript/bin/tsc','--noEmit'],['node_modules/vite/bin/vite.js','build']]){
 console.log('Ontology pipeline:',args.join(' '));
 const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true,shell:false});
 if(result.error)throw result.error;if(result.status){process.exitCode=result.status;break;}
}
