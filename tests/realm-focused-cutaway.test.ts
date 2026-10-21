import {describe,it,expect} from 'vitest';
import {NullEngine,Scene,MeshBuilder,Vector3} from '@babylonjs/core';
import {FocusedRenderer} from '../src/web/realms/focusedRenderer';

describe('imported architecture cutaway',()=>{
 it.each(['wall','column','post','door_jamb'])('reveals the owned body behind a %s and restores its opacity off the sightline',part=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const mesh=MeshBuilder.CreateBox('imported-room:'+part,{width:1,height:4,depth:1},scene);
  mesh.position.set(0,2,-2);mesh.computeWorldMatrix(true);
  const owner={meshes:()=>[mesh]} as unknown as FocusedRenderer;
  FocusedRenderer.prototype.cutaway.call(owner,new Vector3(0,2,-5),Vector3.Zero());expect(mesh.visibility).toBe(.12);
  FocusedRenderer.prototype.cutaway.call(owner,new Vector3(5,2,-5),Vector3.Zero());expect(mesh.visibility).toBe(1);
  scene.dispose();engine.dispose();
 });
 it('does not fade a character or carried prop on the same ray',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const mesh=MeshBuilder.CreateBox('hero:held-dagger',{width:1,height:4,depth:1},scene);mesh.position.set(0,2,-2);mesh.computeWorldMatrix(true);
  FocusedRenderer.prototype.cutaway.call({meshes:()=>[mesh]} as unknown as FocusedRenderer,new Vector3(0,2,-5),Vector3.Zero());expect(mesh.visibility).toBe(1);
  scene.dispose();engine.dispose();
 });
});
