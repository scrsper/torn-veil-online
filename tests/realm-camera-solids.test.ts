import { describe, expect, it } from 'vitest';
import { voxelSolid, insideSolid, boxObstruction } from '../src/web/realms/cameraSolids';
import { interiorVoxel, planInterior } from '../src/sim/world/interiors/layout';
import { B } from '../src/sim/physical/blocks';
import { marchObstruction } from '../src/web/game/adaptiveCamera';

describe('received interior camera geometry', () => {
  it('leaves the same neighbouring half-metre cells open as canonical collision', () => {
    const authored={x:10.5,y:1,z:0,w:1,h:5,d:10},physical=voxelSolid(authored),point={x:11.3,y:2.4,z:5};
    expect(insideSolid(authored,point)).toBe(true);
    expect(insideSolid(physical,point)).toBe(false);
    expect(physical).toMatchObject({x:10,y:1,w:1,h:5,d:10}); expect(physical.z).toBeCloseTo(0);
  });
  it('matches the authoritative voxel occupancy throughout seeded floors', () => {
    for (const floor of [1,25,50,100]) {
      const plan=planInterior({version:1,id:`qa:${floor}`,buildingId:'qa:tower',seed:918271,floor,slot:0}),boxes=plan.solids.map(voxelSolid);
      for(let x=plan.origin.x-plan.half;x<plan.origin.x+plan.half;x++)for(let z=plan.origin.z-plan.half;z<plan.origin.z+plan.half;z++){
        const solid=boxes.some(s=>insideSolid(s,{x:x+.5,y:2.5,z:z+.5}));
        expect(solid).toBe(interiorVoxel(plan,x,2,z)===B.Stone);
      }
    }
  });
  it('sweeps continuously through a corner that falls between point samples', () => {
    const boxes=[{x:1.18,y:1,z:1.18,w:.02,h:5,d:.02}],from={x:0,y:2.4,z:0},dir={x:Math.SQRT1_2,y:0,z:Math.SQRT1_2};
    const sampled=marchObstruction((x,y,z)=>boxes.some(s=>insideSolid(s,{x,y,z})),0,.22);
    expect(sampled(from,dir,3)).toBeGreaterThan(2);
    const sweep=boxObstruction(()=>boxes);
    expect(sweep(from,dir,3)).toBeLessThan(1.18*Math.SQRT2);
    expect(sweep(from,{x:-1,y:0,z:0},3)).toBe(3);
    expect(sweep(from,{x:0,y:1,z:0},3)).toBe(3);
  });
});
