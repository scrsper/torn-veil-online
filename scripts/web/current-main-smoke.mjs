import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {route} from './canonical-tower-qa-route.mjs';
const base=process.env.TV_REALMS_URL??'http://127.0.0.1:7550',out=resolve(process.env.TV_REALMS_EVIDENCE??'.debug/main-integration/playable');
mkdirSync(out,{recursive:true});
const health=await(await fetch(base+'/realms/health')).json(),build=await(await fetch(base+'/current-build.json')).json();
assert.equal(health.clientBuild.commit,build.commit);assert.equal(build.progression,'canonical-world');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
const page=await context.newPage(),checks=[],errors=[],observations=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const wait=(fn,arg=null,timeout=240000)=>page.waitForFunction(fn,arg,{timeout});
const ready=()=>wait(()=>window.tvRealms?.ready),ascentReady=()=>wait(()=>window.tvAscent?.ready);
const realm=()=>page.evaluate(()=>window.tvRealms.state),floor=()=>page.evaluate(()=>window.tvAscent.frame);
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});console.log(ok?'PASS':'FAIL',name);assert.ok(ok,name);};
const shot=async name=>{await page.screenshot({path:resolve(out,name+'.png')});console.log('CAPTURE',name);};
const hold=async(key,ms)=>{await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);};
const unchanged=(a,b)=>a.person.id===b.person.id&&a.body.id===b.body.id&&a.person.rank===b.person.rank&&JSON.stringify(a.person.inventory)===JSON.stringify(b.person.inventory);
async function portal(destination){
 await page.locator('#rv-portal').click();await wait(()=>window.tvRealms.state.prompt.includes('Cross the Veil'));
 await page.keyboard.press('KeyE');await wait(()=>!!window.tvRealms.state.pending);await page.locator('#rv-cross').click();
 await wait(r=>window.tvRealms?.state.realm===r&&window.tvRealms.ready,destination);
}
async function enter(){
 const s=await realm(),x=s.realm==='aether'?3120.5:11312.5;
 if(!s.tower){await page.locator('#rv-tower').click();await wait(x=>Math.hypot(window.tvRealms.state.body.pos.x-x,window.tvRealms.state.body.pos.z-3120.5)<.6,x);
  if((await realm()).prompt.includes('Open Tower'))await page.keyboard.press('KeyE');await hold('KeyW',2700);await wait(()=>window.tvRealms.state.tower);}
 await page.locator('#rv-canonical').click();await ascentReady();
}
const held=new Set();
async function keys(next){for(const k of held)if(!next.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
async function scanWardens(){
 // Turn through ordinary camera/face controls. Canonical perception can lose a
 // body behind the player; inspecting hidden server residents is not allowed.
 await keys(['KeyQ']);let turns=0,seen=false;
 const orbit=async dx=>{await page.mouse.move(760,680);await page.mouse.down({button:'middle'});await page.mouse.move(760+dx,680);await page.mouse.up({button:'middle'});};
 try{for(;turns<8;){await orbit(100);turns++;await page.waitForTimeout(220);const f=await floor();if(f.snapshot.bodies.some(b=>b.bodyId!==f.own.bodyId&&!b.dead&&!b.incapacitated)){seen=true;break;}}}
 finally{for(;turns>0;turns--)await orbit(-100);await page.waitForTimeout(150);await keys([]);}
 return seen;
}
async function walkTo(target,timeout=45000,combat=false,seek=false){
 const plan=await page.evaluate(()=>window.tvAscent.plan),deadline=Date.now()+timeout;let path=[],nextRoute=0;
 try{while(Date.now()<deadline){
  const f=await floor(),own=f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId),to=typeof target==='function'?target(f):target;
  if(seek&&f.snapshot.bodies.some(b=>b.bodyId!==own.bodyId&&!b.dead&&!b.incapacitated))return f;
  if(Math.hypot(own.pos.x-to.x,own.pos.z-to.z)<(combat?.7:.65))return f;
  if(Date.now()>nextRoute){path=route(plan,own.pos,to);nextRoute=Date.now()+500;}
  while(path.length&&Math.hypot(own.pos.x-path[0].x,own.pos.z-path[0].z)<.3)path.shift();
  const cell=path[0]??to,input=[];
  if(Math.abs(cell.x-own.pos.x)>.12)input.push(cell.x>own.pos.x?'KeyD':'KeyA');
  if(Math.abs(cell.z-own.pos.z)>.12)input.push(cell.z>own.pos.z?'KeyS':'KeyW');
  if(combat)input.push('KeyQ');await keys(input);await page.waitForTimeout(50);
 }throw Error('Ordinary-key navigation timed out.');}finally{await keys([]);}
}
let initial,entered,beforeReload,returned;
try{
 await page.goto(base+'/');await ready();initial=await realm();
 check('primary URL uses canonical world and real rank',typeof initial.person.rank==='string'&&initial.person.rank==='Normal'&&!initial.expedition?.active,initial.person);
 check('historical score Tower is absent from primary UI',!await page.locator('#rv-ascend').isVisible());
 check('canonical avatar body projection retains identity',initial.avatar.bodyId===initial.body.id&&initial.avatar.entityId===initial.person.id);
 await page.waitForTimeout(1500);const city=await page.evaluate(()=>window.tvRealms.inspect());
 check('current imported humans render as city residents',city.residentLooks.some(l=>l?.sharedLook&&l.bodyId),city.residentLooks);
 observations.push({kind:'city',hardware:city.hardware,renderer:city.renderer,heap:city.heap,loaded:city.loaded,width:city.width,height:city.height,frames:city.frames,streamingFrames:city.streamingFrames,uploads:city.uploads,serverSamples:city.serverSamples});await shot('01-current-aether');
 const from=initial.body.pos;await hold('KeyW',1000);const moving=await realm();
 check('ordinary world movement uses canonical displacement',Math.hypot(moving.body.pos.x-from.x,moving.body.pos.z-from.z)>.5);
 await page.locator('#rv-portal').click();await wait(()=>window.tvRealms.state.prompt.includes('Cross the Veil'));
 await page.keyboard.press('KeyE');await wait(()=>!!window.tvRealms.state.pending);await page.locator('#rv-cancel').click();await wait(()=>!window.tvRealms.state.pending);
 check('cancelled portal retains realm and identity',unchanged(initial,await realm())&&(await realm()).realm==='aether');
 await portal('brass');const brass=await realm();check('portal preserves actual canonical rank and all starting belongings',unchanged(initial,brass));await shot('02-current-cinderveil');
 await page.reload();await ready();check('portal save reload retains canonical identity/rank/inventory',unchanged(brass,await realm()));
 await portal('aether');check('portal round trip retains canonical identity/rank/inventory',unchanged(initial,await realm()));
 await enter();entered=await floor();check('canonical Tower carries same person body and rank',entered.own.id===initial.person.id&&entered.own.bodyId===initial.body.id&&entered.own.rank===initial.person.rank);
 await page.waitForTimeout(1500); // Capture after the imported body has rendered.
 const visuals=await page.evaluate(()=>window.tvAscent.inspect().looks);check('Tower shares current imported human presentation',visuals.some(l=>l?.bodyId===initial.body.id&&l.sharedLook),visuals);await shot('03-current-canonical-tower');
 await page.getByRole('button',{name:'Take Ember field manual',exact:true}).click();await page.getByRole('button',{name:'Study Ember field manual',exact:true}).click();await wait(()=>window.tvAscent.frame.own.learned.some(s=>s.id==='book-ember'));
 check('source-backed learning retains canonical rank gate', (await floor()).own.rank===initial.person.rank&&!(await floor()).own.growth.eligible);
 await page.mouse.move(760,680);const seq=(await floor()).snapshot.bodies.find(b=>b.bodyId===initial.body.id).attackSeq;
 await page.mouse.click(760,680);await wait(s=>window.tvAscent.frame.snapshot.bodies.find(b=>b.bodyId===window.tvAscent.frame.own.bodyId).attackSeq>s,seq);
 check('unlocked mouse strike reaches canonical combat action',!await page.evaluate(()=>!!document.pointerLockElement));await page.waitForTimeout(800);
 await page.mouse.down({button:'right'});await wait(()=>window.tvAscent.frame.snapshot.bodies.find(b=>b.bodyId===window.tvAscent.frame.own.bodyId).guarding);
 await page.waitForTimeout(900);check('held mouse guard renews its canonical lease', (await floor()).snapshot.bodies.find(b=>b.bodyId===initial.body.id).guarding);
 await page.mouse.up({button:'right'});await wait(()=>!window.tvAscent.frame.snapshot.bodies.find(b=>b.bodyId===window.tvAscent.frame.own.bodyId).guarding);check('mouse guard press and release reach canonical body',true);
 // Visibility is canonical: physically search the projected rooms before selecting.
 const plan=await page.evaluate(()=>window.tvAscent.plan);
 let visible=(await floor()).snapshot.bodies.some(b=>b.bodyId!==initial.body.id&&!b.dead&&!b.incapacitated);
 for(const station of [plan.exit,...plan.rooms.map(r=>({x:r.x+r.w/2,z:r.z+r.d/2}))]){
  if(visible)break;await walkTo(station,45000,false,true);
  visible=(await floor()).snapshot.bodies.some(b=>b.bodyId!==initial.body.id&&!b.dead&&!b.incapacitated);
 }
 await page.keyboard.press('Tab');let target=await page.evaluate(()=>window.tvAscent.targetId);check('selected a real projected warden after physical exploration',!!target);
 // A warden can leave the visibility projection behind a doorway. Remember only
 // its last observed position and physically follow; never inspect hidden bodies.
 let lastSeen=(await floor()).snapshot.bodies.find(b=>b.bodyId===target)?.pos;
 const observedTarget=f=>{let b=f.snapshot.bodies.find(b=>b.bodyId===target);if(!b){b=f.snapshot.bodies.find(b=>b.bodyId!==f.own.bodyId&&!b.dead&&!b.incapacitated);if(b)target=b.bodyId;}lastSeen=b?.pos??lastSeen;assert.ok(lastSeen,'selected target has an observed position');return lastSeen;};
 await walkTo(observedTarget,60000,true);await keys(['KeyQ']);await page.waitForTimeout(200);
 const beforeHit=await floor();
 let hit=false;
 for(let n=0;n<8&&!hit;n++){
  if(!(await floor()).snapshot.bodies.some(b=>b.bodyId!==initial.body.id&&!b.dead&&!b.incapacitated)){
   if(!await scanWardens())for(const station of plan.rooms.map(r=>({x:r.x+r.w/2,z:r.z+r.d/2}))){await walkTo(station,45000,false,true);if((await floor()).snapshot.bodies.some(b=>b.bodyId!==initial.body.id&&!b.dead&&!b.incapacitated))break;}
  }
  await walkTo(observedTarget,15000,true);await keys(['KeyQ']);await page.waitForTimeout(180);
  await page.mouse.click(760,680);await page.waitForTimeout(900);const f=await floor();
  observations.push({kind:'actual-mouse-contact-attempt',own:f.own,body:f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId),target:f.snapshot.bodies.find(b=>b.bodyId===target)});
  const ownAction=f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId)?.combatAction;
  // Physical contact can hit another warden, and a struck body may leave the
  // visibility projection. The actor's canonical contact receipt is the proof.
  hit=!!(ownAction?.kind==='attack'&&ownAction.id!==beforeHit.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId)?.combatAction?.id
   &&ownAction.contact?.eventId&&ownAction.contact.bodyId!==f.own.bodyId&&['hit','guarded'].includes(ownAction.outcome));
  if(hit)observations.push({kind:'canonical-mouse-contact-receipt',action:ownAction});
 }
 await keys([]);check('actual mouse combat causes observed warden contact',hit);observations.push({kind:'tower-play',inspect:await page.evaluate(()=>window.tvAscent.inspect())});await shot('04-current-mouse-combat');
 const start=(await floor()).tower.start;await walkTo(start,60000);await page.waitForTimeout(1200);
 beforeReload=await floor();await page.locator('#as-save').click();await page.waitForTimeout(800);
 await page.mouse.down({button:'right'});await page.reload();await page.mouse.up({button:'right'});await ascentReady();
 const loaded=await floor();check('save reload retains run identity learning inventory and rank',loaded.tower.id===entered.tower.id&&loaded.own.id===entered.own.id&&loaded.own.bodyId===entered.own.bodyId&&loaded.own.rank===entered.own.rank&&loaded.own.learned.some(s=>s.id==='book-ember')&&JSON.stringify(loaded.snapshot.carried.map(i=>[i.id,i.quantity]))===JSON.stringify(beforeReload.snapshot.carried.map(i=>[i.id,i.quantity])));
 check('reload releases stale guard input',!loaded.snapshot.bodies.find(b=>b.bodyId===loaded.own.bodyId).guarding);
 check('save reload does not manufacture health',loaded.own.health<=beforeReload.own.health+.1);
 await page.keyboard.press('Escape');await page.locator('#as-return').click();await ready();returned=await realm();
 check('Tower return carries learned sources to same world identity and rank',returned.person.id===initial.person.id&&returned.body.id===initial.body.id&&returned.person.rank===initial.person.rank&&returned.person.inventory.some(i=>i.name==='Ember field manual'));await shot('05-current-returned-world');
 await enter();const repeat=await floor();check('repeated Tower entry retains run learning and rank',repeat.tower.id===entered.tower.id&&repeat.own.rank===initial.person.rank&&repeat.own.learned.some(s=>s.id==='book-ember'));
 await page.locator('#as-return').click();await ready();await page.reload();await ready();check('world reload after repeated Tower return retains canonical belongings',JSON.stringify((await realm()).person.inventory)===JSON.stringify(returned.person.inventory));
 check('no browser errors',errors.length===0,errors);
}catch(e){errors.push(String(e));observations.push({kind:'failure-state',state:await page.evaluate(()=>window.tvAscent?.frame??window.tvRealms?.state),inspect:await page.evaluate(()=>window.tvAscent?.inspect()??window.tvRealms?.inspect())});console.error(e);await shot('failure');process.exitCode=1;}
finally{
 await keys([]);writeFileSync(resolve(out,'result.json'),JSON.stringify({kind:'actual rendered ordinary-input journey; no body/save mutation and no calibrated pacing claim',commit:build.commit,health,checks,errors,observations,initial,entered,beforeReload,returned,completedAt:new Date().toISOString()},null,2));
 const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'current-main-traversal.webm'));await browser.close();
}
