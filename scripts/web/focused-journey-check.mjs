import {chromium} from 'playwright';import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import assert from 'node:assert/strict';
import {clearAscentEntry} from './focused-input-driver.mjs';
const base=process.env.TV_FOCUSED_URL??'http://127.0.0.1:7572',out=resolve(process.env.TV_FOCUSED_EVIDENCE??'.debug/motion-correction/focused-journey');mkdirSync(out,{recursive:true});
const health=await fetch(base+'/realms/health').then(r=>r.json());assert.ok(/motion-correction[/\\]focused-save/.test(health.savePath),'Refusing live save');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-precise-memory-info','--disable-renderer-backgrounding','--disable-background-timer-throttling']}),context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}}),page=await context.newPage(),errors=[],samples=[];let errorCount=0,status='failed';
page.on('pageerror',e=>{errorCount++;if(errors.length<30)errors.push(String(e).slice(0,3000));});page.on('console',m=>{if(m.type()==='error'){errorCount++;if(errors.length<30)errors.push(m.text().slice(0,3000));}});
const realm=()=>page.evaluate(()=>window.tvRealms.inspect()),ascent=()=>page.evaluate(()=>window.tvAscent.inspect());
const waitRealm=()=>page.waitForFunction(()=>window.tvRealms?.ready&&(!window.tvRealms.state.focusedAssets||window.tvRealms.inspect().focused.pending===0),null,{timeout:180000});
const shot=async(name,kind='realm')=>{const value=await(kind==='realm'?realm():ascent());samples.push({name,kind,...value,frame:kind==='ascent'?await page.evaluate(()=>window.tvAscent.frame):undefined});await page.screenshot({path:resolve(out,name+'.png')});console.log(name);};
const truth=s=>({person:s.person.id,rank:s.person.rank,inventory:s.person.inventory,body:s.body.id});
try{
 await page.goto(base+'/?realms');await waitRealm();await page.waitForTimeout(1200);const original=truth((await realm()).state);await shot('01-town-ground');
 const start=(await realm()).state.body.pos;await page.keyboard.down('KeyX');await page.keyboard.down('KeyW');await page.waitForTimeout(1100);await shot('02-road-walk');await page.keyboard.up('KeyW');await page.keyboard.up('KeyX');assert.ok(Math.hypot((await realm()).state.body.pos.x-start.x,(await realm()).state.body.pos.z-start.z)>1);
 await page.locator('#rv-portal').click();await page.waitForFunction(()=>window.tvRealms.state.prompt.includes('Cross the Veil'),null,{timeout:90000});await page.keyboard.press('KeyE');await page.waitForFunction(()=>!!window.tvRealms.state.pending);await page.locator('#rv-cancel').click();await page.waitForFunction(()=>!window.tvRealms.state.pending);assert.equal((await realm()).state.realm,'brass');
 for(const destination of ['aether','brass']){await page.locator('#rv-portal').click();await page.waitForFunction(()=>window.tvRealms.state.prompt.includes('Cross the Veil'),null,{timeout:90000});await page.keyboard.press('KeyE');await page.waitForFunction(()=>!!window.tvRealms.state.pending);await page.locator('#rv-cross').click();await page.waitForFunction(realm=>window.tvRealms?.state?.realm===realm,destination,{timeout:180000});await waitRealm();assert.deepEqual(truth((await realm()).state),original);await shot('02-portal-'+destination);}
 await page.locator('#rv-tower').click();await page.waitForFunction(()=>window.tvRealms.state.body.pos.z>3170,null,{timeout:90000});await shot('03-forest-route');
 await page.waitForFunction(()=>window.tvRealms.state.tower,null,{timeout:120000});await page.waitForTimeout(700);await shot('04-tower-landmark');assert.deepEqual(truth((await realm()).state),original);
 await page.locator('#rv-canonical').click();await page.waitForFunction(()=>window.tvAscent?.ready,null,{timeout:180000});await page.waitForTimeout(700);await shot('05-actual-tower-floor','ascent');
 const firstRun=await page.evaluate(()=>({id:window.tvAscent.frame.tower.id,body:window.tvAscent.frame.own.bodyId}));await page.keyboard.press('KeyF');await waitRealm();assert.deepEqual(truth((await realm()).state),original);await shot('05-returned-landmark');await page.locator('#rv-canonical').click();await page.waitForFunction(()=>window.tvAscent?.ready,null,{timeout:180000});assert.deepEqual(await page.evaluate(()=>({id:window.tvAscent.frame.tower.id,body:window.tvAscent.frame.own.bodyId})),firstRun);
 const entrance=await page.evaluate(()=>window.tvAscent.frame.tower.start),beforeTime=await page.evaluate(()=>window.tvAscent.frame.snapshot.tick);
 await page.keyboard.press('KeyE');await page.waitForTimeout(350);await page.keyboard.press('KeyE');await page.waitForTimeout(350);await page.keyboard.press('KeyI');await page.getByRole('button',{name:'Equip Trial steel dagger',exact:true}).click();await page.waitForFunction(()=>window.tvAscent.frame.snapshot.bodies.find(b=>b.bodyId===window.tvAscent.frame.own.bodyId)?.equipment.some(i=>i.type==='dagger'));await page.keyboard.press('KeyI');await page.waitForTimeout(500);await shot('05-finite-dagger-equipped','ascent');
 const initialHitSequences=await page.evaluate(()=>Object.fromEntries(window.tvAscent.frame.snapshot.bodies.map(b=>[b.bodyId,b.hitSeq])));
 // Ordinary controls advance along the authored processional route; no debug
 // teleports, damage fixtures, rank grants or renderer-owned enemies are used.
 // The isolated contact check proved this wide lane clears the entry columns.
 await clearAscentEntry(page);await shot('06-floor-traversal','ascent');
 let hit=false;
 for(let n=0;n<35;n++){
  const f=await page.evaluate(()=>window.tvAscent.frame),own=f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId),rivals=f.snapshot.bodies.filter(b=>b.bodyId!==own.bodyId&&!b.dead&&!b.incapacitated),nearest=rivals.sort((a,b)=>Math.hypot(a.pos.x-own.pos.x,a.pos.z-own.pos.z)-Math.hypot(b.pos.x-own.pos.x,b.pos.z-own.pos.z))[0];
  if(!nearest){await page.waitForTimeout(300);continue;}
  for(const b of f.snapshot.bodies)initialHitSequences[b.bodyId]??=b.hitSeq;for(let j=0;j<rivals.length+1&&(await page.evaluate(()=>window.tvAscent.targetId))!==nearest.bodyId;j++)await page.keyboard.press('Tab');
  const d=Math.hypot(nearest.pos.x-own.pos.x,nearest.pos.z-own.pos.z),i=await ascent();
  if(d>1.1){const yaw=i.camera.movementYaw,dx=nearest.pos.x-own.pos.x,dz=nearest.pos.z-own.pos.z,right=dx*Math.cos(yaw)-dz*Math.sin(yaw),forward=-dx*Math.sin(yaw)-dz*Math.cos(yaw),key=Math.abs(right)>Math.abs(forward)?(right>0?'KeyD':'KeyA'):(forward>0?'KeyW':'KeyS');await page.keyboard.down(key);await page.waitForTimeout(220);await page.keyboard.up(key);await page.waitForTimeout(250);continue;}
  await page.keyboard.down('KeyQ');await page.waitForTimeout(160);await page.keyboard.press('KeyJ');await page.waitForTimeout(500);await page.keyboard.up('KeyQ');
  const now=await page.evaluate(()=>window.tvAscent.frame);if(now.snapshot.bodies.some(b=>b.hitSeq>(initialHitSequences[b.bodyId]??b.hitSeq))){hit=true;break;}
 }
 await shot('07-canonical-combat','ascent');assert.ok(hit,'No actual canonical hit observed');assert.ok((await page.evaluate(()=>window.tvAscent.frame.snapshot.tick))>beforeTime);
 // Reload preserves the real active floor and its finite entities.
 const floorBefore=await page.evaluate(()=>({id:window.tvAscent.frame.tower.id,floor:window.tvAscent.frame.tower.floor,body:window.tvAscent.frame.own.bodyId,rank:window.tvAscent.frame.own.rank}));
 await page.reload();await page.waitForFunction(()=>window.tvAscent?.ready,null,{timeout:180000});assert.deepEqual(await page.evaluate(()=>({id:window.tvAscent.frame.tower.id,floor:window.tvAscent.frame.tower.floor,body:window.tvAscent.frame.own.bodyId,rank:window.tvAscent.frame.own.rank})),floorBefore);await shot('08-reloaded-floor','ascent');
 assert.equal(errorCount,0,errors.join('\n'));status='passed';
}catch(e){errors.push(String(e));console.log(String(e));try{const kind=await page.evaluate(()=>window.tvAscent?'ascent':'realm');await shot('failure',kind);}catch{}}
finally{const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'recorded-journey.webm'));await browser.close();writeFileSync(resolve(out,'result.json'),JSON.stringify({status,health,errorCount,errors,samples,measurement:'Actual headless Chrome1440x900 with ordinary button/keyboard controls. Frame intervals include recording and scheduling overhead; no human climb or GPU timer claim.'},null,2));console.log(JSON.stringify({status,errorCount,samples:samples.length,errors:errors.map(e=>e.slice(0,300))}));}
if(status!=='passed')process.exitCode=1;
