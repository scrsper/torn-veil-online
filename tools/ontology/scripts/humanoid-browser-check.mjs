import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const out='generated/validation/humanoid-v1/browser';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],reports=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
await page.goto('http://127.0.0.1:5173?webgl',{waitUntil:'networkidle'});
const ready=()=>page.waitForFunction(()=>window.ontologyDebug?.snapshot().meshCount>0&&document.getElementById('loading').hidden,null,{timeout:60000});
await ready();const snapshot=()=>page.evaluate(()=>window.ontologyDebug.snapshot());
await page.getByRole('button',{name:'18 art references'}).click();
if(await page.locator('#reference-dialog article').count()!==18)throw Error('Reference inventory not visible');
await page.locator('#reference-dialog img').first().waitFor({state:'visible'});
await page.waitForFunction(()=>document.querySelector('#reference-dialog img')?.naturalWidth>0);
await page.screenshot({path:`${out}/reference-gallery.png`});await page.getByRole('button',{name:'Close',exact:true}).click();
if((await snapshot()).resolution.bodyAssetId!=='tv-human-male-v1')throw Error('Human family not default');
for(const sex of ['male','female']){
 await page.getByLabel('Human body study').selectOption(sex);await ready();
 for(const view of ['front','side','back','three-quarter','face','gameplay']){
  await page.getByLabel('Review view').selectOption(view);await page.waitForTimeout(500);
  const s=await snapshot();if(s.loadError||s.skeletons!==1)throw Error('Human load/rig failure');
  reports.push({sex,view,...s});await page.screenshot({path:`${out}/${sex}-${view}.png`});
  await page.locator('canvas').screenshot({path:`${out}/${sex}-${view}-viewport.png`});
 }
}
const game=await snapshot();if(Math.abs(game.camera.fov-62*Math.PI/180)>.001)throw Error('Camera FOV mismatch');
const gameViews=reports.filter(r=>r.view==='gameplay');if(JSON.stringify(gameViews[0].camera)!==JSON.stringify(gameViews[1].camera))throw Error('Comparison cameras differ');
const box=await page.locator('canvas').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+100,box.y+box.height/2+30,{steps:8});await page.mouse.up();await page.waitForTimeout(300);if((await snapshot()).camera.alpha===game.camera.alpha)throw Error('Orbit failed');
await page.mouse.wheel(0,-200);await page.waitForTimeout(300);if((await snapshot()).camera.radius===game.camera.radius)throw Error('Zoom failed');await page.getByRole('button',{name:'Reset camera'}).click();
if(Math.abs((await snapshot()).camera.radius-game.camera.radius)>.001)throw Error('Preset reset failed');
await page.getByLabel('Wireframe',{exact:true}).check();await page.getByLabel('Skeleton',{exact:true}).check();await page.screenshot({path:`${out}/female-debug.png`});
if(!await page.getByText('CC0-1.0',{exact:true}).isVisible())throw Error('Provenance absent');
await writeFile(`${out}/report.json`,JSON.stringify({reports,errors,verified:['Human variant selection','processed GLB load','camera presets','orbit','zoom','reset','provenance','shared rig','no art approval']},null,2));
const comparison=await browser.newPage({viewport:{width:1400,height:1120}});
const pictures=await Promise.all(['male-front','female-front','male-gameplay','female-gameplay'].map(async name=>({name,url:'data:image/png;base64,'+(await readFile(`${out}/${name}-viewport.png`)).toString('base64')})));
await comparison.setContent(`<body style="margin:0;background:#15202a;color:#dbe6ed;font:16px Arial;padding:20px"><h1>Human family / reference-guided studies</h1><p>PROTOTYPE - visual target not achieved. Same entity height (1.75 m), lights, floor and camera per row. Gameplay: 8 m / 0.5 rad / 62 degrees.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${pictures.map(p=>`<div><p>${p.name}</p><img style="width:100%" src="${p.url}"></div>`).join('')}</div></body>`);
await comparison.screenshot({path:`${out}/human-comparison.png`,fullPage:true});await browser.close();if(errors.length)throw Error(errors.join('\n'));console.log('Human catalog checks passed; screenshots require separate visual judgment.');
