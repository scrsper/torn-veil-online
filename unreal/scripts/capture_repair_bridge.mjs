// Read-only companion to capture_repair_observation.py; never runs on the UE game thread.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const label=process.argv[2];
if(!/^[a-z0-9-]+$/.test(label??''))throw Error('Supply an evidence label');
const started=performance.now();
const read=async path=>{const r=await fetch('http://127.0.0.1:8787/'+path,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(path+': '+r.status);return r.json();};
const health=await read('health');
if(resolve(health.projectRoot)!==process.cwd())throw Error('Wrong bridge checkout');
const snapshot=await read('snapshot');
const metrics=await read('metrics');
const report={label,utc:new Date().toISOString(),checkout:process.cwd(),health,snapshot,
  diagnostics:{requestWallMs:performance.now()-started,snapshotBytes:Buffer.byteLength(JSON.stringify(snapshot)),
    scheduler:metrics.scheduler,eventLoopMs:metrics.eventLoopMs,memory:metrics.memory}};
writeFileSync(`docs/evidence/foundational-gameplay/retrofit/${label}-bridge.json`,JSON.stringify(report,null,2)+'\n');
console.log({label,bodyId:snapshot.controlledBodyId,container:snapshot.container,diagnostics:report.diagnostics});
