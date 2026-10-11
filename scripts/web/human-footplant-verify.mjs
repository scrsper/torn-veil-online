import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
// Detailed imported adult at fixed 60 Hz. No gameplay, render cadence or keyboard
// timing contributes to the comparison. TV_MOTION_URL points to a running client.
const base=process.env.TV_MOTION_URL??'http://127.0.0.1:7516';
const out=process.env.TV_MOTION_OUT??'.debug/footplant-controlled.json';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const page=await browser.newPage({viewport:{width:1100,height:700}});
try{
 await page.goto(base+'/?arena=1&seed=11');
 await page.waitForFunction(()=>!!window.__arena?.world?.plants?.get(window.__arena.world.hero),null,{timeout:180000});
 const report=await page.evaluate(()=>{
  const a=window.__arena,w=a.world,assets=w.assets,Plant=w.plants.get(w.hero).constructor;
  a.scene.getEngine().stopRenderLoop();w.footLock=false;
  const results=[],dt=1/60,Animator=w.hero.anim.constructor;
  const scenarios=[['forward','locomotion/walking',0],['running','locomotion/running',0],['backward','unarmed/walk_backward',Math.PI],['strafe','unarmed/walk_strafe_left',Math.PI/2],['sharp-turn','locomotion/walking',0],['stop','locomotion/walking',0]];
  for(const [scenario,name,direction] of scenarios)for(const on of [false,true]){
   const inst=assets.human('ranger','fixture'),plant=new Plant(inst),root=inst.root;
   root.position.set(0,0,0);root.rotation.set(0,0,0);
   const bind=[...inst.bones.values()].map(n=>({n,p:n.position.clone(),q:n.rotationQuaternion?.clone(),r:n.rotation.clone(),s:n.scaling.clone()}));
   const restore=()=>{for(const b of bind){b.n.position.copyFrom(b.p);b.n.rotationQuaternion=b.q?.clone()??null;b.n.rotation.copyFrom(b.r);b.n.scaling.copyFrom(b.s);}};
   const clip=assets.clips.get(name),idle=inst.anims.get('locomotion/idle'),g=inst.anims.get(name);
   if(!g||!clip)throw new Error('Missing imported clip: '+name);
   g.start(true,1,g.from,g.to);g.setWeightForAllAnimatables(1);g.pause();
   const animator=scenario==='stop'?new Animator(inst.anims,w.hero.anim.phases):null;if(animator){g.stop();animator.play(name,{loop:true,fade:0});}
   const scale=root.scaling.y,pace=(clip.stance>.1?clip.stance:1.5)*scale;
   const duration=(g.to-g.from)/(g.targetedAnimations[0]?.animation.framePerSecond??clip.fps),rate=pace/(Math.max(.1,clip.stance)*scale);
   let current=g,prev=[null,null],sum=0,samples=0,maxStep=0,maxStepAt=null,locks=0,minHeight=Infinity,maxHeight=-Infinity,hintSum=0,hintSamples=0,rawAnimationSamples=0,settledSum=0,settledSamples=0,settledMaxStep=0;
   const vertices=inst.meshes.reduce((n,m)=>n+m.getTotalVertices(),0);
   for(let frame=0;frame<240;frame++){
    const time=frame*dt,stopping=scenario==='stop'&&time>=2;
    const yaw=scenario==='sharp-turn'?Math.max(0,Math.min(1,(time-2)/.2))*Math.PI/2:0;
    root.rotation.y=yaw;
    if(!stopping){root.position.x+=Math.sin(direction+yaw)*pace*dt;root.position.z+=Math.cos(direction+yaw)*pace*dt;}
    if(stopping&&current!==idle){if(animator)animator.play('locomotion/idle',{loop:true,fade:.2});else {current.stop();idle.start(true,1,idle.from,idle.to);idle.setWeightForAllAnimatables(1);idle.pause();}current=idle;}
    restore();let phase=stopping?((time-2)%1):((time*rate/duration)%1);
    // Unweighted goToFrame applies directly (no deferred binding). The stop case
    // uses the production Animator and flushes its weighted bindings at fixed dt.
    if(animator){animator.update(dt);a.scene._animate(dt*1000);phase=((g.animatables[0]?.masterFrame??g.from)-g.from)/Math.max(1,g.to-g.from);}else current.goToFrame(current.from+phase*(current.to-current.from),false);
    const raw=['l','r'].map(side=>{const foot=inst.bones.get('foot_'+side);foot.computeWorldMatrix(true);return foot.getAbsolutePosition().clone();});
    const contact=raw.map((p,k)=>p.y<(inst.bindAnkleHeights[k]+.07)*scale);
    const source=animator?.contactSource(),supportClip=source?assets.clips.get(source.name):clip;const hintFrame=source?Math.max(0,Math.min(supportClip.frames-1,Math.floor(source.frame))):Math.min(clip.frames-1,Math.floor(phase*(clip.frames-1)));const hints=animator?(source?[0,1].map(k=>!!supportClip.contact?.[k]?.[hintFrame]):undefined):[0,1].map(k=>!!clip.contact?.[k]?.[hintFrame]);if(on)plant.update(dt,0,yaw,true,hints);
    if(frame>=30&&plant.lockCount())locks++;
    raw.forEach((p,k)=>{
     const foot=inst.bones.get('foot_'+['l','r'][k]);foot.computeWorldMatrix(true);const actual=foot.getAbsolutePosition().clone();
     if(frame>=30){minHeight=Math.min(minHeight,p.y);maxHeight=Math.max(maxHeight,p.y);if(contact[k])rawAnimationSamples++;}
     const prior=prev[k];if(frame>=30&&prior){const delta=Math.hypot(actual.x-prior.actual.x,actual.z-prior.actual.z);if(delta>maxStep){maxStep=delta;maxStepAt={frame,side:['l','r'][k],phase,rawStep:Math.hypot(p.x-prior.raw.x,p.z-prior.raw.z)};}
      if(contact[k]&&prior.contact&&Math.abs(p.y-prior.raw.y)/dt<.35*scale){sum+=delta/dt;samples++;if(stopping&&time>=2.4){settledSum+=delta/dt;settledSamples++;settledMaxStep=Math.max(settledMaxStep,delta);}}
      const hint=!!clip.contact?.[k]?.[Math.min(clip.frames-1,Math.floor(phase*(clip.frames-1)))];
      if(!stopping&&hint&&prior.hint){hintSum+=delta/dt;hintSamples++;}
     }
     prev[k]={raw:p,actual,contact:contact[k],hint:!stopping&&!!clip.contact?.[k]?.[Math.min(clip.frames-1,Math.floor(phase*(clip.frames-1)))]};
    });
   }
   results.push({settledStanceSpeed:settledSamples?settledSum/settledSamples:null,settledMaxStep,scenario,name,on,vertices,dt,frames:240,pace,bind:inst.bindAnkleHeights,rawAnkleRange:[minHeight,maxHeight],lowAnkleSamples:rawAnimationSamples,stanceSamples:samples,meanStanceSpeed:samples?sum/samples:null,maxFrameStep:maxStep,maxStepAt,lockFrames:locks,clipContactSamples:hintSamples,clipContactSpeed:hintSamples?hintSum/hintSamples:null});
   inst.dispose();
  }
  return results;
 });
 for(let i=0;i<report.length;i+=2){
  const raw=report[i],corrected=report[i+1];
  if(raw.clipContactSamples!==corrected.clipContactSamples||raw.stanceSamples!==corrected.stanceSamples||raw.rawAnkleRange.some((value,k)=>Math.abs(value-corrected.rawAnkleRange[k])>1e-5))throw new Error(`Off/on input mismatch: ${raw.scenario}`);
  if(raw.clipContactSamples===0||corrected.clipContactSpeed>=raw.clipContactSpeed)throw new Error(`No measured support improvement: ${raw.scenario}`);
  if(corrected.maxFrameStep>raw.maxFrameStep+1e-6)throw new Error(`Correction increased maximum frame displacement: ${raw.scenario}`);
 }
 mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.filter(r=>r.on).map(r=>{const raw=report.find(x=>x.scenario===r.scenario&&!x.on);return {scenario:r.scenario,sourceStanceRaw:raw.clipContactSpeed,sourceStanceCorrected:r.clipContactSpeed,maxStepRaw:raw.maxFrameStep,maxStepCorrected:r.maxFrameStep,settledStanceRaw:raw.settledStanceSpeed,settledStanceCorrected:r.settledStanceSpeed};})));
}finally{await browser.close();}
