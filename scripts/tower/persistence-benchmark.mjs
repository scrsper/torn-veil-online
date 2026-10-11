/** Observed persistence benchmark on a COPY of an earned checkpoint; no climb,
 * synthetic rank grant, history truncation, or original-save overwrite.
 * node --import tsx scripts/tower/persistence-benchmark.mjs <source.json> <new-output-dir> */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {RealmJournal} from '../../src/server/realmJournal.ts';
import {INTERACTION_SPEC} from '../../src/sim/physical/prediction.ts';
const [sourceArg,outArg]=process.argv.slice(2);
if(!sourceArg||!outArg)throw Error('Expected source checkpoint and new evidence directory');
const source=path.resolve(sourceArg),out=path.resolve(outArg),save=path.join(out,'world.json');
if(fs.existsSync(save))throw Error('Use a new output directory; existing benchmark save retained');
fs.mkdirSync(out,{recursive:true});fs.copyFileSync(source,save);
const hash=x=>createHash('sha256').update(x).digest('hex');
const bands=a=>{const s=[...a].sort((a,b)=>a-b);return {count:s.length,p50:s[Math.floor(s.length*.5)]??0,p95:s[Math.floor(s.length*.95)]??0,max:s.at(-1)??0};};
const report={kind:'observed local persistence timings on copied earned save; not human playtime',source,started:new Date().toISOString(),checks:[],baseline:[],flush:[],steps:[],lag:[],checkpoints:[]};
const start=performance.now(),j=new RealmJournal(save,0);await j.ready;report.startupMs=performance.now()-start;report.memoryAfterLoad=process.memoryUsage();
const identity=()=>({id:j.runtime.session.person.id,body:j.runtime.session.body.id,rank:j.runtime.session.person.ontology.stage,inventory:[...j.runtime.session.person.inventory]});
report.identity=identity();let timer=null;
try{
  // Reproduce the previous synchronous capture/write/rename path on a disposable
  // file. No simulation or competing QA runs during these three samples.
  for(let i=0;i<3;i++){const at=performance.now(),raw=j.runtime.session.save();
    fs.writeFileSync(path.join(out,'legacy-checkpoint.tmp'),raw);fs.renameSync(path.join(out,'legacy-checkpoint.tmp'),path.join(out,'legacy-checkpoint.json'));
    report.baseline.push(performance.now()-at);}
  // This file is only the just-created redundant benchmark output, not a user's save.
  fs.unlinkSync(path.join(out,'legacy-checkpoint.json'));
  j.apply({type:'bind',id:'benchmark',epoch:'benchmark-epoch'});let sequence=0,last=performance.now(),background=null;
  timer=setInterval(()=>{const now=performance.now();report.lag.push(Math.max(0,now-last-20));last=now;},20);
  for(let i=0;i<600;i++){
    const now=performance.now();
    if(i%10===0)j.apply({type:'command',now,input:{version:2,type:'command',epoch:'benchmark-epoch',controllerId:'benchmark',bodyId:j.runtime.session.body.id,specRevision:INTERACTION_SPEC.revision,
      sequence,commandId:`benchmark-${sequence++}`,clientTimeMs:now,command:{type:'guard',held:false}}});
    const at=performance.now();j.apply({type:'step',now});report.steps.push(performance.now()-at);if(i%6===0)j.apply({type:'frame'});
    if(i%90===89){const at=performance.now();await j.flush();report.flush.push(performance.now()-at);}
    if(i===150)background=j.checkpoint().then(m=>report.checkpoints.push(m));
    await new Promise(r=>setTimeout(r,Math.max(0,16.667-(performance.now()-now))));
  }
  await background;report.checkpoints.push(await j.checkpoint());clearInterval(timer);timer=null;
  const canonical=r=>{const o=JSON.parse(r.session.save());delete o.savedAt;return Object.fromEntries(Object.keys(o).map(k=>[k,hash(JSON.stringify(o[k]))]));};
  const before=canonical(j.runtime),loaded=j.store.load(0),after=canonical(loaded.runtime);
  report.differences=Object.keys(before).filter(k=>before[k]!==after[k]);
  report.checks.push({name:'all canonical fields match the worker checkpoint exactly',ok:report.differences.length===0});
  report.checks.push({name:'identity inventory and rank unchanged',ok:JSON.stringify(identity())===JSON.stringify(report.identity)});
  report.checks.push({name:'imported source copy unchanged',ok:hash(fs.readFileSync(save))===hash(fs.readFileSync(source))});
  report.memoryAfterAudit=process.memoryUsage();report.metrics=j.metrics;
  for(const key of ['baseline','flush','steps','lag'])report[key]=bands(report[key]);
  // Leave a real committed tail, interrupt the replica during the next large
  // checkpoint, and replay the durable tail. Never acknowledge the unflushed step.
  for(let i=0;i<12;i++)j.apply({type:'step',now:performance.now()});await j.flush();
  const expected=canonical(j.runtime),manifestBefore=j.store.manifest().worldFile;
  let interruption='completed';const writing=j.checkpoint().catch(e=>{interruption=String(e);});
  await new Promise(r=>setTimeout(r,100));j.apply({type:'step',now:performance.now()});await j.abort();await writing;
  const recovered=canonical(j.store.load(0).runtime);
  report.interruption={result:interruption,previousBaseRetained:j.store.manifest().worldFile===manifestBefore};
  report.checks.push({name:'interrupted worker recovers exact durable tail and excludes unflushed input',ok:JSON.stringify(recovered)===JSON.stringify(expected)});
  const resumed=new RealmJournal(save,0);await resumed.ready;await resumed.close();
}catch(e){report.error=String(e);if(timer)clearInterval(timer);await j.abort();process.exitCode=1;}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({checks:report.checks,error:report.error,baseline:report.baseline,flush:report.flush,steps:report.steps,lag:report.lag,checkpoints:report.checkpoints},null,2));
assert.ok(!report.error&&report.checks.length===4&&report.checks.every(c=>c.ok),'Persistence benchmark failed; inspect retained evidence');
