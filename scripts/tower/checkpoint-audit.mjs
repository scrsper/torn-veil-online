/** Audit an existing earned checkpoint without advancing or overwriting it.
 * node --import tsx scripts/tower/checkpoint-audit.mjs input.json report.json */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { RealmSession } from '../../src/sim/world/realms/session.ts';
import { towerResidency } from '../../src/sim/world/interiors/residency.ts';
const [input,output]=process.argv.slice(2);assert.ok(input&&output,'Supply a saved checkpoint and a separate report path');
assert.notEqual(path.resolve(input),path.resolve(output),'Never overwrite the checkpoint');
const readStart=performance.now(),raw=fs.readFileSync(input,'utf8'),readMs=performance.now()-readStart;
const loadStart=performance.now(),session=new RealmSession(0,raw),loadMs=performance.now()-loadStart;
const w=session.world,p=session.person,b=session.body,run=w.canonicalTower;assert.ok(run,'Canonical run required');
const afterLoadMemory=process.memoryUsage();
const before={person:p.id,body:b.id,rank:p.ontology.stage,health:b.health,injuries:b.injuries,inventory:p.inventory,arcana:p.arcana};
const saveStart=performance.now(),saved=session.save(),serializeMs=performance.now()-saveStart,afterSerializationMemory=process.memoryUsage();
const reloadStart=performance.now(),again=new RealmSession(0,saved),reloadMs=performance.now()-reloadStart;
assert.deepEqual({person:again.person.id,body:again.body.id,rank:again.person.ontology.stage,health:again.body.health,injuries:again.body.injuries,inventory:again.person.inventory,arcana:again.person.arcana},before);
assert.deepEqual(again.world.canonicalTower,run);
assert.equal(new Set(run.floors.flatMap(f=>f.rewardItemIds)).size,run.floors.flatMap(f=>f.rewardItemIds).length);
const clearEvents=run.floors.filter(f=>f.clearEventId).map(f=>w.event(f.clearEventId));
assert.ok(clearEvents.every(e=>e?.type==='tower_floor_cleared'));
const integrations=[];let currentFloor=0;
for(const e of w.events){if(e.type==='tower_floor_opened')currentFloor=e.data.floor;
 if(e.type==='ontological_advancement'&&e.actor===p.id)integrations.push({eventId:e.id,from:e.data.from,to:e.data.to,floor:currentFloor,worldTick:e.tick,materials:e.data.materialAmounts?.reduce((n,a)=>n+a,0)});}
const bands=[];for(let start=1;start<=run.floor;start+=10){const values=clearEvents.filter(e=>e.data.floor>=start&&e.data.floor<start+10).map(e=>e.data.seconds).sort((a,b)=>a-b);
 bands.push({from:start,to:Math.min(start+9,run.floor),cleared:values.length,fightPhysicalSeconds:{total:values.reduce((n,v)=>n+v,0),median:values[Math.floor(values.length/2)]??null,min:values[0]??null,max:values.at(-1)??null}});}
const victories=Object.values(p.arcana?.growth?.victories??{}),quality=victories.reduce((n,v)=>n+v.quality,0)/Math.max(1,victories.length);
const result={kind:'Observed local load/serialize/reload and receipt audit of an earned input-strategy checkpoint; no world advancement or history fabrication; concurrent load, not a general benchmark',input,
 sha256:crypto.createHash('sha256').update(raw).digest('hex'),bytes:Buffer.byteLength(raw),savedBytes:Buffer.byteLength(saved),readMs,loadMs,serializeMs,reloadMs,afterLoadMemory,afterSerializationMemory,
 seed:w.seed,personId:p.id,bodyId:b.id,rank:p.ontology.stage,health:b.health,injuries:b.injuries,inventoryCount:p.inventory.length,people:w.persons().length,events:w.events.length,
 physicalSeconds:w.physicalTime,worldSeconds:w.now,run:{id:run.id,status:run.status,active:run.active,floor:run.floor,clearedFloors:clearEvents.length},
 residency:towerResidency(w),growth:{victories:victories.length,meanEncounterControl:quality,integrations},bands,
 checks:['schema and canonical receipt validation on load','round-trip exact body identity, inventory, rank, injury and growth evidence','round-trip exact Tower state','unique finite reward items across floors','real canonical floor-clear receipts']};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,seed:result.seed,run:result.run,rank:result.rank,physicalSeconds:result.physicalSeconds,growth:result.growth,residency:result.residency,bytes:result.bytes,loadMs,serializeMs,reloadMs}));
