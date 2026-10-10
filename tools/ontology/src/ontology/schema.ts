import {z} from 'zod';

export const QualitySchema=z.enum(['MISSING','PLACEHOLDER','PROTOTYPE','CANDIDATE','APPROVED','PRODUCTION']);
export type Quality=z.infer<typeof QualitySchema>;
const id=z.string().min(1);
export const ArchetypeIdSchema=z.enum(['humanoid_standard','humanoid_heavy','humanoid_small','dwarf_humanoid','beast_humanoid','giant_humanoid','quadruped','dragon','winged_creature','insectoid','serpentine','amorphous','construct','skeletal','ethereal','cosmic_abstract']);
export const EquipmentSlotSchema=z.enum(['head','face','neck','torso_inner','torso_outer','shoulders','hands','waist','legs','feet','back','main_hand','off_hand','accessory_1','accessory_2']);
export const EquipmentSchema=z.object({id,slot:EquipmentSlotSchema,assetId:id.optional(),socket:id.optional(),rigFamilies:z.array(id).default([]),hides:z.array(id).default([]),materialOverrides:z.record(z.string()).default({})}).strict();
export const EntitySchema=z.object({
 schemaVersion:z.literal(1),id,name:id,appearanceSeed:z.number().int().min(0).max(4294967295),
 biological:z.object({species:id,subspecies:id.optional(),origin:z.enum(['biological','artificial','metaphysical']).default('biological'),sex:id.default('unspecified'),age:z.number().nonnegative().optional(),bodyType:id.default('standard'),heightM:z.number().positive().optional(),massKg:z.number().positive().optional(),proportions:z.record(z.number().positive()).default({}),morphology:z.record(z.number().finite()).default({})}).strict(),
 personal:z.object({skin:id.optional(),faceFamily:id.optional(),hair:id.optional(),eyes:id.optional(),scars:z.array(id).default([]),tattoos:z.array(id).default([]),horns:id.optional(),ears:id.optional(),tail:id.optional(),wings:id.optional(),features:z.array(id).default([])}).strict().default({}),
 social:z.object({culture:id.optional(),profession:id.optional(),role:id.optional(),faction:id.optional(),wealth:id.optional(),status:id.optional()}).strict().default({}),
 gameplay:z.object({class:id.optional(),skills:z.array(id).default([]),rank:id.optional(),combatProfile:id.optional(),equipment:z.array(EquipmentSchema).default([])}).strict().default({}),
 states:z.array(id).default([]),modifiers:z.array(id).default([]),relationships:z.array(z.object({kind:id,targetEntityId:id})).default([])
}).strict();
export type EntityDescription=z.infer<typeof EntitySchema>;
export const SpeciesSchema=z.object({id,name:id,archetype:ArchetypeIdSchema,rigFamily:id,defaultHeightM:z.number().positive(),headFamily:id,features:z.array(id),materialFamily:id,bodyAssetId:id.optional(),requirements:z.array(id)}).strict();
export type SpeciesDefinition=z.infer<typeof SpeciesSchema>;
export const ProvenanceSchema=z.object({id,name:id,creator:id,source:id,sourceUrl:z.string().url(),license:id,licenseUrl:z.string().url(),downloadDate:z.string().datetime(),originalFilename:id,localPath:id,modificationStatus:id,redistributionRestrictions:id,sha256:z.string().regex(/^[a-f0-9]{64}$/),notes:z.string(),parentId:id.optional()});
export const AssetSchema=z.object({id,provider:id,kind:z.enum(['body','component','equipment','animation','material','hdri']),url:z.string().startsWith('/assets/'),sourcePath:id,provenanceId:id,status:QualitySchema,rigFamily:id.optional(),nativeHeightM:z.number().positive().optional(),tags:z.array(id),limitations:z.array(id),lods:z.array(z.object({level:z.number().int().nonnegative(),url:id,maxDistanceM:z.number().positive()})).default([]),review:z.object({reviewer:id,date:z.string().datetime(),referenceProfile:id}).optional()}).strict().superRefine((a,ctx)=>{if(['APPROVED','PRODUCTION'].includes(a.status)&&!a.review)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Human review evidence is required for approval'});});
export type AssetRecord=z.infer<typeof AssetSchema>;
const pending=z.number().positive().nullable();
export const ArtDirectionSchema=z.object({
 id,version:z.number().int().positive(),status:z.enum(['UNSET','DRAFT','USER_APPROVED']),referenceIds:z.array(id),
 humanoidProportions:z.object({headsTall:pending,shoulderToHeight:pending}),polygonBudget:z.object({hero:pending,crowd:pending,lodRatios:z.array(z.number().positive().max(1))}),
 textureDensity:z.object({pixelsPerMeter:pending,maxResolution:pending}),stylization:z.string().nullable(),
 materialRules:z.object({roughnessRange:z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]).nullable(),metallicPolicy:z.string().nullable()}),
 silhouetteRules:z.array(z.string()),colorRules:z.object({palette:z.array(z.string()),saturationRange:z.tuple([z.number(),z.number()]).nullable()}),
 faceRules:z.record(z.string()),handRules:z.object({scale:pending}),armorRules:z.array(z.string()),clothingRules:z.array(z.string()),monsterLanguage:z.array(z.string()),
 presentation:z.object({gameCameraDistanceM:pending,lightingReference:z.string().nullable()})
}).strict();
export type ArtDirectionProfile=z.infer<typeof ArtDirectionSchema>;
/** Authoring measurements are proposals, independent of canonical biological state. */
export const HumanFamilySchema=z.object({id,version:z.number().int().positive(),status:QualitySchema,artDirectionProfile:id,sourceTopology:id,rigFamily:id,rigImplementation:id,note:id,
 variants:z.array(z.object({id,sex:z.enum(['male','female']),heightM:z.number().positive(),headsTallTarget:z.number().min(5).max(10),shoulderWidthToHeightTarget:z.number().positive().max(1),handLengthToHeightTarget:z.number().positive().max(1),assetId:id,references:z.array(id)}).strict()),
 derivations:z.array(z.object({species:id,baseFamily:id,status:QualitySchema,references:z.array(id).optional(),requirements:z.array(id)}).strict())}).strict();
export const GameCameraSchema=z.object({id,status:z.literal('DRAFT'),projection:z.literal('perspective'),distanceM:z.number().positive(),pitchRadians:z.number().min(0).max(Math.PI/2),verticalFovDegrees:z.number().min(10).max(120),targetHeightM:z.number().positive(),lookTargetOffsetM:z.number(),referenceYawRadians:z.number(),source:id,notes:id}).strict();
