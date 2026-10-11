import {Worker} from 'node:worker_threads';
import {RealmJournalStore,type JournalEntry,realmEngineFingerprint} from './realmJournalStore';
import type {RealmOperation,RealmRuntime} from './realmRuntime';
import {WriterLock} from './store';

/** One bounded replica, one serialized disk writer, immutable operation batches.
 * No live-world structured clone or JSON capture occurs during routine autosaves. */
export class RealmJournal {
  readonly store:RealmJournalStore;
  readonly runtime:RealmRuntime;
  private readonly fence:WriterLock;
  private worker:Worker;
  private pending:JournalEntry[]=[];
  private sequence:number;
  private durable:number;
  private chain=Promise.resolve();
  private failed:Error|null=null;
  private closed=false;
  private request=0;
  private checkpointFlight:Promise<any>|null=null;
  private checkpointWait: {id:number;resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
  readonly ready:Promise<void>;
  metrics={durableSequence:0,checkpointSequence:0,journalBytes:0,flushMs:0,checkpoint:null as any};
  constructor(path:string,seed:number,engine=realmEngineFingerprint()){
    this.store=new RealmJournalStore(path,engine);this.fence=new WriterLock(this.store.dir,{release:engine,env:'realms'});this.fence.acquire();
    try{const loaded=this.store.load(seed);this.runtime=loaded.runtime;this.sequence=this.durable=loaded.sequence;}
    catch(e){this.fence.release();throw e;}
    this.metrics.durableSequence=this.durable;
    this.metrics.checkpointSequence=this.store.manifest()?.sequence??0;
    this.worker=new Worker(new URL('./realmReplayWorkerLoader.mjs',import.meta.url),{workerData:{path,seed,engine},resourceLimits:{maxOldGenerationSizeMb:6144}});
    this.ready=new Promise((resolve,reject)=>{
      const startup=setTimeout(()=>fail(Error('Realm replay initialization exceeded 120 seconds')),120000);
      const fail=(error:Error)=>{clearTimeout(startup);this.failed=error;reject(error);if(this.checkpointWait){clearTimeout(this.checkpointWait.timer);this.checkpointWait.reject(error);this.checkpointWait=null;}};
      this.worker.on('error',fail);this.worker.on('exit',code=>{if(!this.closed)fail(Error(`Realm replay worker exited (${code})`));});
      this.worker.on('message',m=>{
        if(m.error){fail(Error(m.error));return;}
        if(m.ready){clearTimeout(startup);if(m.sequence!==this.durable){fail(Error('Realm replica started at a different sequence'));return;}resolve();}
        if(this.checkpointWait&&m.id===this.checkpointWait.id){const w=this.checkpointWait;clearTimeout(w.timer);this.checkpointWait=null;
          this.metrics.checkpoint=m.metrics;this.metrics.checkpointSequence=m.metrics.sequence;w.resolve(m.metrics);}
      });
    });
  }
  apply(op:RealmOperation):any {
    if(this.closed||this.failed)throw this.failed??Error('Realm journal closed');
    if(this.pending.length>=20000||this.sequence-this.metrics.checkpointSequence>120000)throw Error('Realm persistence backlog limit reached; stop and checkpoint before continuing');
    const result=this.runtime.apply(op);this.pending.push({sequence:++this.sequence,op:structuredClone(op)});return result;
  }
  flush():Promise<void>{
    const entries=this.pending.splice(0);
    this.chain=this.chain.then(async()=>{
      if(this.failed)throw this.failed;if(!entries.length)return;
      await this.ready;this.fence.verify();const start=performance.now();
      this.metrics.journalBytes+=await this.store.append(entries);this.durable=entries.at(-1)!.sequence;
      this.metrics.durableSequence=this.durable;this.metrics.flushMs=performance.now()-start;
      this.worker.postMessage({type:'batch',entries});
    }).catch(e=>{this.failed=e instanceof Error?e:Error(String(e));throw this.failed;});
    return this.chain;
  }
  checkpoint():Promise<any>{
    if(this.checkpointFlight)return this.checkpointFlight;
    this.checkpointFlight=(async()=>{await this.flush();
    return new Promise((resolve,reject)=>{const id=++this.request;
      const timer=setTimeout(()=>{this.failed=Error('Realm checkpoint exceeded 120 seconds');this.checkpointWait=null;reject(this.failed);},120000);
      this.checkpointWait={id,resolve,reject,timer};this.worker.postMessage({type:'checkpoint',id});});
    })().finally(()=>{this.checkpointFlight=null;});return this.checkpointFlight;
  }
  /** Stop the replica without acknowledging any uncommitted input. Used after a
   * failed simulation/disk operation: do not save an interrupted live mutation. */
  async abort(){this.closed=true;if(this.checkpointWait){clearTimeout(this.checkpointWait.timer);this.checkpointWait.reject(Error('Realm journal aborted'));this.checkpointWait=null;}
    await this.worker.terminate();this.fence.release();}
  async close(){try{await this.checkpointFlight;await this.checkpoint();}finally{await this.abort();}}
}
