import {MaterialPluginBase,ShaderLanguage,type PBRMaterial} from '@babylonjs/core';
/** Composite the existing RGBA branch texture over an opaque living canopy.
 * Transparent texels are coverage, not black paint or holes in collision geometry. */
export class CanopyCoverage extends MaterialPluginBase {
 constructor(material:PBRMaterial){super(material,'VeilCanopyCoverage',210,{},true,true);}
 override isCompatible(){return true;}
 override getCustomCode(type:string,language=ShaderLanguage.GLSL):Record<string,string>|null {
  if(type!=='fragment')return null;
  return {CUSTOM_FRAGMENT_BEFORE_LIGHTS:language===ShaderLanguage.WGSL?`
   let tvLeafAlpha=textureSample(albedoSampler,albedoSamplerSampler,fragmentInputs.vAlbedoUV).a;
   let tvLeafGrain=fract(sin(dot(floor(fragmentInputs.vAlbedoUV*13.0),vec2f(127.1,311.7)))*43758.5453);
   surfaceAlbedo=mix(vec3f(.045,.10,.025)*( .85+.15*tvLeafGrain),surfaceAlbedo,smoothstep(.12,.75,tvLeafAlpha));
  `:`
   float tvLeafAlpha=texture2D(albedoSampler,vAlbedoUV).a;
   float tvLeafGrain=fract(sin(dot(floor(vAlbedoUV*13.0),vec2(127.1,311.7)))*43758.5453);
   surfaceAlbedo=mix(vec3(.045,.10,.025)*(.85+.15*tvLeafGrain),surfaceAlbedo,smoothstep(.12,.75,tvLeafAlpha));
  `};
 }
}
