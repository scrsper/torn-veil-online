import { Color3, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, TransformNode, type Scene } from '@babylonjs/core';

/** Placeholder figures: the player (a hooded capsule with a facing cue) and townsfolk (capsule
 * bodies in their seeded colours, heads, a few hats). Primitives only, by design. */
const pbr = (scene: Scene, name: string, hex: string | Color3, rough = .85) => {
  const m = new PBRMaterial(name, scene); m.albedoColor = typeof hex === 'string' ? Color3.FromHexString(hex).toLinearSpace() : hex; m.roughness = rough; m.metallic = 0; m.environmentIntensity = .6; return m;
};
export interface Figure { root: TransformNode; body: Mesh; head: Mesh }
export function makeFigure(scene: Scene, name: string, colour: string, opts: { height?: number; hat?: 'hood' | 'brim' | 'cap' | null; skin?: string } = {}): Figure {
  const h = opts.height ?? 1.75, root = new TransformNode(name, scene);
  const body = MeshBuilder.CreateCapsule(`${name}:body`, { height: h * .82, radius: .27, tessellation: 12, subdivisions: 2 }, scene);
  body.position.y = h * .41; body.scaling.set(1, 1, .8); body.material = pbr(scene, `${name}:cloth`, colour); body.parent = root;
  const head = MeshBuilder.CreateSphere(`${name}:head`, { diameter: .3, segments: 10 }, scene);
  head.position.y = h * .87; head.material = pbr(scene, `${name}:skin`, opts.skin ?? '#c99a78', .7); head.parent = root;
  const belt = MeshBuilder.CreateTorus(`${name}:belt`, { diameter: .5, thickness: .06, tessellation: 16 }, scene);
  belt.position.y = h * .5; belt.scaling.set(1.02, 1, .82); belt.material = pbr(scene, `${name}:belt`, '#3a2a1c'); belt.parent = root;
  // Facing cue: a small satchel on the back, so a turning figure reads.
  const bag = MeshBuilder.CreateBox(`${name}:bag`, { width: .26, height: .3, depth: .12 }, scene);
  bag.position.set(0, h * .6, -.22); bag.material = belt.material; bag.parent = root;
  if (opts.hat === 'brim') { const b = MeshBuilder.CreateCylinder(`${name}:hat`, { height: .05, diameter: .52, tessellation: 14 }, scene), c = MeshBuilder.CreateCylinder(`${name}:hatc`, { height: .16, diameterTop: .2, diameterBottom: .28, tessellation: 12 }, scene); b.position.y = h * .93; c.position.y = h * .99; b.material = c.material = pbr(scene, `${name}:hatm`, '#5a4630'); b.parent = c.parent = root; }
  if (opts.hat === 'hood') { const hd = MeshBuilder.CreateSphere(`${name}:hood`, { diameter: .4, segments: 10, slice: .6 }, scene); hd.position.set(0, h * .87, -.03); hd.material = body.material; hd.parent = root; }
  if (opts.hat === 'cap') { const c = MeshBuilder.CreateSphere(`${name}:cap`, { diameter: .33, segments: 8, slice: .5 }, scene); c.position.y = h * .89; c.material = pbr(scene, `${name}:capm`, '#6b6f78', .4); c.parent = root; }
  body.metadata = { y: body.position.y }; head.metadata = { y: head.position.y };
  for (const m of root.getChildMeshes()) m.isPickable = false;
  return { root, body, head };
}
/** Ground marker for click-to-move: a pulsing ring. */
export function makeMarker(scene: Scene): Mesh {
  const ring = MeshBuilder.CreateTorus('move-marker', { diameter: .9, thickness: .07, tessellation: 32 }, scene);
  const m = new StandardMaterial('move-marker', scene); m.emissiveColor = new Color3(1, .82, .45); m.diffuseColor = Color3.Black(); m.disableLighting = true; m.alpha = .85;
  ring.material = m; ring.isPickable = false; ring.setEnabled(false); return ring;
}
