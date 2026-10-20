import {existsSync,readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {Animation,NullEngine,Scene,SceneLoader,TransformNode,Vector3,Quaternion} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {Retargeter,UAL} from '../src/web/arena/retarget';
import {normalizeCharacterMetres} from '../src/web/actors/characterScale';
import {RadialFootPlant} from '../src/web/arena/radialFootPlant';
import type {CharacterInstance} from '../src/web/arena/assets';

const files=['web/public/arena/motion/ual-standard.glb','web/public/arena/people/hero.glb','web/public/arena/people/wren.glb'];
describe('staged approved human radial contacts',()=>{
 // These existing credited binary assets are staged locally, never committed by
 // this test. A clean checkout without art reports a skip, not fabricated proof.
 it.skipIf(!files.every(p=>existsSync(p)))('settles both actual boot skins through their own UAL idle/walk bake in a rotated metre frame',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  const observer=SceneLoader.OnPluginActivatedObservable.add(plugin=>{if(plugin.name==='gltf')(plugin as unknown as {skipMaterials:boolean}).skipMaterials=true;});
  const load=async(path:string)=>SceneLoader.LoadAssetContainerAsync('',new Uint8Array(readFileSync(path)),scene,undefined,'.glb');
  const instance=(container:Awaited<ReturnType<typeof load>>,prefix:string)=>{
   const entries=container.instantiateModelsToScene(n=>prefix+n,false,{doNotInstantiate:true}),space=new TransformNode(prefix,scene);
   entries.rootNodes.forEach(n=>n.parent=space);entries.animationGroups.forEach(g=>g.stop());
   return {entries,space,nodes:new Map(space.getChildTransformNodes(false).map(n=>[n.name.slice(prefix.length),n]))};
  };
  try{
   const source=await load(files[0]),src=instance(source,'source.');
   for(const name of ['hero','wren']){
    const container=await load(`web/public/arena/people/${name}.glb`),t=instance(container,name+'.');
    const retarget=new Retargeter(src,t,UAL),clips=['Idle_Loop','Walk_Loop'].map(n=>retarget.bake(n,src.entries.animationGroups.find(g=>g.name==='source.'+n)!));
    const actor=new TransformNode('canonical-body',scene),parent=new TransformNode('radial',scene);actor.parent=parent;t.space.parent=actor;t.space.rotation.y=Math.PI;
    const up=new Vector3(0,.3216,.9469).normalize();parent.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),up,Quaternion.Identity());
    const meshes=t.space.getChildMeshes(),metric=normalizeCharacterMetres(t.space,meshes,1);
    const inst={root:t.space,meshes,bones:t.nodes} as unknown as CharacterInstance,plant=new RadialFootPlant(inst,actor);
    const origin=new Vector3(12000,1000,-4000),normal=up.clone(),frame={reference:'planet',origin,up,sample(p:{x:number;y:number;z:number}){
     const point=new Vector3(p.x,p.y,p.z);return {point:point.subtract(up.scale(Vector3.Dot(point.subtract(origin),normal)/Vector3.Dot(up,normal))),normal,source:'test-plane'};
    }};
    const rootMatrix=t.space.computeWorldMatrix(true).clone();
    for(let kind=0;kind<clips.length;kind++){
     const clip=clips[kind],gaps:number[]=[],weight:number[]=[];
     for(let i=0;i<120;i++){
      plant.restore();
      for(const track of clip.tracks){const node=t.nodes.get(track.bone)!;const f=(i/2)%clip.frames;
       if(track.anim.dataType===Animation.ANIMATIONTYPE_QUATERNION)node.rotationQuaternion=track.anim.evaluate(f).clone();else node.position.copyFrom(track.anim.evaluate(f));}
      t.nodes.forEach(n=>n.computeWorldMatrix(true));plant.update(1/60,true,undefined,frame);
      for(const foot of plant.inspect().feet){
       expect(foot.measuredVertices).toBeGreaterThanOrEqual(3);expect(foot.measuredVertices).toBeLessThanOrEqual(13);
       expect(foot.soleVertices.every(v=>v.mesh.includes('boots'))).toBe(true);
       if(foot.weight>.98&&!foot.releasing)gaps.push(Math.min(...foot.signedGaps.filter((x):x is number=>x!==null)));
       weight.push(foot.weight);
      }
     }
     expect(gaps.length).toBeGreaterThan(kind===0?200:50);
     expect(Math.max(...gaps.map(Math.abs)),`${name} clip${kind} skin gap`).toBeLessThan(.003);
     if(kind===1)expect(weight.some(w=>w===0)).toBe(true);
    }
    // Imported unit conversion differs; the solver never alters it or root pose.
    expect(metric.scale).toBeGreaterThan(.9);expect(metric.scale).toBeLessThan(1.2);
    expect(t.space.computeWorldMatrix(true).equals(rootMatrix)).toBe(true);
    t.entries.dispose();actor.dispose();parent.dispose();container.dispose();
   }
   src.entries.dispose();source.dispose();
  }finally{SceneLoader.OnPluginActivatedObservable.remove(observer);scene.dispose();engine.dispose();}
 },20000);
});
