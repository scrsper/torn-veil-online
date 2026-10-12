import {chromium} from 'playwright';import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const base=process.env.TV_FOCUSED_URL??'http://127.0.0.1:7572',out=resolve('.debug/motion-correction/first-world');mkdirSync(out,{recursive:true});
const health=await fetch(base+'/realms/health').then(r=>r.json());assert.ok(health.savePath.includes('motion-correction/focused-save')||health.savePath.includes('motion-correction\\focused-save'),'Refusing live save');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-precise-memory-info','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}}),page=await context.newPage(),errors=[],samples=[],started=Date.now();let warmAt;
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const read=()=>page.evaluate(()=>window.tvRealms.inspect());let status='failed';
try{
 await page.goto(base+'/?realms');await page.waitForFunction(()=>window.tvRealms?.ready&&window.tvRealms.inspect().focused.instances>=8,null,{timeout:180000});await page.waitForTimeout(1200);warmAt=(Date.now()-started)/1000;
 const initial=await read();assert.equal(initial.state.person.id,'p_5');assert.equal(initial.state.body.id,'b_5');assert.ok(initial.state.focusedAssets);samples.push({name:'spawn',...initial});
 await page.screenshot({path:resolve(out,'01-town-spawn.png')});
 await page.keyboard.down('AltLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(1100);samples.push({name:'walk',...(await read())});await page.screenshot({path:resolve(out,'02-authored-walk.png')});await page.keyboard.up('KeyW');await page.keyboard.up('AltLeft');await page.waitForTimeout(700);
 const moved=await read();assert.ok(Math.hypot(moved.state.body.pos.x-initial.state.body.pos.x,moved.state.body.pos.z-initial.state.body.pos.z)>1);assert.equal(moved.state.person.id,initial.state.person.id);assert.deepEqual(moved.state.person.inventory,initial.state.person.inventory);
 await page.mouse.move(720,650);await page.mouse.down({button:'middle'});await page.mouse.move(1120,610,{steps:30});await page.mouse.up({button:'middle'});await page.waitForTimeout(1000);await page.screenshot({path:resolve(out,'03-town-orbit.png')});samples.push({name:'orbit',...(await read())});
 assert.deepEqual(errors,[]);status='passed';
}finally{const video=page.video();await context.close();if(video)await video.saveAs(resolve(out,'recorded-town.webm'));await browser.close();writeFileSync(resolve(out,'result.json'),JSON.stringify({status,health,warmAt,samples,errors,finished:new Date().toISOString()},null,2));console.log(JSON.stringify({status,samples:samples.length,errors}));}
