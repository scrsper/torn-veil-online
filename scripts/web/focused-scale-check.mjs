import {chromium} from 'playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {travelClick} from './focused-input-driver.mjs';
const base=process.env.TV_FOCUSED_URL??'http://127.0.0.1:7590',label=process.env.TV_SCALE_LABEL??'before';
const out=resolve('.debug/motion-correction/scale-review',label);mkdirSync(out,{recursive:true});
const route=JSON.parse(readFileSync('.debug/motion-correction/scale-review/route.json'));
const health=await fetch(base+'/realms/health').then(r=>r.json());assert.ok(/focused-save-scale-/.test(health.savePath),'Refusing canonical save');
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}}),page=await context.newPage(),errors=[],samples=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const read=()=>page.evaluate(()=>{const i=window.tvRealms.inspect();return {person:i.state.person.id,body:i.state.body.id,rank:i.state.person.rank,inventory:i.state.inventory,health:i.state.body.health,pos:i.state.body.pos,yaw:i.state.body.yaw,clock:i.state.worldTime,camera:i.camera,scale:i.characterScale,motion:i.controlledLook?.motion,focused:i.focused};});
// Aim the freely rotatable camera along the exact segment, then walk with ordinary
// keys. Eight-direction quantisation can cut a narrow doorway corner even when
// the certified segment is clear. Short taps handle the last controller step.
async function driveRealmTo(page,target,{tolerance=.1,timeout=45000}={}){
 const end=Date.now()+timeout;await page.keyboard.down('KeyX');
 try{while(Date.now()<end){const i=await page.evaluate(()=>{const s=window.tvRealms.inspect();return {pos:s.state.body.pos,camera:s.camera};}),dx=target.x-i.pos.x,dz=target.z-i.pos.z,distance=Math.hypot(dx,dz);if(distance<tolerance)return;
  const desired=Math.atan2(-dx,-dz),turn=Math.atan2(Math.sin(desired-i.camera.movementYaw),Math.cos(desired-i.camera.movementYaw));
  if(Math.abs(turn)>.01){await page.keyboard.up('KeyW');let delta=-turn/.0022;while(Math.abs(delta)>.1){const d=Math.max(-450,Math.min(450,delta));await page.mouse.move(700,470);await page.mouse.down({button:'middle'});await page.mouse.move(700+d,470,{steps:8});await page.mouse.up({button:'middle'});delta-=d;}await page.waitForTimeout(110);}
  await page.keyboard.down('KeyW');await page.waitForTimeout(distance<.4?35:160);if(distance<.4){await page.keyboard.up('KeyW');await page.waitForTimeout(70);}
 }throw Error('Precise ordinary-input waypoint unreachable '+JSON.stringify({target,actual:(await read()).pos}));
 }finally{await page.keyboard.up('KeyW');await page.keyboard.up('KeyX');await page.waitForTimeout(400);}
}
async function shot(name,caption){await page.waitForTimeout(1000);const s=await read();samples.push({name,caption,...s});await page.screenshot({path:resolve(out,name+'-raw.png')});
 await page.evaluate(({s,caption,label})=>{
  const ref=s.scale.reference,points=[ref.feet.screen,ref.oneMetre.screen,ref.human.screen],[a,b,c]=points;
  const overlay=document.createElement('div');overlay.id='scale-review';overlay.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:999';
  overlay.innerHTML=`<div style="position:absolute;top:80px;left:20px;padding:10px 14px;background:#101c25e8;color:#eef7ef;font:15px system-ui;border-left:3px solid #ffd78d">${label.toUpperCase()} · ${caption}<br>Actual posed mesh ${s.scale.bounds.dimensions[1].toFixed(3)} m · ${s.scale.screenHeightPx.toFixed(0)} px<br>Controller: 1.75 m tall × 0.60 m diameter</div><svg width="1440" height="900" style="overflow:visible"><path d="M ${a[0]} ${a[1]} L ${c[0]} ${c[1]} M ${a[0]-6} ${a[1]} h 12 M ${b[0]-6} ${b[1]} h 12 M ${c[0]-6} ${c[1]} h 12" stroke="#ffe3a3" stroke-width="3" fill="none"/><text x="${c[0]+10}" y="${c[1]+4}" fill="#ffe3a3" stroke="#182228" stroke-width="3" paint-order="stroke" font-family="sans-serif" font-size="17">1.75 m reference</text><text x="${b[0]+10}" y="${b[1]+4}" fill="#ffe3a3" stroke="#182228" stroke-width="3" paint-order="stroke" font-family="sans-serif" font-size="17">1 m</text></svg>`;document.body.append(overlay);
 },{s,caption,label});
 await page.screenshot({path:resolve(out,name+'.png')});await page.locator('#scale-review').evaluate(e=>e.remove());console.log(name+' '+s.scale.bounds.dimensions[1].toFixed(3)+'m '+s.scale.screenHeightPx.toFixed(0)+'px');
}
async function orbit(yaw,pitch){
 const initial=(await read()).camera;let dx=-Math.atan2(Math.sin(yaw-initial.yaw),Math.cos(yaw-initial.yaw))/.0022,dy=pitch===undefined?0:(pitch-initial.pitch)/.0022;
 while(Math.abs(dx)>.05||Math.abs(dy)>.05){const sx=Math.max(-450,Math.min(450,dx)),sy=Math.max(-250,Math.min(250,dy));await page.mouse.move(700,470);await page.mouse.down({button:'middle'});await page.mouse.move(700+sx,470+sy,{steps:20});await page.mouse.up({button:'middle'});dx-=sx;dy-=sy;}
 await page.waitForTimeout(1000);
 const actual=(await read()).camera.yaw;assert.ok(Math.abs(Math.atan2(Math.sin(actual-yaw),Math.cos(actual-yaw)))<.01,'Ordinary orbit reached requested yaw');
}
const simplify=path=>path.filter((p,i)=>{if(i===path.length-1)return true;const prev=i?path[i-1]:route.spawn,next=path[i+1];return Math.abs(Math.atan2(p.z-prev.z,p.x-prev.x)-Math.atan2(next.z-p.z,next.x-p.x))>.001;});
async function walk(path,target){for(const p of simplify(path))await driveRealmTo(page,p,{tolerance:.12,timeout:45000});await driveRealmTo(page,target,{tolerance:.12,timeout:12000});}
let status='failed';
try{
 await page.goto(base+'/?realms');await page.waitForFunction(()=>window.tvRealms?.ready&&window.tvRealms.inspect().focused.pending===0,null,{timeout:180000});await page.waitForTimeout(1500);
 await shot('00-default','Default framing · actual imported character');const start=await read();await orbit(start.yaw+Math.PI);await shot('01-character-front','Front profile · metre reference in actor plane');await orbit(start.yaw+Math.PI/2);await shot('02-character-side','Side profile · metre reference in actor plane');await orbit(Math.PI);
 await page.keyboard.down('KeyX');await page.keyboard.down('KeyW');await page.waitForTimeout(1800);samples.push({name:'walking',...await read()});await page.keyboard.up('KeyW');await page.keyboard.up('KeyX');await shot('03-walk','Ordinary X + W walking');await driveRealmTo(page,route.spawn,{timeout:12000,tolerance:.2});
 await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(1500);samples.push({name:'running',...await read()});await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await shot('04-run','Ordinary Shift + W running');await driveRealmTo(page,route.spawn,{timeout:12000,tolerance:.2});
 await walk(route.paths[0],route.doorway);await orbit(Math.PI/2);await shot('05-house-doorway','Door clearance 2.405 m · room topology retained');
 await walk(route.paths[1],route.interior);await shot('06-house-interior','Ceiling 2.85 m · metre-scale room');
 await walk(route.paths[2],route.furniture);await orbit(Math.PI/2);await shot('07-bedroom-furniture','Bed frame 2.40 × 1.30 × 0.54 m');
 await walk(route.paths[3],route.spawn);await travelClick(page,'#rv-tower');await page.waitForFunction(()=>window.tvRealms.state.body.pos.z>3150,null,{timeout:90000});await page.keyboard.down('KeyX');await page.keyboard.down('KeyS');await page.waitForTimeout(80);await page.keyboard.up('KeyS');await page.keyboard.up('KeyX');await page.waitForTimeout(600);await driveRealmTo(page,route.forest,{timeout:20000,tolerance:.1});await orbit(Math.PI+.418);await shot('08-forest','Authored mature trees · no forest rescale');
 assert.deepEqual(errors,[]);for(const s of samples){assert.ok(s.scale.bounds.dimensions[1]>1.2&&s.scale.bounds.dimensions[1]<1.9);assert.equal(s.person,start.person);assert.equal(s.body,start.body);assert.equal(s.rank,start.rank);if(label.startsWith('after'))assert.equal(s.camera.blocked,false,'Camera near a solid at '+s.name);}
 status='passed';
}catch(e){errors.push(String(e));console.log(String(e));}
finally{if(status!=='passed')await page.screenshot({path:resolve(out,'failed-frame.png')}).catch(()=>{});const final=await read().catch(()=>null),video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'recorded-scale-review.webm'));await browser.close();writeFileSync(resolve(out,'result.json'),JSON.stringify({status,label,health,errors,samples,final,note:'Ordinary UI/keyboard/mouse controls only. Reference annotations use actual projected metre points; raw images retained. No canonical transforms, clocks or damage injected.'},null,2));console.log(JSON.stringify({status,label,errors,samples:samples.length}));}
if(status!=='passed')process.exitCode=1;
