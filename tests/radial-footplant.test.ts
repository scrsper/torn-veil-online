import {describe,it,expect} from 'vitest';
import {Bone,Matrix,Mesh,NullEngine,Quaternion,Scene,Skeleton,TransformNode,Vector3,VertexBuffer} from '@babylonjs/core';
import type {CharacterInstance} from '../src/web/arena/assets';
import type {FootContactFrame} from '../src/web/arena/footPlant';
import {measureFootSoles,prepareSoles,soleScenePoints} from '../src/web/arena/footGeometry';
import {RadialFootPlant,radialFootSurface} from '../src/web/arena/radialFootPlant';

/** Real Babylon linked bones, inverse bind matrices and weighted boot vertices,
 * through a metre import, canonical facing adapter and freely rotated parent. */
function rig(up=Vector3.Up(),scale=1){
 const engine=new NullEngine(),scene=new Scene(engine),parent=new TransformNode('radial-parent',scene),actor=new TransformNode('canonical-body',scene),root=new TransformNode('import',scene);
 actor.parent=parent;root.parent=actor;root.scaling.setAll(scale);root.position.y=.008*scale;root.rotation.y=Math.PI;
 const q=Quaternion.FromUnitVectorsToRef(Vector3.Up(),up,Quaternion.Identity());parent.rotationQuaternion=q;
 const origin=new Vector3(10000,20000,-30000),absolute=origin.clone();
 const nodes=new Map<string,TransformNode>(),skeleton=new Skeleton('boot-skin','boot-skin',scene),positions:number[]=[],indices:number[]=[],weights:number[]=[];
 for(const side of ['l','r']){
  let pn:TransformNode=root,pb:Bone|null=null;
  for(const [name,pos] of [[`thigh_${side}`,new Vector3(side==='l'?-.12:.12,.94,0)],[`calf_${side}`,new Vector3(0,-.43,.12)],[`foot_${side}`,new Vector3(0,-.4,-.12)]] as const){
   const node=new TransformNode(name,scene);node.parent=pn;node.position.copyFrom(pos);node.rotationQuaternion=Quaternion.Identity();node.computeWorldMatrix(true);nodes.set(name,node);
   const bone:Bone=new Bone(name,skeleton,pb,Matrix.Translation(pos.x,pos.y,pos.z));bone.linkTransformNode(node);pn=node;pb=bone;
  }
  const index=skeleton.bones.length-1,x=side==='l'?-.12:.12;
  for(const dx of [-.065,.065])for(const z of [-.1,.17]){
   positions.push(x+dx,0,z);indices.push(index,0,0,0);weights.push(1,0,0,0);
  }
 }
 const mesh=new Mesh('actual-weighted-boots',scene);mesh.parent=root;mesh.skeleton=skeleton;
 mesh.setVerticesData(VertexBuffer.PositionKind,positions);mesh.setVerticesData(VertexBuffer.MatricesIndicesKind,indices);mesh.setVerticesData(VertexBuffer.MatricesWeightsKind,weights);
 const inst={root,bones:nodes,meshes:[mesh],bindAnkleHeights:[.11,.11]} as unknown as CharacterInstance;
 const plant=new RadialFootPlant(inst,actor,scale),footRoot=root.computeWorldMatrix(true).clone();
 const plane=(point:Vector3,slope=0)=>{
  const right=Vector3.Right().applyRotationQuaternion(q),normal=up.subtract(right.scale(slope)).normalize();
  return point.subtract(up.scale(Vector3.Dot(point.subtract(absolute),normal)/Vector3.Dot(up,normal)));
 };
 let slope=0,available=true;
 const frame:FootContactFrame={reference:'planet-a',origin,up,sample(point){
  if(!available)return null;const p=Vector3.FromArray([point.x,point.y,point.z]),right=Vector3.Right().applyRotationQuaternion(q);
  return {point:plane(p,slope),normal:up.subtract(right.scale(slope)).normalize(),source:'weighted-test-floor'};
 }};
 const pose=(lift=0)=>{plant.restore();for(const [name,n] of nodes){n.rotationQuaternion=Quaternion.Identity();if(name.startsWith('foot_'))n.position.set(0,-.4+lift,-.12);n.computeWorldMatrix(true);}};
 const step=(lift=0,active=true,contacts?:readonly [boolean,boolean])=>{pose(lift);plant.update(1/60,active,contacts,frame);return plant.inspect();};
 return {scene,root,parent,actor,origin,absolute,up,q,nodes,inst,plant,frame,step,pose,footRoot,setSlope:(x:number)=>slope=x,setAvailable:(x:boolean)=>available=x,dispose:()=>{scene.dispose();engine.dispose();}};
}

describe('radial foot contacts',()=>{
 it('measures real skinned sole vertices and follows their animated rotations',()=>{
  const r=rig(),soles=measureFootSoles(r.inst);expect(soles.every(s=>s&&s.points.length>=3)).toBe(true);
  prepareSoles(soles);const before=soleScenePoints(soles[0]!);
  expect(Math.min(...before.map(p=>p.y))).toBeCloseTo(.008,6);
  const foot=r.nodes.get('foot_l')!;foot.rotationQuaternion=Quaternion.RotationAxis(Vector3.Right(),.3);foot.computeWorldMatrix(true);prepareSoles(soles);
  const after=soleScenePoints(soles[0]!);expect(Math.max(...after.map((p,i)=>Vector3.Distance(p,before[i])))).toBeGreaterThan(.03);
  // Bounded measurement is the same skinning as Babylon's whole-mesh path.
  const full=r.inst.meshes[0].getPositionData(true,true)!,world=r.inst.meshes[0].computeWorldMatrix(true);
  for(const p of after)expect(Array.from({length:4},(_,i)=>Vector3.Distance(p,Vector3.TransformCoordinates(Vector3.FromArray(full,i*3),world))).some(d=>d<1e-6)).toBe(true);
  r.dispose();
 });
 it('settles measured soles on flat and inclined support at poles, equator and arbitrary parent rotations/scales without root movement',()=>{
  for(const up of [Vector3.Up(),Vector3.Down(),Vector3.Right(),new Vector3(.2,.6,-.4).normalize()])for(const scale of [.65,1.3]){
   const r=rig(up,scale);r.setSlope(.15);
   const before=r.root.computeWorldMatrix(true).clone();
   for(let i=0;i<30;i++)r.step(0,true,[true,true]);
   const d=r.plant.inspect();expect(d.feet).toHaveLength(2);expect(r.plant.lockState(),JSON.stringify({up:up.asArray(),scale,d})).toEqual([true,true]);
   for(const foot of d.feet){expect(foot.weight).toBe(1);expect(Math.abs(Math.min(...foot.signedGaps as number[]))).toBeLessThan(.002);}
   expect(r.root.computeWorldMatrix(true).equals(before)).toBe(true);expect(r.actor.position.equals(Vector3.Zero())).toBe(true);r.dispose();
  }
 });
 it('keeps absolute anchors through floating-origin shifts and small stance translation',()=>{
  const r=rig(new Vector3(0,.3216,.9469).normalize());for(let i=0;i<20;i++)r.step(0,true,[true,true]);
  const start=r.plant.inspect().feet.map(f=>({id:f.lockId,anchor:f.anchor!,points:f.solePoints}));
  const right=Vector3.Right().applyRotationQuaternion(r.q);
  for(let i=0;i<10;i++){
   r.origin.addInPlace(new Vector3(17,-31,42));r.parent.position.copyFrom(r.absolute.subtract(r.origin).add(right.scale(.003*i)));
   const d=r.step(0,true,[true,true]);
   for(let k=0;k<2;k++){expect(d.feet[k].lockId).toBe(start[k].id);expect(d.feet[k].anchor).toEqual(start[k].anchor);
    expect(Math.max(...d.feet[k].solePoints.map((p,n)=>Vector3.Distance(new Vector3(p.x,p.y,p.z),new Vector3(start[k].points[n].x,start[k].points[n].y,start[k].points[n].z))))).toBeLessThan(.002);}
  }
  r.dispose();
 });
 it('releases on lost support, swing, reference change, teleport and flight; landing does not calibrate a swing apex',()=>{
  const r=rig();for(let i=0;i<15;i++)r.step(.2);expect(r.plant.lockState()).toEqual([false,false]);
  for(let i=0;i<20;i++)r.step();expect(r.plant.lockState()).toEqual([true,true]);
  r.setAvailable(false);for(let i=0;i<30;i++)r.step();expect(r.plant.lockState()).toEqual([false,false]);
  r.setAvailable(true);for(let i=0;i<20;i++)r.step();
  r.step(0,false);expect(r.plant.inspect().resetReason).toBe('inactive');expect(r.plant.lockState()).toEqual([false,false]);
  for(let i=0;i<20;i++)r.step();r.frame.reference='planet-b';r.step();expect(r.plant.inspect().resetReason).toBe('reference-changed');
  for(let i=0;i<20;i++)r.step();r.parent.position.x+=3;r.step();expect(r.plant.inspect().resetReason).toBe('teleport');
  r.dispose();
 });
 it('refuses walls, ledge edges, missing footprints and distant floors',()=>{
  const r=rig(),query=r.absolute.clone(),forward=Vector3.Forward();
  for(const sample of [
   (p:Vector3)=>({point:new Vector3(p.x,r.absolute.y+1,p.z),normal:Vector3.Up()}),
   (p:Vector3)=>({point:new Vector3(p.x,r.absolute.y+(p.x<r.absolute.x?0:.15),p.z),normal:Vector3.Up()}),
   (p:Vector3)=>p.x>r.absolute.x?null:{point:new Vector3(p.x,r.absolute.y,p.z),normal:Vector3.Up()},
   (p:Vector3)=>({point:p,normal:Vector3.Right()}),
  ]){
   const frame={...r.frame,sample:(p:{x:number;y:number;z:number})=>sample(new Vector3(p.x,p.y,p.z))};
   expect(radialFootSurface(frame,query,r.absolute,forward,1)).toBeNull();
  }
  r.dispose();
 });
 it('fails closed without measurable sole geometry and restores joint poses without accumulating correction',()=>{
  const r=rig();for(let i=0;i<20;i++)r.step(0,true,[true,true]);
  r.plant.restore();expect(r.nodes.get('thigh_l')!.rotationQuaternion!.equals(Quaternion.Identity())).toBe(true);
  const empty=new RadialFootPlant({...r.inst,meshes:[]},r.actor);empty.update(1/60,true,[true,true],r.frame);
  expect(empty.lockState()).toEqual([false,false]);expect(empty.inspect().feet.map(f=>f.reason)).toEqual(['unmeasured-sole','unmeasured-sole']);r.dispose();
 });
 it('rejects a toe/heel ledge outside the centre cross but inside the measured boot extent',()=>{
  const r=rig();r.frame.sample=p=>({point:new Vector3(p.x,r.absolute.y+(p.z<r.absolute.z-.14?.15:0),p.z),normal:Vector3.Up()});
  for(let i=0;i<30;i++)r.step(0,true,[true,true]);
  expect(r.plant.lockState()).toEqual([false,false]);r.dispose();
 });
});
