import { describe, expect, it } from 'vitest';
import { appearanceProfile } from '../src/bridge/appearanceProfile';
import { activityPresentation } from '../src/bridge/activityPresentation';
import { MAX_SETTLE_METRES, SlotReservations, approachSlot, chooseStation, conversationStations, occupancySlots, separationOffset } from '../src/bridge/occupancy';
import { BridgeSession } from '../src/bridge/session';
import { deserialize, serialize } from '../src/sim/persist/save';
import { B } from '../src/sim/physical/blocks';
import { makePlace } from '../src/sim/world/factory';
import { projectAppearanceDescription } from '../src/sim/core/appearance';
import { richCatalogue } from './fixtures/characterCatalogue';
import { addPerson, createTestWorld, v } from './helpers/world';

/** The slice's architectural rule: canonical simulation never learns an engine exists. */
const ENGINE_PATH = /\/Game\/|\.uasset|SKM_|SK_|ABP_|BS_/;

describe('appearance profiles consume the canonical description through the Character Foundry', () => {
  it('projects the canonical description and resolves it through the shared catalogue', () => {
    const tw = createTestWorld();
    const smith = addPerson(tw, 'Hedda', 'smith', v(10, 1, 10));
    const profile = appearanceProfile(smith, tw.world.primaryBody(smith.id)!.id, richCatalogue(), tw.world.seed)!;
    expect(profile).not.toBeNull();
    expect(profile.description).toEqual(projectAppearanceDescription(smith.appearance.description!, smith.age, smith.occupation));
    expect(profile.description.roleCues).toContain('apron');
    expect(profile.realization.complete).toBe(true);
    expect(profile.realization.entityId).toBe(smith.id);
    expect(profile.realization.slots.find(s => s.slot === 'body')?.package).toMatch(/^\/Game\//);
    expect(profile.realization.slots.filter(s => s.slot === 'accessory').map(s => s.name)).toContain('SM_Hammer');
  });

  it('keeps the description and realization identical across a save and reload', () => {
    const session = new BridgeSession();
    const world = session.world, player = world.person(world.playerId)!;
    const body = world.primaryBody(player.id)!;
    const catalogue = richCatalogue();
    const before = appearanceProfile(player, body.id, catalogue, world.seed)!;

    const reloaded = deserialize(serialize(world))!.world;
    const samePlayer = reloaded.person(player.id)!;
    const sameBody = reloaded.primaryBody(samePlayer.id)!;
    expect(samePlayer.id).toBe(player.id);
    expect(sameBody.id).toBe(body.id);

    const after = appearanceProfile(samePlayer, sameBody.id, catalogue, reloaded.seed)!;
    expect(after.signature).toBe(before.signature);
    expect(after.description).toEqual(before.description);
    expect(after.realization).toEqual(before.realization);
  });

  it('does not re-derive clothes when current wealth changes', () => {
    const tw = createTestWorld();
    const person = addPerson(tw, 'Hedda', 'smith', v(10, 1, 10));
    const bodyId = tw.world.primaryBody(person.id)!.id;
    const before = appearanceProfile(person, bodyId, richCatalogue(), tw.world.seed)!;
    person.wealth += 10_000;
    const after = appearanceProfile(person, bodyId, richCatalogue(), tw.world.seed)!;
    expect(after.description).toEqual(before.description);
    expect(after.realization).toEqual(before.realization);
  });

  it('fails soft for an older person with no canonical description instead of inventing one', () => {
    const tw = createTestWorld();
    const person = addPerson(tw, 'Legacy', 'innkeeper', v(10, 1, 10));
    const bodyId = tw.world.primaryBody(person.id)!.id;
    delete person.appearance.description;
    expect(appearanceProfile(person, bodyId, richCatalogue(), tw.world.seed)).toBeNull();
  });

  it('keeps Unreal paths out of canonical state even when presentation resolves local assets', () => {
    const session = new BridgeSession(918271, { characterCatalogue: richCatalogue() });
    const snapshot = session.snapshot();
    expect(JSON.stringify(snapshot.bodies.map(b => b.embodiment))).toMatch(ENGINE_PATH);
    expect(JSON.stringify(session.world.persons())).not.toMatch(ENGINE_PATH);
  });
});

describe('activity presentation reads canonical state and invents nothing', () => {
  function actor() {
    const tw = createTestWorld();
    const person = addPerson(tw, 'Worker', 'smith', v(10, 1, 10));
    const body = tw.world.primaryBody(person.id)!;
    person.mind.plan = [];
    return { tw, person, body };
  }

  it('reports idle rather than an ambient animation when canonical state says nothing', () => {
    const { tw, person, body } = actor();
    body.pose = 'stand'; body.vel = { x: 0, y: 0, z: 0 };
    const activity = activityPresentation(tw.world, body, person);
    expect(activity.family).toBe('idle');
    expect(activity.station).toBeNull();
    expect(activity.evidence).toEqual({ pose: 'stand', action: null, goal: person.mind.goal?.type ?? null });
  });

  it('derives the work family and a physical station from the canonical workplace', () => {
    const { tw, person, body } = actor();
    const smithy = makePlace(tw.world, 'smithy', 'test smithy', { x0: 6, z0: 6, x1: 12, z1: 12, y0: 1, y1: 4 }, { inside: v(9, 1, 9) });
    body.pose = 'work';
    person.mind.plan = [{ type: 'work', placeId: smithy.id, status: 'active' }];
    const activity = activityPresentation(tw.world, body, person);
    expect(activity.family).toBe('work');
    expect(activity.detail).toBe('forge');
    expect(activity.station).toBe('work');
    expect(activity.placeId).toBe(smithy.id);
  });

  it('separates travel, carry, eat, drink, rest, socialize, trade and flee from each other', () => {
    const { tw, person, body } = actor();
    const cases: [() => void, string][] = [
      [() => { body.pose = 'walk'; body.vel = { x: 1.2, y: 0, z: 0 }; }, 'travel'],
      [() => { body.pose = 'eat'; body.vel = { x: 0, y: 0, z: 0 }; }, 'eat'],
      [() => { body.pose = 'drink'; }, 'drink'],
      [() => { body.pose = 'sleep'; }, 'rest'],
      [() => { body.pose = 'talk'; }, 'socialize'],
      [() => { body.pose = 'stand'; person.mind.goal = { type: 'shop', key: 'shop', utility: 1, since: 0 } as never; }, 'trade'],
      [() => { person.mind.goal = { type: 'flee', key: 'flee', utility: 1, since: 0 } as never; }, 'flee'],
    ];
    for (const [arrange, family] of cases) {
      arrange();
      expect(activityPresentation(tw.world, body, person).family).toBe(family);
    }
  });

  it('keeps canonical injury consequences visible instead of restating them', () => {
    const { tw, person, body } = actor();
    body.pose = 'stand';
    body.injuries = { torso: 0.6 };
    const hurt = activityPresentation(tw.world, body, person, 0.55);
    expect(hurt.injury).toEqual({ impaired: true, severity: 0.6, movementMultiplier: 0.55 });
    body.pose = 'downed';
    const downed = activityPresentation(tw.world, body, person, 0.55);
    expect(downed.family).toBe('injured');
    expect(downed.posture).toBe('lie');
  });

  it('escalates locomotion with actual canonical speed', () => {
    const { tw, person, body } = actor();
    body.pose = 'walk';
    const tierAt = (speed: number) => { body.vel = { x: speed, y: 0, z: 0 }; return activityPresentation(tw.world, body, person).locomotion; };
    expect(tierAt(0)).toBe('idle');
    expect(tierAt(1.4)).toBe('walk');
    expect(tierAt(3.5)).toBe('run');
    expect(tierAt(6)).toBe('sprint');
  });
});

describe('physical occupancy derives valid positions from canonical geometry', () => {
  function smithy() {
    const tw = createTestWorld();
    for (let x = 6; x <= 12; x++) for (let z = 6; z <= 12; z++) tw.world.grid.set(x, 1, z, B.Air);
    const place = makePlace(tw.world, 'smithy', 'test smithy', { x0: 6, z0: 6, x1: 12, z1: 12, y0: 1, y1: 4 }, { inside: v(9, 1, 9) });
    tw.world.grid.set(9, 1, 9, B.Anvil);
    place.anchors.push({ kind: 'work', pos: v(9, 1, 9) });
    return { tw, place };
  }

  it('stands a worker beside the anvil rather than inside it, facing it', () => {
    const { tw, place } = smithy();
    const slots = occupancySlots(tw.world, place);
    // One station per side a body can physically stand on, not one arbitrary side.
    expect(slots).toHaveLength(4);
    expect(new Set(slots.map(s => s.id)).size).toBe(4);
    for (const slot of slots) {
      expect(slot.posture).toBe('stand');
      expect(Math.hypot(slot.stand.x - 9.5, slot.stand.z - 9.5)).toBeCloseTo(1, 5);
      // Facing points back at the anchor cell it serves.
      expect(Math.abs(Math.atan2(9.5 - slot.stand.x, 9.5 - slot.stand.z) - slot.yaw)).toBeLessThan(1e-6);
      expect(slot.id).toContain(place.id);
    }
  });

  it('works an open-floor anchor standing on it, not pushed a metre off its own position', () => {
    const tw = createTestWorld();
    for (let x = 6; x <= 12; x++) for (let z = 6; z <= 12; z++) tw.world.grid.set(x, 1, z, B.Air);
    const farm = makePlace(tw.world, 'farm', 'test farm', { x0: 6, z0: 6, x1: 12, z1: 12, y0: 1, y1: 4 }, { inside: v(11, 1, 9) });
    farm.anchors.push({ kind: 'work', pos: v(9, 1, 9) });
    const slots = occupancySlots(tw.world, farm);
    expect(slots).toHaveLength(1);
    expect(slots[0].stand).toEqual({ x: 9.5, y: 1, z: 9.5 });
    // With no fixture to face, the worker faces into the place rather than at nothing.
    expect(slots[0].yaw).toBeCloseTo(Math.atan2(11.5 - 9.5, 9.5 - 9.5), 5);
    const worker = tw.world.primaryBody(addPerson(tw, 'Tender', 'farmer', v(9.5, 1, 9.5)).id)!;
    const station = chooseStation(tw.world, worker, 'work', farm.id, new SlotReservations())!;
    expect(station.settleMetres).toBeCloseTo(0, 5);
  });

  it('yields no slot for an anchor the canonical world has made unusable', () => {
    const { tw, place } = smithy();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) tw.world.grid.set(9 + dx, 1, 9 + dz, B.Stone);
    expect(occupancySlots(tw.world, place)).toHaveLength(0);
  });

  it('never seats two bodies on the same station, and gives up the station on release', () => {
    const { tw, place } = smithy();
    // Both smiths are standing on the anvil cell, exactly where canonical planning routes them.
    const first = addPerson(tw, 'First', 'smith', v(9.5, 1, 9.5));
    const second = addPerson(tw, 'Second', 'smith', v(9.5, 1, 9.5));
    const a = tw.world.primaryBody(first.id)!, b = tw.world.primaryBody(second.id)!;
    const reservations = new SlotReservations();
    const held = chooseStation(tw.world, a, 'work', place.id, reservations);
    expect(held).not.toBeNull();
    expect(held!.settleMetres).toBeLessThanOrEqual(MAX_SETTLE_METRES);
    // The second smith is standing in the same spot, so it must take a different face of the
    // anvil rather than share one.
    const other = chooseStation(tw.world, b, 'work', place.id, reservations);
    expect(other).not.toBeNull();
    expect(other!.slot.id).not.toBe(held!.slot.id);

    // With every other side walled off, there is genuinely only one position, and the second
    // body gets none rather than a position it cannot physically occupy.
    const { tw: tight, place: narrow } = smithy();
    for (const [dx, dz] of [[1, 0], [0, 1], [0, -1]]) tight.world.grid.set(9 + dx, 1, 9 + dz, B.Stone);
    const only = new SlotReservations();
    const c = tight.world.primaryBody(addPerson(tight, 'Solo', 'smith', v(9.5, 1, 9.5)).id)!;
    const d = tight.world.primaryBody(addPerson(tight, 'Queued', 'smith', v(9.5, 1, 9.5)).id)!;
    expect(occupancySlots(tight.world, narrow)).toHaveLength(1);
    expect(chooseStation(tight.world, c, 'work', narrow.id, only)).not.toBeNull();
    expect(chooseStation(tight.world, d, 'work', narrow.id, only)).toBeNull();
    only.release(c.id);
    expect(chooseStation(tight.world, d, 'work', narrow.id, only)).not.toBeNull();
  });

  it('offers no station to a body the simulation has not actually brought to the workplace', () => {
    const { tw, place } = smithy();
    const distant = addPerson(tw, 'Distant', 'smith', v(20, 1, 20));
    const body = tw.world.primaryBody(distant.id)!;
    expect(chooseStation(tw.world, body, 'work', place.id, new SlotReservations())).toBeNull();
  });

  it('sits a body on a chair facing the table it is set against', () => {
    const tw = createTestWorld();
    for (let x = 6; x <= 12; x++) for (let z = 6; z <= 12; z++) tw.world.grid.set(x, 1, z, B.Air);
    const tavern = makePlace(tw.world, 'tavern', 'test tavern 2', { x0: 6, z0: 6, x1: 12, z1: 12, y0: 1, y1: 4 }, { inside: v(9, 1, 9) });
    tw.world.grid.set(10, 1, 9, B.Table);
    tavern.anchors.push({ kind: 'seat', pos: v(9, 1, 9) });
    const slot = occupancySlots(tw.world, tavern)[0];
    expect(slot.posture).toBe('sit');
    expect(slot.stand).toEqual({ x: 9.5, y: 1, z: 9.5 });
    expect(slot.yaw).toBeCloseTo(Math.atan2(1, 0), 5);
  });

  it('spaces a conversation evenly and points every participant at the group centre', () => {
    const tw = createTestWorld();
    const bodies = [v(10, 1, 10), v(12, 1, 10), v(11, 1, 12)]
      .map((pos, i) => tw.world.primaryBody(addPerson(tw, `Talker${i}`, 'traveler', pos).id)!);
    const ring = conversationStations(bodies);
    expect(ring.size).toBe(3);
    const centre = { x: 11, z: 32 / 3 };
    for (const body of bodies) {
      const station = ring.get(body.id)!;
      expect(Math.hypot(station.stand.x - centre.x, station.stand.z - centre.z)).toBeCloseTo(0.85, 5);
      expect(station.yaw).toBeCloseTo(Math.atan2(centre.x - station.stand.x, centre.z - station.stand.z), 5);
    }
    expect(conversationStations([bodies[0]]).size).toBe(0);
  });

  it('approaches a target from an adjacent standable cell, never through it', () => {
    const tw = createTestWorld();
    tw.world.grid.set(10, 1, 10, B.Well);
    const slot = approachSlot(tw.world, v(10, 1, 10), v(7, 1, 10))!;
    expect(slot).not.toBeNull();
    expect(Math.hypot(slot.x - 10.5, slot.z - 10.5)).toBeCloseTo(1, 5);
    expect(slot.x).toBeLessThan(10.5);
  });

  it('separates a crowded standing body but leaves a moving one exactly where canon puts it', () => {
    const tw = createTestWorld();
    const a = tw.world.primaryBody(addPerson(tw, 'A', 'traveler', v(10, 1, 10)).id)!;
    const b = tw.world.primaryBody(addPerson(tw, 'B', 'traveler', v(10.2, 1, 10)).id)!;
    const offset = separationOffset(a, [a, b]);
    expect(Math.hypot(offset.x, offset.z)).toBeGreaterThan(0);
    expect(Math.hypot(offset.x, offset.z)).toBeLessThanOrEqual(MAX_SETTLE_METRES);
    a.vel = { x: 2, y: 0, z: 0 };
    expect(separationOffset(a, [a, b])).toEqual({ x: 0, z: 0 });
  });
});

describe('the bridge projects embodiment without touching canonical state', () => {
  it('sends a full appearance profile once and its signature thereafter', () => {
    const session = new BridgeSession();
    const opening = session.snapshot();
    const controlled = opening.controlledBodyId!;
    const first = opening.bodies.find(row => row.bodyId === controlled)!;
    expect(first.embodiment).not.toBeNull();
    expect(first.embodiment!.appearance).toBeDefined();
    const signature = first.embodiment!.appearanceSignature;
    const second = session.snapshot().bodies.find(row => row.bodyId === controlled)!;
    expect(second.embodiment!.appearance).toBeUndefined();
    expect(second.embodiment!.appearanceSignature).toBe(signature);
  });

  it('leaves every canonical body position, pose and clock untouched when projecting', () => {
    const session = new BridgeSession();
    const world = session.world;
    const before = world.bodies().map(b => ({ id: b.id, pos: { ...b.pos }, pose: b.pose, yaw: b.yaw }));
    const clock = world.physicalTime;
    session.snapshot(); session.snapshot();
    expect(world.physicalTime).toBe(clock);
    for (const body of before) {
      const now = world.body(body.id)!;
      expect(now.pos).toEqual(body.pos);
      expect(now.pose).toBe(body.pose);
      expect(now.yaw).toBe(body.yaw);
    }
  });

  it('carries no engine asset path when the machine-local catalogue is absent', () => {
    const session = new BridgeSession();
    expect(JSON.stringify(session.snapshot())).not.toMatch(ENGINE_PATH);
  });

  it('sends Foundry realization paths only in presentation when a local catalogue is supplied', () => {
    const session = new BridgeSession(918271, { characterCatalogue: richCatalogue() });
    const snapshot = session.snapshot();
    expect(JSON.stringify(snapshot.bodies.map(b => b.embodiment))).toMatch(ENGINE_PATH);
    expect(JSON.stringify(session.world.persons())).not.toMatch(ENGINE_PATH);
  });
});
