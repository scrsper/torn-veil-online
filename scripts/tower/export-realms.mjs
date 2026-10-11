/** Export the verified active journal to a portable canonical JSON save.
 * Stop the realm host first. Never overwrite an existing destination. */
import {openSync,writeFileSync,fsyncSync,closeSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {RealmJournalStore,realmEngineFingerprint} from '../../src/server/realmJournalStore.ts';
import {WriterLock} from '../../src/server/store.ts';
const [saveArg,outArg]=process.argv.slice(2);
if(!saveArg||!outArg)throw Error('Usage: node --import tsx scripts/tower/export-realms.mjs <save.json> <new-export.json>');
const save=resolve(saveArg),out=resolve(outArg);
if(existsSync(out))throw Error('Export destination already exists; choose a new file');
const store=new RealmJournalStore(save,realmEngineFingerprint()),lock=new WriterLock(store.dir,{release:'portable-export',env:'realms'});
lock.acquire();
try{const {runtime,sequence}=store.load(0),raw=runtime.session.save(),fd=openSync(out,'wx');
  try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}
  console.log(JSON.stringify({export:out,sequence,bytes:Buffer.byteLength(raw),person:runtime.session.person.id,rank:runtime.session.person.ontology.stage}));
}finally{lock.release();}
