import {Matrix,Vector3,VertexBuffer,type AbstractMesh,type Skeleton} from '@babylonjs/core';
import type {CharacterInstance} from './assets';

type SkinPoint={mesh:AbstractMesh;vertexIndex:number;position:Vector3;indices:number[];weights:number[]};
export type FootSole={points:SkinPoint[];bindAnkleHeight:number;bindSoleHeight:number};

/** Read the actual imported skin once, before animation. Select a small support
 * hull from vertices driven by this foot/toe; clothing and the other foot cannot
 * calibrate an ankle. No source mesh, skin weight, material or morph is changed. */
export function measureFootSoles(inst:CharacterInstance):[FootSole|null,FootSole|null]{
 const inverse=Matrix.Invert(inst.root.computeWorldMatrix(true));
 return ['l','r'].map(side=>{
  const foot=inst.bones?.get(`foot_${side}`);if(!foot)return null;
  foot.computeWorldMatrix(true);
  const ankle=Vector3.TransformCoordinates(foot.getAbsolutePosition(),inverse);
  const candidates:{skin:SkinPoint;point:Vector3}[]=[];
  for(const mesh of inst.meshes){
   const skeleton=mesh.skeleton;if(!skeleton)continue;
   const distal=new Set<number>();
   skeleton.bones.forEach((bone,index)=>{
    let node=bone.getTransformNode();
    while(node){if(node===foot){distal.add(bone.getIndex()??index);break;}node=node.parent as typeof node;}
   });
   if(!distal.size)continue;
   const positions=mesh.getPositionData(false,true),indices=mesh.getVerticesData(VertexBuffer.MatricesIndicesKind),weights=mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
   if(!positions||!indices||!weights)continue;
   const extraI=mesh.getVerticesData(VertexBuffer.MatricesIndicesExtraKind),extraW=mesh.getVerticesData(VertexBuffer.MatricesWeightsExtraKind);
   const matrix=mesh.computeWorldMatrix(true).multiply(inverse);
   for(let i=0;i<positions.length/3;i++){
    const ids:number[]=[],ws:number[]=[];
    for(let j=0;j<4;j++){ids.push(indices[i*4+j]);ws.push(weights[i*4+j]);}
    if(extraI&&extraW)for(let j=0;j<4;j++){ids.push(extraI[i*4+j]);ws.push(extraW[i*4+j]);}
    if(ws.reduce((sum,w,k)=>sum+(distal.has(ids[k])?w:0),0)<.95)continue;
    const position=Vector3.FromArray(positions,i*3),point=Vector3.TransformCoordinates(position,matrix);
    if(!Number.isFinite(point.lengthSquared())||point.y>ankle.y+.005)continue;
    candidates.push({skin:{mesh,vertexIndex:i,position,indices:ids,weights:ws},point});
   }
  }
  if(candidates.length<3)return null;
  // Downward support directions cover flat soles and the permitted 25-degree
  // terrain tilt. This is a bounded hull of real vertices, not a whole-mesh scan
  // each frame. Toe articulation remains the imported animation's responsibility.
  const selected=new Set<number>();
  for(let i=0;i<12;i++){
   const a=i*Math.PI/6,d=new Vector3(.55*Math.cos(a),-1,.55*Math.sin(a));
   let best=-Infinity,index=0;
   candidates.forEach((v,k)=>{const value=Vector3.Dot(v.point,d);if(value>best){best=value;index=k;}});selected.add(index);
  }
  let lowest=0;for(let i=1;i<candidates.length;i++)if(candidates[i].point.y<candidates[lowest].point.y)lowest=i;
  selected.add(lowest);
  return {points:[...selected].map(i=>candidates[i].skin),bindAnkleHeight:ankle.y,bindSoleHeight:candidates[lowest].point.y};
 }) as [FootSole|null,FootSole|null];
}

/** The same linear-blend skin matrices used by Babylon rendering, evaluated for
 * at most thirteen measured vertices per foot. Call prepareSoles after changing
 * joints; never cache animated CPU positions across frames. */
export function prepareSoles(soles:readonly (FootSole|null)[]):void{
 const skeletons=new Set<Skeleton>();for(const sole of soles)for(const point of sole?.points??[])if(point.mesh.skeleton)skeletons.add(point.mesh.skeleton);
 for(const skeleton of skeletons)skeleton.prepare(true);
}
export function soleScenePoints(sole:FootSole):Vector3[]{
 return sole.points.map(({mesh,position,indices,weights})=>{
  const matrices=mesh.skeleton!.getTransformMatrices(mesh),p=Vector3.Zero();
  for(let i=0;i<weights.length;i++){
   const w=weights[i];if(w<=0)continue;const o=indices[i]*16,m=matrices;
   p.x+=(position.x*m[o]+position.y*m[o+4]+position.z*m[o+8]+m[o+12])*w;
   p.y+=(position.x*m[o+1]+position.y*m[o+5]+position.z*m[o+9]+m[o+13])*w;
   p.z+=(position.x*m[o+2]+position.y*m[o+6]+position.z*m[o+10]+m[o+14])*w;
  }
  return Vector3.TransformCoordinates(p,mesh.computeWorldMatrix(true));
 });
}
