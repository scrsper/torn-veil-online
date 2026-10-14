/** Actual canonical realm/Tower clients, copied saves, headless only. No fixture
 * renderer or generated gameplay. Matching close settings isolate pose comparison. */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const label=process.env.TV_CAPTURE_LABEL??'before',base=process.env.TV_CAPTURE_URL??`http://127.0.0.1:${label==='before'?7570:7571}`;
const out=resolve('.debug/motion-correction',label);mkdirSync(out,{recursive:true});
const health=await fetch(base+'/realms/health').then(r=>r.json());assert.ok(health.savePath.includes('motion-correction'), 'Refusing to control the live player save');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling','--enable-precise-memory-info']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
await context.addInitScript(()=>{for(const version of [1,2])for(const view of ['realm','tower'])localStorage.setItem(`torn-veil.primary-camera.${view}.v${version}`,JSON.stringify({distance:5.4,pitch:24*Math.PI/180,yaw:view==='realm'?Math.PI:0}));});
const page=await context.newPage(),started=Date.now(),errors=[],shots=[],samples=[];let warmAt=null,phase='loading';
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const wait=(fn,arg=null,timeout=180000)=>page.waitForFunction(fn,arg,{timeout});
const read=()=>page.evaluate(()=>window.tvAscent?{mode:'tower',frame:window.tvAscent.frame,inspection:window.tvAscent.inspect()}:{mode:'realm',frame:window.tvRealms.state,inspection:window.tvRealms.inspect()});
async function shot(name){const sample=await read();await page.screenshot({path:resolve(out,name+'.png')});shots.push({name,videoSeconds:(Date.now()-started)/1000,...sample});console.log('CAPTURE',label,name);}
const held=new Set();async function keys(next){for(const k of held)if(!next.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
async function hold(name,input,ms){phase=name;await keys(input);for(let i=0;i<Math.ceil(ms/100);i++){await page.waitForTimeout(100);const s=await read();samples.push({phase:name,videoSeconds:(Date.now()-started)/1000,...s});}await keys([]);phase='stop';await page.waitForTimeout(750);}
let status='failed',gpu;
try{
 await page.goto(base+'/?realms');await wait(()=>window.tvRealms?.ready);await page.waitForTimeout(1200);warmAt=(Date.now()-started)/1000;
 gpu=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl?.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null;});
 await shot('01-close-idle');await hold('ordinary-travel',['KeyW'],2400);await shot('02-travel-stop');await hold('return',['KeyS'],2400);
 await hold('sprint',['KeyW','ShiftLeft'],1600);await shot('03-run-stop');await hold('return-after-run',['KeyS'],2500);
 await hold('strafe-right',['KeyQ','KeyD'],1200);await hold('strafe-left',['KeyQ','KeyA'],1200);await shot('04-strafe-stop');
 await page.mouse.move(720,660);await page.mouse.down({button:'middle'});await page.mouse.move(1120,660,{steps:30});await page.mouse.up({button:'middle'});await page.waitForTimeout(600);await shot('05-side-idle');
 await hold('side-travel',['KeyW'],2000);await hold('side-return',['KeyS'],2000);await shot('06-side-stop');
 if(label==='after'){
  const looks=samples.map(s=>s.inspection.controlledLook?.motion).filter(Boolean);assert.ok(looks.some(m=>m.policy==='authored-in-place'&&m.gait===null));
  assert.ok(!samples.filter(s=>s.phase==='ordinary-travel').some(s=>s.inspection.controlledLook?.motion?.dominantClip==='unarmed/run_sprint'),'Ordinary travel must not select sprint');
 }
 assert.deepEqual(errors,[]);status='passed';
}finally{await keys([]);const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'recorded-full.webm'));await browser.close();writeFileSync(resolve(out,'result.json'),JSON.stringify({status,label,health,gpu,warmAt,shots,samples,errors,finished:new Date().toISOString()},null,2));console.log(JSON.stringify({status,label,shots:shots.length,samples:samples.length,errors}));}
