import {describe,it,expect,vi} from 'vitest';
import {Tooling} from '../src/observatory/tooling';
import {createObservatoryServer} from '../src/observatory/server';
describe('local tooling boundary',()=>{
 it('validates the fixed Asset Lab service and handles offline status',async()=>{
  const read=vi.spyOn(globalThis,'fetch');const tooling=new Tooling(process.cwd());
  try{read.mockResolvedValueOnce(new Response(JSON.stringify({app:'Torn Veil Asset Lab',backend:'busy',jobs:[{state:'running'},{state:'completed'}]})));expect(await tooling.assetLabStatus()).toMatchObject({ready:true,backend:'busy',activeJobs:1});expect(read.mock.calls[0][0]).toBe('http://127.0.0.1:8192/api/state');
   read.mockResolvedValueOnce(new Response(JSON.stringify({app:'other'})));expect((await tooling.assetLabStatus()).ready).toBe(false);
   read.mockRejectedValueOnce(Error('offline'));expect((await tooling.assetLabStatus()).ready).toBe(false);
  }finally{read.mockRestore();}
 });
 it('rejects arbitrary job commands',()=>{expect(()=>new Tooling(process.cwd()).run('user-shell-command')).toThrow('Unsupported');});
 it('keeps tab assets same-origin, checks sessions and rejects traversal',async()=>{const {server}=createObservatoryServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as {port:number}).port;try{const html=await(await fetch(base)).text();expect(html).toContain('/tooling.js');expect((await fetch(base+'/tooling.js')).status).toBe(200);expect((await fetch(base+'/api/tooling/status')).status).toBe(403);expect((await fetch(base+'/ontology/..%2fpackage.json')).status).toBe(403);const token=html.match(/name="observatory-token" content="([^"]+)"/)![1];const headers={'X-Observatory-Token':token,'Content-Type':'application/json'};expect((await fetch(base+'/api/tooling/status',{headers})).status).toBe(200);expect((await fetch(base+'/api/tooling/run',{method:'POST',headers,body:JSON.stringify({action:'arbitrary-shell'})})).status).toBe(400);expect((await fetch(base+'/api/tooling/status',{headers:{...headers,Origin:'https://example.invalid'}})).status).toBe(403);}finally{await new Promise<void>(r=>server.close(()=>r()));}},30000);
});
