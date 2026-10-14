import {Color3,MeshBuilder,RawTexture,StandardMaterial,Texture,type Scene} from '@babylonjs/core';
/** Soft grounding under the projected canonical feet; presentation only. */
export function contactGrounding(scene:Scene){
 const size=64,data=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2)),i=(y*size+x)*4;data[i+3]=Math.round(255*Math.pow(Math.max(0,1-r),1.8));}
 const texture=RawTexture.CreateRGBATexture(data,size,size,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);texture.hasAlpha=true;
 const material=new StandardMaterial('player-contact-grounding',scene);material.disableLighting=true;material.diffuseColor=Color3.Black();material.emissiveColor=Color3.Black();material.opacityTexture=texture;material.alpha=.4;material.backFaceCulling=false;material.disableDepthWrite=true;material.zOffset=-2;
 const mesh=MeshBuilder.CreateDisc('player-contact-grounding',{radius:1,tessellation:32},scene);mesh.material=material;mesh.rotation.x=Math.PI/2;mesh.scaling.set(.52,.35,1);mesh.isPickable=false;
 return {update:(x:number,y:number,z:number,yaw:number)=>{mesh.position.set(x,y+.014,z);mesh.rotation.y=yaw;}};
}
