import {loadFocusedGeometry} from '../../src/server/focusedGeometryLoader.ts';
import {sceneGeometry} from '../../src/sim/world/assets/focusedRuntime.ts';
let geometry,planId='';
/** Read the actual received floor and route around its physical columns. The
 * browser sends ordinary controls; this Node-side query never steps a World. */
export async function contactRoute(page,from,target){
 const plan=await page.evaluate(()=>window.tvAscent.plan.assetScene);
 if(!geometry||plan.id!==planId){loadFocusedGeometry();geometry=sceneGeometry(plan);planId=plan.id;}
 const start=Math.atan2(from.z-target.z,from.x-target.x),candidates=[];
 for(const offset of [0,.5,-.5,1,-1,1.5,-1.5,Math.PI]){const angle=start+offset,x=target.x+Math.cos(angle)*.72,z=target.z+Math.sin(angle)*.72,y=geometry.supportAt(x,z,from.y);if(y===null||!geometry.fits(x,y,z,.3,1.75))continue;const path=geometry.findPath(from,{x,y,z},40000);if(path)candidates.push(path);}
 if(!candidates.length)throw Error('Actual floor has no ordinary contact route');
 const path=candidates.sort((a,b)=>a.length-b.length)[0];
 return path.filter((p,i)=>{if(i===path.length-1)return true;const prev=i?path[i-1]:from,next=path[i+1];return Math.abs(Math.atan2(p.z-prev.z,p.x-prev.x)-Math.atan2(next.z-p.z,next.x-p.x))>.001;});
}
export async function drivePreciseAscent(page,target,{tolerance=.12,timeout=45000}={}){
 const end=Date.now()+timeout;await page.keyboard.down('KeyX');
 try{while(Date.now()<end){const i=await page.evaluate(()=>{const f=window.tvAscent.frame,s=window.tvAscent.inspect();return {pos:f.snapshot.bodies.find(b=>b.bodyId===f.own.bodyId).pos,camera:s.camera};}),dx=target.x-i.pos.x,dz=target.z-i.pos.z,distance=Math.hypot(dx,dz);if(distance<tolerance)return;
  const desired=Math.atan2(-dx,-dz),turn=Math.atan2(Math.sin(desired-i.camera.movementYaw),Math.cos(desired-i.camera.movementYaw));
  if(Math.abs(turn)>.01){await page.keyboard.up('KeyW');let delta=-turn/.0022;while(Math.abs(delta)>.1){const d=Math.max(-450,Math.min(450,delta));await page.mouse.move(700,470);await page.mouse.down({button:'middle'});await page.mouse.move(700+d,470,{steps:8});await page.mouse.up({button:'middle'});delta-=d;}await page.waitForTimeout(110);}
  await page.keyboard.down('KeyW');await page.waitForTimeout(distance<.4?35:150);if(distance<.4){await page.keyboard.up('KeyW');await page.waitForTimeout(70);}
 }throw Error('Ordinary contact route waypoint unreachable');
 }finally{await page.keyboard.up('KeyW');await page.keyboard.up('KeyX');await page.waitForTimeout(300);}
}
