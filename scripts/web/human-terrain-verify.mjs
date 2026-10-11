import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
// Controlled imported rig, synthetic presentation surfaces, fixed animation pose.
// Run sequentially with human-footplant-verify against the same isolated client.
const base=process.env.TV_MOTION_URL??'http://127.0.0.1:7516';
const out=process.env.TV_TERRAIN_OUT??'.debug/terrain-contact-controlled.json';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(base+'/?arena=1&seed=11');
 await page.waitForFunction(()=>!!window.__arena?.world?.plants?.get(window.__arena.world.hero),null,{timeout:180000});
 const report=await page.evaluate(()=>{
  const a=window.__arena,w=a.world,Plant=w.plants.get(w.hero).constructor;
  a.scene.getEngine().stopRenderLoop();w.footLock=false;
  const rows=[];
  for(const size of [.65,1,1.4])for(const scenario of ['flat','incline','tread','edge','missing','cliff']){
   const inst=w.assets.human('ranger','terrain-fixture'),root=inst.root;
   root.scaling.setAll(size);root.position.set(0,0,0);root.rotation.set(0,0,0);
   const plant=new Plant(inst),clip=inst.anims.get('locomotion/idle');
   if(!clip)throw new Error('Missing detailed human idle');
   const bind=[...inst.bones.values()].map(n=>({n,p:n.position.clone(),q:n.rotationQuaternion?.clone(),r:n.rotation.clone(),s:n.scaling.clone()}));
   const pose=()=>{for(const b of bind){b.n.position.copyFrom(b.p);b.n.rotationQuaternion=b.q?.clone()??null;b.n.rotation.copyFrom(b.r);b.n.scaling.copyFrom(b.s);}clip.goToFrame(clip.from,false);};
   clip.start(true,1,clip.from,clip.to);clip.setWeightForAllAnimatables(1);clip.pause();pose();
   const feet=['l','r'].map(side=>inst.bones.get('foot_'+side));
   const raw=feet.map(f=>{f.computeWorldMatrix(true);return f.getAbsolutePosition().clone();});
   const center=(raw[0].x+raw[1].x)/2;
   const ground=(x,z)=>scenario==='missing'?null:scenario==='cliff'?2*size:scenario==='flat'?0:scenario==='incline'?.06*size+.12*x:scenario==='tread'?(x<center?0:.12*size):(x<raw[0].x?0:.15*size);
   let prior=raw.map(p=>p.clone()),maxFrameStep=0;
   for(let frame=0;frame<90;frame++){
    pose();plant.update(1/60,0,0,true,[true,true],ground);
    feet.forEach((f,k)=>{f.computeWorldMatrix(true);const p=f.getAbsolutePosition().clone();maxFrameStep=Math.max(maxFrameStep,p.subtract(prior[k]).length());prior[k]=p;});
   }
   rows.push({scenario,size,locks:plant.lockState(),maxFrameStep,root:root.position.asArray(),feet:prior.map((p,k)=>({rawY:raw[k].y,actualY:p.y,ground:ground(raw[k].x,raw[k].z),correction:p.y-raw[k].y}))});
   inst.dispose();
  }
  return rows;
 });
 for(const r of report){
  assert.deepEqual(r.root,[0,0,0]);assert.ok(r.maxFrameStep<2/60*r.size+.002,`Unbounded correction ${r.scenario}/${r.size}`);
  if(r.scenario==='flat')for(const f of r.feet)assert.ok(Math.abs(f.correction)<.002);
  if(r.scenario==='incline')for(const f of r.feet)assert.ok(Math.abs(f.correction-f.ground)<.004,`Incline mismatch ${r.size}`);
  if(r.scenario==='tread')assert.ok(r.feet.some(f=>f.correction>.08*r.size),`No step support ${r.size}`);
  if(r.scenario==='missing'||r.scenario==='cliff')assert.deepEqual(r.locks,[false,false]);
  if(r.scenario==='edge')assert.equal(r.locks[0],false);
 }
 mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,scenarios:report.length,out}));
}finally{await browser.close();}
