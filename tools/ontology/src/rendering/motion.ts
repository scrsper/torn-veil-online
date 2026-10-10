import {cleanMotion} from './motionCleanup';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import {Retargeter,instantiateClips,UE,type RigMap} from '../../../../src/web/arena/retarget';
/** Reuse Claude's reviewed model-space retargeter; source motion is the existing local CC0 UAL. */
export async function attachReviewMotion(target:AssetContainer,scene:Scene,isCurrent:()=>boolean){
 const source=await LoadAssetContainerAsync(import.meta.env.BASE_URL+'assets/library/quaternius-ual/model.glb',scene);
 try{
  if(!isCurrent())return [];
  const rig=(c:AssetContainer)=>({space:c.meshes[0],nodes:new Map(c.skeletons[0].bones.map(b=>[b.name,b.getTransformNode()!] as const).filter(([,n])=>!!n))});
  const s=rig(source),t=rig(target);
  const map:RigMap={...UE,map:UE.map.map(([a,b,c,d])=>[a==='head'?'Head':a,b,c==='head'?'Head':c,d]),blend:[],follow:[]};
  map.map=map.map.filter(([a,b])=>s.nodes.has(a)&&t.nodes.has(b)).map(([a,b,c,d])=>{
  // MPFB places shoulder/neck origins well above its short spine chain. Swinging
  // these offset joints toward UE child origins distorts the torso and collar.
  // Preserve their anatomical rest frame; transfer the source model-space delta.
  return /^(pelvis|spine_|neck_|clavicle_)/.test(b)?[a,b,null,null]:[a,b,c?.replace('fingers_01','middle_01')??null,d];
 });
  for(const side of ['l','r'])for(const finger of ['index','middle','ring','pinky'])for(let joint=1;joint<=3;joint++){const bone=`${finger}_0${joint}_${side}`,child=joint<3?`${finger}_0${joint+1}_${side}`:null;if(s.nodes.has(bone)&&t.nodes.has(bone))map.map.push([bone,bone,child,child]);}
 if(!s.nodes.has('pelvis')||!t.nodes.has('pelvis'))throw Error('Review rig lacks pelvis');
  const retarget=new Retargeter(s,t,map),clips=new Map();
  for(const name of ['Idle_Loop','Walk_Loop']){const clip=source.animationGroups.find(g=>g.name===name);if(!clip)throw Error('UAL clip missing: '+name);clips.set(name,retarget.bake(name,clip,true));}
  const targetRest=[...t.nodes.values()].map(n=>[n,{p:n.position.clone(),q:n.rotationQuaternion!.clone()}] as const);
  const groups=instantiateClips('Review UAL',clips,t.nodes,scene);
  const footReview=new Map();
  for(const [name,g] of groups){footReview.set(name,cleanMotion(target,t.nodes,g,clips.get(name)!));g.name=name+' / RETARGET REVIEW';target.animationGroups.push(g);}
  for(const [node,transform] of targetRest){node.position.copyFrom(transform.p);node.rotationQuaternion?.copyFrom(transform.q);}
  scene.render();
  return [...clips].map(([name,c])=>({name,frames:c.frames,fps:c.fps,stance:c.stance,footReview:footReview.get(name),rootCycleM:footReview.get(name).rootCycleM,contacts:c.contact?.map((a:Uint8Array)=>a.reduce((n,v)=>n+v,0))}));
 }finally{source.dispose();}
}
