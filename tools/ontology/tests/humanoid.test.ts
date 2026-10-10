import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {HumanFamilySchema,GameCameraSchema} from '../src/ontology/schema';
import family from '../ontology/morphology/human-family.json';
import camera from '../ontology/game-camera.json';
import refs from '../references/manifest.json';
import {entities,species,providers,states} from '../src/ontology/data';
import {resolveVisual} from '../src/visual/resolver';
describe('reference-guided Human foundation',()=>{
 it('preserves complete reviewed reference inventory with eleven usefulness dimensions',()=>{expect(refs.images).toHaveLength(18);expect(new Set(refs.images.map(r=>r.sha256)).size).toBe(18);for(const r of refs.images){expect(r.visuallyInspected).toBe(true);expect(Object.keys(r.usefulness)).toHaveLength(11);expect(r.license).toBe('USER_PROVIDED_REFERENCE_ONLY');expect(r.localPath.startsWith('references/')).toBe(true);}});
 it('validates shared family and camera; descendants inherit a family rather than source-specific entity classes',()=>{expect(HumanFamilySchema.parse(family).variants).toHaveLength(2);expect(family.derivations.map(d=>d.species)).toEqual(['elf','orc','dwarf']);expect(GameCameraSchema.parse(camera).distanceM).toBe(8);expect(GameCameraSchema.safeParse({...camera,distanceM:0}).success).toBe(false);});
 it('selects Human body variants deterministically and leaves simulation descriptions untouched',()=>{const male=structuredClone(entities[0]);const female=structuredClone(male);female.biological.sex='female';const before=JSON.stringify(female);expect(resolveVisual(male,species,providers,states).bodyAssetId).toBe('tv-human-male-v2');const result=resolveVisual(female,species,providers,states);expect(result.bodyAssetId).toBe('tv-human-female-v1');expect(result).toEqual(resolveVisual(female,species,providers,states));expect(JSON.stringify(female)).toBe(before);expect(result.rig).toBe('humanoid_standard');expect(result.status).toBe('PROTOTYPE');});
 it('attributes each Human public file to its actual source instead of the first entities directory record',()=>{const publicFiles=JSON.parse(readFileSync('assets/provenance/public-files.json','utf8'));for(const sex of ['male','female']){const r=publicFiles.find((r:{localPath:string})=>r.localPath===`public/assets/entities/tv-human-${sex}-v1.glb`);expect(r.parentId).toBe(`tv-human-${sex}-v1-provenance`);}});
});
