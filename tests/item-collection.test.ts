import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ITEM_DESIGNS, itemDesign } from '../src/sim/content/itemCollection';
import { makeCatalogItem, makeItem, makePlace, ITEM_DAMAGE, ITEM_VALUE } from '../src/sim/world/factory';
import { itemStaticAssetPath, itemStaticAssetFor, itemFittingPrototypePath } from '../src/web/items/itemAssets';
import { takePortionInHand } from '../src/sim/world/metabolism';
import { addPlaceStock } from '../src/sim/world/stock';
import { createHaulTask, loadHaulCargo, depositHaulCargo } from '../src/sim/logistics/haul';
import { serialize, deserialize } from '../src/sim/persist/save';
import { createTestWorld, addPerson, v } from './helpers/world';

const root = new URL('../web/public/items/v1.1/', import.meta.url);
describe('v1.1 item design collection', () => {
  it('has exactly 360 immutable stable definitions, no renderer paths, and design-only abilities', () => {
    expect(ITEM_DESIGNS).toHaveLength(360);
    expect(ITEM_DESIGNS.map(d => d.id)).toEqual(Array.from({ length: 360 }, (_, i) => `TV-${String(i + 1).padStart(3, '0')}`));
    expect(ITEM_DESIGNS.filter(d => d.mechanicalType)).toHaveLength(80);
    for (const d of ITEM_DESIGNS) {
      expect(Object.isFrozen(d)).toBe(true);
      expect(d).not.toHaveProperty('asset');
      expect(d).not.toHaveProperty('fitting_variants');
      expect(Object.values(d.dimensions_m).every(x => Number.isFinite(x) && x > 0)).toBe(true);
      expect(d.abilities).toHaveLength({ Normal: 0, Uncommon: 1, Rare: 2, Unique: 3, Epic: 4, Legendary: 5 }[d.tier]!);
      for (const a of d.abilities) expect(a.implementation.toLowerCase()).toMatch(/specification|design/);
    }
  });
  it('creates ordinary canonical inventory items without rarity powers or state duplication', () => {
    const tw = createTestWorld(960, 20);
    const { world } = tw;
    const person = addPerson(tw, 'Collector', 'traveler', v(3, 1, 3));
    const sword = makeCatalogItem(world, 'TV-010', { owner: person.id, holder: person.id });
    expect(sword.type).toBe('sword');
    expect(sword.catalogId).toBe('TV-010');
    expect(sword.damage).toBe(ITEM_DAMAGE.sword);
    expect(sword.value).toBe(ITEM_VALUE.sword);
    expect(world.item(sword.id)).toBe(sword);
    expect(person.inventory).toContain(sword.id);
    expect(itemStaticAssetFor(sword)).toBe('items/v1.1/glb/TV-010.glb');
    expect(makeItem(world, 'sword', 'ordinary')).not.toHaveProperty('catalogId');
  });
  it('rejects unsupported, unknown and mismatched designs before world mutation', () => {
    const { world } = createTestWorld(961, 20);
    expect(() => makeCatalogItem(world, 'TV-345')).toThrow(/No canonical mechanics/);
    expect(() => makeCatalogItem(world, 'TV-999')).toThrow(/No canonical mechanics/);
    expect(() => makeItem(world, 'dagger', 'fake', { catalogId: 'TV-001' })).toThrow(/mismatched/);
    expect(itemDesign('TV-345')?.mechanicsStatus).toBe('design-only');
    expect(itemStaticAssetPath('TV-999')).toBeUndefined();
    expect(itemStaticAssetFor({})).toBeUndefined();
    expect(itemFittingPrototypePath('TV-001', 'male')).toBeUndefined();
    expect(itemFittingPrototypePath('TV-345', 'female')).toBe('items/v1.1/rigged/TV-345-female.glb');
  });
  it('preserves identity across stack splits, prevents cross-design merging and survives saves', () => {
    const tw = createTestWorld(962, 20);
    const p = addPerson(tw, 'Collector', 'traveler', v(3, 1, 3));
    const ordinary = makeItem(tw.world, 'sword', 'ordinary', { owner: p.id, holder: p.id, quantity: 2 });
    const designA = makeCatalogItem(tw.world, 'TV-001', { owner: p.id, placeId: tw.places.tavern, quantity: 3 });
    const designB = makeCatalogItem(tw.world, 'TV-002', { owner: p.id, quantity: 2 });
    const a = takePortionInHand(tw.world, p, designA, 1, 'authorized pickup')!;
    const b = takePortionInHand(tw.world, p, designB, 1, 'authorized pickup')!;
    expect(a.catalogId).toBe('TV-001');
    expect(b.catalogId).toBe('TV-002');
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(ordinary.id);
    expect(ordinary.quantity).toBe(2);
    expect(takePortionInHand(tw.world, p, designA, 1, 'authorized pickup')?.id).toBe(a.id);
    expect(a.quantity).toBe(2);
    const stock = addPlaceStock(tw.world, 'sword', 1, tw.places.tavern, p.id, undefined, 'ordinary stock');
    expect(stock.id).not.toBe(designA.id);
    expect(stock.catalogId).toBeUndefined();
    const restored = deserialize(serialize(tw.world))!;
    expect(restored.world.item(a.id)?.catalogId).toBe('TV-001');
    expect(itemStaticAssetFor(restored.world.item(a.id)!)).toBe('items/v1.1/glb/TV-001.glb');
  });
  it('hauls designs as homogeneous cargo and preserves identity at the destination', () => {
    const tw = createTestWorld(963, 20);
    const p = addPerson(tw, 'Collector', 'traveler', v(3, 1, 3));
    const sourceId = tw.places.tavern;
    const dest = makePlace(tw.world, 'farm', 'Store', { x0: 12, z0: 12, x1: 16, z1: 16, y0: 1, y1: 4 }, { inside: v(14, 1, 14) });
    const a = makeCatalogItem(tw.world, 'TV-001', { owner: p.id, placeId: sourceId, quantity: 2 });
    const b = makeCatalogItem(tw.world, 'TV-002', { owner: p.id, placeId: sourceId, quantity: 2 });
    const ordinary = addPlaceStock(tw.world, 'sword', 1, dest.id, p.id, undefined, 'ordinary stock');
    const task = createHaulTask(tw.world, { buyerId: p.id, requesterId: p.id, resource: 'sword', quantity: 4, sourcePlaceId: sourceId, destPlaceId: dest.id, priority: 1, reason: 'authorized design transport' });
    task.claimantId = p.id; task.status = 'claimed';
    expect(loadHaulCargo(tw.world, task, p)).toBe(true);
    expect(tw.world.item(task.cargoItemId!)?.catalogId).toBe('TV-001');
    expect(task.carried).toBe(2);
    expect(a.quantity).toBe(0);
    expect(b.quantity).toBe(2);
    expect(loadHaulCargo(tw.world, task, p)).toBe(true);
    expect(b.quantity).toBe(2);
    expect(depositHaulCargo(tw.world, task, p)).toBe(true);
    expect(ordinary.quantity).toBe(1);
    expect(loadHaulCargo(tw.world, task, p)).toBe(true);
    expect(tw.world.item(task.cargoItemId!)?.catalogId).toBe('TV-002');
    expect(depositHaulCargo(tw.world, task, p)).toBe(true);
    const delivered = tw.world.itemsAtPlaces([dest.id]).filter(i => i.catalogId);
    expect(delivered.map(i => [i.catalogId, i.quantity])).toEqual([['TV-001', 2], ['TV-002', 2]]);
  });
  it('publishes exactly the static360 and fitted160 GLBs with matching hashes and valid glTF headers', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as { files: { path: string; bytes: number; sha256: string }[] };
    expect(readdirSync(new URL('glb/', root)).filter(f => f.endsWith('.glb')).length).toBe(360);
    expect(readdirSync(new URL('rigged/', root)).filter(f => f.endsWith('.glb')).length).toBe(160);
    expect(manifest.files).toHaveLength(520);
    for (const file of manifest.files) {
      const bytes = readFileSync(new URL(file.path, root));
      expect(bytes.length).toBe(file.bytes);
      expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
      expect(bytes.readUInt32LE(4)).toBe(2);
      expect(bytes.readUInt32LE(8)).toBe(bytes.length);
      expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
      expect(gltf.buffers.every((b: { uri?: string }) => !b.uri)).toBe(true);
      if (file.path.startsWith('glb/')) expect(gltf.skins ?? []).toHaveLength(0);
      else { expect(gltf.skins.length).toBeGreaterThan(0); expect(gltf.animations.length).toBe(4); }
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    let fitted = 0;
    for (const d of ITEM_DESIGNS) {
      expect(manifest.files.some(f => `items/v1.1/${f.path}` === itemStaticAssetPath(d.id))).toBe(true);
      for (const sex of ['male', 'female'] as const) {
        const path = itemFittingPrototypePath(d.id, sex);
        if (path) { fitted++; expect(manifest.files.some(f => `items/v1.1/${f.path}` === path)).toBe(true); }
      }
    }
    expect(fitted).toBe(160);
  });
});
