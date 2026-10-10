import {createObservatoryServer} from '../../src/observatory/server';
async function start(){
 const preferred=Number(process.env.TORN_VEIL_OBSERVATORY_PORT??7486);
 if(!Number.isInteger(preferred)||preferred<1024||preferred>65530)throw Error('Invalid tooling port');
 for(let port=preferred;port<preferred+5;port++){
  try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(750)});const health=await response.json();if(health.toolingVersion===3){console.log(`Existing Torn Veil tools: http://127.0.0.1:${port}/#tab=observatory`);return;}}catch{/* Preserve unavailable/other services and try a fresh listener. */}
  const {server,runtime}=createObservatoryServer();
  try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});runtime.startLoop();console.log(`Torn Veil tools: http://127.0.0.1:${port}/#tab=observatory`);return;}
  catch(e){runtime.close();if((e as NodeJS.ErrnoException).code!=='EADDRINUSE')throw e;}
 }
 throw Error('All five local tooling ports are occupied. Existing services were preserved. Choose TORN_VEIL_OBSERVATORY_PORT.');
}
void start().catch(e=>{console.error(e);process.exitCode=1;});
