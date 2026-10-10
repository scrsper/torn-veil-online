import {EntitySchema,type EntityDescription,type SpeciesDefinition,type Quality} from '../ontology/schema';
import type {ProviderRegistry} from '../assets/providers';
import familyData from '../../ontology/morphology/human-family.json';
import {HumanFamilySchema} from '../ontology/schema';
const humanFamily=HumanFamilySchema.parse(familyData);
export const RESOLVER_VERSION='1.1.0';
/** Stable sorted-key encoding; unordered state/modifier sets are normalized separately. */
export function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export function hash32(s:string){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
export function variation(entity:EntityDescription,channel:string){return hash32(`${RESOLVER_VERSION}|${entity.id}|${entity.appearanceSeed}|${channel}`)/4294967296;}
export interface StateRule {id:string;materialFamily?:string;effects:string[];requirements:string[];bodyAssetId?:string;rigFamily?:string;}
export interface Resolution {
 entityId:string;seed:number;version:string;fingerprint:string;archetype:string;bodyAssetId?:string;status:Quality;heightM:number;
 morphology:Record<string,number>;headFamily:string;speciesFeatures:string[];materialFamily:string;hair:string;clothing:string[];equipment:string[];animationProfile:string;rig:string;effects:string[];unresolved:string[];trace:string[];
}
export function resolveVisual(input:unknown,species:readonly SpeciesDefinition[],providers:ProviderRegistry,states:readonly StateRule[]=[]):Resolution {
 const e=EntitySchema.parse(input),s=species.find(s=>s.id===e.biological.species);if(!s)throw Error(`Unknown species: ${e.biological.species}`);
 const normalized={...e,states:[...new Set(e.states)].sort(),modifiers:[...new Set(e.modifiers)].sort()};
 let bodyAssetId=s.bodyAssetId,rig=s.rigFamily,materialFamily=s.materialFamily;
 const unresolved=[...s.requirements],effects:string[]=[],trace=[`Species ${s.id} → ${s.archetype}`,`Biological identity copied from simulation description; no mechanical values computed.`];
 const familyVariant=s.id==='human'?humanFamily.variants.find(v=>v.sex===e.biological.sex):undefined;
 const familyAsset=familyVariant?providers.get(familyVariant.assetId):undefined;
 if(familyAsset){bodyAssetId=familyAsset.id;rig=humanFamily.rigFamily;trace.push(`Shared Human family ${humanFamily.id} → ${familyVariant!.id}; authored MPFB topology and fitted plain clothing`,`Rig implementation ${humanFamily.rigImplementation}; locomotion retarget is still pending`);}
 for(const state of normalized.states){const rule=states.find(x=>x.id===state);if(!rule){unresolved.push(`State visual rule: ${state}`);continue;}if(rule.bodyAssetId)bodyAssetId=rule.bodyAssetId;if(rule.rigFamily)rig=rule.rigFamily;if(rule.materialFamily)materialFamily=rule.materialFamily;effects.push(...rule.effects);unresolved.push(...rule.requirements);trace.push(`State ${state} applied to ${s.id}`);}
 const asset=bodyAssetId?providers.get(bodyAssetId):undefined;
 if(!asset)unresolved.push(`Body geometry for ${s.id}`);else {unresolved.push(...asset.limitations);trace.push(`Body ${asset.id} from provider ${asset.provider}`);}
 const clothing=[e.social.culture&&`${e.social.culture}:wardrobe`,e.social.profession&&`${e.social.profession}:outfit`].filter((x):x is string=>!!x);
 unresolved.push(...clothing.map(x=>`Clothing component: ${x}`));
 for(const eq of e.gameplay.equipment){const item=eq.assetId?providers.get(eq.assetId):undefined;if(!item)unresolved.push(`Equipment ${eq.slot}: ${eq.id}`);else if(item.rigFamily&&item.rigFamily!==rig)unresolved.push(`Equipment rig mismatch: ${eq.id}`);else unresolved.push(`Equipment assembly pending: ${eq.id}`);}
 for(const m of normalized.modifiers)unresolved.push(`Modifier implementation: ${m}`);
 if(Object.keys(e.biological.morphology).length||Object.keys(e.biological.proportions).length||e.biological.bodyType!=='standard')unresolved.push('Body morph targets / proportions not yet applied to source mesh');
 if(e.biological.sex!=='unspecified'&&!familyAsset)unresolved.push(`Requested sex ${e.biological.sex}: source body variant fitting pending`);
 if(e.biological.age!==undefined)unresolved.push('Age-specific face/body authoring pending');
 if(Object.values(e.personal).some(v=>Array.isArray(v)?v.length:!!v))unresolved.push('Personal appearance components not yet assembled');
 trace.push('Seeded face/hair variation is a reproducible request; geometry support is pending.','Culture, profession, rank and equipment never redefine species.');
 return {entityId:e.id,seed:e.appearanceSeed,version:RESOLVER_VERSION,fingerprint:hash32(canonical({entity:normalized,resolver:RESOLVER_VERSION,species:s,states,asset})).toString(16).padStart(8,'0'),archetype:s.archetype,bodyAssetId:asset?.id,status:asset?(unresolved.length?'PROTOTYPE':asset.status):'MISSING',heightM:e.biological.heightM??s.defaultHeightM,morphology:{...e.biological.morphology,...e.biological.proportions,faceVariation:variation(e,'face')},headFamily:e.personal.faceFamily??s.headFamily,speciesFeatures:[...s.features,...e.personal.features],materialFamily,hair:e.personal.hair??`variation_${Math.floor(variation(e,'hair')*4)}`,clothing,equipment:e.gameplay.equipment.map(x=>x.id),animationProfile:`${rig}:base`,rig,effects,unresolved:[...new Set(unresolved)],trace};
}
