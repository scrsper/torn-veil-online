import type {EntityDescription} from '../ontology/schema';
import {variation} from './resolver';
export function appearancePlan(entity:EntityDescription,assetId?:string){
 const supported=assetId==='tv-human-male-v2';
 const tint=variation(entity,'linen-tint');
 return {supported,jaw:variation(entity,'jaw-width'),linen:[.82+tint*.16,.78+tint*.12,.69+tint*.10] as [number,number,number],leather:[.12+variation(entity,'leather-tone')*.08,.055,.025] as [number,number,number],requests:{culture:entity.social.culture??null,profession:entity.social.profession??null,equipment:entity.gameplay.equipment.map(e=>e.id)},applied:supported?['Omni male v2 body','TV_JawWidth morph','seeded linen/leather palette','fixed prototype shirt, belt and calf boots']:[],unresolved:['Culture/profession wardrobe selection','Equipment assembly','Personal hair components','Age-specific population variants']};
}
