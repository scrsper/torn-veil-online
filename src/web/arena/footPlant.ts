import {Quaternion,Vector3,type TransformNode} from '@babylonjs/core';
import type {CharacterInstance} from './assets';
import {reach} from './ik';

type Contact = {lock:Vector3|null;w:number;yaw:number;previousHeight:number|null;dwell:number;releasing:boolean;cooldown:number};
/** Presentation contact correction. Animation supplies each fresh pose before this pass. */
export class FootPlant {
 private feet:Contact[]=['l','r'].map(()=>({lock:null,w:0,yaw:0,previousHeight:null,dwell:0,releasing:false,cooldown:0}));
 private previousRoot:Vector3|null=null;
 constructor(private inst:CharacterInstance){}
 /** Read-only presentation diagnostics for browser motion validation. */
 lockCount():number{return this.feet.reduce((n,f)=>n+(f.lock?1:0),0);}
 lockState():[boolean,boolean]{return [!!this.feet[0].lock,!!this.feet[1].lock];}
 update(dt:number,y:number,yaw:number,active=true,contacts?:readonly [boolean,boolean]){
  const b=this.inst.bones;if(!b)return;
  const step=Math.max(0,Math.min(.1,dt));
  const root=this.inst.root;root.computeWorldMatrix(true);
  const rootPos=root.getAbsolutePosition().clone();
  // Absolute scaling includes a scaled parent and survives body resizing after bind capture.
  const scale=Math.max(.01,Math.abs(root.absoluteScaling.y));
  const teleported=this.previousRoot!==null&&Vector3.Distance(rootPos,this.previousRoot)>.65*scale;
  this.previousRoot=rootPos;
  if(!active||teleported){for(const f of this.feet){f.lock=null;f.w=0;f.previousHeight=null;f.dwell=0;f.releasing=false;f.cooldown=0;}return;}
  for(const [k,side] of ['l','r'].entries()){
   const thigh=b.get('thigh_'+side),calf=b.get('calf_'+side),foot=b.get('foot_'+side);if(!thigh||!calf||!foot)continue;
   foot.computeWorldMatrix(true);const animPos=foot.getAbsolutePosition().clone(),f=this.feet[k];
   // Never calibrate against the first animated frame: it may be the top of a swing.
   const baseline=Math.max(0,this.inst.bindAnkleHeights?.[k]??.06)*scale;
   const height=animPos.y-y;
   const vertical=f.previousHeight!==null&&step>0?(height-f.previousHeight)/step:0;
   f.previousHeight=height;f.cooldown=Math.max(0,f.cooldown-step);
   const rising=vertical>.35*scale&&height>baseline+.025*scale;
   // Baked support phases can identify grounded poses whose retargeted ankle pivot
   // sits above the bind-pose band. Mixed transitions fall back to observation.
   const contact=(contacts?contacts[k]:footContact(height,baseline,scale,!!f.lock))&&!rising;
   if(f.lock){
    const displacement=Math.hypot(f.lock.x-animPos.x,f.lock.z-animPos.z);
    const turn=Math.abs(Math.atan2(Math.sin(yaw-f.yaw),Math.cos(yaw-f.yaw)));
    if(!contact||displacement>.28*scale||turn>.3)f.releasing=true;
   }else{
    f.dwell=contact&&f.cooldown===0?f.dwell+step:0;
    // A baked support phase is already evidence of landing; geometric inference
    // needs dwell. Delaying explicit contact would consume a short running stance.
    if(contact&&f.cooldown===0&&(contacts?.[k]||f.dwell>=.04)){f.lock=animPos.clone();f.yaw=yaw;f.releasing=false;f.dwell=0;}
   }
   // Do not replace a still weighted anchor on turns or stops. Release, then reacquire.
   // A fixed weight fade can dump a large correction into one frame. Bound its
   // release contribution to horizontal foot speed while small offsets fade normally.
   const releaseOffset=f.lock?Math.hypot(f.lock.x-animPos.x,f.lock.z-animPos.z):0;
   const releaseRate=Math.min(10,2*scale/Math.max(.001,releaseOffset));
   f.w=Math.max(0,Math.min(1,f.w+step*(f.lock&&!f.releasing?12:-releaseRate)));
   if(f.lock&&f.w===0){f.lock=null;f.releasing=false;f.cooldown=.04;f.dwell=0;}
   if(!f.lock||f.w<=0)continue;
   const target=new Vector3(f.lock.x,animPos.y,f.lock.z);
   thigh.computeWorldMatrix(true);calf.computeWorldMatrix(true);
   const hip=thigh.getAbsolutePosition(),knee=calf.getAbsolutePosition();
   const length=Vector3.Distance(hip,knee)+Vector3.Distance(knee,animPos);
   // Project continuously into reach instead of dropping correction weight when a
   // knee straightens. A horizontal-only reach circle collapses near vertical full
   // extension; spherical projection permits a small ankle lift during release.
   const animatedReach=Vector3.Distance(hip,animPos);
   const maxReach=Math.max(animatedReach,length*.985);
   const offset=target.subtract(hip),wantedReach=offset.length();
   if(wantedReach>maxReach){target.copyFrom(hip.add(offset.scale(maxReach/wantedReach)));f.releasing=true;}
   const keep=foot.absoluteRotationQuaternion.clone();
   reach(thigh,calf,foot,target,f.w);
   foot.rotationQuaternion=Quaternion.Inverse((foot.parent as TransformNode).absoluteRotationQuaternion).multiply(keep).normalize();foot.computeWorldMatrix(true);
  }
 }
}

/** Height hysteresis accommodates imported sole offsets; acquisition also requires
 * a low/descending pose and stable dwell, while lift/turn/overreach release the anchor. */
export function footContact(height:number,baseline:number,scale:number,locked:boolean):boolean{
 return height<baseline+(locked ? .11 : .07)*Math.max(.01,scale);
}
