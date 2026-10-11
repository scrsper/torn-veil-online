/** Actual rendered Silver fight. Requires the identified earned, cleared floor-46
 * calibration save; no setup or body/progression writes are made by this script. */
import { chromium } from 'playwright';
import { route } from './canonical-tower-qa-route.mjs';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.TV_REALMS_URL??'http://127.0.0.1:7520',out=resolve(process.env.TV_REALMS_EVIDENCE??'.debug/tower-growth/silver-browser');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}}),page=await context.newPage();
const checks=[],errors=[],held=new Set(),observations=[],npcCasts=[],ownCasts=[];let initial=null,final=null,metrics=null,elapsedMs=0;
page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
const frame=()=>page.evaluate(()=>window.tvAscent.frame),shot=n=>page.screenshot({path:resolve(out,n+'.png')});
const check=(name,ok)=>{checks.push({name,ok});console.log(ok?'PASS':'FAIL',name);assert.ok(ok,name);};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
async function keys(next){for(const k of held)if(!next.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
try{
  await page.goto(base+'/?ascent');await page.waitForFunction(()=>window.tvAscent?.ready,null,{timeout:240000});
  const before=await frame();check('loaded earned Silver floor-46 save',before.own.rank==='Silver'&&before.tower.floor===46&&before.tower.clear);
  const preplan=await page.evaluate(()=>window.tvAscent.plan),begin=Date.now();
  while(Date.now()-begin<60000){const f=await frame(),b=f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId);if(dist(b.pos,preplan.exit)<1.2)break;
    const path=route(preplan,b.pos,preplan.exit),to=path.find(p=>dist(b.pos,p)>.35)??preplan.exit,input=[];
    if(Math.abs(to.x-b.pos.x)>.12)input.push(to.x>b.pos.x?'KeyD':'KeyA');if(Math.abs(to.z-b.pos.z)>.12)input.push(to.z>b.pos.z?'KeyS':'KeyW');
    await keys(input);await page.waitForTimeout(60);}
  await keys([]);await page.locator('#as-next').click();await page.waitForFunction(()=>window.tvAscent.frame.tower.floor===47);
  initial=await frame();await shot('01-silver-enters-47');const plan=await page.evaluate(()=>window.tvAscent.plan);
  const patrol=[plan.exit,...plan.rooms.map(r=>({x:r.x+r.w/2,z:r.z+r.d/2}))];let patrolIndex=0,path=[],nextRoute=0,lastTrace=0,catching=false;
  const started=Date.now();
  while(Date.now()-started<240000){
    const f=await frame(),b=f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId);
    const visible=f.snapshot.bodies.filter(x=>x.bodyId!==b.bodyId&&!x.dead&&!x.incapacitated&&!f.tower.retiredBodyIds.includes(x.bodyId));
    for(const cast of f.casts){const list=cast.bodyId===f.own.bodyId?ownCasts:npcCasts;if(!list.some(c=>c.id===cast.id))list.push(cast);}
    const enemy=visible.sort((a,z)=>dist(a.pos,b.pos)-dist(z.pos,b.pos))[0];
    if(enemy)for(let n=0;n<visible.length;n++){if(await page.evaluate(()=>window.tvAscent.targetId)===enemy.bodyId)break;await page.keyboard.press('Tab');}
    if(f.own.breath<.35)catching=true;if(f.own.breath>.8)catching=false;
    const busy=f.own.cast&&!f.own.cast.cancelled&&f.own.cast.completeAt>f.snapshot.physicalTime;
    if(f.own.health<50&&f.own.mana>=32&&!catching){await keys([]);await page.getByRole('button',{name:/Mend/}).first().click();await page.waitForTimeout(1850);}
    else if(enemy&&dist(enemy.pos,b.pos)<30&&f.own.mana>=22&&!catching&&!busy){await keys([]);await page.keyboard.press('Digit1');await page.waitForTimeout(900);}
    else{
      if(!enemy&&dist(b.pos,patrol[patrolIndex])<1)patrolIndex=(patrolIndex+1)%patrol.length;
      const target=enemy?.pos??patrol[patrolIndex];if(Date.now()>nextRoute){path=route(plan,b.pos,target);nextRoute=Date.now()+650;}
      while(path.length&&dist(path[0],b.pos)<.35)path.shift();const to=path[0],input=[];
      if(!catching&&to&&Math.abs(to.x-b.pos.x)>.12)input.push(to.x>b.pos.x?'KeyD':'KeyA');
      if(!catching&&to&&Math.abs(to.z-b.pos.z)>.12)input.push(to.z>b.pos.z?'KeyS':'KeyW');
      if(enemy)input.push('KeyQ');await keys(input);await page.waitForTimeout(70);
    }
    if(Date.now()-lastTrace>10000){lastTrace=Date.now();observations.push(f);await shot(`combat-${observations.length}`);}
    if(f.tower.clear)break;
  }
  elapsedMs=Date.now()-started;await keys([]);final=await frame();metrics=await page.evaluate(()=>window.tvAscent.inspect());await shot('02-after-silver-combat');
  // A successful ranged player can defeat a warden before it casts; record what
  // actually occurred rather than requiring an NPC outcome.
  check('observed physically stronger Silver casts',ownCasts.some(c=>c.damage>=112));
  check('real controls produced canonical later-floor defeats',final.tower.defeated>0);
  check('cleared floor 47 through rendered controls',final.tower.clear);
  check('Gold was not awarded by the floor counter',final.own.rank==='Silver'&&final.own.growth.next==='Gold'&&!final.own.growth.eligible);
  await page.locator('#as-save').click();await page.waitForTimeout(500);await page.reload();await page.waitForFunction(()=>window.tvAscent?.ready,null,{timeout:240000});
  const loaded=await frame();check('later-floor reload retained identity and clearance',loaded.own.bodyId===initial.own.bodyId&&loaded.tower.clear&&loaded.own.rank==='Silver');
  await shot('03-reloaded-silver');check('no browser errors',errors.length===0);
}catch(e){errors.push(String(e));console.error(e);process.exitCode=1;await shot('failure');}
finally{await keys([]);writeFileSync(resolve(out,'result.json'),JSON.stringify({kind:'actual rendered keyboard/button fight from earned headless Silver save; preceding climb not depicted; concurrent tests, not benchmark',checks,errors,initial,final,elapsedMs,metrics,observations,npcCasts,ownCasts},null,2));const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'actual-silver-floor-47.webm'));await browser.close();}
