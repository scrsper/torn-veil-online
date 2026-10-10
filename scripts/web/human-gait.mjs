import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
// Controlled render fixture only: measures the procedural child/fallback rigs, not canonical movement.
const base=process.env.TV_MOTION_URL??'http://127.0.0.1:5181',out=process.env.TV_MOTION_OUT??'.debug/human-motion';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.goto(base+'/?showroom=lineup&focus=1&dist=3.5&renderer=webgl2');
await page.waitForFunction(()=>window.__tv?.ready,null,{timeout:120000});
await page.waitForTimeout(2000);
const report=await page.evaluate(()=>{
 const app=window.__tv;app.ctx.engine.stopRenderLoop();const results=[];
 for(const index of [0,1,8]) for(const speed of [1.5,4.6]) for(const direction of ['forward','backward','left']) {
   const v=app.showroom.visuals[index].v,rig=v.rig,anim=v.animator,dt=1/60;
   rig.root.rotation.y=0;rig.root.position.set(0,0,0);
   const velocity={x:direction==='left'?-speed:0,y:0,z:direction==='forward'?-speed:direction==='backward'?speed:0};
   const state={bodyId:'review',own:false,kind:'person',speed,velocity,yaw:0,crouch:0,age:0};
   let sum=0,n=0,maxHeight=0,groundSum=0,previous=[null,null];
   const stature=anim.feet.stature,p=Math.max(0,Math.min(1,(speed/stature-2.1)/2.5)),run=p*p*(3-2*p),stance=.64-.23*run;
   // Six seconds leaves more than 100 stable stance samples even for a child's short sprint.
   for(let frame=0;frame<360;frame++) {
     rig.root.position.x+=velocity.x*dt;rig.root.position.z+=velocity.z*dt;v.update(dt,state);
     for(const [k,side] of ['l','r'].entries()) {
       const foot=rig.bones.get('foot_'+side);foot.node.computeWorldMatrix(true);const pos=foot.node.absolutePosition.clone();
       const phase=(anim.phase/(Math.PI*2)+k*.5)%1,planted=phase>.06&&phase<stance-.06;
       if(frame>60&&planted&&previous[k]){sum+=Math.hypot(pos.x-previous[k].x,pos.z-previous[k].z)/dt;n++;groundSum+=pos.y;maxHeight=Math.max(maxHeight,pos.y);}
       previous[k]=planted?pos:null;
     }
   }
   results.push({index,speed,direction,samples:n,skate:sum/n,meanAnkleHeight:groundSum/n,maxAnkleHeight:maxHeight});
 }
 return results;
});
writeFileSync(out+'/gait-measurements.json',JSON.stringify(report,null,2));
await browser.close();
assert.equal(report.length,18);
for(const r of report){assert.ok(r.samples>100,'Insufficient planted samples');assert.ok(Number.isFinite(r.skate)&&r.skate<.1,JSON.stringify(r));}
console.log(JSON.stringify({cases:report.length,maxMeanPlantedSpeed:Math.max(...report.map(r=>r.skate)),limit:.1}));
