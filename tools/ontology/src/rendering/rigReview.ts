import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
/** Evaluated CPU skinning of the same meshes rendered by Babylon, in world metres. */
export class RigReview {
 private rest=new Map<string,{points:Vector3[];edges:[number,number,number][]}>();
 private attachments:{mesh:string;cloth:string;pairs:{index:number;partner:number;distance:number}[]}[]=[];
 private soles:{mesh:string;indices:number[];side:string}[]=[];
 constructor(private container:AssetContainer,private scene:Scene){
  scene.render();
  for(const mesh of container.meshes){const data=mesh.getPositionData(true,true);if(!data)continue;const world=mesh.computeWorldMatrix(true);const points:Vector3[]=[];for(let i=0;i<data.length;i+=3)points.push(Vector3.TransformCoordinates(Vector3.FromArray(data,i),world));const triangles=mesh.getIndices()??[];const edges:[number,number,number][]=[];for(let i=0;i<triangles.length;i+=3)for(let j=0;j<3;j++){const a=triangles[i+j],b=triangles[i+(j+1)%3];const length=Vector3.Distance(points[a],points[b]);if(length>1e-5)edges.push([a,b,length]);}this.rest.set(mesh.name,{points,edges});
   if(/shoes03|Mannequin/.test(mesh.name)){for(const [side,sign]of [['left',1],['right',-1]] as const){const candidates=points.map((p,i)=>({p,i})).filter(({p})=>p.x*sign>0);const low=Math.min(...candidates.map(({p})=>p.y));this.soles.push({mesh:mesh.name,side,indices:candidates.filter(({p})=>p.y<low+.012).map(({i})=>i)});}}
  }
  const cloth=[...this.rest].find(([name])=>name.includes('casualsuit'));
  if(cloth)for(const[name,value]of this.rest)if(/fitted leather belt|belt buckle|linen rolled cuff/.test(name)){
   const pairs=value.points.map((p,index)=>{let partner=0,best=Infinity;cloth[1].points.forEach((q,j)=>{const distance=Vector3.DistanceSquared(p,q);if(distance<best){best=distance;partner=j;}});return {index,partner,distance:Math.sqrt(best)};});this.attachments.push({mesh:name,cloth:cloth[0],pairs});
  }
 }
 sample(render=true,full=true){
  if(render)this.scene.render();for(const skeleton of this.container.skeletons)skeleton.prepare(true);const metrics=[];const coordinates=new Map<string,Vector3[]>();
  for(const mesh of this.container.meshes){if(!full&&!/shoes03|Mannequin/.test(mesh.name))continue;const data=mesh.getPositionData(true,true);const rest=this.rest.get(mesh.name);if(!data||!rest)continue;const world=mesh.computeWorldMatrix(true),points:Vector3[]=[];for(let i=0;i<data.length;i+=3)points.push(Vector3.TransformCoordinates(Vector3.FromArray(data,i),world));coordinates.set(mesh.name,points);const ratios=full?rest.edges.map(([a,b,d])=>Vector3.Distance(points[a],points[b])/d).sort((a,b)=>a-b):[];metrics.push({mesh:mesh.name,minY:Math.min(...points.map(p=>p.y)),maxEdgeStretch:ratios.at(-1),p99EdgeStretch:ratios[Math.floor(ratios.length*.99)]});
  }
  const soles=this.soles.map(s=>{const points=s.indices.map(i=>coordinates.get(s.mesh)![i]);const center=points.reduce((sum,p)=>sum.add(p),Vector3.Zero()).scale(1/points.length);return {side:s.side,vertices:points.length,minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y)),center:center.asArray()};});
  const attachments=full?this.attachments.map(a=>{const delta=a.pairs.map(p=>Vector3.Distance(coordinates.get(a.mesh)![p.index],coordinates.get(a.cloth)![p.partner])-p.distance).sort((x,y)=>x-y);return {component:a.mesh,maxAddedSeparationM:delta.at(-1),p95AddedSeparationM:delta[Math.floor(delta.length*.95)]};}):[];
  return {attachments,groundY:this.scene.getMeshByName('meter-floor')?.position.y,method:'CPU-skinned outsole vertices (rest-bottom 12mm), world metres; triangles compared against authored rest lengths',soles,meshes:metrics,bones:this.container.skeletons[0]?.bones.map(b=>({name:b.name,position:b.getTransformNode()?.getAbsolutePosition().asArray()}))};
 }
}

