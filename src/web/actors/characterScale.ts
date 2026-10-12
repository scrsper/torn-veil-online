import {Matrix,Vector3,type AbstractMesh,type TransformNode} from '@babylonjs/core';

/** On-demand observation of actual skin/morph vertices and authored node transforms.
 * Deliberately outside the render loop. No positions, bones or bounds are mutated. */
export function characterMeshBounds(root:TransformNode,meshes:readonly AbstractMesh[],skinned=true){
 const inverse=Matrix.Invert(root.computeWorldMatrix(true)),min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
 const parts: {name:string;min:number[];max:number[];scale:number[]}[]=[];
 for(const mesh of meshes){
  const data=mesh.getPositionData(skinned,true);if(!data?.length)continue;
  const matrix=mesh.computeWorldMatrix(true).multiply(inverse),lo=new Vector3(Infinity,Infinity,Infinity),hi=new Vector3(-Infinity,-Infinity,-Infinity);
  for(let i=0;i<data.length;i+=3){const p=Vector3.TransformCoordinates(Vector3.FromArray(data,i),matrix);lo.minimizeInPlace(p);hi.maximizeInPlace(p);}
  min.minimizeInPlace(lo);max.maximizeInPlace(hi);
  parts.push({name:mesh.name,min:lo.asArray(),max:hi.asArray(),scale:mesh.absoluteScaling.asArray()});
 }
 return {min:min.asArray(),max:max.asArray(),dimensions:max.subtract(min).asArray(),parts};
}

export function characterScaleObservation(root:TransformNode,meshes:readonly AbstractMesh[]){
 const bounds=characterMeshBounds(root,meshes),scene=root.getScene(),camera=scene.activeCamera;
 const centre=(bounds.min[0]+bounds.max[0])/2,z=(bounds.min[2]+bounds.max[2])/2;
 const project=(p:Vector3)=>{
  const world=Vector3.TransformCoordinates(p,root.getWorldMatrix());if(!camera)return {world:world.asArray(),screen:null};
  const point=Vector3.Project(world,Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(scene.getEngine().getRenderWidth(),scene.getEngine().getRenderHeight()));
  return {world:world.asArray(),screen:point.asArray()};
 };
 const feet=project(new Vector3(centre,bounds.min[1],z)),crown=project(new Vector3(centre,bounds.max[1],z));
 const reference={feet:project(new Vector3(.65,0,0)),oneMetre:project(new Vector3(.65,1,0)),human:project(new Vector3(.65,1.75,0))};
 return {units:'metres',bounds,rootScale:root.scaling.asArray(),feet,crown,reference,
  screenHeightPx:feet.screen&&crown.screen?Math.abs(feet.screen[1]-crown.screen[1]):null};
}
