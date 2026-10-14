/** Short actual screencast, started only after assets are ready. Chrome timestamps
 * preserve capture cadence; keyboard controls and canonical observations only. */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.TV_FOCUSED_URL??'http://127.0.0.1:7592',out=resolve(process.env.TV_MOTION_EVIDENCE??'.debug/motion-correction/scale-review/current-motion');mkdirSync(out,{recursive:true});
const health=await fetch(base+'/realms/health').then(r=>r.json());assert.ok(/focused-save-scale-motion/.test(health.savePath),'Refusing live save');
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],frames=[],observations=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const read=()=>page.evaluate(()=>{const i=window.tvRealms.inspect();return {person:i.state.person.id,body:i.state.body.id,rank:i.state.person.rank,hp:i.state.body.hp,inventory:i.state.person.inventory,pos:i.state.body.pos,velocity:i.state.avatar.velocity,camera:i.camera,scale:i.characterScale,motion:i.controlledLook.motion};});
let cdp,status='failed';
try{
 await page.goto(base+'/?realms');await page.waitForFunction(()=>window.tvRealms?.ready&&window.tvRealms.inspect().focused.pending===0,null,{timeout:180000});await page.waitForTimeout(1000);const original=await read();
 cdp=await context.newCDPSession(page);cdp.on('Page.screencastFrame',async e=>{const name='frame-'+String(frames.length).padStart(5,'0')+'.jpg';writeFileSync(resolve(out,name),Buffer.from(e.data,'base64'));frames.push({name,timestamp:e.metadata.timestamp});await cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{});});
 await cdp.send('Page.startScreencast',{format:'jpeg',quality:88,maxWidth:1440,maxHeight:900,everyNthFrame:1});await page.waitForTimeout(1000);
 await page.keyboard.down('KeyX');await page.keyboard.down('KeyW');await page.waitForTimeout(1600);observations.push({phase:'walking',...await read()});await page.keyboard.up('KeyW');await page.keyboard.up('KeyX');await page.waitForTimeout(600);
 await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(2000);observations.push({phase:'running',...await read()});await page.screenshot({path:resolve(out,'Veil-current-jog.png')});await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.waitForTimeout(1000);
 await page.mouse.move(700,470);await page.mouse.down({button:'middle'});await page.mouse.move(1090,470,{steps:30});await page.mouse.up({button:'middle'});await page.waitForTimeout(1000);observations.push({phase:'free-orbit',...await read()});
 await page.mouse.wheel(0,450);await page.waitForTimeout(1000);observations.push({phase:'zoom-out',...await read()});await page.mouse.wheel(0,-450);await page.waitForTimeout(1000);observations.push({phase:'zoom-in',...await read()});
 for(const s of observations){assert.equal(s.person,original.person);assert.equal(s.body,original.body);assert.equal(s.rank,original.rank);assert.equal(s.hp,original.hp);assert.deepEqual(s.inventory,original.inventory);assert.equal(s.camera.blocked,false);}
 assert.ok(Math.hypot(observations[1].velocity.x,observations[1].velocity.z)>Math.hypot(observations[0].velocity.x,observations[0].velocity.z));assert.ok(frames.length>20);assert.deepEqual(errors,[]);status='passed';
}catch(e){errors.push(String(e));}
finally{
 if(cdp)await cdp.send('Page.stopScreencast').catch(()=>{});await context.close();await browser.close();
 let concat='';for(let i=0;i<frames.length;i++){concat+=`file '${resolve(out,frames[i].name).replaceAll('\\','/')}'\n`;if(i+1<frames.length)concat+=`duration ${Math.max(.001,frames[i+1].timestamp-frames[i].timestamp).toFixed(6)}\n`;}
 writeFileSync(resolve(out,'frame-times.txt'),concat);writeFileSync(resolve(out,'result.json'),JSON.stringify({status,health,errors,frames,observations,note:'Actual headless Chrome frames, native capture timestamps, ordinary walking/running/orbit/zoom. No rendered interpolation, physics injection or fixed FPS claim.'},null,2));console.log(JSON.stringify({status,errors,frames:frames.length}));
}
if(status!=='passed')process.exitCode=1;
