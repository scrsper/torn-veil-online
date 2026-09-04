import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/mind/agent';
import { deserialize, newWorld, serialize } from '../src/sim/persist/save';
import { beginConflict, recordConflictBlow } from '../src/sim/social/conflict';
import { subdue, takeIntoCustody, beginSurrender } from '../src/sim/social/custody';

function advance(world: ReturnType<typeof newWorld>['world'], sim: Simulation, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
    const dt = Math.min(0.05, seconds - elapsed);
    const worldDt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, worldDt); sim.flushSpeech();
  }
}

describe('save round trips', () => {
  it('rejects checkpoint-era and malformed save overlays cleanly', () => {
    const { world } = newWorld(1337);
    const stale = JSON.parse(serialize(world)); stale.version -= 1;
    expect(deserialize(JSON.stringify(stale))).toBeNull();
    const malformed = JSON.parse(serialize(world)); malformed.playerId = 'missing-player';
    expect(deserialize(JSON.stringify(malformed))).toBeNull();
  });

  it('preserves witnessed consequences, dynamic trade items, events, and door state', () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    const player = world.person(world.playerId)!;
    const tomas = gen.people.tomas;
    const mara = gen.people.mara;
    const merchant = gen.people.wendel;
    const playerBody = world.primaryBody(player.id)!;
    const tomasBody = world.primaryBody(tomas.id)!;
    const maraBody = world.primaryBody(mara.id)!;
    playerBody.pos = { x: 101.5, y: 14, z: 96.5 };
    tomasBody.pos = { x: 100.5, y: 14, z: 96.5 };
    maraBody.pos = { x: 100.5, y: 14, z: 100.5 };
    maraBody.yaw = 0;
    const attack = sim.applyHit(player, playerBody, tomasBody, 8)!;
    advance(world, sim, 0.3);
    expect(mara.knowledge[`ev:${attack.id}`]?.source.type).toBe('witnessed');

    const doorIndex = world.grid.doorStates.keys().next().value as number;
    const doorY = doorIndex % world.grid.H;
    const doorXZ = (doorIndex - doorY) / world.grid.H;
    const doorZ = doorXZ % world.grid.D;
    const doorX = (doorXZ - doorZ) / world.grid.D;
    world.setDoorOpen({ x: doorX, y: doorY, z: doorZ }, true, player.id);

    const oldCoins = player.inventory.map(id => world.item(id)).find(item => item?.type === 'coins')!;
    player.inventory = player.inventory.filter(id => id !== oldCoins.id);
    world.entities.delete(oldCoins.id);
    const sold = player.inventory.map(id => world.item(id)).find(item => item?.type === 'bread')!;
    const trade = sim.sellItem(player, merchant, sold, 4, { x: 75.5, y: 14, z: 106.5 }, merchant.workId ?? undefined)!;

    const loaded = deserialize(serialize(world));
    expect(loaded).not.toBeNull();
    const restored = loaded!.world;
    const restoredMara = restored.person(mara.id)!;
    expect(restoredMara.knowledge[`ev:${attack.id}`]).toMatchObject({ source: { type: 'witnessed' }, claim: { actor: player.id } });
    expect(restoredMara.memories.some(memory => memory.eventId === attack.id)).toBe(true);
    expect(restoredMara.relationships[player.id].trust).toBeLessThan(0);
    expect(restored.isDoorOpen({ x: doorX, y: doorY, z: doorZ })).toBe(true);
    expect(restored.item(sold.id)).toMatchObject({ ownerId: merchant.id, holderId: null, provenance: expect.arrayContaining([expect.objectContaining({ eventId: trade.id, how: 'sold' })]) });
    const restoredPlayer = restored.person(player.id)!;
    expect(restoredPlayer.inventory.map(id => restored.item(id)).find(item => item?.type === 'coins')).toMatchObject({ holderId: player.id, quantity: 4 });
    for (const event of restored.events) {
      expect(event.causes.every(id => restored.event(id))).toBe(true);
      expect(event.effects.every(id => restored.event(id))).toBe(true);
    }
  });

  it('persists v0.2.3 conflict / surrender / subdual / custody state across save+reload', () => {
    const { world, gen } = newWorld(1337);
    const skarn = gen.people.skarn; const vex = gen.people.vex;
    const rowan = gen.people.rowan; const hale = gen.people.hale;

    // An active conflict (Skarn vs Rowan), a subdued body (Vex), and a detained person (Skarn).
    const active = beginConflict(world, { initiator: skarn.id, target: rowan.id, cause: 'faction_hostility', intent: 'injure' });
    recordConflictBlow(world, active, skarn.id, 'injure');
    subdue(world, vex, hale.id);
    const crimeKey = 'ev:persist-crime';
    hale.knowledge[crimeKey] = { key: crimeKey, kind: 'event', claim: { eventId: 'p', type: 'theft', actor: skarn.id, target: gen.people.hobb.id, tick: world.now }, confidence: 1, learnedAt: world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    const crimeCf = beginConflict(world, { initiator: skarn.id, target: hale.id, cause: 'crime_response', intent: 'arrest' });
    beginSurrender(world, skarn, hale.id, 'yielded', crimeCf);
    takeIntoCustody(world, skarn, hale, crimeKey, crimeCf);

    const restored = deserialize(serialize(world))!.world;
    const rActive = restored.conflicts.find(c => c.id === active.id)!;
    expect(rActive.status).toBe('active');
    expect(rActive.participants.sort()).toEqual([skarn.id, rowan.id].sort());
    expect(restored.conflicts.some(c => c.outcome === 'arrest')).toBe(true); // the resolved arrest conflict too
    expect(restored.primaryBody(vex.id)!.subduedUntil).toBeGreaterThan(restored.physicalTime);
    expect(restored.primaryBody(vex.id)!.pose).toBe('downed');
    const rSkarn = restored.person(skarn.id)!;
    expect(rSkarn.custody?.active).toBe(true);
    expect(rSkarn.custody?.reason).toContain('theft');
    // A reloaded detainee stays put and does not fight.
    const sim = new Simulation(restored);
    advance(restored, sim, 60);
    expect(rSkarn.custody?.active).toBe(true);
    expect(restored.events.some(e => e.type === 'attack' && e.actor === skarn.id && e.tick > world.now)).toBe(false);
  });

  it('persists faction leadership succession and institutional knowledge (v0.2.1 Priority 8)', () => {
    // Regression: v0.2 introduced Faction.leaderId (mutated by leadership succession on a
    // leader's death, see history/factions.ts) and Faction.knowledge (institutional memory),
    // but save.ts never persisted or restored either — `deserialize` regenerates factions
    // fresh from the seed via `generateVillage`, so a save/reload would silently revert any
    // leadership change or institutional knowledge gained during play back to the village's
    // initial state. Unlike Person.factionId/cognitiveLOD or Body.attackTarget (all safely
    // reconstructed from data that IS saved, or harmless to reset — see the SAVE_VERSION
    // comment in persist/save.ts), leaderId/knowledge depend on simulation history that
    // cannot be re-derived from present state, so they must round-trip explicitly.
    const { world, gen } = newWorld(1337);
    const bandits = world.faction(gen.people.skarn.factionId)!;
    expect(bandits.leaderId).toBe(gen.people.skarn.id);
    // Simulate a leadership succession (Skarn dies, Vex takes over) and a promoted piece of
    // institutional knowledge, exactly as history/factions.ts would produce during play.
    bandits.leaderId = gen.people.vex.id;
    bandits.knowledge['ev:test-crime'] = {
      key: 'ev:test-crime', kind: 'event', confidence: 0.9, learnedAt: world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
      claim: { type: 'attack', actor: gen.people.vex.id, target: gen.people.skarn.id, tick: world.now },
    };

    const restored = deserialize(serialize(world))!.world;
    const restoredFaction = restored.faction(bandits.id)!;
    expect(restoredFaction.leaderId).toBe(gen.people.vex.id);
    expect(restoredFaction.knowledge['ev:test-crime']?.claim.type).toBe('attack');
  });
});
