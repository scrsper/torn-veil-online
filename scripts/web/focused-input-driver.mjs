import assert from 'node:assert/strict';
/** Ordinary keyboard pilot. Wide waypoints leave clearance around columns;
 * the current rendered camera determines WASD, never a fixed world heading. */
export async function driveAscentTo(page,target,{tolerance=.22,timeout=20000}={}){
 let held=[];const deadline=Date.now()+timeout;await page.keyboard.down('KeyX');let last;
 try{while(Date.now()<deadline){const data=await page.evaluate(()=>({frame:window.tvAscent.frame,inspect:window.tvAscent.inspect()})),own=data.frame.snapshot.bodies.find(b=>b.bodyId===data.frame.own.bodyId);last=own.pos;const dx=target.x-last.x,dz=target.z-last.z;if(Math.hypot(dx,dz)<=tolerance)return {...last};const yaw=data.inspect.camera.movementYaw,right=dx*Math.cos(yaw)-dz*Math.sin(yaw),forward=-dx*Math.sin(yaw)-dz*Math.cos(yaw),largest=Math.max(Math.abs(right),Math.abs(forward)),next=[];
   if(Math.abs(right)>.5*largest)next.push(right>0?'KeyD':'KeyA');if(Math.abs(forward)>.5*largest)next.push(forward>0?'KeyW':'KeyS');for(const key of held)if(!next.includes(key))await page.keyboard.up(key);for(const key of next)if(!held.includes(key))await page.keyboard.down(key);held=next;await page.waitForTimeout(60);
  }assert.fail(`Waypoint unreachable by ordinary input: target${JSON.stringify(target)} actual${JSON.stringify(last)}`);
 }finally{for(const key of held)await page.keyboard.up(key);await page.keyboard.up('KeyX');await page.waitForTimeout(250);}
}
export async function clearAscentEntry(page){const entrance=await page.evaluate(()=>window.tvAscent.frame.tower.start);await page.mouse.click(720,650,{button:'middle'});await driveAscentTo(page,{x:entrance.x,z:entrance.z-5});await driveAscentTo(page,{x:entrance.x-3,z:entrance.z-5});await driveAscentTo(page,{x:entrance.x-3,z:entrance.z-35},{timeout:45000});await driveAscentTo(page,{x:entrance.x-1.4,z:entrance.z-35});return entrance;}
