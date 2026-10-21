import { describe, expect, it } from 'vitest';
import { townLayout, terrainHeight, toLocal, toTown, TOWN_SEED, WALLS } from '../../src/sim/town/layout';
import { TownCollision } from '../../src/sim/town/collision';
import { groundMask } from '../../src/sim/town/groundMask';
import { angleDelta, createPlayer, forwardOf, rightOf, stepPlayer, wishDirection, RUN, WALK } from '../../src/sim/town/movement';
import { boomDirection, clampPitch, clampZoom, collideBoom, easeBoom, orbitInput, shoulderPivot, NEAR_MIN, PITCH_MAX, PITCH_MIN, PROBE, ZOOM_MAX, ZOOM_MIN } from '../../src/sim/town/camera';
import { TownFolk, NPC_RADIUS } from '../../src/sim/town/npcs';

const layout = townLayout(), world = new TownCollision(layout);
const still = { forward: 0, right: 0, run: false };

describe('town layout', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    expect(JSON.stringify(townLayout(TOWN_SEED))).toBe(JSON.stringify(layout));
    expect(JSON.stringify(townLayout(TOWN_SEED + 1).props)).not.toBe(JSON.stringify(layout.props));
  });
  it('places the library spaces, a fountain plaza, houses, stalls, lamps and townsfolk', () => {
    expect(layout.library.map(l => l.assetId)).toContain('tv_31_06_tavern');
    const kinds = new Set(layout.props.map(p => p.kind));
    for (const k of ['fountain', 'house', 'stall', 'lamp', 'barrel', 'crate', 'tree', 'wall', 'fence']) expect(kinds.has(k as never)).toBe(true);
    expect(layout.npcs.length).toBeGreaterThanOrEqual(8);
  });
  it('keeps the town floor flat inside the walls and rolls outside', () => {
    expect(terrainHeight(0, 0)).toBe(0);
    expect(terrainHeight(WALLS.x0 + 1, WALLS.z0 + 1)).toBe(0);
    const outside = [-150, -120, 120, 150].map(x => Math.abs(terrainHeight(x, -20)));
    expect(Math.max(...outside)).toBeGreaterThan(.2);
  });
  it('round-trips placement transforms', () => {
    const p = { x: 12, z: -7, yaw: .7 }, [x, z] = toTown(p, 3, -4), [lx, lz] = toLocal(p, x, z);
    expect(lx).toBeCloseTo(3, 9); expect(lz).toBeCloseTo(-4, 9);
  });
  it('spawns everyone on free ground', () => {
    expect(world.blocked(layout.spawn.x, layout.spawn.z)).toBe(false);
    for (const n of layout.npcs) expect(world.blocked(n.x, n.z, NPC_RADIUS), n.id).toBe(false);
  });
  it('paints a deterministic ground mask with cobbles on the plaza and grass in the meadow', () => {
    const a = groundMask(layout, 128), b = groundMask(layout, 128);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    const at = (x: number, z: number) => { const i = Math.floor((x - a.x0) / a.size * a.n), k = Math.floor((z - a.z0) / a.size * a.n); return a.data.slice((k * a.n + i) * 4, (k * a.n + i) * 4 + 4); };
    expect(at(0, 8)[1]).toBeGreaterThan(200);
    expect(at(-120, -140)[1]).toBe(0);
  });
});

describe('town collision', () => {
  it('blocks walls, fountain and the playable ring, and slides along obstacles', () => {
    expect(world.blocked(0, 0)).toBe(true); // fountain
    expect(world.blocked(layout.bounds.x + layout.bounds.r + 1, layout.bounds.z)).toBe(true);
    // Walking into the fountain at an angle slides around it rather than stopping dead.
    const [x, z] = world.move(-.5, -6, .6, 4, .35);
    expect(world.blocked(x, z)).toBe(false);
    expect(Math.hypot(x, z)).toBeGreaterThan(3.4 + .35 - 1e-6);
    expect(Math.abs(x + .5) + Math.abs(z + 6)).toBeGreaterThan(.5);
  });
  it('never lets a body end inside a collider over a long random walk', () => {
    let x = layout.spawn.x, z = layout.spawn.z, s = 1;
    for (let i = 0; i < 3000; i++) { s = (s * 16807) % 2147483647; const a = s / 2147483647 * Math.PI * 2; [x, z] = world.move(x, z, Math.sin(a) * .5, Math.cos(a) * .5 + .05, .35); expect(world.blocked(x, z, .35)).toBe(false); }
  });
});

describe('player movement', () => {
  const W = { move: (x: number, z: number, dx: number, dz: number, r: number) => world.move(x, z, dx, dz, r), groundAt: (x: number, z: number) => world.groundAt(x, z) };
  it('moves relative to the camera yaw', () => {
    const [fx, fz] = wishDirection({ forward: 1, right: 0, run: false }, 0); expect(fx).toBeCloseTo(0); expect(fz).toBeCloseTo(1);
    const [rx, rz] = wishDirection({ forward: 0, right: 1, run: false }, Math.PI / 2); expect(rx).toBeCloseTo(0); expect(rz).toBeCloseTo(1);
    // Right is perpendicular to forward and on the camera's right (forward × up).
    const f = forwardOf(.4), r = rightOf(.4); expect(f[0] * r[0] + f[1] * r[1]).toBeCloseTo(0);
    let p = createPlayer(0, -84, 0, W);
    for (let i = 0; i < 60; i++) p = stepPlayer(p, { forward: 1, right: 0, run: false }, 0, 1 / 60, W);
    expect(p.z).toBeGreaterThan(-84 + 1.5); expect(Math.abs(p.x)).toBeLessThan(.05);
    expect(p.speed).toBeCloseTo(WALK, 1);
    for (let i = 0; i < 60; i++) p = stepPlayer(p, { forward: 0, right: 0, run: true }, 0, 1 / 60, W);
    expect(p.speed).toBe(0);
    expect(RUN).toBeGreaterThan(WALK);
  });
  it('walks to a clicked target and stops there; keys cancel the target', () => {
    let p = { ...createPlayer(0, -84, 0, W), target: { x: 4, z: -80 } };
    for (let i = 0; i < 600 && p.target; i++) p = stepPlayer(p, still, 0, 1 / 60, W);
    expect(p.target).toBeNull(); expect(Math.hypot(p.x - 4, p.z + 80)).toBeLessThan(.3);
    p = stepPlayer({ ...p, target: { x: 10, z: -60 } }, { forward: 1, right: 0, run: false }, 0, 1 / 60, W);
    expect(p.target).toBeNull();
  });
  it('drops a click target it cannot reach (walking into the fountain)', () => {
    let p = { ...createPlayer(0, -8, 0, W), target: { x: 0, z: 0 } };
    for (let i = 0; i < 600 && p.target; i++) p = stepPlayer(p, still, 0, 1 / 60, W);
    expect(p.target).toBeNull(); expect(world.blocked(p.x, p.z)).toBe(false);
  });
  it('turns the short way', () => { expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6); expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI); });
});

describe('third-person camera math', () => {
  it('clamps pitch and zoom', () => {
    expect(clampPitch(9)).toBe(PITCH_MAX); expect(clampPitch(-9)).toBe(PITCH_MIN);
    expect(clampZoom(0)).toBe(ZOOM_MIN); expect(clampZoom(99)).toBe(ZOOM_MAX);
    const o = orbitInput({ yaw: 0, pitch: 0, zoom: 5 }, 0, 10000, 100000); expect(o.pitch).toBe(PITCH_MAX); expect(o.zoom).toBe(ZOOM_MAX);
  });
  it('puts the boom behind the view direction and above when pitched down', () => {
    const [x, y, z] = boomDirection(0, .3); expect(z).toBeLessThan(0); expect(y).toBeGreaterThan(0); expect(Math.hypot(x, y, z)).toBeCloseTo(1);
  });
  it('offsets the pivot over the right shoulder', () => {
    const [px, , pz] = shoulderPivot(0, 0, 0, 0, 3), r = rightOf(0); expect(px * r[0] + pz * r[1]).toBeGreaterThan(.2);
  });
  it('pulls the boom in front of a hit, never through it, and eases back out', () => {
    expect(collideBoom(6, null)).toBe(6);
    expect(collideBoom(6, 2)).toBeCloseTo(2 - PROBE); expect(collideBoom(6, 2)).toBeLessThan(2);
    expect(collideBoom(6, .1)).toBe(NEAR_MIN);
    expect(easeBoom(6, 2, 1 / 60)).toBe(2); // in at once
    const out = easeBoom(2, 6, 1 / 60); expect(out).toBeGreaterThan(2); expect(out).toBeLessThan(2.5);
  });
});

describe('townsfolk', () => {
  const W = { blocked: (x: number, z: number, r: number) => world.blocked(x, z, r), move: (x: number, z: number, dx: number, dz: number, r: number) => world.move(x, z, dx, dz, r) };
  it('is deterministic for a seed and tick count', () => {
    const a = new TownFolk(layout.npcs, W, TOWN_SEED), b = new TownFolk(layout.npcs, W, TOWN_SEED);
    a.advanceTo(600); b.advanceTo(300); b.advanceTo(600);
    expect(JSON.stringify(a.states)).toBe(JSON.stringify(b.states));
  });
  it('wanders without entering colliders, vendors staying near their stalls', () => {
    const f = new TownFolk(layout.npcs, W, TOWN_SEED), start = f.states.map(s => ({ ...s }));
    for (let t = 0; t < 1200; t++) { f.step(); for (const s of f.states) expect(world.blocked(s.x, s.z, NPC_RADIUS - .01)).toBe(false); }
    const moved = f.states.filter((s, i) => Math.hypot(s.x - start[i].x, s.z - start[i].z) > .5).length;
    expect(moved).toBeGreaterThan(layout.npcs.length / 2);
    layout.npcs.forEach((n, i) => { if (n.role === 'vendor') expect(Math.hypot(f.states[i].x - n.x, f.states[i].z - n.z)).toBeLessThan(n.radius + .5); });
  });
});
