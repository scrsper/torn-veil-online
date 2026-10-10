import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {spawn} from 'node:child_process';
import type {IncomingMessage,ServerResponse} from 'node:http';

export class Tooling {
 readonly ontologyRoot=resolve(process.env.TORN_VEIL_ONTOLOGY_ROOT??'tools/ontology');
 private job:{id:number;action:string;state:string;exitCode:number|null;output:string}|null=null;
 constructor(private gameRoot:string){}
 async assetLabStatus(){
  // Fixed read-only loopback endpoint; Asset Lab remains owner of submissions/cancellation.
  try{const response=await fetch('http://127.0.0.1:8192/api/state',{signal:AbortSignal.timeout(1500)});if(!response.ok)throw Error('Unavailable');const value=await response.json();if(value.app!=='Torn Veil Asset Lab')throw Error('Unexpected service');return {ready:true,url:'http://127.0.0.1:8192',backend:value.backend,activeJobs:Array.isArray(value.jobs)?value.jobs.filter((j:{state:string})=>['queued','submitting','running','cancelling'].includes(j.state)).length:0};}
  catch{return {ready:false,url:'http://127.0.0.1:8192',backend:'unavailable',activeJobs:null};}
 }
 async status(){const exists=async(p:string)=>{try{return(await stat(p)).isFile();}catch{return false;}};return {assetLab:await this.assetLabStatus(),ontology:{ready:await exists(resolve(this.ontologyRoot,'dist/index.html')),root:this.ontologyRoot},game:{ready:await exists(resolve(this.gameRoot,'dist-web/index.html'))},arena:{ready:await exists(resolve(this.gameRoot,'dist-web/arena/people_flat/ranger.glb')),note:'Claude action Arena/Tower: browser-only presentation lab, separate from canonical simulation'},job:this.job};}
 run(action:string){
  if(this.job?.state==='running')throw Error('A tooling task is already running');
  const actions:Record<string,{root:string;args:string[]}>= {
   'ontology-typecheck':{root:this.ontologyRoot,args:['node_modules/typescript/bin/tsc','--noEmit']},
   'ontology-check':{root:this.ontologyRoot,args:['node_modules/vitest/vitest.mjs','run','tests/ontology.test.ts','tests/humanoid.test.ts','tests/appearance.test.ts']},
   'ontology-build':{root:this.ontologyRoot,args:['node_modules/vite/bin/vite.js','build']},
   'omni-rebuild':{root:this.gameRoot,args:['scripts/tooling/buildOntology.mjs']},
   'game-typecheck':{root:this.gameRoot,args:['node_modules/typescript/bin/tsc','--noEmit']},
   'web-build':{root:this.gameRoot,args:['node_modules/vite/bin/vite.js','build','--config','vite.web.config.ts']},
   'observatory-check':{root:this.gameRoot,args:['node_modules/vitest/vitest.mjs','run','tests/observatory-workbench.test.ts','tests/observatory-tooling.test.ts']},
  };
  const command=actions[action];if(!command)throw Error('Unsupported tooling action');
  const job={id:Date.now(),action,state:'running',exitCode:null as number|null,output:''};this.job=job;
  const child=spawn(process.execPath,command.args,{cwd:command.root,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
  const append=(x:Buffer|string)=>{job.output=(job.output+x.toString()).slice(-40000);};child.stdout.on('data',append);child.stderr.on('data',append);
  child.on('error',e=>{append(String(e));job.state='failed';});child.on('close',code=>{job.exitCode=code;job.state=code===0?'passed':'failed';});return job;
 }
 async serve(path:string,res:ServerResponse,headers:Record<string,string>){
  if(!path.startsWith('/ontology/'))return false;
  const relative=decodeURIComponent(path.slice('/ontology/'.length))||'index.html';
  let roots=[resolve(this.ontologyRoot,'dist'),resolve(this.ontologyRoot,'public')];let names=[relative];
  if(relative.startsWith('reference-images/')){
   const manifest=JSON.parse(await readFile(resolve(this.ontologyRoot,'references/manifest.json'),'utf8'));
   const reference=manifest.images.find((r:{id:string})=>r.id===relative.slice(17));
   if(!reference){res.writeHead(404,headers);res.end('Unknown reference');return true;}
   roots=[resolve(this.ontologyRoot,'references')];names=[reference.localPath.replace(/^references\//,'')];
  }
  if(path.startsWith('/ontology/assets/shared/')){roots=[resolve(this.gameRoot,'web/public')];names=[path.slice('/ontology/assets/shared/'.length)];}
  for(const root of roots)for(const name of names){
   const file=resolve(root,name);if(!file.startsWith(root+sep)){res.writeHead(403,headers);res.end('Invalid asset path');return true;}
   try{const actual=await realpath(file),actualRoot=await realpath(root);if(!actual.startsWith(actualRoot+sep))continue;
    const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.hdr':'application/octet-stream','.json':'application/json'};
    const mime=types[extname(actual)];if(!mime)continue;const bytes=await readFile(actual);res.writeHead(200,{...headers,'Content-Type':mime});res.end(bytes);return true;
   }catch{/* Try the explicit local public root after build assets. */}
  }
  res.writeHead(404,{...headers,'Content-Type':'text/plain'});res.end('Ontology build or asset missing. Open Tools and run the ontology build.');return true;
 }
}
