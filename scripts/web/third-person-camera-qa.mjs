import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {route} from './canonical-tower-qa-route.mjs';
const base=process.env.TV_REALMS_URL??'http://127.0.0.1:7555',out=resolve(process.env.TV_REALMS_EVIDENCE??'.debug/third-person/after');
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
  if((await realm()).prompt.includes('Open Tower'))await page.keyboard.press('KeyE');await worldWalkTo({x,z:3129.5});await wait(()=>window.tvRealms.state.tower);}
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
  const view=await page.evaluate(()=>window.tvAscent.inspect()),camera=view.camera,yaw=camera.movementYaw;
  cameraSamples.push({view:'tower',bodyPosition:own.pos,...camera,
    bodyVisual:view.controlledBody,blockingSolids: view.cameraSolids.filter(s=>s.kind==='wall'&&camera.position.x>=s.x&&camera.position.x<=s.x+s.w&&camera.position.y>=s.y&&camera.position.y<=s.y+s.h&&camera.position.z>=s.z&&camera.position.z<=s.z+s.d)});
  const dx=cell.x-own.pos.x,dz=cell.z-own.pos.z;
  const right=dx*Math.cos(yaw)-dz*Math.sin(yaw),forward=-dx*Math.sin(yaw)-dz*Math.cos(yaw);
  const length=Math.hypot(right,forward)||1;
  if(Math.abs(right/length)>.38)input.push(right>0?'KeyD':'KeyA');
  if(Math.abs(forward/length)>.38)input.push(forward>0?'KeyW':'KeyS');
  if(combat)input.push('KeyQ');await keys(input);await page.waitForTimeout(50);
 }throw Error('Ordinary-key navigation timed out.');}finally{await keys([]);}
}

const angle=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const cameraSamples=[];
const inspect=()=>page.evaluate(()=>window.tvAscent?window.tvAscent.inspect():window.tvRealms.inspect());
async function orbit(dx,dy=0){await page.mouse.move(740,670);await page.mouse.down({button:'middle'});await page.mouse.move(740+dx,670+dy,{steps:20});await page.mouse.up({button:'middle'});await page.waitForTimeout(650);}
async function worldWalkTo(to,timeout=18000){
 const end=Date.now()+timeout;
 try{while(Date.now()<end){const s=await realm(),dx=to.x-s.body.pos.x,dz=to.z-s.body.pos.z;
  if(Math.hypot(dx,dz)<.5)return;
  const yaw=(await inspect()).camera.movementYaw,r=dx*Math.cos(yaw)-dz*Math.sin(yaw),f=-dx*Math.sin(yaw)-dz*Math.cos(yaw),n=Math.hypot(r,f)||1;
  const next=[];if(Math.abs(r/n)>.38)next.push(r>0?'KeyD':'KeyA');if(Math.abs(f/n)>.38)next.push(f>0?'KeyW':'KeyS');
  await keys(next);await page.waitForTimeout(60);
 }throw Error('Street ordinary-key navigation timed out');}finally{await keys([]);}
}
async function cameraMovement(name,key,right,forward,ms=700,tower=false){
 const read=tower?floor:realm,a=await read(),bodyA=tower?a.snapshot.bodies.find(b=>b.bodyId===a.own.bodyId):a.body,c=await inspect();
 await hold(key,ms);await page.waitForTimeout(200);const after=await read(),bodyB=tower?after.snapshot.bodies.find(b=>b.bodyId===after.own.bodyId):after.body;
 const yaw=c.camera.movementYaw,expect={x:right*Math.cos(yaw)-forward*Math.sin(yaw),z:-forward*Math.cos(yaw)-right*Math.sin(yaw)},dx=bodyB.pos.x-bodyA.pos.x,dz=bodyB.pos.z-bodyA.pos.z,n=Math.hypot(dx,dz),cos=(dx*expect.x+dz*expect.z)/(n*Math.hypot(expect.x,expect.z));
 observations.push({kind:'camera-relative-movement',name,bodyA,bodyB,camera:c.camera,displacement:{dx,dz,length:n,cos}});
 check(name,n>.3&&cos>.93,{n,cos});return n;
}
async function streetCamera(){
 await page.waitForTimeout(1200);let a=await realm(),v=await inspect();
 check('rendered player uses canonical body and is visible in frame',v.controlledBody.id===a.body.id&&v.controlledBody.enabled&&v.controlledLook.sharedLook&&v.controlledBody.screen.x>0&&v.controlledBody.screen.x<1440&&v.controlledBody.screen.y>0&&v.controlledBody.screen.y<900&&v.controlledBody.screen.z>0&&v.controlledBody.screen.z<1,v.controlledBody);
 check('elevated freely orbiting initial framing',v.camera.mode==='third-person'&&Math.abs(v.camera.pitch-38*Math.PI/180)<.001&&v.camera.preferred===10.5&&!v.camera.blocked,v.camera);
 await shot('00-after-matched-spawn');
 await cameraMovement('world forward follows camera','KeyW',0,1);await cameraMovement('world backwards follows camera','KeyS',0,-1);
 await cameraMovement('world right follows camera','KeyD',1,0);await cameraMovement('world left follows camera','KeyA',-1,0);
 const old=(await realm()).body.yaw;await orbit(540,65);v=await inspect();
 check('idle orbit changes camera without turning body',angle((await realm()).body.yaw,old)<.02&&angle(v.camera.renderedYaw,Math.PI)>.7,v.camera);
 await shot('01-after-free-orbit');
 const turns=[];await page.keyboard.down('KeyW');
 for(let n=0;n<8;n++){const s=await realm();turns.push({time:s.time,yaw:s.body.yaw});await page.waitForTimeout(35);}
 await page.keyboard.up('KeyW');await page.waitForTimeout(180);
 check('runtime body turns at bounded canonical rate',turns.every((s,n)=>!n||angle(s.yaw,turns[n-1].yaw)<=12.566371*(s.time-turns[n-1].time)+.03),turns);
 await cameraMovement('orbited world forward follows rendered view','KeyW',0,1);await cameraMovement('orbited world back follows rendered view','KeyS',0,-1);
 await cameraMovement('orbited world right follows rendered view','KeyD',1,0);await cameraMovement('orbited world left follows rendered view','KeyA',-1,0);
 await page.mouse.move(740,650);for(let i=0;i<12;i++)await page.mouse.wheel(0,-600);await page.waitForTimeout(1800);v=await inspect();
 check('wheel provides bounded near framing',v.camera.preferred===3&&!v.camera.blocked,v.camera);await shot('02-after-near');
 for(let i=0;i<15;i++)await page.mouse.wheel(0,600);await page.waitForTimeout(2300);v=await inspect();
 check('wheel provides bounded far framing',v.camera.preferred===18&&!v.camera.blocked,v.camera);await shot('03-after-far');
 const prefs=v.camera;await page.reload();await ready();v=await inspect();check('reload preserves orbit pitch and zoom preferences',angle(v.camera.yaw,prefs.yaw)<.001&&v.camera.pitch===prefs.pitch&&v.camera.preferred===prefs.preferred);
 const start=(await realm()).body.pos;await page.locator('#rv-journal').click();await hold('KeyW',600);await page.waitForTimeout(150);
 check('journal releases movement',Math.hypot((await realm()).body.pos.x-start.x,(await realm()).body.pos.z-start.z)<.05);await page.locator('#rv-close').click();
 await page.keyboard.down('KeyW');await page.waitForTimeout(200);await page.locator('#rv-journal').click();await page.keyboard.up('KeyW');await page.waitForTimeout(200);a=await realm();await page.waitForTimeout(500);
 check('opening journal releases already held movement',Math.hypot((await realm()).body.pos.x-a.body.pos.x,(await realm()).body.pos.z-a.body.pos.z)<.05);await page.locator('#rv-close').click();
}
async function towerCamera(){
 await page.waitForTimeout(800);const a=await floor(),v=await inspect();
 check('canonical Tower starts with elevated third-person profile',v.camera.mode==='third-person'&&v.camera.preferred===10.5&&Math.abs(v.camera.pitch-38*Math.PI/180)<.001&&!v.camera.blocked,v.camera);
 const old=a.snapshot.bodies.find(b=>b.bodyId===a.own.bodyId).yaw;await orbit(450,35);
 check('Tower idle orbit retains canonical body facing',angle((await floor()).snapshot.bodies.find(b=>b.bodyId===a.own.bodyId).yaw,old)<.03);
 await cameraMovement('Tower orbited forward follows view','KeyW',0,1,320,true);await cameraMovement('Tower orbited back follows view','KeyS',0,-1,320,true);
 await cameraMovement('Tower orbited right follows view','KeyD',1,0,320,true);await cameraMovement('Tower orbited left follows view','KeyA',-1,0,320,true);
 await shot('04-after-canonical-tower-orbit');
}

let initial,entered,beforeReload,returned;
try{
 await page.goto(base+'/');await ready();initial=await realm();
 check('primary URL uses canonical world and real rank',typeof initial.person.rank==='string'&&initial.person.rank==='Normal'&&!initial.expedition?.active,initial.person);
 check('historical score Tower is absent from primary UI',!await page.locator('#rv-ascend').isVisible());
 check('canonical avatar body projection retains identity',initial.avatar.bodyId===initial.body.id&&initial.avatar.entityId===initial.person.id);
 await streetCamera();await page.waitForTimeout(1500);const city=await page.evaluate(()=>window.tvRealms.inspect());
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
 const visuals=await page.evaluate(()=>window.tvAscent.inspect().looks);check('Tower shares current imported human presentation',visuals.some(l=>l?.bodyId===initial.body.id&&l.sharedLook),visuals);await shot('03-current-canonical-tower');await towerCamera();
 await page.getByRole('button',{name:'Take Ember field manual',exact:true}).click();await page.getByRole('button',{name:'Study Ember field manual',exact:true}).click();await wait(()=>window.tvAscent.frame.own.learned.some(s=>s.id==='book-ember'));
 check('source-backed learning retains canonical rank gate', (await floor()).own.rank===initial.person.rank&&!(await floor()).own.growth.eligible);
 await page.mouse.move(760,680);const seq=(await floor()).snapshot.bodies.find(b=>b.bodyId===initial.body.id).attackSeq;
 const strikeCam=(await inspect()).camera.yaw;await page.mouse.click(760,680);await wait(s=>window.tvAscent.frame.snapshot.bodies.find(b=>b.bodyId===window.tvAscent.frame.own.bodyId).attackSeq>s,seq);
 check('unlocked mouse strike reaches canonical combat action',!await page.evaluate(()=>!!document.pointerLockElement));check('striking does not rotate camera',angle((await inspect()).camera.yaw,strikeCam)<.001);await page.waitForTimeout(800);
 const guardCam=(await inspect()).camera.yaw;await page.mouse.down({button:'right'});await wait(()=>window.tvAscent.frame.snapshot.bodies.find(b=>b.bodyId===window.tvAscent.frame.own.bodyId).guarding);
 await page.waitForTimeout(900);check('held mouse guard renews its canonical lease', (await floor()).snapshot.bodies.find(b=>b.bodyId===initial.body.id).guarding);
 await page.mouse.up({button:'right'});await wait(()=>!window.tvAscent.frame.snapshot.bodies.find(b=>b.bodyId===window.tvAscent.frame.own.bodyId).guarding);check('mouse guard press and release reach canonical body',true);check('guarding does not rotate camera',angle((await inspect()).camera.yaw,guardCam)<.001);
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
 await enter();check('combat exploration resumes the same learned canonical run',(await floor()).tower.id===entered.tower.id&&(await floor()).own.learned.some(s=>s.id==='book-ember'));
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
 const targetCam=(await inspect()).camera.yaw;await walkTo(observedTarget,60000,true);await keys(['KeyQ']);await page.waitForTimeout(350);
 const faced=await floor(),fb=faced.snapshot.bodies.find(b=>b.bodyId===faced.own.bodyId),ft=faced.snapshot.bodies.find(b=>b.bodyId===target);
 check('held target facing preserves camera orientation',angle((await inspect()).camera.yaw,targetCam)<.001&&(await inspect()).facingMode==='target');
 if(ft)check('held target facing uses canonical opponent direction',angle(fb.yaw,Math.atan2(fb.pos.x-ft.pos.x,fb.pos.z-ft.pos.z))<.2);
 await keys([]);check('releasing target facing returns to travel mode',(await inspect()).facingMode==='travel');await keys(['KeyQ']);
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
 observations.push({kind:'camera-obstruction-traversal',samples:cameraSamples});
 check('camera remains outside received solid geometry during Tower traversal',cameraSamples.length>10&&cameraSamples.every(c=>!c.blocked&&!c.bodyVisual?.blocked),{samples:cameraSamples.length,blocked:cameraSamples.filter(c=>c.blocked),minDistance:Math.min(...cameraSamples.map(c=>c.dist)),maxDistance:Math.max(...cameraSamples.map(c=>c.dist))});
 check('no browser errors',errors.length===0,errors);
}catch(e){errors.push(String(e));observations.push({kind:'failure-state',state:await page.evaluate(()=>window.tvAscent?.frame??window.tvRealms?.state),inspect:await page.evaluate(()=>window.tvAscent?.inspect()??window.tvRealms?.inspect())});console.error(e);await shot('failure');process.exitCode=1;}
finally{
 await keys([]);writeFileSync(resolve(out,'result.json'),JSON.stringify({kind:'actual rendered ordinary-input journey; no body/save mutation and no calibrated pacing claim',commit:build.commit,health,checks,errors,observations,cameraSamples,initial,entered,beforeReload,returned,completedAt:new Date().toISOString()},null,2));
 const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'third-person-traversal.webm'));await browser.close();
}
