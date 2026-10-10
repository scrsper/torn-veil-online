import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import {ArenaAssets} from '../../../../src/web/arena/assets';
import {instantiateClips} from '../../../../src/web/arena/retarget';
import {SHARED_MOTION_NAMES} from '../../../../src/web/arena/sharedMotionNames';
/** Same Claude loader, optional local Mixamo packs, and fallback contract as game/Tower. */
export async function attachSharedMotion(target:AssetContainer,scene:Scene,isCurrent:()=>boolean){
 const assets=new ArenaAssets(scene,{base:import.meta.env.BASE_URL+'assets/shared/arena/',detailedHumans:true});
 assets.used=SHARED_MOTION_NAMES;
 await assets.load(['skeleton_warrior'],()=>{});await assets.loadHumans(['ranger'],()=>{});
 if(!isCurrent())return [];
 const nodes=new Map(target.skeletons[0].bones.map(b=>[b.name,b.getTransformNode()!] as const).filter(([,n])=>!!n));
 const groups=instantiateClips('Shared cast',assets.clips,nodes,scene);
 for(const [name,g] of groups){g.name=name;target.animationGroups.push(g);}
 assets.dispose();
 return [{source:assets.mocap?'Existing local Mixamo / Motifect':'Tracked KayKit fallback',contract:'Claude ArenaAssets / Retargeter / instantiateClips'}];
}
