import {parentPort,workerData} from 'node:worker_threads';
import {RealmJournalStore,type JournalEntry} from './realmJournalStore';
const store=new RealmJournalStore(workerData.path,workerData.engine);
let {runtime,sequence}=store.load(workerData.seed);
let chain=Promise.resolve();
parentPort!.on('message',message=>{chain=chain.then(async()=>{
  if(message.type==='batch')for(const entry of message.entries as JournalEntry[]){
    if(entry.sequence!==sequence+1)throw Error('Replay replica sequence gap');runtime.apply(entry.op);sequence=entry.sequence;}
  else if(message.type==='checkpoint'){const metrics=await store.checkpoint(runtime,sequence);parentPort!.postMessage({id:message.id,metrics});}
  else throw Error('Unknown replay message');
}).catch(error=>{parentPort!.postMessage({error:String(error)});process.exitCode=1;parentPort!.close();});});
if(!store.manifest()||store.manifest()!.engine!==workerData.engine)await store.checkpoint(runtime,sequence);
parentPort!.postMessage({ready:true,sequence});
