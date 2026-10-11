/** Rendered late-history persistence/travel acceptance from an earned 100-floor bot checkpoint.
 * The video does not depict or claim a human 100-floor climb. */
import { chromium } from 'playwright';
import { route } from './canonical-tower-qa-route.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.TV_REALMS_URL??'http://127.0.0.1:7520',out=resolve(process.env.TV_REALMS_EVIDENCE??'.debug/tower-stability/summit-browser');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}}),page=await context.newPage();
const checks=[],errors=[],held=new Set(),observations=[];let metrics=null; const saves=[]; let healthBefore=null,healthAfter=null,persistenceMetrics=null;
page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
const wait=(fn,arg=null,timeout=180000)=>page.waitForFunction(fn,arg,{timeout});
const frame=()=>page.evaluate(()=>window.tvAscent.frame),realm=()=>page.evaluate(()=>window.tvRealms.state);
const shot=n=>page.screenshot({path:resolve(out,n+'.png')});
const check=(name,ok)=>{checks.push({name,ok});console.log(ok?'PASS':'FAIL',name);assert.ok(ok,name);};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
async function keys(next){for(const k of held)if(!next.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
async function walk(target){
 const plan=await page.evaluate(()=>window.tvAscent.plan),begin=Date.now();let path=[],nextRoute=0;
 // The authoritative entrance accepts 2.4 m. Stop inside it instead of requiring
 // sub-metre steering precision while the large-history host is backpressured.
 try{while(Date.now()-begin<180000){const f=await frame(),b=f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId);if(dist(b.pos,target)<2)return;
  if(Date.now()>nextRoute){path=route(plan,b.pos,target);nextRoute=Date.now()+600;}
  while(path.length&&dist(path[0],b.pos)<.35)path.shift();const to=path[0]??target,input=[];
  if(Math.abs(to.x-b.pos.x)>.12)input.push(to.x>b.pos.x?'KeyD':'KeyA');if(Math.abs(to.z-b.pos.z)>.12)input.push(to.z>b.pos.z?'KeyS':'KeyW');
  await keys(input);await page.waitForTimeout(60);
 }throw Error('Summit entrance traversal timed out');}finally{await keys([]);}
}
async function cross(to,cancelByReload=false){await page.locator('#rv-portal').click();await wait(()=>window.tvRealms.state.prompt.includes('Cross the Veil'));await page.keyboard.press('KeyE');
 if(cancelByReload){await wait(()=>window.tvRealms.state.pending);await page.reload();await wait(()=>window.tvRealms?.ready);
  check('reload cancelled uncommitted portal without moving identity',(await realm()).realm!==to&&!(await realm()).pending);await page.keyboard.press('KeyE');}
 await page.locator('#rv-cross').click();await wait(to=>window.tvRealms?.ready&&window.tvRealms.state.realm===to,to);
}
try{
 await page.goto(base+'/?ascent');await wait(()=>window.tvAscent?.ready);const before=await frame();observations.push(before.own);
 check('loaded earned completed Silver summit',before.tower.floor===100&&before.tower.clear&&before.tower.status==='completed'&&before.own.rank==='Silver');
 await shot('01-earned-silver-summit');
 const idleBefore=(await page.evaluate(()=>window.tvAscent.inspect())).receipts.length;
 await page.waitForTimeout(2000);
 check('idle client emits no movement/guard command traffic',(await page.evaluate(()=>window.tvAscent.inspect())).receipts.length===idleBefore);
 healthBefore=await (await fetch(base+'/realms/health')).json();
 for(let i=0;i<6;i++){
  if(i===1)await keys(['KeyA']);if(i===2)await keys(['KeyD']);if(i===3)await keys([]);
  saves.push(await page.evaluate(()=>new Promise((resolve,reject)=>{
   const n=document.getElementById('as-notice'),start=performance.now();
   const timer=setTimeout(()=>{observer.disconnect();reject(Error('Save acknowledgement timed out'));},10000);
   const observer=new MutationObserver(()=>{if(n.textContent==='World saved.'){clearTimeout(timer);observer.disconnect();resolve(performance.now()-start);}});
   observer.observe(n,{childList:true,subtree:true,characterData:true});document.getElementById('as-save').click();
  })));
  await page.waitForTimeout(400);
 }
 await keys([]);check('six repeated durable saves acknowledged',saves.length===6&&saves.every(ms=>ms<10000));
 // Keep rendering and the authoritative scheduler running through a background
 // full checkpoint, while routine frames and saves continue.
 const deadline=Date.now()+90000;
 do{await page.waitForTimeout(500);healthAfter=await(await fetch(base+'/realms/health')).json();}
 while(!healthAfter.persistence.checkpoint&&Date.now()<deadline);
 check('background full checkpoint completes while the host remains live',!!healthAfter.persistence.checkpoint&&healthAfter.ready);
 persistenceMetrics=await page.evaluate(()=>window.tvAscent.inspect());
 await shot('02-background-checkpoint-live');
 await page.reload();await wait(()=>window.tvAscent?.ready);
 const loaded=await frame();check('summit reload retained run and body',loaded.tower.status==='completed'&&loaded.tower.id===before.tower.id&&loaded.own.bodyId===before.own.bodyId);
 await walk(loaded.tower.start);metrics=await page.evaluate(()=>window.tvAscent.inspect());await page.locator('#as-return').click();await wait(()=>window.tvRealms?.ready);
 const departure=await realm();observations.push(departure.person);await shot('02-summit-return-to-city');await cross('brass',true);
 const across=await realm();
 check('Cinderveil retains completed summit without a new run or reward',across.canonicalTower.runId===before.tower.id&&across.canonicalTower.floor===100&&across.canonicalTower.status==='completed'&&JSON.stringify(across.person)===JSON.stringify(departure.person));
 await shot('03-summit-record-in-cinderveil');await cross('aether');
 await page.reload();await wait(()=>window.tvRealms?.ready);const returned=await realm();observations.push(returned.person);
 check('summit portal round trip preserves exact person inventory rank and body',JSON.stringify(returned.person)===JSON.stringify(departure.person)&&returned.body.id===departure.body.id);
 await shot('04-silver-returned-to-aether');check('no browser errors',errors.length===0);
}catch(e){errors.push(String(e));console.error(e);process.exitCode=1;await shot('failure');}
finally{await keys([]);writeFileSync(resolve(out,'result.json'),JSON.stringify({kind:'actual rendered persistence and summit portal journey from earned headless 100-floor save; preceding climb not depicted; observed local timing, not human playtime',checks,errors,observations,metrics,persistenceMetrics,saves,healthBefore,healthAfter},null,2));const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'actual-persistence-summit-journey.webm'));await browser.close();}
