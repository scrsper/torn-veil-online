import { beforeAll, describe, expect, test } from 'vitest';
import { World } from '../src/sim/core/world';
import { WorldGeography } from '../src/sim/world/geography';
import { BridgeSession } from '../src/bridge/session';
import { projectRegion, RegionStream } from '../src/bridge/regions';
import { serialize, deserialize } from '../src/sim/persist/save';
import { B } from '../src/sim/physical/blocks';
import { moveByIntent } from '../src/sim/physical/input';
import { knownName } from '../src/sim/mind/people';
import { createHash } from 'node:crypto';
const digest = (w: World) => { const data = JSON.parse(serialize(w)); delete data.savedAt; return createHash('sha256').update(JSON.stringify(data)).digest('hex'); };

describe('continuous seeded world', () => {
  let session: BridgeSession, w: World;
  beforeAll(() => { session = new BridgeSession(918271, { playable: true }); w = session.world; }, 30000);
  test('one geography, registry and clock, distinct living settlements and meaningful routes', () => {
    expect(w.grid.W).toBe(24576); expect(w.grid.D).toBe(24576);
    expect(w.settlements()).toHaveLength(7); expect(w.livingPersons().length).toBeGreaterThan(100);
    expect(new Set(w.settlements().map(s => s.formerInhabitantIds.length)).size).toBeGreaterThan(1);
    expect(w.geography!.roads.some(r => r.length > 1000)).toBe(true);
    expect(session.sim.world).toBe(w); expect(session.scene()).toHaveProperty('regional', true);
  });
  test('local seeds reproduce untouched regions in either visitation order and diverge across world seeds', () => {
    const a = new WorldGeography(918271), b = new WorldGeography(918271), other = new WorldGeography(7239);
    const samples = [[4, 2], [60, 30], [30, 60], [92, 90]];
    const first = samples.map(([x,z]) => a.resources(x,z));
    for (const [x,z] of samples.slice().reverse()) b.resources(x,z);
    expect(samples.map(([x,z]) => b.resources(x,z))).toEqual(first);
    expect(a.sites).toEqual(b.sites); expect(a.roads).toEqual(b.roads);
    expect(a.sites).not.toEqual(other.sites);
    expect(samples.map(([x,z])=>a.surface(x*256,z*256))).not.toEqual(samples.map(([x,z])=>other.surface(x*256,z*256)));
  }, 30000);
  test('region edges share canonical samples and projection is read-only', () => {
    const before = digest(w), a = projectRegion(w, 4, 2), b = projectRegion(w, 5, 2);
    expect(a.terrain.columns.filter(c=>c[0]===1280)).toEqual(b.terrain.columns.filter(c=>c[0]===1280));
    expect(digest(w)).toBe(before);
    expect(JSON.stringify(a)).not.toMatch(/knowledge|honesty|goal|wealth/);
    expect(a.decoration).toMatchObject({ classification:'decorative', collision:false, gameplay:false });
  });
  test('presentation eviction cannot mutate resources, dropped items, history or knowledge', () => {
    const stream = new RegionStream(), p = w.person(w.playerId)!, body = w.primaryBody(p.id)!;
    const pos = { ...body.pos }; stream.frame(w);
    const before = digest(w);
    // Developer relocation exercises residency only, and is not travel evidence.
    body.pos.x += 1024; const frame = stream.frame(w)!; expect(frame.unload.length).toBeGreaterThan(0);
    body.pos = pos; stream.frame(w); expect(digest(w)).toBe(before);
  });
  test('region overlays and externally controlled Person survive save/load/reconnect', () => {
    const g = w.grid, x = 450, z = 450, y = g.groundHeight(x,z), old = g.get(x,y,z);
    g.set(x,y,z,B.Gravel);
    const raw = serialize(w), loaded = deserialize(raw)!.world;
    expect(loaded.grid.get(x,y,z)).toBe(B.Gravel);
    expect(loaded.now).toBe(w.now); expect(loaded.events).toEqual(w.events);
    expect(loaded.wildernessRegions).toEqual(w.wildernessRegions);
    expect(loaded.resourceNodes).toEqual(w.resourceNodes);
    const reconnect = new BridgeSession(0,{save:raw}); expect(reconnect.world.playerId).toBe(w.playerId);
    expect(reconnect.regions.frame(reconnect.world)!.regions.length).toBeLessThanOrEqual(9);
    expect(loaded.geography!.roads).toEqual(w.geography!.roads);
    g.set(x,y,z,old);
  },30000);
  test('canonical surface changes invalidate resident terrain while unchanged frames reuse it',()=>{
    const stream=new RegionStream(), pos=w.positionOf(w.playerId!)!, x=Math.floor(pos.x/8)*8,z=Math.floor(pos.z/8)*8,rx=Math.floor(x/256),rz=Math.floor(z/256);
    stream.frame(w); expect(stream.frame(w)!.regions).toHaveLength(0);
    const y=w.grid.groundHeight(x,z),old=w.grid.get(x,y,z); w.grid.set(x,y,z,B.Gravel);
    const frame=stream.frame(w)!; expect(frame.regions.some(r=>r.id===`${rx},${rz}`)).toBe(true);
    expect(frame.regions.find(r=>r.id===`${rx},${rz}`)!.terrain.columns.find(c=>c[0]===x&&c[1]===z)![3]).toBe(B.Gravel);
    expect(stream.frame(w)!.regions).toHaveLength(0); w.grid.set(x,y,z,old);
  });
  test('ordinary movement changes canonical position, time and physiology without teaching distant identity', () => {
    const p = w.person(w.playerId)!, body = w.primaryBody(p.id)!, start = { ...body.pos }, physiology = { ...p.physiology }, now = w.now;
    let seq = 0;
    for (let i=0;i<300;i++) { session.intent({version:1,sequence:++seq,type:'move',x:-1,z:0}); session.step(.05); }
    expect(body.pos.x).toBeLessThan(start.x-10); expect(w.now).toBeGreaterThan(now);
    expect(p.physiology.hydration).toBeLessThan(physiology.hydration);
    for (const s of w.settlements().filter(s=>Math.hypot(s.location.x-body.pos.x,s.location.z-body.pos.z)>1000)) {
      const resident = w.person(s.formerInhabitantIds[0])!;
      expect(knownName(resident,p.id)).not.toBe(p.name); expect(resident.knowledge[`identity:${p.id}`]).toBeUndefined();
    }
    const pos = {...body.pos}; moveByIntent(session.sim,p,body,NaN,0,false,.05); expect(body.pos).toEqual(pos);
  },30000);
});
