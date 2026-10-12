import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.TV_FOCUSED_URL??'http://127.0.0.1:7572',label=process.env.TV_POLISH_LABEL??'before',out=resolve(`.debug/motion-correction/polish-${label}`);
mkdirSync(out,{recursive:true});const health=await fetch(base+'/realms/health').then(r=>r.json());
assert.ok(/motion-correction[/\\]focused-save/.test(health.savePath),'Refusing live save');
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}}),page=await context.newPage(),errors=[],samples=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const read=()=>page.evaluate(()=>{const i=window.tvRealms.inspect();return {person:i.state.person.id,body:i.state.body.id,rank:i.state.person.rank,pos:i.state.body.pos,clock:i.state.worldTime,camera:i.camera,motion:i.controlledLook?.motion,equipment:i.controlledLook?.equipment,focused:i.focused,hardware:i.hardware,heap:i.heap};});
const shot=async name=>{samples.push({name,...await read()});await page.screenshot({path:resolve(out,name+'.png')});console.log(name);};
const hold=async(keys,ms,capture)=>{for(const k of keys)await page.keyboard.down(k);for(let t=0;t<ms;t+=100){await page.waitForTimeout(100);samples.push({name:'motion:'+keys.join('+'),...await read()});}if(capture)await shot(capture);for(const k of keys)await page.keyboard.up(k);await page.waitForTimeout(650);};
const orbit=async(dx,dy=0)=>{await page.mouse.move(720,600);await page.mouse.down({button:'middle'});await page.mouse.move(720+dx,600+dy,{steps:30});await page.mouse.up({button:'middle'});await page.waitForTimeout(800);};
let status='failed';
try{
 await page.goto(base+'/?realms');await page.waitForFunction(()=>window.tvRealms?.ready&&window.tvRealms.inspect().focused.pending===0,null,{timeout:180000});await page.waitForTimeout(1500);
 await shot('01-house-street');await orbit(280,-35);await shot('02-house-side');await orbit(-280,35);
 await hold(['KeyW'],1500);await hold(['KeyS'],1500);await hold(['KeyW','ShiftLeft'],1200);await hold(['KeyS'],1850);
 await hold(['KeyC'],1200,'03-crouch');await hold(['KeyC','KeyW'],1100);await hold(['KeyS'],700);
 await page.locator('#rv-tower').click();await page.waitForFunction(()=>window.tvRealms.state.body.pos.z>3150,null,{timeout:90000});await page.keyboard.press('KeyQ');await page.keyboard.down('KeyX');await page.keyboard.down('KeyS');await page.waitForTimeout(80);await page.keyboard.up('KeyS');await page.keyboard.up('KeyX');await page.waitForTimeout(600);await shot('04-forest-mouth');
 await orbit(190,-25);await shot('05-forest-canopy');await orbit(-190,25);
 assert.deepEqual(errors,[]);status='passed';
}catch(e){errors.push(String(e));console.log(String(e));}
finally{const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'recorded-polish.webm'));await browser.close();writeFileSync(resolve(out,'result.json'),JSON.stringify({status,label,health,errors,samples,note:'Ordinary controls, same portable baseline and scripted camera deltas. No body/clock/material state injected. Before client is 78734a3; before backend includes migration-only development changes.'},null,2));console.log(JSON.stringify({status,label,errors,samples:samples.length}));}
if(status!=='passed')process.exitCode=1;
