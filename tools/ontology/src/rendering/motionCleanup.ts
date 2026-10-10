import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import type {ClipTemplate} from '../../../../src/web/arena/retarget';

function refresh(container:AssetContainer,nodes:Map<string,TransformNode>){for(const n of nodes.values())n.computeWorldMatrix(true);for(const s of container.skeletons)s.prepare(true);}
function worldQ(node:TransformNode){const q=new Quaternion();node.computeWorldMatrix(true).decompose(undefined,q);return q.normalize();}
function setWorldQ(node:TransformNode,q:Quaternion){node.rotationQuaternion=Quaternion.Inverse(worldQ(node.parent as TransformNode)).multiply(q).normalize();node.computeWorldMatrix(true);}
function swing(a:Vector3,b:Vector3){const u=a.normalizeToNew(),v=b.normalizeToNew(),dot=Math.max(-1,Math.min(1,Vector3.Dot(u,v)));if(dot>.999999)return Quaternion.Identity();let axis=Vector3.Cross(u,v);if(axis.lengthSquared()<1e-10)axis=Vector3.Cross(u,Vector3.Right());return Quaternion.RotationAxis(axis.normalize(),Math.acos(dot));}
/** Analytic two-bone stance IK preserves the animated foot's world rotation. */
function solveLeg(nodes:Map<string,TransformNode>,side:string,goal:Vector3){
 const thigh=nodes.get('thigh_'+side)!,calf=nodes.get('calf_'+side)!,foot=nodes.get('foot_'+side)!;
 const hip=thigh.getAbsolutePosition().clone(),knee=calf.getAbsolutePosition().clone(),ankle=foot.getAbsolutePosition().clone(),footQ=worldQ(foot);
 const a=Vector3.Distance(hip,knee),b=Vector3.Distance(knee,ankle);const axis=goal.subtract(hip).normalize();const distance=Math.min(a+b-.0001,Math.max(.001,Vector3.Distance(hip,goal)));
 let pole=knee.subtract(hip);pole.subtractInPlace(axis.scale(Vector3.Dot(pole,axis)));if(pole.lengthSquared()<1e-7){pole=Vector3.Forward();pole.subtractInPlace(axis.scale(Vector3.Dot(pole,axis)));}pole.normalize();
 const x=(distance*distance+a*a-b*b)/(2*distance),height=Math.sqrt(Math.max(0,a*a-x*x));const desiredKnee=hip.add(axis.scale(x)).add(pole.scale(height));
 setWorldQ(thigh,swing(knee.subtract(hip),desiredKnee.subtract(hip)).multiply(worldQ(thigh)));calf.computeWorldMatrix(true);foot.computeWorldMatrix(true);
 const newKnee=calf.getAbsolutePosition().clone();setWorldQ(calf,swing(foot.getAbsolutePosition().subtract(newKnee),goal.subtract(newKnee)).multiply(worldQ(calf)));foot.computeWorldMatrix(true);setWorldQ(foot,footQ);
}

class Soles {
 private mesh:AssetContainer['meshes'][number];private sets:number[][]=[[],[]];
 constructor(private container:AssetContainer,private nodes:Map<string,TransformNode>){
  this.mesh=container.meshes.find(m=>m.name.includes('shoes03'))!;if(!this.mesh)throw Error('Actual boot sole geometry missing');refresh(container,nodes);const points=this.points();const feet=['l','r'].map(s=>nodes.get('foot_'+s)!.getAbsolutePosition());
  for(let side=0;side<2;side++){const ids=points.map((p,i)=>({p,i})).filter(({p})=>Math.abs(p.x-feet[side].x)<Math.abs(p.x-feet[1-side].x));const lo=Math.min(...ids.map(({p})=>p.y));this.sets[side]=ids.filter(({p})=>p.y<lo+.012).map(({i})=>i);if(!this.sets[side].length)throw Error('Boot has no sole vertices');}
 }
 private points(){this.mesh.skeleton?.prepare(true);const values=this.mesh.getPositionData(true,true)!;const matrix=this.mesh.computeWorldMatrix(true),points:Vector3[]=[];for(let i=0;i<values.length;i+=3)points.push(Vector3.TransformCoordinates(Vector3.FromArray(values,i),matrix));return points;}
 sample(){refresh(this.container,this.nodes);const all=this.points();return this.sets.map(ids=>{const p=ids.map(i=>all[i]);return {min:Math.min(...p.map(v=>v.y)),center:p.reduce((sum,v)=>sum.add(v),Vector3.Zero()).scale(1/p.length)};});}
}

/** Bake grounding and contact correction against the rendered skinned boot soles.
 * Walking includes measured forward root travel; viewport carries travel across loops.
 */
export function cleanMotion(container:AssetContainer,nodes:Map<string,TransformNode>,group:AnimationGroup,clip:ClipTemplate){
 const rest=[...nodes.values()].map(n=>[n,{p:n.position.clone(),q:n.rotationQuaternion!.clone()}] as const);const restore=()=>{for(const[n,r]of rest){n.position.copyFrom(r.p);n.rotationQuaternion!.copyFrom(r.q);}refresh(container,nodes);};
 const soles=new Soles(container,nodes),raw:ReturnType<Soles['sample']>[]=[];const apply=(frame:number)=>{group.goToFrame(frame);refresh(container,nodes);};
 group.start(false,1,0,clip.frames-1);for(let i=0;i<clip.frames;i++){apply(i);raw.push(soles.sample());}group.stop();restore();
 const idle=clip.name==='Idle_Loop';const contact=[0,1].map(k=>{const lo=Math.min(...raw.map(f=>f[k].min));return raw.map(f=>idle||f[k].min<lo+.028);});
 const travel:Vector3[]=[Vector3.Zero()];for(let i=1;i<clip.frames;i++){const changes=[];if(!idle)for(let k=0;k<2;k++)if(contact[k][i]&&contact[k][i-1]){const delta=raw[i-1][k].center.subtract(raw[i][k].center);delta.y=0;changes.push(delta);}travel.push(travel[i-1].add(changes.length?changes.reduce((sum,p)=>sum.add(p),Vector3.Zero()).scale(1/changes.length):Vector3.Zero()));}
 const pelvis=nodes.get('pelvis')!,parent=pelvis.parent as TransformNode,parentInv=parent.computeWorldMatrix(true).clone().invert();const rotations=new Map<string,{frame:number;value:Quaternion}[]>();for(const s of ['l','r'])for(const b of ['thigh','calf','foot'])rotations.set(b+'_'+s,[]);
 const positions:{frame:number;value:Vector3}[]=[];const corrected:ReturnType<Soles['sample']>[]=[];let anchors:(Vector3|null)[]=[null,null];
 group.start(false,1,0,clip.frames-1);
 for(let i=0;i<clip.frames;i++){
  apply(i);pelvis.position.addInPlace(Vector3.TransformNormal(travel[i].add(new Vector3(0,-Math.min(raw[i][0].min,raw[i][1].min),0)),parentInv));refresh(container,nodes);
  let current=soles.sample();const goals:(Vector3|null)[]=[];
  for(let k=0;k<2;k++){
   if(!contact[k][i]){anchors[k]=null;goals[k]=null;continue;}
   if(!anchors[k]){anchors[k]=current[k].center.clone();anchors[k]!.y-=current[k].min;}
   const foot=nodes.get('foot_'+(k?'r':'l'))!;goals[k]=foot.getAbsolutePosition().add(new Vector3(anchors[k]!.x-current[k].center.x,-current[k].min,anchors[k]!.z-current[k].center.z));
  }
  // Lower hips only as much as needed for the stance ankle to be reachable.
  let lower=0;for(let k=0;k<2;k++){const goal=goals[k];if(!goal)continue;const s=k?'r':'l',hip=nodes.get('thigh_'+s)!.getAbsolutePosition(),knee=nodes.get('calf_'+s)!.getAbsolutePosition(),foot=nodes.get('foot_'+s)!.getAbsolutePosition();const reach=Vector3.Distance(hip,knee)+Vector3.Distance(knee,foot)-.0005;const horizontal=(hip.x-goal.x)**2+(hip.z-goal.z)**2;lower=Math.max(lower,hip.y-goal.y-Math.sqrt(Math.max(.001,reach*reach-horizontal)));}
  if(lower>0){pelvis.position.addInPlace(Vector3.TransformNormal(new Vector3(0,-lower,0),parentInv));refresh(container,nodes);}
  for(let k=0;k<2;k++)if(goals[k]){solveLeg(nodes,k?'r':'l',goals[k]!);refresh(container,nodes);}
  current=soles.sample();positions.push({frame:i,value:pelvis.position.clone()});for(const[b,keys]of rotations)keys.push({frame:i,value:nodes.get(b)!.rotationQuaternion!.clone()});corrected.push(current);
 }
 group.stop();restore();
 const root=clip.tracks.find(t=>t.bone==='pelvis'&&t.anim.targetProperty==='position')!;root.anim.setKeys(positions);for(const[b,keys]of rotations){const track=clip.tracks.find(t=>t.bone===b&&t.anim.targetProperty==='rotationQuaternion');if(!track)throw Error('Leg track missing: '+b);track.anim.setKeys(keys);}
 const metrics=(frames:typeof raw)=>({lowestSoleM:Math.min(...frames.flatMap(f=>f.map(s=>s.min))),highestLowerSoleM:Math.max(...frames.map(f=>Math.min(f[0].min,f[1].min))),maxContactStepM:Math.max(...frames.flatMap((f,i)=>i?[0,1].filter(k=>contact[k][i]&&contact[k][i-1]).map(k=>{const d=f[k].center.subtract(frames[i-1][k].center);return Math.hypot(d.x,d.z);}):[0]))});
 clip.contact=contact.map(c=>Uint8Array.from(c,v=>v?1:0)) as [Uint8Array,Uint8Array];
 return {method:'CPU-skinned boot outsole vertices; two-bone stance IK with animated foot rotation preserved; measured walking root travel',before:metrics(raw),after:metrics(corrected),rootCycleM:travel.at(-1)!.asArray(),contactFrames:contact.map(c=>c.filter(Boolean).length),status:'IMPROVED_REVIEW_REQUIRED'};
}
