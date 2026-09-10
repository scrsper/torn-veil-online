import { describe, expect, it } from 'vitest';
import { B } from '../src/sim/physical/blocks';
import { addPerson, createTestWorld, step, v } from './helpers/world';
import { learnPlace } from '../src/sim/mind/knowledge';
import { syncNeeds } from '../src/sim/core/physiology';
import { makePlace } from '../src/sim/world/factory';
import { createFields } from '../src/sim/world/metabolism';

describe('Navigator.findPath', () => {
  it('refreshes navigation when field initialization clears an obstructed crop cell', () => {
    const {world}=createTestWorld(65,14);
    const farm=makePlace(world,'farm','Farm',{x0:3,z0:3,x1:8,z1:8,y0:1,y1:4},{inside:v(4,1,4)});
    world.grid.set(5,0,5,B.Farmland); world.grid.set(5,1,5,B.Fence);
    world.nav.rebuildArea(5,5,5,5);
    expect(world.nav.floorY(5,5)).toBe(-1);
    createFields(world,[{placeId:farm.id,ownerId:null,startMoisture:0.7}]);
    expect(world.grid.get(5,1,5)).toBe(B.Air);
    expect(world.nav.floorY(5,5)).toBe(1);
    expect(world.nav.canStepTo(v(5.5,1,5.5),5.6,5.5)).toBe(true);
  });

  it.each(['sleep','sit'] as const)('does not snap a resting body onto an inaccessible %s anchor column', action => {
    const tw=createTestWorld(64,14), {world}=tw;
    for(let y=1;y<5;y++)world.grid.set(6,y,5,B.Stone);
    world.nav.rebuildArea(6,5,6,5);
    const person=addPerson(tw,'Resting person','villager',v(5.5,1,5.5));
    person.mind.thinkInterval=1000; person.mind.thinkBudget=0;
    person.mind.goal={type:'sleep',key:'sleep',utility:0.5,reasons:[],createdAt:world.now};
    person.mind.plan=[{type:action,status:'active',pos:v(6.5,1,5.5),duration:3600,startedAt:world.now}];
    step(tw,0.15);
    expect(world.positionOf(person.id)).toEqual(v(5.5,1,5.5));
  });

  it('does not let crowd separation push a walker onto an inaccessible raised surface', () => {
    const tw=createTestWorld(63,14), {world}=tw;
    for(let z=2;z<12;z++)for(let y=1;y<4;y++)world.grid.set(5,y,z,B.Stone);
    world.nav.rebuildArea(5,2,5,11);
    const walker=addPerson(tw,'Walker','villager',v(4.99,1,4.5));
    addPerson(tw,'Neighbour','villager',v(4.6,1,4.5),{controlled:true});
    const body=world.primaryBody(walker.id)!, destination=v(4.5,1,8.5);
    walker.mind.thinkInterval=1000; walker.mind.thinkBudget=0;
    walker.mind.goal={type:'wander',key:'wander',utility:0.5,reasons:[],createdAt:world.now};
    walker.mind.plan=[{type:'goto',status:'active',pos:destination,startedAt:world.now}];
    body.path=[destination]; body.pathIndex=0; body.pathGoal=destination;
    step(tw,0.15);
    expect(body.pos.x).toBeLessThan(5);
    expect(body.pos.y).toBe(1);
    expect(body.pos.z).toBeGreaterThan(4.5);
  });

  it('approaches a counter at the requested ground height rather than targeting its inaccessible top', () => {
    const {world}=createTestWorld(62,14), start=v(2.5,1,3.5), counter=v(10.5,1,3.5);
    world.grid.set(10,1,3,B.Stone); world.grid.set(10,2,3,B.Stone);
    world.nav.rebuildArea(9,2,11,4);
    expect(world.nav.floorY(10,3)).toBe(3);
    const path=world.nav.findPath(start,counter);
    expect(path).not.toBeNull();
    expect(path!.at(-1)!.y).toBe(1);
    expect(Math.hypot(path!.at(-1)!.x-counter.x,path!.at(-1)!.z-counter.z)).toBeLessThan(3);
    // These are different destinations even though they have the same horizontal column.
    expect(world.nav.findPath(start,v(10.5,3,3.5))).toBeNull();
  });

  it('does not execute a remote meal or invent an empty-shelf observation after travel fails', () => {
    const tw=createTestWorld(), {world}=tw;
    const shop=world.place(tw.places.tavern)!;
    const buyer=addPerson(tw,'Buyer','villager',v(5,1,5),{homeId:tw.places.chapel,traits:{sociability:0,piety:0}});
    buyer.schedule=[]; buyer.physiology.energy=0; syncNeeds(buyer);
    learnPlace(world,buyer,shop,{type:'prior'});
    for(let z=0;z<world.grid.D;z++)for(let y=1;y<world.grid.H;y++)world.grid.set(20,y,z,B.Stone);
    world.nav.rebuildArea(20,0,20,world.grid.D-1);
    step(tw,5);
    expect(world.events.some(e=>e.type==='path_failure'&&e.actor===buyer.id)).toBe(true);
    expect(buyer.knowledge[`food-access:${shop.id}`]).toBeUndefined();
    expect(world.events.some(e=>e.type==='resource_shortage'&&e.actor===buyer.id&&e.placeId===shop.id)).toBe(false);
  });

  it('caches exact results without sharing mutable paths and invalidates when terrain changes', () => {
    const { world } = createTestWorld(61, 14), a = v(2.5, 1, 3.5), b = v(10.5, 1, 3.5);
    const first = world.nav.findPath(a, b)!;
    const expected = structuredClone(first);
    first[0].x = -100;
    expect(world.nav.findPath(a, b)).toEqual(expected);
    expect(world.nav.cacheHits).toBe(1);
    const before = world.nav.searches;
    for (let z = 0; z < world.grid.D; z++) for (let y = 1; y < world.grid.H; y++) world.grid.set(6, y, z, B.Stone);
    world.nav.rebuildArea(6, 0, 6, world.grid.D - 1);
    expect(world.nav.findPath(a, b)).toBeNull();
    expect(world.nav.searches).toBe(before + 1);
    expect(world.nav.findPath(a, b)).toBeNull();
    for (let y = 1; y < world.grid.H; y++) world.grid.set(6, y, 3, B.Air);
    world.nav.rebuildArea(6, 3, 6, 3);
    expect(world.nav.findPath(a, b)).not.toBeNull();
  });
  it('actually uses a nearby walkable start when the supplied start cell is blocked', () => {
    const tw = createTestWorld(61, 14);
    for (let y = 1; y < tw.world.grid.H; y++) tw.world.grid.set(3, y, 3, B.Stone);
    tw.world.nav.rebuildArea(2, 2, 4, 4);
    expect(tw.world.nav.isWalkable(3, 3)).toBe(false);

    const path = tw.world.nav.findPath(v(3.5, 1, 3.5), v(10.5, 1, 3.5));
    expect(path).not.toBeNull();
    expect(path?.at(-1)).toMatchObject({ x: 10.5, z: 3.5 });
  });
});
