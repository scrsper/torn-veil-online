import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync,gunzipSync} from 'node:zlib';
import {RealmSession} from '../src/sim/world/realms/session';
import {RealmRuntime,type RealmOperation} from '../src/server/realmRuntime';
import {RealmJournalStore,realmEngineFingerprint,digest} from '../src/server/realmJournalStore';
import {RealmJournal} from '../src/server/realmJournal';
import {applyTowerCommand} from '../src/server/canonicalTower';
import {INTERACTION_SPEC} from '../src/sim/physical/prediction';
import {portalPoint} from '../src/sim/world/realms/layout';

const roots:string[]=[];
const location=()=>{const dir=mkdtempSync(join(tmpdir(),'veil-journal-'));roots.push(dir);return join(dir,'world.json');};
afterEach(()=>{for(const dir of roots.splice(0))rmSync(dir,{recursive:true,force:true});});
function canonical(r:RealmRuntime){const raw=JSON.parse(r.session.save());delete raw.savedAt;return raw;}
function tower(){const s=new RealmSession(731);const b=s.grid.chunk('aether',32,32).buildings[0];s.body.pos={x:b.x+5,y:1,z:b.z+5};
  applyTowerCommand(s,{id:'enter-fixture',type:'enter',revision:0});return new RealmRuntime(s);}
function input(r:RealmRuntime,sequence:number,command:any):RealmOperation{return {type:'command',now:sequence*17,input:{
  version:2,type:'command',epoch:'journal-epoch',controllerId:'journal-controller',bodyId:r.session.body.id,
  specRevision:INTERACTION_SPEC.revision,sequence,commandId:`journal-${sequence}`,clientTimeMs:sequence*17,command}};}

describe('lossless realm journal',()=>{
  const schema30=()=>readFileSync(new URL('./fixtures/save-schema30-compact.json',import.meta.url),'utf8');
  const oldBase=(path:string)=>{
    const store=new RealmJournalStore(path,'schema30-engine-fixture'),bytes=gzipSync(schema30()),worldFile='world-0-schema30-fixture.json.gz';
    const r=new RealmRuntime(new RealmSession(731,schema30()));
    writeFileSync(join(store.dir,worldFile),bytes);
    writeFileSync(join(store.dir,'CURRENT.json'),JSON.stringify({format:1,sequence:0,engine:store.engine,worldFile,sha256:digest(bytes),bytes:bytes.length,control:r.checkpoint()}));
    return {store,bytes,worldFile,r};
  };
  it('imports the historical schema30 compact JSON and retains its original bytes through checkpoint/tail recovery',async()=>{
    const path=location(),original=schema30();writeFileSync(path,original);
    const j=new RealmJournal(path,731,'schema31-import');
    try{
      await j.ready;const expected=new RealmRuntime(new RealmSession(731,original));
      expect(canonical(j.runtime)).toEqual(canonical(expected));
      const m=j.store.manifest()!;expect(JSON.parse(gunzipSync(readFileSync(join(j.store.dir,m.worldFile))).toString()).version).toBe(31);
      j.apply({type:'disconnect'});for(let i=0;i<6;i++)j.apply({type:'step',now:i*17});await j.flush();
      const committed=canonical(j.runtime);await j.abort();
      expect(canonical(j.store.load(731).runtime)).toEqual(committed);
      expect(readFileSync(path,'utf8')).toBe(original);
    }finally{await j.abort();}
  },30000);
  it('upgrades a checksummed schema30 compressed base before accepting a new-engine tail',async()=>{
    const path=location(),{bytes,worldFile,r}=oldBase(path),j=new RealmJournal(path,731,'schema31-upgrade');
    try{
      await j.ready;expect(canonical(j.runtime)).toEqual(canonical(r));
      const manifest=j.store.manifest()!;expect(manifest.engine).toBe('schema31-upgrade');
      expect(JSON.parse(gunzipSync(readFileSync(join(j.store.dir,manifest.worldFile))).toString()).version).toBe(31);
      expect(readFileSync(join(j.store.dir,worldFile))).toEqual(bytes);
      j.apply({type:'disconnect'});for(let i=0;i<6;i++)j.apply({type:'step',now:i*17});await j.flush();
      const committed=canonical(j.runtime);await j.abort();expect(canonical(j.store.load(731).runtime)).toEqual(committed);
      expect(readFileSync(join(j.store.dir,worldFile))).toEqual(bytes);
    }finally{await j.abort();}
  },30000);
  it('refuses an old-engine tail on a schema30 base without changing any committed file',async()=>{
    const path=location(),{store}=oldBase(path);await store.append([{sequence:1,op:{type:'disconnect'}}]);
    const files=()=>Object.fromEntries(readdirSync(store.dir).map(name=>[name,digest(readFileSync(join(store.dir,name)))]));
    const before=files();expect(()=>new RealmJournalStore(path,'schema31-upgrade').load(731)).toThrow(/mechanics changed/);
    expect(files()).toEqual(before);
  });
  it('fences validator changes anywhere in the executable source tree without treating line endings as a new engine',()=>{
    const path=location(),root=path.slice(0,-'world.json'.length);mkdirSync(join(root,'src/web/legacy'),{recursive:true});
    const file=join(root,'src/web/legacy/checkpoint.ts');writeFileSync(file,'export const valid = true;\n');writeFileSync(join(root,'package-lock.json'),'{}\n');
    const initial=realmEngineFingerprint(root);writeFileSync(file,'export const valid = true;\r\n');expect(realmEngineFingerprint(root)).toBe(initial);
    writeFileSync(file,'export const valid = false;\n');expect(realmEngineFingerprint(root)).not.toBe(initial);
    writeFileSync(file,'export const valid = true;\n');writeFileSync(join(root,'package-lock.json'),'{"dependency":"changed"}\n');expect(realmEngineFingerprint(root)).not.toBe(initial);
  });
  it('retains transition receipts and finite rewards without duplicating a retried Tower entry',async()=>{
    const path=location(),store=new RealmJournalStore(path,'test'),r=tower();await store.checkpoint(r,0);
    const before=canonical(r),op:RealmOperation={type:'tower',command:{id:'enter-fixture',type:'enter',revision:0}};
    expect(r.apply(op).error).toBeUndefined();await store.append([{sequence:1,op}]);
    expect(canonical(store.load(731).runtime)).toEqual(before);
    const bad:RealmOperation={type:'tower',command:{id:'invalid-ascent',type:'ascend',revision:r.session.world.canonicalTower!.revision,runId:r.session.world.canonicalTower!.id}};
    expect(r.apply(bad).error).toMatch(/not complete/);expect(canonical(r)).toEqual(before);
  });
  it('continues exact canonical simulation with pending ordered Tower input across compressed checkpoints',async()=>{
    const path=location(),r=tower(),store=new RealmJournalStore(path,'test-engine');
    r.apply({type:'bind',id:'journal-controller',epoch:'journal-epoch'});
    for(let i=0;i<5;i++){r.apply(input(r,i,{type:'move',x:.2,z:0,sprint:false}));r.apply({type:'step',now:i*17+1});}
    r.apply(input(r,5,{type:'guard',held:true}));r.apply(input(r,6,{type:'move',x:.3,z:0,sprint:false}));
    await store.checkpoint(r,0);const restored=store.load(731).runtime;
    expect(canonical(restored)).toEqual(canonical(r));
    for(let i=7;i<22;i++){const op=input(r,i,{type:'move',x:i%2?.2:0,z:.1,sprint:false});
      for(const runtime of [r,restored]){runtime.apply(op);runtime.apply({type:'step',now:i*17+1});runtime.apply({type:'frame'});}}
    expect(canonical(restored)).toEqual(canonical(r));
  });
  it('recovers a committed tail, ignores incomplete temp writes, and refuses corruption/gaps/changed replay mechanics',async()=>{
    const path=location(),store=new RealmJournalStore(path,'engine-a'),r=new RealmRuntime(new RealmSession(731));await store.checkpoint(r,0);
    const op:RealmOperation={type:'move',input:{x:.5,z:0,sprint:false}};r.apply(op);
    await store.append([{sequence:1,op}]);writeFileSync(join(store.dir,'journal-2-2.json.tmp-interrupted'),'partial');
    expect(canonical(store.load(731).runtime)).toEqual(canonical(r));
    expect(()=>new RealmJournalStore(path,'engine-b').load(731)).toThrow(/mechanics changed/);
    await store.append([{sequence:3,op:{type:'step',now:30}}]);expect(()=>store.load(731)).toThrow(/sequence gap/);
    writeFileSync(join(store.dir,'journal-1-1.json'),JSON.stringify({sha256:'bad',payload:'{}'}));expect(()=>store.load(731)).toThrow(/checksum/);
  });
  it('preserves pending portal choice in checkpoints, while disconnect cancels it without a crossing',async()=>{
    const path=location(),store=new RealmJournalStore(path,'test'),r=new RealmRuntime(new RealmSession(19));
    r.session.body.pos={...portalPoint('aether'),z:portalPoint('aether').z-2};r.apply({type:'interact'});
    await store.checkpoint(r,0);const resumed=store.load(19).runtime;
    expect(resumed.session.snapshot().pending).toEqual(r.session.snapshot().pending);
    resumed.apply({type:'disconnect'});expect(resumed.session.snapshot().pending).toBeNull();expect(resumed.session.world.events.some(e=>e.type==='realm_crossed')).toBe(false);
    resumed.apply({type:'interact'});resumed.apply({type:'confirm',id:resumed.session.snapshot().pending!.id});
    await store.checkpoint(resumed,1);const across=store.load(19).runtime;
    expect(across.session.person.id).toBe(r.session.person.id);expect(across.session.body.id).toBe(r.session.body.id);expect(across.session.snapshot().realm).toBe('brass');
    expect(across.session.world.events.filter(e=>e.type==='realm_crossed')).toHaveLength(1);
  });
  it('runs a real replica worker, commits repeated small autosaves, and checkpoints without losing identity/history',async()=>{
    const path=location(),original=new RealmSession(27), imported=original.save();writeFileSync(path,imported);
    const j=new RealmJournal(path,27,'worker-test');
    try{await j.ready;for(let batch=0;batch<3;batch++){
      j.apply({type:'move',input:{x:.2,z:0,sprint:false}});
      for(let i=0;i<12;i++)j.apply({type:'step',now:(batch*12+i)*17});
      await j.flush();}
      expect(j.metrics.journalBytes).toBeLessThan(20000);
      const before=canonical(j.runtime),metrics=await j.checkpoint();
      expect(metrics.bytes).toBeLessThan(metrics.rawBytes);expect(canonical(j.store.load(27).runtime)).toEqual(before);
      expect(readFileSync(path,'utf8')).toBe(imported);
    }finally{await j.close();}
    const loaded=new RealmJournalStore(path,'new-code-with-no-tail').load(27);
    expect(loaded.runtime.session.person.id).toBe(original.person.id);
    expect(readdirSync(path+'.store').filter(n=>n.endsWith('.json.gz')).length).toBeLessThanOrEqual(2);
  },30000);
  it('keeps the last durable tail after a failed write and rejects a second writer',async()=>{
    const path=location(),j=new RealmJournal(path,87,'failure-test');await j.ready;
    try{
      expect(()=>new RealmJournal(path,87,'failure-test')).toThrow(/live writer/);
      j.apply({type:'move',input:{x:.5,z:0,sprint:false}});for(let i=0;i<6;i++)j.apply({type:'step',now:i*17});await j.flush();
      const durable=canonical(j.runtime);j.apply({type:'step',now:120});
      vi.spyOn(j.store,'append').mockRejectedValueOnce(Error('injected disk failure'));
      await expect(j.flush()).rejects.toThrow('injected disk failure');
      expect(()=>j.apply({type:'step',now:130})).toThrow('injected disk failure');
      await j.abort();expect(canonical(j.store.load(87).runtime)).toEqual(durable);
    }finally{await j.abort();}
  },30000);
  it('can upgrade a fully checkpointed base, then recover its new-code journal after an interrupted process',async()=>{
    const path=location(),old=new RealmJournal(path,41,'old-code');await old.ready;await old.close();
    const next=new RealmJournal(path,41,'new-code');await next.ready;
    next.apply({type:'move',input:{x:.2,z:0,sprint:false}});for(let i=0;i<6;i++)next.apply({type:'step',now:i*17});await next.flush();
    const expected=canonical(next.runtime);next.apply({type:'step',now:300});await next.abort();
    expect(canonical(next.store.load(41).runtime)).toEqual(expected);
  },30000);
});
