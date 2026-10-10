import {chromium} from 'playwright';
import {writeFileSync,mkdirSync} from 'node:fs';
const out='.debug/tooling-browser';mkdirSync(out,{recursive:true});
const base=process.argv[2]??'http://127.0.0.1:7585';
const b=await chromium.launch({headless:true});const errors=[];
try{
const p=await b.newPage({viewport:{width:1800,height:1100}});p.on('pageerror',e=>errors.push(String(e)));
await p.goto(base+'/#tab=ontology');const fl=p.frameLocator('iframe[title="Model ontology editor"]');
await fl.locator('#render-status').filter({hasText:'meshes'}).waitFor({timeout:60000});await fl.locator('#sources-tab').click();
await fl.locator('[data-id="shared-wren"]').click();
const f=p.frames().find(f=>f.url().includes('/ontology/'));
await f.waitForFunction(()=>window.ontologyDebug.snapshot().sourceId==='shared-wren'&&window.ontologyDebug.snapshot().animations.length>2&&!window.ontologyDebug.snapshot().loadError,null,{timeout:90000});
await fl.getByLabel('Review view').selectOption('three-quarter');await fl.getByLabel('Animation',{exact:true}).selectOption({label:(await f.evaluate(()=>window.ontologyDebug.snapshot().animations)).includes('unarmed/combat_idle')?'unarmed/combat_idle':'Idle_Combat'});
await p.screenshot({path:out+'/shared-editor-wren.png'});const s=await f.evaluate(()=>window.ontologyDebug.snapshot());
writeFileSync(out+'/shared-editor-result.json',JSON.stringify({snapshot:s,errors},null,2));if(errors.length||s.motionError)throw Error(JSON.stringify({errors,motionError:s.motionError}));console.log('PASS editor uses shared cast and existing Claude motion pipeline');
}finally{await b.close();}
