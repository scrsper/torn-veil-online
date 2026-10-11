/** Ordinary-input acceptance on the active shared adult renderer. Isolated QA hosts only. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { route } from './canonical-tower-qa-route.mjs';
const surface = process.env.TV_GAIT_SURFACE ?? 'lab';
const base = process.env.TV_GAIT_URL ?? 'http://127.0.0.1:7521';
const out = resolve(process.env.TV_GAIT_EVIDENCE ?? `.debug/gait-pr65/${surface}`);
mkdirSync(out,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:false,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
const page=await context.newPage(), errors=[],checks=[],phases=[],held=new Set();let initial, final,metrics;
page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(`${e.text()} ${e.location().url}`);});
const check=(name,ok,detail)=>{checks.push({name,ok,detail});console.log(ok?'PASS':'FAIL',name);assert.ok(ok,name);};
async function keys(next=[]){for(const k of [...held])if(!next.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
async function read(){return page.evaluate(surface=>{
 if(surface==='town') {const tv=window.__tv,own=tv.own(),b=tv.snapshot.bodies.find(b=>b.bodyId===own.bodyId);return{body:b,rank:own.rank,motion:tv.actors.get(b.bodyId)?.visual.root.metadata.motion,personId:tv.link.hello.playerId,inventory:tv.snapshot.carried};}
 const tv=surface==='tower'?window.tvAscent:window.tvMotion,f=tv.frame,b=f.snapshot.bodies.find(b=>b.bodyId===(surface==='tower'?f.own.bodyId:f.local.bodyId));
 return{body:b,rank:surface==='tower'?f.own.rank:null,motion:tv.inspect().looks.find(v=>v.bodyId===b.bodyId)?.motion,personId:surface==='tower'?f.own.id:f.snapshot.playerId,inventory:f.snapshot.carried,tower:surface==='tower'?f.tower:null};
},surface);}
async function shot(name){await page.screenshot({path:resolve(out,`${name}.png`)});console.log('CAPTURE',name);}
async function phase(name,input,ms=900){const before=await read(),samples=[];await keys(input);const end=Date.now()+ms;let captured=false;
 while(Date.now()<end){await page.waitForTimeout(60);samples.push(await read());if(!captured&&Date.now()>end-ms/2){await shot(name);captured=true;}}
 await keys();await page.waitForTimeout(300);const after=await read();phases.push({name,input,before,samples,after});return phases.at(-1);}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
// Interaction availability/cooldowns in carried rows can change during combat.
// Inventory identity and counts are the preservation contract.
const inventorySignature=items=>JSON.stringify(items.map(({id,name,quantity})=>({id,name,quantity})).sort((a,b)=>a.id.localeCompare(b.id)));
async function towerWalk(to){const plan=await page.evaluate(()=>window.tvAscent.plan);const end=Date.now()+45000;
 while(Date.now()<end){const own=(await read()).body;if(distance(own.pos,to)<.5){await keys();return true;}const path=route(plan,own.pos,to),p=path.find(p=>distance(own.pos,p)>.28)??to,dx=p.x-own.pos.x,dz=p.z-own.pos.z;
 await keys(Math.abs(dx)>Math.abs(dz)?[dx>0?'KeyD':'KeyA']:[dz>0?'KeyS':'KeyW']);await page.waitForTimeout(85);}
 await keys();return false;}
let result='failed';
try{
 if(surface==='town') {await page.request.post(`${base}/api/gym/control`,{data:{action:'switch',scenario:'town'}});await page.goto(`${base}/?gym=1&scenario=town&autoplay=1&view=orbit&renderer=webgl2`);await page.waitForFunction(()=>window.__tv?.ready&&window.__tv.link.playable,null,{timeout:240000});}
 else if(surface==='tower') {await page.goto(`${base}/?realms`);await page.waitForFunction(()=>window.tvRealms?.ready||window.tvAscent?.ready,null,{timeout:240000});
 if(!await page.evaluate(()=>window.tvAscent?.ready)){
  if(!await page.evaluate(()=>window.tvRealms.state.tower)){await page.locator('#rv-tower').click();await page.waitForFunction(()=>Math.hypot(window.tvRealms.state.body.pos.x-3120.5,window.tvRealms.state.body.pos.z-3120.5)<.6,null,{timeout:90000});
   if((await page.evaluate(()=>window.tvRealms.state.prompt)).includes('Open Tower'))await page.keyboard.press('KeyE');await keys(['KeyW']);await page.waitForTimeout(2700);await keys();await page.waitForFunction(()=>window.tvRealms.state.tower);}
  await page.locator('#rv-canonical').click();await page.waitForFunction(()=>window.tvAscent?.ready,null,{timeout:240000});}}
 else {await page.goto(`${base}/?motion-review`);await page.waitForFunction(()=>window.tvMotion?.ready,null,{timeout:240000});}
 await page.waitForTimeout(900);
 if(surface==='tower')check('initial floor route remains navigable',await towerWalk(await page.evaluate(()=>window.tvAscent.plan.start)));
 initial=await read();await shot('01-idle');
 const slow=await phase('01b-slow-walk',surface==='tower'?['KeyD','KeyC']:['KeyS','KeyC'],1800);
 check('slow movement exercises walk curves',slow.samples.some(s=>s.motion?.gait?.weight>.5&&s.motion.gait.run<.5));
 const walk=await phase('02-walk',surface==='tower'?['KeyA']:surface==='town'?['KeyW']:['KeyS']);
 check('walk drives shared gait on canonical displacement',distance(walk.before.body.pos,walk.after.body.pos)>.35&&walk.samples.some(s=>s.motion?.gait?.weight>.5));
 const run=await phase('03-run',surface==='tower'?['KeyD','ShiftLeft']:surface==='town'?['KeyS','ShiftLeft']:['KeyW','ShiftLeft'],800);
 check('run uses run curves',run.samples.some(s=>s.motion?.gait?.run>.5));
 const turn=await phase('04-turn',surface==='tower'?['KeyA']:['KeyD'],650);
 check('turn changes canonical facing',turn.samples.some(s=>Math.abs(Math.atan2(Math.sin(s.body.yaw-turn.before.body.yaw),Math.cos(s.body.yaw-turn.before.body.yaw)))>.3));
 if(surface==='town'){await phase('04b-space-for-backpedal',['KeyW'],1100);}
 let reverseKeys=surface==='town'?['KeyS','KeyZ']:['KeyG','KeyS'];
 if(surface==='tower'){
  reverseKeys=await page.evaluate(()=>{const f=window.tvAscent.frame,b=f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId),t=f.snapshot.bodies.find(b=>b.bodyId===window.tvAscent.targetId);if(!t)return['KeyQ','KeyS'];const dx=b.pos.x-t.pos.x,dz=b.pos.z-t.pos.z;return['KeyQ',Math.abs(dx)>Math.abs(dz)?dx>0?'KeyD':'KeyA':dz>0?'KeyS':'KeyW'];});
  await keys(['KeyQ']);await page.waitForTimeout(500);
 }
 const reverse=await phase('05-reverse',reverseKeys,850);
 check('actual reverse travel retains authored directional ownership',reverse.samples.some(s=>s.motion?.gait?.weight<.05&&(-Math.sin(s.body.yaw)*s.body.velocity.x-Math.cos(s.body.yaw)*s.body.velocity.z)<-.1));
 const attackKey=surface==='town'?'KeyH':'KeyJ';await page.keyboard.press(attackKey);await page.waitForTimeout(130);const attack=await read();await shot('06-attack');
 check('attack keeps canonical action clock and authored pose',attack.motion?.action!=null&&attack.motion.gait?.weight===0);
 await page.waitForTimeout(650);await keys([surface==='tower'?'KeyD':'KeyS']);await page.keyboard.press('Space');await page.waitForTimeout(100);const dodge=await read();await shot('07-dodge');
 check('dodge owns pose',dodge.motion?.action!=null&&dodge.motion.gait?.weight===0);await keys();await page.waitForTimeout(800);
 const recovery=await phase('08-locomotion-recovery',surface==='tower'?['KeyA']:['KeyW'],800);
 check('locomotion resumes after attack and dodge',recovery.samples.some(s=>s.motion?.gait?.weight>.8&&!s.motion.action));
 // A real held input reaches structural collision; no body/collision writes.
 if(surface==='tower'){
  const plan=await page.evaluate(()=>window.tvAscent.plan);check('navigate back through floor structure',await towerWalk(plan.start));
  const collision=await phase('09-wall-collision',['KeyS'],11000),tail=collision.samples.slice(-5);
  check('collision stops actual displacement and settles gait',tail.length===5&&distance(tail[0].body.pos,tail.at(-1).body.pos)<.06&&tail.at(-1).motion.gait.weight<.05);
  check('return route remains navigable',await towerWalk(plan.start));
 }else if(surface==='town'){
  const collision=await phase('09-visible-fence-collision',['KeyS'],6500),tail=collision.samples.slice(-5);
  check('mainworld collision stops canonical travel and settles gait',tail.length===5&&distance(tail[0].body.pos,tail.at(-1).body.pos)<.06&&tail.at(-1).motion.gait.weight<.05);
 }
 else if(surface==='lab'){
  // This finite canonical lab has solid perimeter cells. Walking continues until
  // the body reaches them, with the final samples proving a settled blocked pose.
  const collision=await phase('09-wall-collision',['KeyA','ShiftLeft'],12000),tail=collision.samples.slice(-5);
  check('collision stops actual displacement and settles gait',tail.length===5&&distance(tail[0].body.pos,tail.at(-1).body.pos)<.06&&tail.at(-1).motion.gait.weight<.05);
 }
 await keys([surface==='tower'?'KeyD':'KeyS']);await page.waitForTimeout(250);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await keys();await page.waitForTimeout(350);const stopped=await read();await page.waitForTimeout(500);const settled=await read();
 check('interrupted input settles without root drift',distance(stopped.body.pos,settled.body.pos)<.08&&settled.motion.gait.weight<.01);await shot('10-stopped');
 if(surface==='tower') {const plan=await page.evaluate(()=>window.tvAscent.plan);check('return threshold reachable',await towerWalk(plan.start));await page.locator('#as-save').click();await page.waitForTimeout(350);await page.reload();await page.waitForFunction(()=>window.tvAscent?.ready,null,{timeout:240000});const reload=await read();
  check('reload preserves person, body, rank and inventory',reload.personId===initial.personId&&reload.body.bodyId===initial.body.bodyId&&reload.rank===initial.rank&&inventorySignature(reload.inventory)===inventorySignature(initial.inventory));await shot('11-reloaded');
  await page.locator('#as-return').click();await page.waitForFunction(()=>window.tvRealms?.ready,null,{timeout:240000});const city=await page.evaluate(()=>window.tvRealms.state);check('Tower return preserves identity and rank',city.person.id===initial.personId&&city.body.id===initial.body.bodyId&&city.person.rank===initial.rank);await shot('12-world-return');}
 else {final=await read();check('identity and inventory retained',final.personId===initial.personId&&final.body.bodyId===initial.body.bodyId&&inventorySignature(final.inventory)===inventorySignature(initial.inventory));}
 metrics=await page.evaluate(surface=>surface==='town'?{frames:window.__tv.frameMs,heap:performance.memory?.usedJSHeapSize,looks:[...window.__tv.ctx.scene.transformNodes].filter(n=>n.metadata?.presentationRevision).map(n=>n.metadata)}:(surface==='tower'?window.tvRealms.inspect():window.tvMotion.inspect()),surface);
 check('no browser errors',errors.length===0);result='passed';
}catch(e){errors.push(String(e));console.error(e);await shot('failure');process.exitCode=1;}
finally{await keys();const video=page.video();await context.close();renameSync(await video.path(),resolve(out,'actual-gameplay.webm'));await browser.close();
 writeFileSync(resolve(out,'result.json'),JSON.stringify({surface,result,checks,errors,initial,final,phases,metrics,completedAt:new Date().toISOString()},null,2));console.log(JSON.stringify({surface,result,checks,errors}));}
