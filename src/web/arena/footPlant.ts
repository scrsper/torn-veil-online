import {Quaternion,Vector3,type TransformNode} from '@babylonjs/core';
import type {CharacterInstance} from './assets';
import {reach} from './ik';

export type FootGround = (x:number,z:number)=>number|null;
export type FootPoint = Readonly<{x:number;y:number;z:number}>;
/** Stable absolute universe metres, never camera-relative coordinates. */
export interface FootSupport {point:FootPoint;normal:FootPoint;source?:string}
export interface FootContactFrame {
 reference:string;
 /** Current render origin: absolute = scene point + origin. */
 origin:FootPoint;
 up:FootPoint;
 /** Return only a nearby supporting floor along up, or null when unavailable.
  * radius/maxDistance are render metres. The solver also checks its footprint. */
 sample(point:FootPoint,up:FootPoint,radius:number,maxDistance:number):FootSupport|null;
}
type Surface = {height:number;normal:Vector3};
type Contact = {lock:Vector3|null;surface:Surface|null;w:number;yaw:number;previousHeight:number|null;dwell:number;releasing:boolean;cooldown:number};
/** Presentation contact correction. Animation supplies each fresh pose before this pass. */
export class FootPlant {
 private feet:Contact[]=['l','r'].map(()=>({lock:null,surface:null,w:0,yaw:0,previousHeight:null,dwell:0,releasing:false,cooldown:0}));
 private previousRoot:Vector3|null=null;
 constructor(private inst:CharacterInstance){}
 /** Read-only presentation diagnostics for browser motion validation. */
 lockCount():number{return this.feet.reduce((n,f)=>n+(f.lock?1:0),0);}
 lockState():[boolean,boolean]{return [!!this.feet[0].lock,!!this.feet[1].lock];}
 update(dt:number,y:number,yaw:number,active=true,contacts?:readonly [boolean,boolean],ground?:FootGround):[boolean,boolean]|undefined{
  const b=this.inst.bones;if(!b)return;
  const step=Math.max(0,Math.min(.1,dt));
  const root=this.inst.root;root.computeWorldMatrix(true);
  const rootPos=root.getAbsolutePosition().clone();
  // Absolute scaling includes a scaled parent and survives body resizing after bind capture.
  const scale=Math.max(.01,Math.abs(root.absoluteScaling.y));
  const teleported=this.previousRoot!==null&&Vector3.Distance(rootPos,this.previousRoot)>.65*scale;
  this.previousRoot=rootPos;
  if(!active||teleported){for(const f of this.feet){f.lock=null;f.surface=null;f.w=0;f.previousHeight=null;f.dwell=0;f.releasing=false;f.cooldown=0;}return;}
  const support:[boolean,boolean]=[false,false];
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
   const sample=ground?footSurface(ground,f.lock??animPos,y,scale):null;
   const posedContact=(contacts?contacts[k]:footContact(height,baseline,scale,!!f.lock))&&!rising;
   const contact=posedContact&&(!ground||sample!==null);
   // Audio can still use body-relative pose support on a projected upper floor
   // outside the terrain-only IK sampler; its material lookup validates residency.
   support[k]=posedContact;
   if(f.lock){
    const displacement=Math.hypot(f.lock.x-animPos.x,f.lock.z-animPos.z);
    const turn=Math.abs(Math.atan2(Math.sin(yaw-f.yaw),Math.cos(yaw-f.yaw)));
    if(!contact||displacement>.28*scale||turn>.3||(f.surface&&sample&&Math.abs(sample.height-f.surface.height)>.06*scale))f.releasing=true;
   }else{
    f.dwell=contact&&f.cooldown===0?f.dwell+step:0;
    // A baked support phase is already evidence of landing; geometric inference
    // needs dwell. Delaying explicit contact would consume a short running stance.
    if(contact&&f.cooldown===0&&(contacts?.[k]||f.dwell>=.04)){f.lock=animPos.clone();f.surface=sample;f.yaw=yaw;f.releasing=false;f.dwell=0;}
   }
   // Do not replace a still weighted anchor on turns or stops. Release, then reacquire.
   // A fixed weight fade can dump a large correction into one frame. Bound its
   // release contribution to foot speed while small offsets fade normally.
   const terrainOffset=f.surface?Math.max(-.22*scale,Math.min(.22*scale,f.surface.height-y)):0;
   const releaseOffset=f.lock?Math.hypot(f.lock.x-animPos.x,f.lock.z-animPos.z,terrainOffset):0;
   const releaseRate=Math.min(10,2*scale/Math.max(.001,releaseOffset));
   const acquireRate=terrainOffset!==0?Math.min(12,2*scale/Math.max(.001,releaseOffset)):12;
   f.w=Math.max(0,Math.min(1,f.w+step*(f.lock&&!f.releasing?acquireRate:-releaseRate)));
   if(f.lock&&f.w===0){f.lock=null;f.surface=null;f.releasing=false;f.cooldown=.04;f.dwell=0;}
   if(!f.lock||f.w<=0)continue;
   const target=new Vector3(f.lock.x,animPos.y+terrainOffset,f.lock.z);
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
   // Apply terrain tilt to the animated world orientation, retaining imported bind
   // axes and authored ankle articulation. Flat ground is exactly the old pass.
   let desired=keep;
   if(f.surface){
    const normal=f.surface.normal,axis=Vector3.Cross(Vector3.Up(),normal),angle=Math.acos(Math.max(-1,Math.min(1,normal.y)));
    if(axis.lengthSquared()>1e-8){const tilt=Quaternion.RotationAxis(axis.normalize(),Math.min(angle,Math.PI/7.2));desired=Quaternion.Slerp(Quaternion.Identity(),tilt,f.w).multiply(keep);}
   }
   foot.rotationQuaternion=Quaternion.Inverse((foot.parent as TransformNode).absoluteRotationQuaternion).multiply(desired).normalize();foot.computeWorldMatrix(true);
  }
  return support;
 }
}

/** Small sole footprint, in render metres. Do not treat a stair edge as an incline
 * or reach a distant floor/cliff. Missing neighbour samples also mean no support. */
export function footSurface(ground:FootGround,point:Pick<Vector3,'x'|'z'>,rootY:number,scale:number):Surface|null{
 const s=Math.max(.01,Math.abs(scale)),r=.09*s;
 const h=ground(point.x,point.z),xp=ground(point.x+r,point.z),xm=ground(point.x-r,point.z),zp=ground(point.x,point.z+r),zm=ground(point.x,point.z-r);
 if([h,xp,xm,zp,zm].some(v=>v===null||!Number.isFinite(v)))return null;
 const height=h!,dx=(xp!-xm!)/(2*r),dz=(zp!-zm!)/(2*r);
 if(Math.abs(height-rootY)>.22*s||Math.abs((xp!+xm!)/2-height)>.025*s||Math.abs((zp!+zm!)/2-height)>.025*s||Math.hypot(dx,dz)>Math.tan(Math.PI/5))return null;
 return {height,normal:new Vector3(-dx,1,-dz).normalize()};
}

/** Height hysteresis accommodates imported sole offsets; acquisition also requires
 * a low/descending pose and stable dwell, while lift/turn/overreach release the anchor. */
export function footContact(height:number,baseline:number,scale:number,locked:boolean):boolean{
 return height<baseline+(locked ? .11 : .07)*Math.max(.01,scale);
}
