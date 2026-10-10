import {chromium} from 'playwright';
import {writeFileSync,mkdirSync} from 'node:fs';
const out='.debug/tooling-browser';mkdirSync(out,{recursive:true});
const base=process.argv[2]??'http://127.0.0.1:7585';
const b=await chromium.launch({headless:true});const errors=[];
try{
 const p=await b.newPage({viewport:{width:1800,height:1100},recordVideo:{dir:out+'/equipment-video',size:{width:1800,height:1100}}});p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(base+'/');
 await p.evaluate(async()=>{const token=document.querySelector('meta[name="observatory-token"]').content;await fetch('/api/reset',{method:'POST',headers:{'X-Observatory-Token':token,'Content-Type':'application/json'},body:JSON.stringify({scenario:'combat-gym',seed:918271})});});await p.reload();
 if(await p.getByRole('button',{name:'Resume',exact:true}).count())await p.getByRole('button',{name:'Resume',exact:true}).click();
 await p.locator('#people-list .person').filter({hasText:'Gym traveler'}).click();await p.getByRole('button',{name:'Play selected person',exact:true}).click();
 await p.waitForTimeout(1000);console.log('Frames',p.frames().map(f=>f.url()));
 const f=p.frames().find(f=>f.url().includes('/game/'));
 if(!f)throw Error('No game viewport');
 await f.waitForFunction(()=>window.__tv?.sharedCharacters?.ready&&window.__tv?.snapshot&&window.__tv?.phase==='playing',null,{timeout:90000});
 const initial=await f.evaluate(()=>({phase:window.__tv.phase,shared:window.__tv.sharedCharacters?.ready,characters:window.__tv.ctx.scene.transformNodes.filter(n=>n.metadata?.sharedLook).map(n=>n.metadata),body:window.__tv.snapshot.bodies.find(x=>x.bodyId===window.__tv.ownBodyId)}));
 await f.evaluate(()=>window.__tv.openMenu('items'));await p.screenshot({path:out+'/equipment-lab-inventory.png'});
 const own=()=>f.evaluate(()=>window.__tv.snapshot.bodies.find(x=>x.bodyId===window.__tv.ownBodyId));
 const equipButtons=await f.getByRole('button',{name:/^Equip /}).allTextContents();
 for(const [index,label] of equipButtons.entries()){if(index===1)continue;const button=f.getByRole('button',{name:label,exact:true}),id=(await button.getAttribute('data-fk')).split(':').at(-1);await button.click();await f.waitForFunction(id=>window.__tv.snapshot.bodies.find(x=>x.bodyId===window.__tv.ownBodyId).equipment.some(x=>x.id===id),id,{timeout:15000});console.log('Equipped',label);}
 await f.evaluate(()=>window.__tv.modal.close());
 await f.waitForFunction(()=>window.__tv.ctx.scene.meshes.filter(m=>m.parent?.name?.startsWith('equipment:')).length>=7,null,{timeout:15000});
 await f.locator('body').screenshot({path:out+'/equipment-lab-equipped.png'});
 const equipped=await own(),geometry=await f.evaluate(()=>window.__tv.ctx.scene.meshes.filter(m=>m.parent?.name?.startsWith('equipment:')).map(m=>({name:m.name,parent:m.parent.name,bone:m.parent.parent?.name,min:m.getBoundingInfo().boundingBox.minimumWorld.asArray(),max:m.getBoundingInfo().boundingBox.maximumWorld.asArray()})));
 if(equipped.equipment.length!==7)throw Error('Missing canonical equipment '+JSON.stringify(equipped.equipment));
 await f.evaluate(()=>window.__tv.openMenu('items'));
 for(const label of await f.getByRole('button',{name:/^Unequip /}).allTextContents()){const button=f.getByRole('button',{name:label,exact:true}),id=(await button.getAttribute('data-fk')).split(':').at(-1);await button.click();await f.waitForFunction(id=>!window.__tv.snapshot.bodies.find(x=>x.bodyId===window.__tv.ownBodyId).equipment.some(x=>x.id===id),id,{timeout:15000});console.log('Unequipped',label);}
 await f.evaluate(()=>window.__tv.modal.close());await p.waitForTimeout(300);
 if((await own()).equipment.length)throw Error('Unequip did not clear canonical bindings');
 await f.locator('body').screenshot({path:out+'/equipment-lab-unequipped.png'});
 writeFileSync(out+'/equipment-browser-result.json',JSON.stringify({checks:['shared human casts retain six canonical identities','inventory UI equip seven catalog pieces','seven rendered socket/bone attachments','UI unequip clears canonical bindings and rendered attachments'],initial,equipped,geometry,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));console.log('PASS canonical equip/unequip and shared character flow');
}finally{await b.close();}
