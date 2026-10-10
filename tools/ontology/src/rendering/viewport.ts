import {RigReview} from './rigReview';
import {Quaternion} from '@babylonjs/core/Maths/math.vector';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {attachSharedMotion} from './sharedMotion';
import {attachReviewMotion} from './motion';
import type {appearancePlan} from '../visual/appearance';
import {Engine} from '@babylonjs/core/Engines/engine';
import {WebGPUEngine} from '@babylonjs/core/Engines/webgpuEngine';
import type {AbstractEngine} from '@babylonjs/core/Engines/abstractEngine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3,Color4} from '@babylonjs/core/Maths/math.color';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import {SkeletonViewer} from '@babylonjs/core/Debug/skeletonViewer';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {HDRCubeTexture} from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import '@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader';
import '@babylonjs/core/Rendering/edgesRenderer';
import '@babylonjs/loaders/glTF';
import '@babylonjs/core/Engines/WebGPU/Extensions';
// Register the catalog's WGSL shaders before the first WebGPU frame. This avoids
// a dev-server dynamic-import race falling through to HTML shader URL responses.
import '@babylonjs/core/ShadersWGSL/color.vertex';
import '@babylonjs/core/ShadersWGSL/color.fragment';
import '@babylonjs/core/ShadersWGSL/default.vertex';
import '@babylonjs/core/ShadersWGSL/default.fragment';
import '@babylonjs/core/ShadersWGSL/pbr.vertex';
import '@babylonjs/core/ShadersWGSL/pbr.fragment';
import '@babylonjs/core/ShadersWGSL/postprocess.vertex';
import '@babylonjs/core/ShadersWGSL/rgbdDecode.fragment';
import '@babylonjs/core/ShadersWGSL/hdrFiltering.vertex';
import '@babylonjs/core/ShadersWGSL/hdrFiltering.fragment';
import cameraData from '../../ontology/game-camera.json';
import {GameCameraSchema} from '../ontology/schema';
const gameplayCamera=GameCameraSchema.parse(cameraData);

export class Viewport {
 engine!:AbstractEngine;scene!:Scene;camera!:ArcRotateCamera;backend='';
 container?:AssetContainer;root?:TransformNode;viewers:SkeletonViewer[]=[];
 dimensions=[0,0,0];request=0;wire=false;skeleton=false;animation='';loadError='';meshCount=0;applied:string[]=[];motionReport:unknown=[];motionError='';pose='rest';
 private rigReview?:RigReview;
 private rootBase=Vector3.Zero();private pelvisBase=Vector3.Zero();private motionCameraBase=Vector3.Zero();private previousMotionFrame=-1;private cycleTravel=Vector3.Zero();
 private home={radius:4,target:new Vector3(0,0.9,0)};
 private restoreRest:(()=>void)[]=[];
 viewMode='inspection';
 constructor(private canvas:HTMLCanvasElement){}
 async init(){
  if(!new URLSearchParams(location.search).has('webgl')){try{if(await WebGPUEngine.IsSupportedAsync){const e=new WebGPUEngine(this.canvas,{antialias:true});await e.initAsync();this.engine=e;this.backend='WebGPU';}}catch(err){console.warn('WebGPU initialization failed; using WebGL',err);}}
  if(!this.engine){this.engine=new Engine(this.canvas,true,{preserveDrawingBuffer:true,stencil:true});this.backend='WebGL';}
  this.scene=new Scene(this.engine);this.scene.useRightHandedSystem=true;this.scene.clearColor=new Color4(0.115,0.14,0.17,1);
  this.camera=new ArcRotateCamera('catalog-camera',Math.PI/2,1.3,4,new Vector3(0,.9,0),this.scene);this.camera.attachControl(this.canvas,true);this.camera.lowerRadiusLimit=.3;this.camera.upperRadiusLimit=40;this.camera.wheelDeltaPercentage=.01;this.camera.minZ=.01;
  const hemi=new HemisphericLight('neutral-fill',new Vector3(0,1,0),this.scene);hemi.intensity=.85;hemi.groundColor=new Color3(.25,.28,.32);
  const key=new DirectionalLight('key',new Vector3(-1,-2,1),this.scene);key.intensity=2;
  const rim=new DirectionalLight('rim',new Vector3(1,-.7,-1),this.scene);rim.intensity=.6;
  // Curated CC0 studio lighting, kept local. No Babylon environment CDN dependency.
  this.scene.environmentTexture=new HDRCubeTexture(import.meta.env.BASE_URL+'assets/materials/studio_small_09_1k.hdr',this.scene,128,false,true,false,true);
  this.scene.environmentIntensity=.65;
  const floor=MeshBuilder.CreateGround('meter-floor',{width:30,height:30},this.scene);const mat=new StandardMaterial('floor',this.scene);mat.disableLighting=true;mat.emissiveColor=new Color3(.09,.115,.14);mat.specularColor=Color3.Black();floor.material=mat;floor.position.y=0;
  const lines=[];for(let n=-10;n<=10;n++){lines.push([new Vector3(n,0,-10),new Vector3(n,0,10)],[new Vector3(-10,0,n),new Vector3(10,0,n)]);}const grid=MeshBuilder.CreateLineSystem('one-meter-grid',{lines},this.scene);grid.color=new Color3(.25,.3,.34);grid.isPickable=false;grid.position.y=.001;
  this.scene.onBeforeRenderObservable.add(()=>this.updateRootMotion());this.engine.runRenderLoop(()=>this.scene.render());window.addEventListener('resize',()=>this.engine.resize());new ResizeObserver(()=>this.engine.resize()).observe(this.canvas);
 }
 clear(){this.viewers.forEach(v=>v.dispose());this.viewers=[];this.container?.dispose();this.container=undefined;this.root?.dispose();this.root=undefined;this.meshCount=0;this.dimensions=[0,0,0];this.animation='';this.restoreRest=[];this.applied=[];this.motionReport=[];this.motionError='';this.pose='rest';this.rigReview=undefined;}
 async load(url?:string,heightM?:number){
  const request=++this.request;this.clear();this.loadError='';if(!url)return;
  try{const container=await LoadAssetContainerAsync(url.startsWith('/assets/')?import.meta.env.BASE_URL+url.slice(1):url,this.scene);if(request!==this.request){container.dispose();return;}
   // Quaternius exports include unused UV sets. WebGPU's baseline device limit is
   // eight vertex buffers: discard only UV channels unreferenced by the material.
   for(const mesh of container.meshes){if(!(mesh instanceof Mesh))continue;const used=new Set(mesh.material?.getActiveTextures().map(t=>t.coordinatesIndex)??[]);for(let channel=1;channel<6;channel++){if(!used.has(channel))mesh.removeVerticesData(`uv${channel+1}`);}}
   container.addAllToScene();this.container=container;container.animationGroups.forEach(a=>a.stop());
   const root=new TransformNode('entity-instance',this.scene);this.root=root;
   for(const node of [...container.meshes,...container.transformNodes])if(!node.parent)node.parent=root;
   this.restoreRest=[...container.meshes,...container.transformNodes].map(n=>{const p=n.position.clone(),s=n.scaling.clone(),r=n.rotation.clone(),q=n.rotationQuaternion?.clone();return()=>{n.position.copyFrom(p);n.scaling.copyFrom(s);n.rotation.copyFrom(r);n.rotationQuaternion=q?.clone()??null;};});
   const meshes=container.meshes.filter(m=>m.getTotalVertices()>0);this.meshCount=meshes.length;if(!meshes.length)throw Error('Asset contains no visible meshes');
   root.computeWorldMatrix(true);for(const mesh of meshes)mesh.computeWorldMatrix(true);const bounds=root.getHierarchyBoundingVectors(true);const size=bounds.max.subtract(bounds.min);if(!(size.y>0))throw Error('Degenerate model height');
   const scale=heightM?heightM/size.y:1;root.scaling.scaleInPlace(scale);root.position.set(-(bounds.min.x+bounds.max.x)*.5*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*.5*scale);
   this.rootBase=root.position.clone();
   this.dimensions=size.scale(scale).asArray();const h=this.dimensions[1];this.home={radius:Math.max(...this.dimensions)*2.1,target:new Vector3(0,h*.5,0)};this.resetCamera();
   this.rigReview=new RigReview(container,this.scene);
   this.setWireframe(this.wire);this.setSkeleton(this.skeleton);
   if(url.includes('/assets/shared/')){try{this.motionReport=await attachSharedMotion(container,this.scene,()=>request===this.request);}catch(e){this.motionError=String(e);}}
   if(url.includes('tv-human-male-v2')){try{this.motionReport=await attachReviewMotion(container,this.scene,()=>request===this.request);if(request!==this.request)return;this.pelvisBase=container.skeletons[0].bones.find(b=>b.name==='pelvis')!.getTransformNode()!.getAbsolutePosition().clone();}catch(e){this.motionError=String(e);}}
  }catch(err){if(request!==this.request)return;this.clear();this.loadError=String(err);throw err;}
 }
 resetCamera(){this.setView(this.viewMode);}
 setView(view:string){
  this.viewMode=view;this.camera.inertialAlphaOffset=0;this.camera.inertialBetaOffset=0;this.camera.inertialRadiusOffset=0;
  this.camera.setTarget(this.home.target.clone(),false,true,true);this.camera.fov=.8;this.camera.alpha=Math.PI/2;this.camera.beta=Math.PI/2;this.camera.radius=this.home.radius;
  if(view==='gameplay'){
   const {distanceM,pitchRadians,verticalFovDegrees,targetHeightM,lookTargetOffsetM,referenceYawRadians}=gameplayCamera;
   this.camera.fov=verticalFovDegrees*Math.PI/180;
   this.camera.alpha=Math.PI/2+referenceYawRadians;
   const horizontal=distanceM*Math.cos(pitchRadians),vertical=distanceM*Math.sin(pitchRadians)-lookTargetOffsetM;
   this.camera.radius=Math.hypot(horizontal,vertical);this.camera.beta=Math.atan2(horizontal,vertical);
   this.camera.setTarget(new Vector3(0,targetHeightM+lookTargetOffsetM,0),false,true,true);
  }else if(view==='side')this.camera.alpha=0;
  else if(view==='back')this.camera.alpha=-Math.PI/2;
  else if(view==='three-quarter'){this.camera.alpha=Math.PI/2+.65;this.camera.beta=1.35;}
  else if(view==='face'){this.camera.setTarget(new Vector3(0,this.dimensions[1]*.925,0),false,true,true);this.camera.radius=.65;}
  else if(view==='inspection')this.camera.beta=1.3;
 }
 setWireframe(on:boolean){this.wire=on;this.container?.materials.forEach(m=>m.wireframe=on);}
 setSkeleton(on:boolean){this.skeleton=on;this.viewers.forEach(v=>v.dispose());this.viewers=[];if(on&&this.container)for(const sk of this.container.skeletons){const mesh=this.container.meshes.find(m=>m.skeleton===sk);if(mesh){const viewer=new SkeletonViewer(sk,mesh,this.scene,true,1);viewer.isEnabled=true;this.viewers.push(viewer);}}}
 private updateRootMotion(){
  if(!this.animation.startsWith('Walk_Loop')||!this.root||!this.container)return;
  const group=this.container.animationGroups.find(g=>g.name===this.animation),frame=group?.animatables[0]?.masterFrame;
  if(frame===undefined)return;const report=(this.motionReport as {name:string;rootCycleM:number[]}[]).find(r=>r.name==='Walk_Loop');if(!report)return;
  if(this.previousMotionFrame>=0&&frame<this.previousMotionFrame-.5)this.cycleTravel.addInPlace(Vector3.FromArray(report.rootCycleM));this.previousMotionFrame=frame;
  this.root.position.copyFrom(this.rootBase.add(this.cycleTravel));this.root.computeWorldMatrix(true);
  const pelvis=this.container.skeletons[0].bones.find(b=>b.name==='pelvis')!.getTransformNode()!;pelvis.computeWorldMatrix(true);const offset=pelvis.getAbsolutePosition().subtract(this.pelvisBase);offset.y=0;this.camera.setTarget(this.motionCameraBase.add(offset),false,true,true);
 }
 play(name:string){if(this.root)this.root.position.copyFrom(this.rootBase);this.previousMotionFrame=-1;this.cycleTravel.setAll(0);this.setView(this.viewMode);this.motionCameraBase=this.camera.target.clone();this.container?.animationGroups.forEach(a=>a.stop());this.restoreRest.forEach(restore=>restore());this.container?.animationGroups.find(a=>a.name===name)?.start(true);this.animation=name;}
 applyAppearance(plan:ReturnType<typeof appearancePlan>,jaw=plan.jaw){
  this.applied=[];if(!plan.supported||!this.container)return;
  for(const mesh of this.container.meshes){const manager=mesh.morphTargetManager;if(manager)for(let i=0;i<manager.numTargets;i++){const t=manager.getTarget(i);if(t.name==='TV_JawWidth'){t.influence=jaw;this.applied.push('TV_JawWidth='+jaw.toFixed(3));}}}
  for(const mat of this.container.materials)if(mat instanceof PBRMaterial){if(mat.name==='TV woven linen shirt'){mat.albedoColor=Color3.FromArray(plan.linen);this.applied.push('seeded linen palette');}if(mat.name==='TV worn brown leather'){mat.albedoColor=Color3.FromArray(plan.leather);this.applied.push('seeded leather palette');}}
 }
 setLighting(preset:string){const key=this.scene.getLightByName('key')!,fill=this.scene.getLightByName('neutral-fill')!;key.intensity=preset==='raking'?1.4:1;fill.intensity=preset==='raking'?.25:.65;this.scene.environmentIntensity=preset==='raking'?.25:.5;}
 setPose(pose:string){this.play('');this.pose=pose;const q=(bone:string,x:number,y:number,z:number)=>{const n=this.container?.skeletons[0]?.bones.find(b=>b.name===bone)?.getTransformNode();if(n){n.rotationQuaternion=(n.rotationQuaternion??Quaternion.FromEulerVector(n.rotation)).multiply(Quaternion.FromEulerAngles(x,y,z));}};
  if(pose==='shoulder'){q('upperarm_l',0,0,.65);q('upperarm_r',0,0,-.65);}if(pose==='elbow'){q('lowerarm_l',1,0,0);q('lowerarm_r',1,0,0);}if(pose==='hip'){q('thigh_l',.7,0,0);}if(pose==='knee'){q('calf_l',1,0,0);}
 }
 currentMotion(){return {frame:this.container?.animationGroups.find(g=>g.name===this.animation)?.animatables[0]?.masterFrame,...this.rigReview?.sample(false,false)};}
 reviewSample(name:string,frame:number){this.play(name);const group=this.container?.animationGroups.find(a=>a.name===name);group?.pause();group?.goToFrame(frame);return this.rigReview?.sample();}
 stats(){return {applied:this.applied,pose:this.pose,motionReport:this.motionReport,motionError:this.motionError,backend:this.backend,meshCount:this.meshCount,dimensions:this.dimensions,skeletons:this.container?.skeletons.length??0,animations:this.container?.animationGroups.map(a=>a.name)??[],animationFrame:this.container?.animationGroups.find(a=>a.name===this.animation)?.animatables[0]?.masterFrame??null,camera:{view:this.viewMode,alpha:this.camera.alpha,beta:this.camera.beta,radius:this.camera.radius,fov:this.camera.fov,target:this.camera.target.asArray()},loadError:this.loadError};}
}
