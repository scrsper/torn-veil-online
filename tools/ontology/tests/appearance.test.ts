import {describe,it,expect} from 'vitest';
import {appearancePlan} from '../src/visual/appearance';
import {entities} from '../src/ontology/data';
describe('authored appearance preview',()=>{
 it('changes supported geometric/material channels reproducibly without changing identity',()=>{const e=structuredClone(entities[0]),before=JSON.stringify(e),a=appearancePlan(e,'tv-human-male-v2');expect(a).toEqual(appearancePlan(e,'tv-human-male-v2'));expect(JSON.stringify(e)).toBe(before);e.appearanceSeed++;const b=appearancePlan(e,'tv-human-male-v2');expect(b.jaw).not.toBe(a.jaw);expect(b.linen).not.toEqual(a.linen);expect(b.requests).toEqual(a.requests);});
 it('does not claim appearance application or wardrobe assembly for unsupported assets',()=>{const p=appearancePlan(entities[0],'tv-human-female-v1');expect(p.supported).toBe(false);expect(p.applied).toEqual([]);expect(p.unresolved).toContain('Equipment assembly');});
});
