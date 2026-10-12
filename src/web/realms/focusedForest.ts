import {Color3,InstancedMesh,MaterialPluginBase,Matrix,Mesh,MeshBuilder,PBRMaterial,Quaternion,ShaderLanguage,Vector3,VertexBuffer,type AbstractMesh,type BaseTexture,type Scene,type TransformNode,type UniformBuffer} from '@babylonjs/core';
import {StaticGeometry,type StaticTriangle} from '../../sim/physical/staticGeometry';
import {useScannedMaps,type loadScannedMaps} from '../render/materials';
import type {Atmosphere} from '../world/atmosphere';
type Maps=ReturnType<typeof loadScannedMaps>;
export type ForestRoute=readonly (readonly [number,number,number])[];
const hash=(name:string)=>{let n=2166136261;for(const c of name)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
const random=(seed:number)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const distance=(x:number,z:number,routes:readonly ForestRoute[])=>{let d=Infinity;for(const route of routes)for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[2]-a[2],u=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1)));d=Math.min(d,Math.hypot(x-a[0]-u*dx,z-a[2]-u*dz));}return d;};

/** One continuous ground palette replaces material-slot polygon boundaries.
 * Vertex alpha is authored route coverage, never transparency or geometry. */
class ForestGround extends MaterialPluginBase {
 constructor(material:PBRMaterial,private grass:Maps['albedo']){super(material,'VeilForestGround',205,{},true,true);}
 override isCompatible(){return true;}override isReadyForSubMesh(){return this.grass.isReady();}
 override getSamplers(s:string[]){s.push('tvForestGrass');}override getActiveTextures(t:BaseTexture[]){t.push(this.grass);}
 override bindForSubMesh(b:UniformBuffer){b.setTexture('tvForestGrass',this.grass);}
 override getCustomCode(type:string,language=ShaderLanguage.GLSL):Record<string,string>|null{
  const w=language===ShaderLanguage.WGSL;
  if(type==='vertex')return {CUSTOM_VERTEX_DEFINITIONS:w?'varying tvForestCoverage:f32;':'varying float tvForestCoverage;',CUSTOM_VERTEX_MAIN_END:w?'vertexOutputs.tvForestCoverage=vertexInputs.color.a;':'tvForestCoverage=color.a;'};
  if(type!=='fragment')return null;
  return {CUSTOM_FRAGMENT_DEFINITIONS:w?'varying tvForestCoverage:f32;var tvForestGrass:texture_2d<f32>;var tvForestGrassSampler:sampler;':'varying float tvForestCoverage;uniform sampler2D tvForestGrass;',CUSTOM_FRAGMENT_BEFORE_LIGHTS:w?`
   let tvForestUV=fragmentInputs.vPositionW.xz*.21;
   let tvForestPatch=.12*sin(tvForestUV.x*.7+sin(tvForestUV.y*.9));
   let tvForestSoil=toLinearSpaceVec3(textureSample(albedoSampler,albedoSamplerSampler,tvForestUV).rgb);
   let tvForestLeaf=toLinearSpaceVec3(textureSample(tvForestGrass,tvForestGrassSampler,tvForestUV).rgb);
   surfaceAlbedo=mix(vec3f(.11,.12,.065),mix(tvForestSoil,tvForestLeaf*vec3f(.85,1.02,.75),clamp(fragmentInputs.tvForestCoverage+tvForestPatch,.06,.94)),.72);
   normalW=normalize(mix(normalW,normalize(fragmentInputs.vNormalW),.65));
  `:`
   vec2 tvForestUV=vPositionW.xz*.21;
   float tvForestPatch=.12*sin(tvForestUV.x*.7+sin(tvForestUV.y*.9));
   vec3 tvForestSoil=toLinearSpace(texture2D(albedoSampler,tvForestUV).rgb);
   vec3 tvForestLeaf=toLinearSpace(texture2D(tvForestGrass,tvForestUV).rgb);
   surfaceAlbedo=mix(vec3(.11,.12,.065),mix(tvForestSoil,tvForestLeaf*vec3(.85,1.02,.75),clamp(tvForestCoverage+tvForestPatch,.06,.94)),.72);
   normalW=normalize(mix(normalW,normalize(vNormalW),.65));
  `};
 }
}
/** Leaves close to the eye fade through a stable spatial dither. They never
 * block camera rays or alter the canonical capsule/triangle collision. */
export class FoliageEyeFade extends MaterialPluginBase {
 constructor(m:PBRMaterial){super(m,'VeilFoliageEyeFade',220,{},true,true);}override isCompatible(){return true;}
 override getCustomCode(type:string,language=ShaderLanguage.GLSL):Record<string,string>|null{
  if(type!=='fragment')return null;return {CUSTOM_FRAGMENT_BEFORE_LIGHTS:language===ShaderLanguage.WGSL?`
   let tvEyeFade=smoothstep(.65,2.2,distance(fragmentInputs.vPositionW,uniforms.vEyePosition.xyz));
   let tvEyeGrain=fract(sin(dot(floor(fragmentInputs.vPositionW.xz*35.0),vec2f(127.1,311.7)))*43758.5453);
   if(tvEyeGrain>tvEyeFade){discard;}
  `:`
   float tvEyeFade=smoothstep(.65,2.2,distance(vPositionW,vEyePosition.xyz));
   float tvEyeGrain=fract(sin(dot(floor(vPositionW.xz*35.0),vec2(127.1,311.7)))*43758.5453);
   if(tvEyeGrain>tvEyeFade)discard;
  `};
 }
}
export class FocusedForest {
 readonly floor:PBRMaterial;
 constructor(private scene:Scene,private atmosphere:Atmosphere,maps:(surface:string)=>Maps,private leaves:(kind:string)=>PBRMaterial){
  this.floor=new PBRMaterial('focused-continuous-forest-floor',scene);useScannedMaps(this.floor,maps('forest_ground_04'));this.floor.albedoColor=Color3.White();this.floor.roughness=.95;this.floor.metallic=0;this.floor.specularIntensity=.1;this.floor.ambientTextureStrength=.35;new ForestGround(this.floor,maps('grass_ground').albedo);
 }
 decorate(root:TransformNode,routes:readonly ForestRoute[]){
  const inverse=root.computeWorldMatrix(true).clone().invert(),meshes=root.getChildMeshes(),groups=new Map<string,{kind:string;lo:Vector3;hi:Vector3;ground:number}>(),triangles:StaticTriangle[]=[];
  const source=(m:AbstractMesh)=>m instanceof InstancedMesh?m.sourceMesh:m as Mesh;
  const name=(m:AbstractMesh)=>(source(m).metadata?.focusedOriginalMaterial??m.material?.name??'').toLowerCase().replace(/^tv_/,'').replace(/\.\d+$/,'');
  const ground=meshes.filter(m=>/^(earth|soil|grass|ochre)$/.test(name(m)));
  for(const mesh of ground){const matrix=mesh.computeWorldMatrix(true).multiply(inverse),p=mesh.getVerticesData(VertexBuffer.PositionKind)!,indices=mesh.getIndices()!,points:Vector3[]=[],colors:number[]=[];
   for(let i=0;i<p.length;i+=3){const point=Vector3.TransformCoordinates(Vector3.FromArray(p,i),matrix);points.push(point);const d=distance(point.x,point.z,routes),coverage=.10+.60*Math.max(0,Math.min(1,(d-1.2)/3));colors.push(1,1,1,coverage);}
   for(let i=0;i<indices.length;i+=3){const a=points[indices[i]],b=points[indices[i+1]],c=points[indices[i+2]],normal=Vector3.Cross(b.subtract(a),c.subtract(a));if(Math.abs(normal.y)>.7*normal.length())triangles.push({p:[...a.asArray(),...b.asArray(),...c.asArray()],support:true});}
   const original=source(mesh);original.metadata={...original.metadata,focusedOriginalMaterial:original.metadata?.focusedOriginalMaterial??original.material?.name};original.makeGeometryUnique();original.setVerticesData(VertexBuffer.ColorKind,colors);original.hasVertexAlpha=false;original.useVertexColors=true;original.material=this.floor;
  }
  for(const canopy of meshes.filter(m=>/^(pine|leaf)$/.test(name(m)))){
   const key=canopy.parent?.name??canopy.name,box=canopy.getBoundingInfo().boundingBox,matrix=canopy.computeWorldMatrix(true).multiply(inverse),old=groups.get(key),group=old??{kind:name(canopy)==='pine'?'pine':'leaf',lo:new Vector3(Infinity,Infinity,Infinity),hi:new Vector3(-Infinity,-Infinity,-Infinity),ground:Infinity};
   if(name(canopy)==='pine')group.kind='pine';for(const p of box.vectors){const point=Vector3.TransformCoordinates(p,matrix);group.lo.minimizeInPlace(point);group.hi.maximizeInPlace(point);}groups.set(key,group);
   this.atmosphere.removeCaster(canopy);canopy.setEnabled(false);canopy.metadata={...canopy.metadata,decorativeCanopyProxy:true};
  }
  let support:StaticGeometry|null=null;if(triangles.length){const bounds={x0:Infinity,z0:Infinity,x1:-Infinity,z1:-Infinity};for(const t of triangles)for(const i of [0,3,6]){bounds.x0=Math.min(bounds.x0,t.p[i]);bounds.x1=Math.max(bounds.x1,t.p[i]);bounds.z0=Math.min(bounds.z0,t.p[i+2]);bounds.z1=Math.max(bounds.z1,t.p[i+2]);}support=new StaticGeometry(triangles,bounds);}
  const matrices=new Map<string,number[]>();const card=(kind:string,lod:string,position:Vector3,width:number,height:number,yaw:number,roll=0,pitch=0)=>{const key=kind+':'+lod,data=matrices.get(key)??[];data.push(...Matrix.Compose(new Vector3(width,height,1),Quaternion.RotationYawPitchRoll(yaw,pitch,roll),position).asArray());matrices.set(key,data);};
  for(const [key,tree]of groups){const rng=random(hash(key)),centre=tree.lo.add(tree.hi).scale(.5),height=tree.hi.y-tree.lo.y,radius=Math.min(tree.hi.x-tree.lo.x,tree.hi.z-tree.lo.z)*.5,phase=rng()*Math.PI*2;
   for(const lod of ['near','far']){const tiers=lod==='near'?7:4,branches=lod==='near'?7:4;
    for(let layer=0;layer<tiers;layer++){const t=(layer+.2)/tiers,r=radius*(tree.kind==='pine'?(.12+.88*Math.pow(1-t,.75)):Math.sqrt(Math.max(.10,1-Math.pow(t*2-1,2))));
     for(let branch=0;branch<branches;branch++){const angle=phase+branch*Math.PI*2/branches+layer*2.39996,width=r*(1.05+rng()*.18),position=new Vector3(centre.x+Math.sin(angle)*width*.43,tree.lo.y+height*t,centre.z+Math.cos(angle)*width*.43);card(tree.kind,lod,position,width,Math.min(height*.32,width*.66),angle-Math.PI/2,-.18-rng()*.17,(rng()-.5)*.8);}
    }
   }
   if(support)for(let n=0;n<5;n++){const a=rng()*Math.PI*2,r=.65+rng()*1.45,x=centre.x+Math.sin(a)*r,z=centre.z+Math.cos(a)*r;if(distance(x,z,routes)<2.2)continue;const y=support.supportAt(x,z,tree.lo.y,8);if(y===null)continue;const h=.24+rng()*.33;for(const yaw of [a,a+Math.PI/2])card('leaf','understory',new Vector3(x,y+h*.4,z),h*1.5,h,yaw,(rng()-.5)*.4);}
  }
  for(const [key,data]of matrices){const [kind,lod]=key,mesh=MeshBuilder.CreatePlane(root.name+':layered-'+key,{size:1},this.scene);mesh.parent=root;mesh.material=this.leaves(kind);mesh.isPickable=false;mesh.receiveShadows=true;mesh.thinInstanceSetBuffer('matrix',new Float32Array(data),16,true);mesh.metadata={focusedSoftFoliage:true,foliageLod:lod,cards:data.length/16,sourceTrees:groups.size};if(lod!=='far')this.atmosphere.addCaster(mesh);}
  root.metadata={...root.metadata,forestPresentation:'layered-branches-v2',sourceTrees:groups.size,proxyCanopiesHidden:true};
 }
 dispose(){this.floor.dispose();}
}
