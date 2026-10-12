/** Offline, reversible migration of a VERIFIED portable canonical save.
 * Never opens a live journal or overwrites an input/output. Export with the
 * original engine first; this tool must not rewrite a journal fingerprint. */
import {readFileSync,openSync,writeFileSync,fsyncSync,closeSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {RealmSession} from '../../src/sim/world/realms/session.ts';
import {loadFocusedGeometry} from '../../src/server/focusedGeometryLoader.ts';
const [inputArg,outputArg]=process.argv.slice(2);if(!inputArg||!outputArg)throw Error('Usage: node --import tsx scripts/world/migrate-focused-world.mjs <verified-portable.json> <NEW-focused.json>');
const input=resolve(inputArg),output=resolve(outputArg),report=output+'.migration.json';
if(input===output||existsSync(output)||existsSync(report))throw Error('Migration output must be new; original input is retained');
const raw=readFileSync(input,'utf8'),digest=s=>createHash('sha256').update(s).digest('hex');loadFocusedGeometry();
const session=new RealmSession(0,raw),before=JSON.parse(raw),run=structuredClone(session.world.canonicalTower),activeBody=run?.active?structuredClone(session.body):null;
session.adoptFocusedWorld(run?{policy:'preserve-canonical-floors-v1',runId:run.id,revision:run.revision}:undefined);
const migrated=session.save(),after=JSON.parse(migrated),restored=new RealmSession(0,migrated);
const stable=['playerId','seed','persons','items','containers','events','interiors','diffs','doors','counters','rng','weatherRng','demographicRng','clock','physicalTime'];
// Resident locations may change to actual town access. Their identity and all
// ordinary player truth remain exact; historical entries are never rewritten.
for(const key of stable)assert.deepEqual(after[key],before[key],`Migration changed ${key}`);
const bodies=new Map(after.bodies.map(body=>[body.id,body]));
for(const body of before.bodies){const next=bodies.get(body.id);assert.ok(next,'Migration removed a body');
 const a={...body},b={...next};
 // A new exterior can require relocation and abandoning its obsolete route.
 // These four fields are the entire permitted body mutation surface.
 for(const key of ['pos','vel','path','pathGoal']){delete a[key];delete b[key];}
 assert.deepEqual(b,a,`Migration changed body truth ${body.id}`);
}
if(run)assert.deepEqual({...restored.world.canonicalTower,returnPos:run.returnPos},run,'Migration changed Tower progress');
if(activeBody)assert.deepEqual(restored.body,activeBody,'Migration changed the active floor body');
assert.deepEqual(restored.person,session.person);
const data={policy:'preserve-canonical-floors-v1',input,inputSha256:digest(raw),output,outputSha256:digest(migrated),schema:after.version,person:session.person.id,body:session.body.id,rank:session.person.ontology.stage,inventory:[...session.person.inventory],tower:run?{id:run.id,floor:run.floor,status:run.status,active:run.active,revision:run.revision,oldReturn:run.returnPos,newReturn:restored.world.canonicalTower.returnPos,retainedFloors:run.floors.length}:null,rollback:'Keep input and its original engine/store; launch it on a separate port. No input bytes or original journal were changed.'};
for(const [path,bytes]of [[output,migrated],[report,JSON.stringify(data,null,2)]]){const fd=openSync(path,'wx');try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
console.log(JSON.stringify({output,report,person:data.person,rank:data.rank,tower:data.tower}));
