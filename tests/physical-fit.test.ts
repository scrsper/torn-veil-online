import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, MeshBuilder, TransformNode, Quaternion, Vector3 } from '@babylonjs/core';
import { createHash } from 'node:crypto';
import { CATALOG_RENDER_VARIANTS, CATALOG_TYPE_RANGE_M, HELD_ITEMS, SHIELD_GRIP_BAR_DEPTH, anchorOffset, fitHeldItem, heldPlacement, renderLength, resolveParts } from '../src/web/items/physicalFit';

/** Longest documented dimension per catalog type (web/public/items/v1.1/catalog.json). */
const catalog = JSON.parse(readFileSync('web/public/items/v1.1/catalog.json', 'utf8')) as { items: { type: string; dimensions_m?: { width: number; depth: number; height: number } }[] };
const range = (type: string) => { const v = catalog.items.filter(i => i.type === type && i.dimensions_m).map(i => Math.max(i.dimensions_m!.width, i.dimensions_m!.depth, i.dimensions_m!.height)).sort((a, b) => a - b); return { min: v[0], max: v[v.length - 1], median: v[Math.floor(v.length / 2)] }; };
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('held-item physical contract', () => {
  it('uses the documented catalog type ranges', () => {
    for (const [type, key] of [['Longsword', 'longsword'], ['Dagger', 'dagger'], ['Axe', 'axe'], ['Hammer', 'hammer'], ['Polearm', 'polearm'], ['Bow', 'bow'], ['Shield', 'shield'], ['Closed book', 'closedBook'], ['Pulse carbine', 'carbine']] as const) {
      const r = range(type), c = CATALOG_TYPE_RANGE_M[key] as readonly number[];
      near(c[0], +r.min.toFixed(2), .006); near(c[1], +r.max.toFixed(2), .006);
    }
    near(CATALOG_TYPE_RANGE_M.shieldMedian, +range('Shield').median.toFixed(2), .006);
    near(CATALOG_TYPE_RANGE_M.axeMedian, +range('Axe').median.toFixed(2), .006);
  });
  it('keeps authored metric items inside their documented range, and preserves intentionally different sizes', () => {
    // Measured authored extents (m), from the arena's own sources.
    expect(fitHeldItem('W_night-thorn', [0.08, 0.671, 0.03])).toMatchObject({ status: 'authored', scale: 1 });          // small dagger
    expect(fitHeldItem('W_veilguard', [0.2, 1.216, 0.05])).toMatchObject({ status: 'authored', scale: 1 });              // sword
    expect(fitHeldItem('W_oathbreaker', [0.3, 1.767, 0.06])).toMatchObject({ status: 'authored', scale: 1 });            // large two-handed sword
    expect(fitHeldItem('W_bell-of-ruin', [0.4, 1.335, 0.3])).toMatchObject({ status: 'kept', scale: 1 });               // two-handed maul, explicit
    expect(fitHeldItem('W_serpent-tooth', [0.1, 0.816, 0.04])).toMatchObject({ status: 'kept', scale: 1 });
  });
  it('fits only the oversized metric items down to their documented maximum', () => {
    const axe = fitHeldItem('W_widow-cleaver', [0.5, 1.419, 0.06]);
    expect(axe.status).toBe('fitted'); near(axe.length_m!, CATALOG_TYPE_RANGE_M.axe[1]); near(axe.scale, CATALOG_TYPE_RANGE_M.axe[1] / 1.419);
    // A synthetic oversized dagger lands on the dagger maximum; an in-range one is untouched.
    const d = fitHeldItem('dagger', [0.05, 0.9, 0.02], { source: 'arsenal', category: 'dagger', maxLength_m: CATALOG_TYPE_RANGE_M.dagger[1], ref: 'test' });
    near(d.scale * 0.9, CATALOG_TYPE_RANGE_M.dagger[1]);
    expect(fitHeldItem('dagger', [0.05, 0.5, 0.02], { source: 'arsenal', category: 'dagger', maxLength_m: CATALOG_TYPE_RANGE_M.dagger[1], ref: 'test' }).scale).toBe(1);
  });
  it('gives every unit-less legacy KayKit piece an explicit target; two-handed pieces stay the larger class', () => {
    const sword = fitHeldItem('W_sword', [0.25, 1.775, 0.08]), great = fitHeldItem('W_greatsword', [0.4, 2.366, 0.1]);
    near(sword.scale * 1.775, CATALOG_TYPE_RANGE_M.longsword[0]); near(great.scale * 2.366, CATALOG_TYPE_RANGE_M.longsword[1]);
    expect(great.length_m!).toBeGreaterThan(sword.length_m!);
    expect(fitHeldItem('W_greataxe', [0.6, 1.72, 0.1]).length_m!).toBeGreaterThan(fitHeldItem('W_axe', [0.4, 1.244, 0.1]).length_m!);
    for (const [k, s] of Object.entries(HELD_ITEMS)) if (s.source === 'kaykit') expect(s.exactLength_m !== undefined || !!s.keep, k).toBe(true);
    const shield = fitHeldItem('W_shield_round', [0.883, 0.883, 0.27]); expect(shield.status).toBe('fitted'); near(shield.scale * 0.883, CATALOG_TYPE_RANGE_M.shieldMedian);
  });
  it('reports intentional exclusions, armour and unknown items instead of silently resizing them', () => {
    expect(fitHeldItem('W_arrow', [0.05, 0.75, 0.05])).toMatchObject({ status: 'kept', scale: 1 });
    expect(fitHeldItem('cuirass', [0.5, 0.49, 0.3], { source: 'catalog', category: 'armor', ref: 'test' })).toMatchObject({ status: 'unsupported', scale: 1 });
    expect(fitHeldItem('W_unknown', [1, 1, 1])).toMatchObject({ status: 'unspecified', scale: 1 });
    expect(fitHeldItem('W_veilguard', [0, 0, 0]).status).toBe('unsupported');
    expect(fitHeldItem('W_veilguard', [NaN, 1, 1]).status).toBe('unsupported');
    expect(fitHeldItem('bad', [1, 1, 1], { source: 'arsenal', category: 'dagger', maxLength_m: -1, ref: 'test' }).status).toBe('unsupported');
    expect(() => anchorOffset(0)).toThrow();
  });
});

describe('catalog shield render variant and mount', () => {
  it('records its unmodified source by hash and keeps the catalog metric size', () => {
    const v = CATALOG_RENDER_VARIANTS['I_TV-081v'];
    expect(createHash('sha256').update(readFileSync(v.sourcePath)).digest('hex')).toBe(v.sourceSha256);
    const doc = catalog.items.find(i => (i as { id?: string }).id === v.sourceId)!.dimensions_m!;
    const f = fitHeldItem('I_TV-081v', [doc.width, doc.height, doc.depth]);
    expect(f).toMatchObject({ status: 'authored', scale: 1 });
  });
  const parts = { 'Oxblood hide': { min: [-.015, .1545, -.0893], max: [.015, .3245, .0013] }, 'Veil quartz': { min: [-.016, .3245, .0593], max: [.016, .3885, .0893] } } as Record<string, { min: [number, number, number]; max: [number, number, number] }>;
  it('takes the grip from the loader-baked handle part and puts it exactly on the fist slot point', () => {
    const r = resolveParts(HELD_ITEMS['I_TV-081v'], parts)!;
    near(r.spec.gripAnchor![0], 0); near(r.spec.gripAnchor![1], .2395); near(r.spec.gripAnchor![2], .0013 + (-.0893 - .0013) * .67);
    const p = heldPlacement(r.spec, 1), q = new Quaternion(...p.quat!), a = new Vector3(...r.spec.gripAnchor!);
    const placed = a.applyRotationQuaternion(q).add(new Vector3(...p.position));
    expect(placed.subtract(new Vector3(...r.spec.mount!.slotPoint)).length()).toBeLessThan(1e-9);
    expect(r.spec.mount!.slot).toBe('fist');
  });
  it('reports a missing named part instead of guessing, and turns the mount when the face is on -z', () => {
    expect(resolveParts(HELD_ITEMS['I_TV-081v'], { 'Veil quartz': parts['Veil quartz'] })).toBeNull();
    const flipped = resolveParts(HELD_ITEMS['I_TV-081v'], { 'Oxblood hide': parts['Oxblood hide'], 'Veil quartz': { min: [-.016, .32, -.09], max: [.016, .39, -.06] } })!;
    const q0 = new Quaternion(...HELD_ITEMS['I_TV-081v'].mount!.quat), q1 = new Quaternion(...flipped.spec.mount!.quat);
    const face = (q: Quaternion) => new Vector3(0, 0, 1).applyRotationQuaternion(q);
    expect(Vector3.Dot(face(q1), face(q0.multiply(Quaternion.RotationAxis(Vector3.Up(), Math.PI))))).toBeGreaterThan(.999);
  });
});

describe('fitted items in a real Babylon transform chain', () => {
  // Actor root (x1.22) -> rotated, scaled hand bone -> grip slot (rotated, scale 1/boneScale) -> fitted instance.
  const rig = () => {
    const scene = new Scene(new NullEngine());
    const root = new TransformNode('root', scene); root.scaling.setAll(1.22); root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), .7);
    const hand = new TransformNode('hand', scene); hand.parent = root; hand.position.set(.4, 1.1, .1); hand.scaling.setAll(.01); hand.rotationQuaternion = Quaternion.RotationYawPitchRoll(.3, -1.1, .4);
    const slot = new TransformNode('slot', scene); slot.parent = hand; slot.scaling.setAll(1 / .01); slot.position.set(2, 5, -1); slot.rotationQuaternion = Quaternion.RotationYawPitchRoll(-.2, .5, 1.3);
    return { scene, root, hand, slot };
  };
  /** An item 1.419 long along +Y with its grip at the origin (like the arsenal), as a real mesh. */
  const item = (scene: Scene, len: number) => { const m = MeshBuilder.CreateBox('axe', { width: .1, height: len, depth: .05 }, scene); m.bakeTransformIntoVertices(m.getWorldMatrix().clone().setTranslationFromFloats(0, len / 2 - .2, 0)); m.refreshBoundingInfo(); return m; };
  const world = (n: TransformNode, p: Vector3) => Vector3.TransformCoordinates(p, n.computeWorldMatrix(true));
  const scaleOf = (n: TransformNode) => { const s = new Vector3(); n.computeWorldMatrix(true).decompose(s); return s.x; };

  it('inherits the actor scale once (not doubled) and keeps the grip origin in the hand', () => {
    const { scene, slot } = rig(), src = item(scene, 1.419);
    const unfitted = src.createInstance('a'); unfitted.parent = slot;
    const fitted = src.createInstance('b'); fitted.parent = slot;
    const f = fitHeldItem('W_widow-cleaver', [.1, 1.419, .05]); const off = anchorOffset(f.scale); fitted.scaling.setAll(f.scale); fitted.position.set(...off);
    near(scaleOf(slot), 1.22, 1e-5);                       // slot world scale = actor scale, bone scale cancelled
    near(scaleOf(fitted), 1.22 * f.scale, 1e-5);           // item = actor scale x fit, nothing else
    expect(world(fitted, Vector3.Zero()).subtract(world(unfitted, Vector3.Zero())).length()).toBeLessThan(1e-6);
    const tipLen = world(fitted, new Vector3(0, 1.419 - .2, 0)).subtract(world(fitted, new Vector3(0, -.2, 0))).length();
    near(tipLen, renderLength(CATALOG_TYPE_RANGE_M.axe[1], 1.22), 1e-5);
    scene.dispose();
  });
  it('scales the shield about its handle bar, not its origin, so the fist stays on the bar', () => {
    const { scene, slot } = rig(), src = MeshBuilder.CreateCylinder('shield', { diameter: .883, height: .05 }, scene);
    const bar = new Vector3(0, 0, -SHIELD_GRIP_BAR_DEPTH);
    const a = src.createInstance('a'); a.parent = slot;
    const b = src.createInstance('b'); b.parent = slot; const f = fitHeldItem('W_shield_round', [.883, .883, .27]); b.scaling.setAll(f.scale); b.position.set(...anchorOffset(f.scale, HELD_ITEMS['W_shield_round'].gripAnchor));
    expect(world(b, bar).subtract(world(a, bar)).length()).toBeLessThan(1e-6);
    expect(world(b, Vector3.Zero()).subtract(world(a, Vector3.Zero())).length()).toBeGreaterThan(1e-4);
    scene.dispose();
  });
  it('keeps the fit through a stow on another parent and a redraw', () => {
    const { scene, root, slot } = rig(), src = item(scene, 1.419), back = new TransformNode('back', scene); back.parent = root; back.position.set(0, 1.3, -.2);
    const m = src.createInstance('m'); m.parent = slot; const f = fitHeldItem('W_widow-cleaver', [.1, 1.419, .05]); m.scaling.setAll(f.scale); const fitPos = new Vector3(...anchorOffset(f.scale)); m.position.copyFrom(fitPos);
    const before = world(m, new Vector3(0, 1, 0));
    m.parent = back; m.position.set(.06, .12, -.2); near(scaleOf(m), 1.22 * f.scale, 1e-5);   // stowed: still fitted
    m.parent = slot; m.position.copyFrom(fitPos);                                            // drawn: exact hand placement again
    expect(world(m, new Vector3(0, 1, 0)).subtract(before).length()).toBeLessThan(1e-6);
    scene.dispose();
  });
});
