import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
// Actual imported bones, fixed idle pose and fixed 60 Hz attention. Fixture changes
// are presentation-only; this harness neither resets nor advances canonical state.
const base=process.env.TV_MOTION_URL??'http://127.0.0.1:7517';
const out=process.env.TV_GAZE_OUT??'.debug/human-gaze-controlled.json';
const health=await fetch(base+'/api/health').then(r=>r.json());
assert.equal(health.isolation,'Disposable town and gym; no save access','Expected isolated test server');
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:760}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(base+'/?gym=1&autoplay=1&view=third-person&renderer=webgl2');
 await page.waitForFunction(()=>{const app=window.__tv;return app?.ready&&app.link.playable&&app.actors.get(app.ownBodyId)?.visual.gaze;},null,{timeout:180000});
 const report=await page.evaluate(()=>{
  const app=window.__tv,visual=app.actors.get(app.ownBodyId).visual,Gaze=visual.gaze.constructor;
  app.ctx.engine.stopRenderLoop();
  const Node=visual.root.constructor,V=visual.root.position.constructor;
  visual.root.computeWorldMatrix(true);const Q=visual.root.absoluteRotationQuaternion.constructor;
  const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(Q.Dot(a,b)))),rows=[];
  for(const size of [.65,1.4])for(const yaw of [0,1.1])for(const scenario of ['target','capped','null-release','action-release']){
   const inst=app.sharedCharacters.assets.human('ranger','gaze-fixture'),parent=new Node('gaze-canonical-parent',app.ctx.scene);
   parent.position.set(3,2,-5);parent.rotation.y=yaw;parent.scaling.setAll(1.3);
   inst.root.parent=parent;inst.root.rotation.y=Math.PI;inst.root.scaling.setAll(size);
   const gaze=new Gaze(inst),head=inst.bones.get('head'),feet=['l','r'].map(s=>inst.bones.get('foot_'+s));
   if(!head||feet.some(f=>!f))throw new Error('Missing imported head/feet');
   const bind=[...inst.bones.values()].map(n=>({n,p:n.position.clone(),q:n.rotationQuaternion?.clone(),r:n.rotation.clone(),s:n.scaling.clone()}));
   const clip=inst.anims.get('locomotion/idle');if(!clip)throw new Error('Missing imported idle');
   clip.start(true,1,clip.from,clip.to);clip.setWeightForAllAnimatables(1);clip.pause();
   const fresh=()=>{
    gaze.restore();for(const b of bind){b.n.position.copyFrom(b.p);b.n.rotationQuaternion=b.q?.clone()??null;b.n.rotation.copyFrom(b.r);b.n.scaling.copyFrom(b.s);}
    clip.goToFrame(clip.from,false);inst.root.computeWorldMatrix(true);head.computeWorldMatrix(true);
   };
   fresh();const frame=inst.root.absoluteRotationQuaternion.clone(),inverse=Q.Inverse(frame);
   const dir=scenario==='capped'?new V(4,10,1):new V(2,1,4);
   const target=head.getAbsolutePosition().add(dir.applyRotationQuaternion(frame));
   const rootPosition=inst.root.getAbsolutePosition().clone(),rootRotation=inst.root.absoluteRotationQuaternion.clone();
   let maxRootMove=0,maxRootAngle=0,maxFootMove=0,maxFrameAngle=0,priorDelta=Q.Identity(),firstAngle=0,settled=null,releaseFirst=null,final=null;
   const frames=scenario.endsWith('release')?240:120;
   for(let i=0;i<frames;i++){
    fresh();const raw=head.absoluteRotationQuaternion.clone(),rawFeet=feet.map(f=>{f.computeWorldMatrix(true);return f.getAbsolutePosition().clone();});
    const releasing=i>=120;
    gaze.apply(1/60,scenario==='null-release'&&releasing?null:target,!(scenario==='action-release'&&releasing));
    head.computeWorldMatrix(true);const delta=head.absoluteRotationQuaternion.multiply(Q.Inverse(raw)),local=inverse.multiply(delta).multiply(frame);
    const fwd=new V(0,0,1).applyRotationQuaternion(local);
    const state={yaw:Math.atan2(fwd.x,fwd.z),pitch:Math.atan2(fwd.y,Math.hypot(fwd.x,fwd.z)),angle:angle(raw,head.absoluteRotationQuaternion)};
    if(i===0)firstAngle=state.angle;if(i===119)settled=state;if(i===120)releaseFirst=state;final=state;
    maxFrameAngle=Math.max(maxFrameAngle,angle(priorDelta,delta));priorDelta=delta;
    maxRootMove=Math.max(maxRootMove,inst.root.getAbsolutePosition().subtract(rootPosition).length());maxRootAngle=Math.max(maxRootAngle,angle(inst.root.absoluteRotationQuaternion,rootRotation));
    feet.forEach((f,k)=>{f.computeWorldMatrix(true);maxFootMove=Math.max(maxFootMove,f.getAbsolutePosition().subtract(rawFeet[k]).length());});
   }
   rows.push({size,yaw,scenario,firstAngle,settled,releaseFirst,final,maxFrameAngle,maxRootMove,maxRootAngle,maxFootMove});
   inst.dispose();parent.dispose();
  }
  return rows;
 });
 for(const r of report){
  assert.ok(r.firstAngle>0&&r.firstAngle<.15,`Abrupt acquisition ${r.scenario}`);
  assert.ok(r.maxFrameAngle<.15,`Abrupt gaze motion ${r.scenario}`);
  assert.ok(r.maxRootMove<1e-6&&r.maxRootAngle<.001&&r.maxFootMove<1e-5,'Gaze moved root/feet');
  const expectedYaw=r.scenario==='capped'?.8:Math.atan2(2,4),expectedPitch=r.scenario==='capped'?.35:Math.atan2(1,Math.hypot(2,4));
  assert.ok(Math.abs(r.settled.yaw-expectedYaw)<.002&&Math.abs(r.settled.pitch-expectedPitch)<.002,`Imported head delta mismatch ${r.size}/${r.yaw}/${r.scenario}`);
  if(r.scenario.endsWith('release')){assert.ok(r.releaseFirst.angle>0&&r.releaseFirst.angle<r.settled.angle);assert.ok(r.final.angle<.001,'Gaze did not release');}
 }
 assert.deepEqual(errors,[]);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({passed:true,rows:report,errors},null,2));
 console.log(JSON.stringify({passed:true,scenarios:report.length,out,maxFrameAngle:Math.max(...report.map(r=>r.maxFrameAngle))}));
}finally{await browser.close();}
