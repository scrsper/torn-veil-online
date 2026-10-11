import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {open,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {RealmSession} from '../sim/world/realms/session';
import {RealmRuntime,type RealmContinuation,type RealmOperation} from './realmRuntime';

export type JournalEntry={sequence:number;op:RealmOperation};
interface Manifest {format:1;sequence:number;engine:string;worldFile:string;sha256:string;bytes:number;control:RealmContinuation}
export const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
/** Replay is code-sensitive. Refuse an unmatched executable with an uncheckpointed
 * tail, instead of silently replaying old decisions under new mechanics. */
export function realmEngineFingerprint(root=resolve('.')):string {
  const hash=createHash('sha256');
  const source=(p:string)=>readFileSync(join(root,p),'utf8').replaceAll('\r\n','\n');
  function walk(dir:string){for(const entry of readdirSync(join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const p=join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.(ts|tsx|js|mjs|json)$/.test(p))hash.update(p.replaceAll('\\','/')).update('\0').update(source(p)).update('\0');}}
  // Legacy checkpoint validators and presentation helpers can live outside sim/.
  // Conservatively cover the whole executable source tree, including this codec.
  // Normalize checkout line endings so Git's Windows conversion isn't a code upgrade.
  walk('src');hash.update(source('package-lock.json'));
  hash.update(JSON.stringify({node:process.version,v8:process.versions.v8,icu:process.versions.icu,platform:process.platform,arch:process.arch}));
  return hash.digest('hex');
}
async function atomic(path:string,bytes:string|Buffer){
  const tmp=path+'.tmp-'+randomUUID(),fd=await open(tmp,'wx');
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  await rename(tmp,path);
}
/** Lossless gzip base + checksummed, atomically renamed journal batches. The original
 * imported JSON is never overwritten. A corrupt committed file is a hard error. */
export class RealmJournalStore {
  readonly dir:string;
  constructor(readonly legacyPath:string,readonly engine:string){this.dir=legacyPath+'.store';mkdirSync(this.dir,{recursive:true});}
  manifest():Manifest|null {
    const path=join(this.dir,'CURRENT.json');if(!existsSync(path))return null;
    const m=JSON.parse(readFileSync(path,'utf8')) as Manifest;
    if(m.format!==1||!Number.isSafeInteger(m.sequence)||m.sequence<0||!/^world-[\w-]+\.json\.gz$/.test(m.worldFile))throw Error('Invalid realm checkpoint manifest; original files retained');
    return m;
  }
  private batchFiles(){return readdirSync(this.dir).filter(n=>/^journal-\d+-\d+\.json$/.test(n)).sort((a,b)=>Number(a.split('-')[1])-Number(b.split('-')[1]));}
  load(seed:number):{runtime:RealmRuntime;sequence:number} {
    const m=this.manifest();let sequence=m?.sequence??0,raw:string|undefined;
    if(m){const bytes=readFileSync(join(this.dir,m.worldFile));if(bytes.length!==m.bytes||digest(bytes)!==m.sha256)throw Error('Realm checkpoint checksum mismatch; original files retained');
      raw=gunzipSync(bytes).toString('utf8');}
    else if(existsSync(this.legacyPath))raw=readFileSync(this.legacyPath,'utf8');
    else if(this.batchFiles().length||readdirSync(this.dir).some(n=>/^world-.*\.json\.gz/.test(n)))throw Error('Realm journal has no base checkpoint; refusing to create another world');
    const runtime=new RealmRuntime(new RealmSession(seed,raw),m?.control);
    for(const file of this.batchFiles()){
      const end=Number(file.split('-')[2].split('.')[0]);if(end<=sequence)continue;
      const envelope=JSON.parse(readFileSync(join(this.dir,file),'utf8'));
      if(typeof envelope.payload!=='string'||digest(envelope.payload)!==envelope.sha256)throw Error(`Realm journal checksum mismatch: ${file}`);
      const batch=JSON.parse(envelope.payload) as {format:number;engine:string;entries:JournalEntry[]};
      if(batch.format!==1||batch.engine!==this.engine||(m&&m.engine!==this.engine))throw Error('Realm replay mechanics changed with an uncheckpointed journal. Resume/checkpoint using the previous source revision before upgrading; files retained.');
      for(const entry of batch.entries){if(entry.sequence<=sequence)continue;
        if(entry.sequence!==sequence+1)throw Error(`Realm journal sequence gap at ${entry.sequence}`);
        runtime.apply(entry.op);sequence=entry.sequence;}
      if(sequence!==end)throw Error(`Incomplete realm journal: ${file}`);
    }
    return {runtime,sequence};
  }
  async append(entries:JournalEntry[]):Promise<number>{
    if(!entries.length)return 0;
    const payload=JSON.stringify({format:1,engine:this.engine,entries}),bytes=JSON.stringify({sha256:digest(payload),payload});
    await atomic(join(this.dir,`journal-${entries[0].sequence}-${entries.at(-1)!.sequence}.json`),bytes);return Buffer.byteLength(bytes);
  }
  async checkpoint(runtime:RealmRuntime,sequence:number){
    const start=performance.now(),raw=runtime.session.save(),captureMs=performance.now()-start;
    const bytes=gzipSync(raw,{level:1}),worldFile=`world-${sequence}-${randomUUID()}.json.gz`;
    await atomic(join(this.dir,worldFile),bytes);
    const m:Manifest={format:1,sequence,engine:this.engine,worldFile,sha256:digest(bytes),bytes:bytes.length,control:runtime.checkpoint()};
    await atomic(join(this.dir,'CURRENT.json'),JSON.stringify(m));
    // CURRENT now names a complete snapshot. Keep its immediate predecessor for
    // manual recovery; never delete the imported save or unique historical data.
    const worlds=readdirSync(this.dir).filter(n=>/^world-\d+-[\w-]+\.json\.gz$/.test(n)&&n!==worldFile)
      .sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
    for(const file of worlds.slice(1))await unlink(join(this.dir,file));
    for(const file of this.batchFiles())if(Number(file.split('-')[2].split('.')[0])<=sequence)await unlink(join(this.dir,file));
    return {sequence,rawBytes:Buffer.byteLength(raw),bytes:bytes.length,captureMs,totalMs:performance.now()-start};
  }
}
