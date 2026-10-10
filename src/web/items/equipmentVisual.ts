import {SceneLoader,Mesh,TransformNode,Matrix,Quaternion,Vector3,type AssetContainer} from '@babylonjs/core';
import type {CharacterInstance} from '../arena/assets';
import {itemStaticAssetPath,itemFittingPrototypePath} from './itemAssets';
import type {EquipmentSlot} from '../../sim/physical/equipment';
type Row={id:string;catalogId?:string;type:string;slot:EquipmentSlot};
const armorBones:Partial<Record<EquipmentSlot,[string,string]>>={head:['head','head'],torso:['chest','spine_03'],'left-shoulder':['upper_arm.L','upperarm_l'],'left-forearm':['forearm.L','lowerarm_l'],'left-shin':['shin.L','calf_l']};
/** Rigid plate bindings use the shipped mannequin's bone-local rest frame, rather than
 * putting every armor mesh at the actor origin. Cloth/skinned wardrobe fitting is separate. */
export class EquipmentVisual {
 private loaded=new Map<string,{container:AssetContainer;root:TransformNode}>();private wanted=new Set<string>();private pending=new Set<string>();private disposed=false;
 readonly errors=new Map<string,string>();
 private restRotation=new Map<string,Quaternion>();private fitScale=1;
 constructor(private actor:CharacterInstance,private sex:'male'|'female'){
  const inverse=actor.root.computeWorldMatrix(true).clone().invert();
  for(const [name,bone] of actor.bones??[]){const q=new Quaternion();bone.computeWorldMatrix(true).multiply(inverse).decompose(undefined,q);this.restRotation.set(name,q);}
  const bounds=actor.root.getHierarchyBoundingVectors(true);const height=(bounds.max.y-bounds.min.y)/actor.root.scaling.y;
  this.fitScale=height/(sex==='female'?1.78:1.9);
 }
 update(rows:Row[]){
  this.wanted=new Set(rows.map(r=>r.id));
  for(const [id,v] of this.loaded)if(!this.wanted.has(id)){v.root.dispose(false,false);v.container.dispose();this.loaded.delete(id);}
  for(const row of rows)if(!this.loaded.has(row.id)&&!this.pending.has(row.id)&&!this.errors.has(row.id))void this.load(row);
 }
 private async load(row:Row){
  if(!row.catalogId){this.errors.set(row.id,'No authored catalog visual');return;}
  const binding=armorBones[row.slot];
  const path=binding?itemFittingPrototypePath(row.catalogId,this.sex):itemStaticAssetPath(row.catalogId);
  if(!path){this.errors.set(row.id,'No supported fitting asset');return;}
  this.pending.add(row.id);
  let container:AssetContainer|undefined;
  try{
   container=await SceneLoader.LoadAssetContainerAsync('./',path,this.actor.root.getScene());
   if(this.disposed||!this.wanted.has(row.id)){container.dispose();return;}
   const target=binding?this.actor.bones?.get(binding[1]):row.slot==='left-hand'?this.actor.slotL:this.actor.slotR;
   if(!target)throw Error('Required attachment bone missing');
   const root=new TransformNode('equipment:'+row.catalogId,this.actor.root.getScene());root.parent=target;
   root.rotationQuaternion=Quaternion.Identity();
   container.addAllToScene();
   const visible=container.meshes.filter((m):m is Mesh=>m instanceof Mesh&&m.getTotalVertices()>0);
   // One grip origin for the complete object, preserving blade/guard/handle relationships.
   const minimum=new Vector3(Infinity,Infinity,Infinity),maximum=new Vector3(-Infinity,-Infinity,-Infinity);
   for(const m of visible){m.computeWorldMatrix(true);const bb=m.getBoundingInfo().boundingBox;minimum.minimizeInPlace(bb.minimumWorld);maximum.maximizeInPlace(bb.maximumWorld);}
   const center=minimum.add(maximum).scale(.5),gripY=minimum.y+(maximum.y-minimum.y)*.18;
   if(binding){
    const bone=container.skeletons[0]?.bones.find(b=>b.name===binding[0])?.getTransformNode();if(!bone)throw Error('Fitting rig bone missing');
    const sourceQ=new Quaternion();bone.computeWorldMatrix(true).decompose(undefined,sourceQ);
    root.rotationQuaternion=Quaternion.Inverse(this.restRotation.get(binding[1])!).multiply(sourceQ).normalize();root.scaling.setAll(this.fitScale);
   }
   for(const mesh of container.meshes){
    if(!(mesh instanceof Mesh)||!mesh.getTotalVertices())continue;
    const world=mesh.computeWorldMatrix(true).clone();
    if(binding){
     const bone=container.skeletons[0]?.bones.find(b=>b.name===binding[0])?.getTransformNode();
     if(!bone)throw Error('Fitting rig bone missing: '+binding[0]);
     const local=world.multiply(bone.computeWorldMatrix(true).clone().invert());
     mesh.skeleton=null;mesh.bakeTransformIntoVertices(local);
    }else{
     mesh.bakeTransformIntoVertices(world);
     // Static GLBs stand on a floor. Move the lower shaft/grip into the hand socket.
     mesh.bakeTransformIntoVertices(Matrix.Translation(-center.x,-gripY,-center.z));
    }
    mesh.parent=root;mesh.position.setAll(0);mesh.rotation.setAll(0);mesh.rotationQuaternion=Quaternion.Identity();mesh.scaling.setAll(1);mesh.isPickable=false;mesh.receiveShadows=true;
   }
   // The source rig is only a fitting frame. All visible plates follow the mapped actor bone.
   for(const n of container.rootNodes)if(n instanceof TransformNode&&!n.getChildMeshes(false).some(m=>m.parent===root))n.setEnabled(false);
   this.loaded.set(row.id,{root,container});
  }catch(e){container?.dispose();this.errors.set(row.id,String(e));console.warn('[equipment]',row.catalogId,e);}
  finally{this.pending.delete(row.id);}
 }
 dispose(){this.disposed=true;for(const v of this.loaded.values()){v.root.dispose(false,false);v.container.dispose();}this.loaded.clear();}
}
