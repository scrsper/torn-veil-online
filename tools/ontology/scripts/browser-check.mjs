import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const out='generated/validation/bootstrap';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`)});
await page.goto('http://127.0.0.1:5173',{waitUntil:'networkidle'});
await page.waitForFunction(()=>window.ontologyDebug?.snapshot().meshCount>0,{},{timeout:60000});
const snap=()=>page.evaluate(()=>window.ontologyDebug.snapshot());
const reports=[];reports.push({test:'human initial',...await snap()});
await page.screenshot({path:`${out}/01-human.png`});
const before=await snap();const canvas=await page.locator('canvas').boundingBox();
await page.mouse.move(canvas.x+canvas.width*.5,canvas.y+canvas.height*.5);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.5+100,canvas.y+canvas.height*.5+40,{steps:10});await page.mouse.up();await page.waitForTimeout(400);
const after=await snap();if(before.camera.alpha===after.camera.alpha)throw Error('Orbit failed');await page.mouse.wheel(0,-200);await page.waitForTimeout(300);if((await snap()).camera.radius===after.camera.radius)throw Error('Zoom failed');
await page.getByRole('button',{name:'Reset camera'}).click();await page.getByLabel('Wireframe',{exact:true}).check();await page.getByLabel('Skeleton',{exact:true}).check();await page.screenshot({path:`${out}/02-debug.png`});await page.getByLabel('Wireframe',{exact:true}).uncheck();await page.getByLabel('Skeleton',{exact:true}).uncheck();
await page.locator('[data-id="dragon_001"]').click();await page.waitForFunction(()=>window.ontologyDebug.snapshot().entityId==='dragon_001'&&window.ontologyDebug.snapshot().meshCount===0);if(!await page.getByText('Geometry unresolved',{exact:true}).isVisible())throw Error('Missing state not exposed');await page.screenshot({path:`${out}/03-unresolved-dragon.png`});
await page.getByLabel('Search ontology').fill('Vampire');if(await page.locator('.entity-row').count()!==1)throw Error('Search failed');await page.locator('[data-id="vampire_001"]').click();await page.waitForFunction(()=>window.ontologyDebug.snapshot().meshCount>0);if(!await page.getByText('CC0-1.0',{exact:true}).isVisible())throw Error('License absent');
await page.getByRole('button',{name:/Sources/}).click();
for(const id of ['quaternius-human-female','quaternius-imp','quaternius-puglin','quaternius-ual']){
 await page.locator(`[data-id="${id}"]`).click();await page.waitForFunction(id=>{const s=window.ontologyDebug.snapshot();return s.sourceId===id&&s.meshCount>0&&document.getElementById('loading').hidden},id,{timeout:60000});
 const report=await snap();if(report.loadError)throw Error(report.loadError);reports.push({test:id,...report});
 if(id==='quaternius-ual'){if(!report.animations.length)throw Error('Expected animation clips');await page.getByLabel('Animation',{exact:true}).selectOption(report.animations.find(n=>/walk/i.test(n))??report.animations[0]);await page.waitForTimeout(300);const frame=(await snap()).animationFrame;await page.waitForTimeout(300);if((await snap()).animationFrame===frame)throw Error('Animation frame did not advance');}
 await page.screenshot({path:`${out}/${id}.png`});
}
const processed=page.locator('[data-id^="processed-"]').first();if(!await processed.count())throw Error('No Blender roundtrip asset registered');await processed.click();await page.waitForFunction(()=>window.ontologyDebug.snapshot().sourceId?.startsWith('processed-')&&window.ontologyDebug.snapshot().meshCount>0);const processedReport=await snap();if(Math.abs(processedReport.dimensions[1]-1.75)>.01)throw Error('Blender roundtrip scale mismatch');reports.push({test:'blender roundtrip',...processedReport});await page.screenshot({path:`${out}/07-blender-roundtrip.png`});
await writeFile(`${out}/browser-report.json`,JSON.stringify({reports,errors,checks:['startup','ontology selection','search','provenance visible','orbit','zoom','reset','wireframe','skeleton','missing status','source models','animation selection','Blender roundtrip']},null,2));
await browser.close();if(errors.length)throw Error(errors.join('\n'));console.log(`Browser acceptance passed: ${reports.length} model cases; screenshots in ${out}`);
