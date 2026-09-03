import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/core/world';
import { generateVillage } from '../src/sim/world/village';

describe('stable authored identity (Constitution §50)', () => {
  it('resolves authored people, places, and factions by slug regardless of generation-order id', () => {
    const world = new World(555);
    generateVillage(world);

    const rowan = world.getBySlug('rowan');
    expect(rowan).toBeDefined();
    expect(rowan!.name).toBe('Rowan Ashford');
    expect(rowan!.slug).toBe('rowan');

    const tavern = world.getBySlug('tavern');
    expect(tavern).toBeDefined();
    expect(tavern!.name).toBe('The Gilded Boar');

    const watch = world.getBySlug('watch');
    expect(watch).toBeDefined();
    expect(watch!.name).toBe('the Village Watch');

    // a dead historical entity is still resolvable by slug (identity survives having no body)
    const anna = world.getBySlug('anna');
    expect(anna).toBeDefined();
    expect((anna as any).alive).toBe(false);
  });

  it('keeps the same slug -> identity resolution across two independently generated worlds with the same seed', () => {
    const a = new World(777); generateVillage(a);
    const b = new World(777); generateVillage(b);
    expect(a.getBySlug('rowan')!.id).toBe(b.getBySlug('rowan')!.id);
    expect(a.getBySlug('tavern')!.id).toBe(b.getBySlug('tavern')!.id);
  });

  it('does not assign slugs to procedurally generated entities like bodies or dropped items', () => {
    const world = new World(555);
    generateVillage(world);
    const rowan = world.getBySlug('rowan')!;
    const body = world.primaryBody(rowan.id);
    expect(body).toBeDefined();
    expect(body!.slug).toBeUndefined();
  });

  it('every faction has a leader (Constitution §36: factions are institutions, not flags)', () => {
    const world = new World(555);
    generateVillage(world);
    const watch = world.getBySlug<any>('watch')!;
    const bandits = world.getBySlug<any>('bandits')!;
    const village = world.getBySlug<any>('village')!;
    expect(watch.leaderId).toBe(world.getBySlug('rowan')!.id);
    expect(bandits.leaderId).toBe(world.getBySlug('skarn')!.id);
    expect(village.leaderId).toBe(world.getBySlug('godwin')!.id);
    expect(watch.knowledge).toEqual({});
  });
});
