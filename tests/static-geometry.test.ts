import {describe,it,expect} from 'vitest';
import {StaticGeometry,capsuleTriangleDistance,type StaticTriangle} from '../src/sim/physical/staticGeometry';
const floor:StaticTriangle[]=[{p:[0,0,0,0,0,8,8,0,0],support:true},{p:[8,0,0,0,0,8,8,0,8],support:true}];
describe('canonical source-triangle support',()=>{
 it('finds fractional ground, rejects unsupported feet and blocks a swept capsule at a thin nongrid wall',()=>{
  const triangles=floor.map(t=>({...t,p:t.p.map((v,i)=>i%3===1?.0625:v)}));triangles.push({p:[2.13,.0625,0,2.13,3,0,2.13,.0625,8],support:false},{p:[2.13,3,0,2.13,3,8,2.13,.0625,8],support:false});
  const g=new StaticGeometry(triangles,{x0:0,z0:0,x1:8,z1:8});expect(g.supportAt(1,1,0)).toBe(.0625);expect(g.fits(1,.0625,1,.3,1.75)).toBe(true);
  expect(g.fits(1.9,.0625,1,.3,1.75)).toBe(false);expect(g.supportAt(-1,1,0)).toBeNull();
  expect(g.lineClear({x:1,y:1,z:1},{x:3,y:1,z:1})).toBe(false);
 });
 it('does not replace a window aperture with a bounding box',()=>{
  const g=new StaticGeometry([...floor,{p:[2,2.4,0,2,3,0,2,2.4,8],support:false},{p:[2,3,0,2,3,8,2,2.4,8],support:false}],{x0:0,z0:0,x1:8,z1:8});
  expect(g.fits(2,0,4,.3,1.75)).toBe(true);expect(g.lineClear({x:1,y:1.6,z:4},{x:3,y:1.6,z:4})).toBe(true);
 });
 it('serializes a bounded geometry window and reconstructs identical support/collision',()=>{
  const g=new StaticGeometry(floor,{x0:0,z0:0,x1:8,z1:8}),w=JSON.parse(JSON.stringify(g.window(0,0,4))),copy=new StaticGeometry(w.triangles,w.bounds);
  expect(copy.supportAt(2,2,0)).toBe(g.supportAt(2,2,0));expect(copy.fits(2,0,2,.3,1.75)).toBe(g.fits(2,0,2,.3,1.75));
 });
 it('detects face, edge and endpoint contacts without moving a body',()=>{
  const t=[2,0,0,2,3,0,2,0,3];expect(capsuleTriangleDistance(1.8,0,1,.3,1.75,t)).toBeCloseTo(.2);expect(capsuleTriangleDistance(2,0,1,.3,1.75,t)).toBe(0);
 });
});
