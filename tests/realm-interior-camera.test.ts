import { describe, expect, it } from 'vitest';
import { InteriorCameraFraming, cameraBoxBlocked,interiorDetailFov } from '../src/web/realms/interiorCamera';
import { voxelSolid, boxObstruction } from '../src/web/realms/cameraSolids';
import { planInterior, interiorVoxel } from '../src/sim/world/interiors/layout';
import { B } from '../src/sim/physical/blocks';

const pitch=38*Math.PI/180;
describe('readable close-wall interior camera',()=>{
  it('keeps a raised full human readable while respecting intentional wide zoom',()=>{
    const pose={position:{x:4,y:7.2,z:0},target:{x:0,y:2.04,z:0},fov:52*Math.PI/180},feet={x:0,y:1,z:0};
    const lens=interiorDetailFov(pose,feet,1.68,4);expect(lens).toBeLessThan(pose.fov);expect(lens).toBeGreaterThanOrEqual(24*Math.PI/180);
    expect(interiorDetailFov(pose,feet,1.68,18)).toBe(pose.fov);
  });
  it('keeps a free orbit untouched away from obstructions, including chosen near zoom',()=>{
    const framing=new InteriorCameraFraming(),pivot={x:0,y:2.3,z:0};
    for(const radius of [3,10.5,18]){
      framing.reset();const raw={position:{x:0,y:pivot.y+.1+Math.sin(pitch)*radius,z:Math.cos(pitch)*radius},target:pivot,fov:1};
      expect(framing.update(raw,pivot,[],{yaw:0,pitch,want:radius,limit:radius+.4},1/60)).toEqual(raw);
    }
  });
  it('raises a zero-clearance pose above the wall without changing requested yaw',()=>{
    const solids=[{x:0,y:1,z:-8,w:1,h:5,d:16}],pivot={x:1.15,y:2.3,z:0},framing=new InteriorCameraFraming();
    for(const yaw of [-Math.PI/2,0,Math.PI/2,Math.PI]){
      const pose=framing.update({position:pivot,target:pivot,fov:1},pivot,solids,{yaw,pitch,want:10.5,limit:0},1/60);
      expect(cameraBoxBlocked(pose.position,solids)).toBe(false);
      expect(Math.hypot(pose.position.x-pivot.x,pose.position.y-pivot.y,pose.position.z-pivot.z)).toBeGreaterThanOrEqual(3);
      expect(pose.position.y).toBeGreaterThan(6.35);expect(pose.target).toEqual(pivot);
    }
  });
  it('uses a clear vertical bridge when a change of orbit would cross a corner',()=>{
    const solids=[{x:-.5,y:1,z:0,w:1,h:5,d:1}],pivot={x:0,y:2.3,z:-2},framing=new InteriorCameraFraming();
    const a=framing.update({position:{x:-4,y:2.5,z:.5},target:pivot,fov:1},pivot,solids,{yaw:-1,pitch:.2,want:5,limit:5.4},1/60);
    const b=framing.update({position:{x:4,y:2.5,z:.5},target:pivot,fov:1},pivot,solids,{yaw:1,pitch:.2,want:5,limit:5.4},1/60);
    expect(b.position.x).toBe(a.position.x);expect(b.position.z).toBe(a.position.z);expect(b.position.y).toBeGreaterThan(6.35);
    expect(cameraBoxBlocked(b.position,solids)).toBe(false);
  });
  it('retains minimum readable distance and lens clearance beside real seeded walls and corners',()=>{
    for(const floor of [1,25,50,100]){
      const plan=planInterior({version:1,id:`camera:${floor}`,buildingId:'qa:tower',seed:918271,floor,slot:0}),solids=plan.solids.map(voxelSolid).filter(s=>s.kind==='wall'),query=boxObstruction(()=>solids);
      const positions=[];
      for(let x=plan.origin.x-plan.half;x<plan.origin.x+plan.half;x++)for(let z=plan.origin.z-plan.half;z<plan.origin.z+plan.half;z++)
        if(interiorVoxel(plan,x,2,z)!==B.Stone && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>interiorVoxel(plan,x+dx,2,z+dz)===B.Stone))positions.push({x:x+.5,y:2.3,z:z+.5});
      expect(positions.length).toBeGreaterThan(10);
      for(const pivot of positions.filter((_,i)=>i%7===0))for(const angle of [8,38,60]){
        const framing=new InteriorCameraFraming(),p=angle*Math.PI/180;
        for(let n=0;n<24;n++){
          const yaw=n*Math.PI/12,dir={x:Math.sin(yaw)*Math.cos(p),y:Math.sin(p),z:Math.cos(yaw)*Math.cos(p)},eye={...pivot,y:pivot.y+.1},limit=query(eye,dir,10.9),d=Math.min(10.5,limit);
          const raw={position:{x:eye.x+dir.x*d,y:eye.y+dir.y*d,z:eye.z+dir.z*d},target:pivot,fov:1};
          const pose=framing.update(raw,pivot,solids,{yaw,pitch:p,want:10.5,limit},1/60);
          expect(cameraBoxBlocked(pose.position,solids)).toBe(false);
          expect(Math.hypot(pose.position.x-pivot.x,pose.position.y-pivot.y,pose.position.z-pivot.z)).toBeGreaterThanOrEqual(3);
          expect([pose.position.x,pose.position.y,pose.position.z,pose.target.x,pose.target.y,pose.target.z].every(Number.isFinite)).toBe(true);
        }
      }
    }
  });
  it('copies getter-based render pivots in the elevated and recovery paths',()=>{
    class Pivot{get x(){return 2;}get y(){return 2.3;}get z(){return 3;}}
    const pivot=new Pivot(),framing=new InteriorCameraFraming(),raw={position:{x:2,y:2.4,z:3},target:{x:2,y:2.3,z:3},fov:1};
    const pose=framing.update(raw,pivot,[{x:0,y:1,z:0,w:1,h:5,d:1}],{yaw:0,pitch,want:10.5,limit:0},1/60);
    expect(pose.target).toEqual({x:2,y:2.3,z:3});
  });
});
