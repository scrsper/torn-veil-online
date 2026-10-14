import { Mesh, Plane, Scene, TransformNode } from '@babylonjs/core';
import { B } from '../../sim/physical/blocks';
import type { MaterialLibrary } from '../render/materials';
import { hash2 } from '../render/noise';
import type { PlaceProjection, RegionProjection } from '../net/messages';
import { MeshBatch } from './meshBatch';
import { COLORS, PropBuilder, furnishing } from './propGeometry';
import type { Cells } from './structures';
import type { WorldLight } from './structures';
import { buildBuildingDressing } from './buildingDressing';
import { buildPaths } from './paths';

/**
 * Static, region-owned props from the projection: furniture (turned against the real walls),
 * fences, worn path decals and doors. Furniture is placed exactly where the simulation says; only
 * its style is authored here.
 */
export interface DoorHandle {
  key: string; cell: { x: number; y: number; z: number }; node: TransformNode; open: number; target: number; direction: 1 | -1; alongX: boolean;
}
export interface StaticProps { meshes: Mesh[]; lights: WorldLight[]; doors: DoorHandle[]; root: TransformNode }

const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function buildStaticProps(scene: Scene, mats: MaterialLibrary, r: RegionProjection, cells: Cells | null, parent: TransformNode, heightAt?: (x: number, z: number) => number): StaticProps {
  const x0 = r.bounds.x0, z0 = r.bounds.z0, out: StaticProps = { meshes: [], lights: [], doors: [], root: new TransformNode(`props-${r.id}`, scene) };
  out.root.parent = parent;
  const props = new MeshBatch(), fenceBatch = new MeshBatch();
  const overhead = new Map<string,{batch:MeshBatch;place:PlaceProjection}>();

  const wallDir = (x: number, y: number, z: number): [number, number] | null => {
    if (!cells) return null;
    for (const [dx, dz] of NEIGHBOURS) if (cells.get(x + dx, y, z + dz) !== 0) return [dx, dz];
    return null;
  };
  r.furnishings.forEach((f, i) => {
    const cx = f.pos.x + 0.5 - x0, cz = f.pos.z + 0.5 - z0, y = f.pos.y, seed = (f.pos.x * 31 + f.pos.z * 17 + f.pos.y) | 0;
    let yaw = (f.yaw * Math.PI) / 180, scale = 1;
    const wd = wallDir(f.pos.x, f.pos.y, f.pos.z);
    switch (f.role) {
      case 'chair': yaw = -yaw - Math.PI / 2; break;
      case 'bed': yaw = wd ? Math.atan2(-wd[0], -wd[1]) : 0; scale = 1; break;
      case 'shelf': yaw = wd ? Math.atan2(wd[0], wd[1]) : yaw; break;
      case 'sign': case 'bench': case 'table': case 'counter': yaw = yaw; break;
      default: yaw = yaw + (hash2(seed, i, 3) - 0.5) * 0.3;
    }
    const place = r.places.find(p=>p.indoor&&f.pos.x>=p.bounds.x0&&f.pos.x<=p.bounds.x1&&f.pos.z>=p.bounds.z0&&f.pos.z<=p.bounds.z1);
    let target=props;
    if(f.role==='lantern'&&place) {
      let owned=overhead.get(place.id);if(!owned){owned={batch:new MeshBatch(),place};overhead.set(place.id,owned);}target=owned.batch;
    }
    const b = new PropBuilder(target, cx, f.role === 'lantern' ? y + 0.55 : y, cz, yaw, scale);
    const res = furnishing(f.role, b, seed, place?.type);
    if(f.role==='lantern'&&place) {
      // Attach to the existing room's roof support; the complete fitting shares
      // that building's cutaway so hanging lamps do not float above an open room.
      const top=place.bounds.y0+place.wallHeight;
      if(top>y+1.2) b.cyl(0,.66,0,.012,top-y-1.21,COLORS.iron,5);
    }
    if (res.light) out.lights.push({ x: cx, y: (f.role === 'lantern' ? y + 0.55 : y) + res.light.y, z: cz, color: res.light.color, intensity: res.light.intensity, range: res.light.range, kind: 'torch' });
  });

  const fenceAt = new Set(r.fences.map(([x, y, z]) => `${x},${y},${z}`));
  for (const [x, y, z] of r.fences) {
    const lx = x + 0.5 - x0, lz = z + 0.5 - z0, w = COLORS.oak, seed = x * 7 + z;
    const wobble = (hash2(seed, 2, 9) - 0.5) * 0.06;
    const post = new PropBuilder(fenceBatch, lx + wobble, y, lz, 0);
    post.box(-0.06, 0, -0.06, 0.12, 1.02, 0.12, [w[0] * 0.8, w[1] * 0.8, w[2] * 0.8]); post.box(-0.08, 1.02, -0.08, 0.16, 0.05, 0.16, [w[0] * 0.6, w[1] * 0.6, w[2] * 0.6]);
    for (const [dx, dz] of [[1, 0], [0, 1]]) if (fenceAt.has(`${x + dx},${y},${z + dz}`)) {
      for (const h of [0.34, 0.72]) {
        const rb = new PropBuilder(fenceBatch, lx + dx * 0.5, y + h, lz + dz * 0.5, 0);
        if (dx) rb.box(-0.5, 0, -0.035, 1, 0.09, 0.07, w); else rb.box(-0.035, 0, -0.5, 0.07, 0.09, 1, w);
      }
    }
  }

  const propsMesh = props.build(`furniture-${r.id}`, scene, mats.get('props'), { receiveShadow: true }); if (propsMesh) { propsMesh.parent = out.root; out.meshes.push(propsMesh); }
  for(const [id,{batch,place}] of overhead){
    const mesh=batch.build(`fittings-${r.id}-${id}`,scene,mats.get('props'),{receiveShadow:true});
    if(mesh){const mat=mats.clone('props',mesh.name+'-cutaway');mat.clipPlane=new Plane(0,1,0,-1e8);mesh.material=mat;mesh.metadata={cutawayBounds:place.bounds,ownsCutawayMaterial:true};mesh.parent=out.root;out.meshes.push(mesh);}
  }
  const fenceMesh = fenceBatch.build(`fences-${r.id}`, scene, mats.get('props'), { receiveShadow: true }); if (fenceMesh) { fenceMesh.parent = out.root; out.meshes.push(fenceMesh); }
  const paths = buildPaths(scene, mats, r, heightAt);
  if (paths) { paths.parent = out.root; out.meshes.push(paths); }
  if (heightAt) {
    const pathCells = new Set(r.paths.map(([x,,z]) => x*100003+z));
    for (const place of r.places) for (const mesh of buildBuildingDressing(scene,mats,place,cells,{regionX0:x0,regionZ0:z0,heightAt,pathCells})) {
      mesh.parent = out.root; out.meshes.push(mesh);
    }
  }

  for (const [x, y, z, open] of r.openings) {
    const alongX = cells ? (cells.get(x - 1, y + 1, z) !== 0 && cells.get(x + 1, y + 1, z) !== 0) : true;
    // Swing away from the side that has more free space: outward from the building.
    const place = r.places.find(p => p.door && Math.abs(p.door.x - x) + Math.abs(p.door.z - z) === 1)
      ?? r.places.find(p => p.indoor && x >= p.bounds.x0 && x <= p.bounds.x1 && z >= p.bounds.z0 && z <= p.bounds.z1 && y >= p.bounds.y0 && y <= p.bounds.y1);
    const door = buildDoor(scene, mats, r, x, y, z, alongX, out.root, out.meshes, place?.indoor ? place.bounds : undefined);
    let direction: 1 | -1 = 1;
    if (place?.door) direction = alongX ? (place.door.z < z ? -1 : 1) : (place.door.x < x ? 1 : -1);
    door.direction = direction; door.open = door.target = open ? 1 : 0; applyDoor(door);
    out.doors.push(door);
  }
  return out;
}

function buildDoor(scene: Scene, mats: MaterialLibrary, r: RegionProjection, x: number, y: number, z: number, alongX: boolean, parent: TransformNode, meshes: Mesh[], bounds?: PlaceProjection['bounds']): DoorHandle {
  const lx = x - r.bounds.x0, lz = z - r.bounds.z0;
  const frame = new MeshBatch(), dk = COLORS.darkOak, t = 0.12;
  const fb = new PropBuilder(frame, lx + 0.5, y, lz + 0.5, alongX ? 0 : Math.PI / 2);
  fb.box(-0.5, 0, -0.56, t, 2.14, 1.12, dk); fb.box(0.5 - t, 0, -0.56, t, 2.14, 1.12, dk); fb.box(-0.5, 2.0, -0.56, 1, 0.14, 1.12, dk);
  fb.box(-0.62, 0, 0.5, 1.24, 0.09, 0.62, COLORS.stone); fb.box(-0.62, 0, -1.12, 1.24, 0.09, 0.62, COLORS.stone);
  const frameMesh = frame.build(`door-frame-${x}-${y}-${z}`, scene, mats.get('props'), { receiveShadow: true }); if (frameMesh) frameMesh.parent = parent;
  // Leaf: hinged at the low-coordinate jamb, built along +x from the pivot.
  const node = new TransformNode(`door-${x}-${y}-${z}`, scene); node.parent = parent;
  const leaf = new MeshBatch(), lb = new PropBuilder(leaf, 0, 0, 0, 0);
  lb.box(0, 0.02, -0.045, 0.86, 1.98, 0.09, COLORS.pine);
  for (const h of [0.35, 1.0, 1.65]) lb.box(0, h, -0.055, 0.86, 0.09, 0.11, COLORS.iron);
  for (let i = 1; i < 5; i++) lb.box(i * 0.172 - 0.006, 0.05, -0.05, 0.012, 1.9, 0.1, [0.6, 0.45, 0.28]);
  lb.cbox(0.74, 0.95, -0.08, 0.05, 0.05, 0.06, COLORS.brass); lb.box(0.74, 0.95, 0.03, 0.05, 0.05, 0.03, COLORS.brass);
  const leafMesh = leaf.build(`door-leaf-${x}-${y}-${z}`, scene, mats.get('props'), { receiveShadow: true }); if (leafMesh) leafMesh.parent = node;
  // Door geometry participates in the same region-owned cutaway as its building.
  // Clipping is presentation only; the canonical opening and swing state stay intact.
  for (const mesh of [frameMesh, leafMesh]) if (mesh) {
    if (bounds) {
      const material = mesh.material!.clone(mesh.name + '-cutaway')!;
      material.clipPlane = new Plane(0, 1, 0, -1e8);
      mesh.material = material;
      mesh.metadata = { cutawayBounds: bounds, ownsCutawayMaterial: true };
    }
    meshes.push(mesh);
  }
  // Hinge position in region space: half a cell along the wall from the cell centre.
  const hx = lx + 0.5 + (alongX ? -0.43 : 0), hz = lz + 0.5 + (alongX ? 0 : -0.43);
  node.position.set(hx, y, hz);
  return { key: `${x},${y},${z}`, cell: { x, y, z }, node, open: 0, target: 0, direction: 1, alongX };
}
export function applyDoor(d: DoorHandle): void {
  d.node.rotation.y = (d.alongX ? 0 : -Math.PI / 2) + d.direction * d.open * 1.75;
}
/** Advance door swing toward its target; returns true while moving. */
export function stepDoors(doors: DoorHandle[], dt: number): boolean {
  let moving = false;
  for (const d of doors) {
    if (Math.abs(d.open - d.target) > 0.002) { d.open += (d.target - d.open) * Math.min(1, dt * 7); moving = true; if (Math.abs(d.open - d.target) <= 0.002) d.open = d.target; }
    applyDoor(d);
  }
  return moving;
}
