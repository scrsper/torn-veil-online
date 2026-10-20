import { describe, expect, it } from 'vitest';
import { LIBRARY, LIBRARY_PLACEMENTS, routeX } from '../../src/sim/world/assets/library';
import { footprintBlocked, footprintFloor, libraryContact, libraryFootprint, placementLocalOf } from '../../src/sim/world/assets/libraryCollision';
import { placementDir } from '../../src/sim/world/assets/library';
import { add, scale, surfaceRadius, tangentFrame, planetSpec } from '../../src/sim/world/planet/planet';

const PLACED = ['village_lane', 'market_square', 'tavern', 'gatehouse', 'ravine_bridge', 'watchpost', 'dungeon_junction', 'gate_segment', 'courtyard_passage'];
describe('library GLB collision footprints', () => {
  it('cooks one footprint per placed whole-space asset, bound to its manifest sha256', () => {
    for (const a of LIBRARY.assets.filter(a => PLACED.includes(a.family))) expect(libraryFootprint(a.id), a.id).not.toBeNull();
    for (const a of LIBRARY.assets.filter(a => !PLACED.includes(a.family))) expect(libraryFootprint(a.id), a.id).toBeNull();
  });
  it('keeps every walkable port open at asset ground level', () => {
    for (const a of LIBRARY.assets) {
      const f = libraryFootprint(a.id); if (!f) continue;
      for (const p of a.ports.filter(p => p.kind === 'walkable')) {
        // A step inside the port along its outward normal.
        const x = p.position[0] - p.outward[0] * .6, z = p.position[2] - p.outward[2] * .6;
        expect(footprintBlocked(f, x, z), `${a.id}:${p.id}`).toBe(false);
        expect(footprintFloor(f, x, z)!, `${a.id}:${p.id}`).toBeLessThan(.45);
      }
    }
  });
  it('walls the gatehouse passage and carries the arched bridge deck', () => {
    const gate = LIBRARY.assets.find(a => a.family === 'gatehouse')!, g = libraryFootprint(gate.id)!, rx = routeX(gate);
    // The curtain wall crosses the passage a few metres inside the south port.
    let walls = 0; for (let z = -6; z <= 0; z += .25) { let n = 0; for (let x = rx - 16; x <= rx + 16; x += .25) if (footprintBlocked(g, x, z)) n++; walls = Math.max(walls, n); }
    expect(walls).toBeGreaterThan(40);
    // A lane stays open through the passage (single posts can be walked around).
    for (let z = -17.5; z <= 17.5; z += .25) { let open = false; for (let x = rx - 1.5; x <= rx + 1.5 && !open; x += .25) open = [-.3, 0, .3].every(o => !footprintBlocked(g, x + o, z)); expect(open, `passage z ${z}`).toBe(true); }
    const bridge = LIBRARY.assets.find(a => a.family === 'ravine_bridge')!, b = libraryFootprint(bridge.id)!, px = routeX(bridge);
    let prev = footprintFloor(b, px, -17.5)!; expect(prev).toBeLessThan(.2);
    for (let z = -17; z <= 17.5; z += .5) { const h = footprintFloor(b, px, z)!; expect(Math.abs(h - prev), `z ${z}`).toBeLessThan(.45); expect(footprintBlocked(b, px, z), `z ${z}`).toBe(false); prev = h; }
    expect(footprintFloor(b, px, 0)!).toBeGreaterThan(2);
  });
  it('maps planet points into placement-local frames and reports contact only for shown GLBs', () => {
    const spec = planetSpec(20260416), p = LIBRARY_PLACEMENTS.find(p => p.id === 'home:bridge')!, d = placementDir(spec, p), f = tangentFrame(d);
    const asset = LIBRARY.assets.find(a => a.id === p.assetId)!, px = routeX(asset);
    // Local (px, 0) sits at -px west of the root, i.e. +px east.
    const pos = scale(add(d, scale(f.east, -px / spec.radius)), surfaceRadius(spec, d) + 1);
    const l = placementLocalOf(spec, d, p.yaw, pos); expect(l.x).toBeCloseTo(px, 0); expect(Math.abs(l.z)).toBeLessThan(.5);
    const c = libraryContact(spec, pos, () => true); expect(c.blocked).toBe(false); expect(c.floorRadius! - l.rootR).toBeGreaterThan(2);
    expect(libraryContact(spec, pos, () => false)).toEqual({ blocked: false, floorRadius: null });
  });
});
