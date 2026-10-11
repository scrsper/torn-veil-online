/** Rendered controls starting from an explicitly identified, earned headless save.
 * This video does not depict or claim the prior 16-floor fight history. */
import { chromium } from 'playwright';
import { route } from './canonical-tower-qa-route.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.TV_REALMS_URL??'http://127.0.0.1:7520',out=resolve(process.env.TV_REALMS_EVIDENCE??'.debug/tower-growth/browser');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}}),page=await context.newPage();
const errors=[],checks=[],observations=[],held=new Set();let metrics=null;
page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
const wait=(fn,arg=null,timeout=180000)=>page.waitForFunction(fn,arg,{timeout});
const frame=()=>page.evaluate(()=>window.tvAscent.frame),realm=()=>page.evaluate(()=>window.tvRealms.state);
const shot=name=>page.screenshot({path:resolve(out,name+'.png')});
const check=(name,ok)=>{checks.push({name,ok});console.log(ok?'PASS':'FAIL',name);assert.ok(ok,name);};
async function keys(next){for(const k of held)if(!next.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
async function walk(target){
  const plan=await page.evaluate(()=>window.tvAscent.plan);let path=[],nextRoute=0;const began=Date.now();
  try{while(Date.now()-began<120000){const f=await frame(),b=f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId);
    if(Math.hypot(b.pos.x-target.x,b.pos.z-target.z)<1.1)return;
    if(Date.now()>nextRoute){path=route(plan,b.pos,target);nextRoute=Date.now()+600;}
    while(path.length&&Math.hypot(path[0].x-b.pos.x,path[0].z-b.pos.z)<.35)path.shift();
    const to=path[0]??target,input=[];
    if(Math.abs(to.x-b.pos.x)>.12)input.push(to.x>b.pos.x?'KeyD':'KeyA');
    if(Math.abs(to.z-b.pos.z)>.12)input.push(to.z>b.pos.z?'KeyS':'KeyW');
    await keys(input);await page.waitForTimeout(60);
  }throw Error('Visible route traversal timed out');}finally{await keys([]);}
}
async function enter(){const s=await realm();if(!s.tower){await page.locator('#rv-tower').click();await wait(x=>Math.hypot(window.tvRealms.state.body.pos.x-x,window.tvRealms.state.body.pos.z-3120.5)<.6,s.realm==='aether'?3120.5:11312.5);
  if((await realm()).prompt.includes('Open Tower'))await page.keyboard.press('KeyE');await page.keyboard.down('KeyW');try{await wait(()=>window.tvRealms.state.tower,null,15000);}finally{await page.keyboard.up('KeyW');}}
  await page.locator('#rv-canonical').click();await wait(()=>window.tvAscent?.ready);}
async function leave(){await page.locator('#as-return').click();await wait(()=>window.tvRealms?.ready);}
async function cross(to,cancel=false){await page.locator('#rv-portal').click();await wait(()=>window.tvRealms.state.prompt.includes('Cross the Veil'));await page.keyboard.press('KeyE');
  if(cancel){await page.locator('#rv-cancel').click();await wait(()=>!window.tvRealms.state.pending);check('cancelled crossing retained departure realm',(await realm()).realm!==to);await page.keyboard.press('KeyE');}
  await page.locator('#rv-cross').click();await wait(to=>window.tvRealms?.ready&&window.tvRealms.state.realm===to,to);}
try{
  await page.goto(base+'/?ascent');await wait(()=>window.tvAscent?.ready);const before=await frame();observations.push(before.own);
  check('loaded actual earned pre-integration save',before.own.rank==='Iron'&&before.own.growth.eligible&&before.tower.clear);
  await shot('01-earned-eligibility');await page.getByRole('button',{name:/Integrate sources.*Bronze/}).click();await wait(()=>window.tvAscent.frame.own.rank==='Bronze');
  const integrated=await frame();observations.push(integrated.own);
  check('real control applied paid Bronze capacity',integrated.own.capacity.amplitude===2.8&&integrated.own.capacity.reserve===150);
  check('integration did not heal or change identity',integrated.own.health<=before.own.health+.1&&integrated.own.bodyId===before.own.bodyId);
  await shot('02-integrated-bronze');
  await page.keyboard.press('Digit1');await page.keyboard.press('Escape');await page.waitForTimeout(300);
  await page.locator('#as-save').click();await page.waitForTimeout(500);await page.reload();await wait(()=>window.tvAscent?.ready);
  const loaded=await frame();check('reload retained earned rank capacity and identity',loaded.own.rank==='Bronze'&&loaded.own.id===before.own.id&&loaded.own.capacity.amplitude===2.8);
  await walk(loaded.tower.exit);await page.locator('#as-next').click();await wait(n=>window.tvAscent.frame.tower.floor===n,before.tower.floor+1);
  const advanced=await frame();check('ascent kept earned state',advanced.own.rank==='Bronze'&&advanced.own.bodyId===before.own.bodyId);await shot('03-next-floor');
  const water=(await frame()).snapshot.interactions.find(i=>i.kind==='drink');
  if(water){const prior=(await frame()).waterSources[0].remaining;await page.getByRole('button',{name:water.label,exact:true}).click();await wait(n=>window.tvAscent.frame.waterSources[0].remaining<n,prior);check('real water interaction depleted physical stock',true);}
  metrics=await page.evaluate(()=>window.tvAscent.inspect());await leave();const departure=await realm();observations.push(departure.person);
  await cross('brass',true);await shot('04-bronze-in-cinderveil');await enter();const resumed=await frame();
  check('other-realm Tower resumed same earned run',resumed.tower.id===before.tower.id&&resumed.tower.floor===advanced.tower.floor&&resumed.own.rank==='Bronze');
  await leave();await cross('aether');await page.reload();await wait(()=>window.tvRealms?.ready);const returned=await realm();observations.push(returned.person);
  check('portal round trip retained exact person inventory and classification',JSON.stringify(returned.person)===JSON.stringify(departure.person)&&returned.body.id===departure.body.id);
  await shot('05-returned-bronze');check('no browser errors',errors.length===0);
}catch(e){errors.push(String(e));console.error(e);process.exitCode=1;await shot('failure');}
finally{await keys([]);writeFileSync(resolve(out,'result.json'),JSON.stringify({kind:'actual rendered controls from earned headless floor-16 save; prior climb is not rendered evidence; concurrent tests, not hardware benchmark',checks,errors,observations,metrics},null,2));const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'actual-earned-growth.webm'));await browser.close();}
