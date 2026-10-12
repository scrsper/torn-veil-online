import {describe,it,expect} from 'vitest';
import {StaticGeometry,type StaticTriangle} from '../src/sim/physical/staticGeometry';
import {focusedTerrain,terrainTriangles} from '../src/sim/world/assets/focusedTerrain';
const square=(x:number,y:number):StaticTriangle[]=>[{p:[x,y,0,x,y,8,x+8,y,0],support:true},{p:[x+8,y,0,x,y,8,x+8,y,8],support:true}];
describe('canonical continuous terrain',()=>{
 it('deterministically fills the space between supported assets beneath their existing floors',()=>{
  const source=new StaticGeometry([...square(0,1),...square(12,1)],{x0:0,z0:0,x1:20,z1:8}),t=focusedTerrain('test:terrain',source),g=new StaticGeometry([...source.triangles,...terrainTriangles(t)],t.bounds);
  expect(focusedTerrain(t.id,source)).toEqual(t);expect(g.supportAt(10,4,1)).toBeCloseTo(.96);expect(g.fits(10,.96,4,.3,1.75)).toBe(true);expect(g.supportAt(4,4,1)).toBe(1);
  expect(new StaticGeometry(terrainTriangles(t),t.bounds).sampleGroundAt(4,4,1)).toBeLessThan(1);
 });
});
