import { describe, expect, it } from 'vitest';
import { RealmSession } from '../../src/sim/world/realms/session';
import { makeItem } from '../../src/sim/world/factory';
import { learnArcaneSource, arcaneBody } from '../../src/sim/physical/arcana/runtime';
import { changeEquipment } from '../../src/sim/physical/equipment';
import { assessMagicalFlight, MAGICAL_FLIGHT_POLICY } from '../../src/sim/physical/arcana/flight';
import { applyCanonicalUniverseCommand } from '../../src/server/canonicalUniverse';
import { spendExertion } from '../../src/sim/physical/exertion';

const env = { gravity: 9.81, atmosphereHeight: 260 };
function fixture() {
  const s = new RealmSession(917);
  s.person.physiology.energy = s.person.physiology.hydration = 1;
  s.person.physiology.fatigue = s.person.physiology.bodyHeat = s.person.physiology.sleepDebt = 0;
  s.person.physiologyTraits.bodySizeFactor = s.person.physiologyTraits.conditioning = 1;
  s.person.skills.veilcraft = 0;
  s.body.health = s.body.maxHealth;
  return s;
}
function learn(s: RealmSession, id: string, kind: 'book' | 'essence' = 'book') {
  const item = makeItem(s.world, 'book', id, { owner: s.person.id, holder: s.person.id });
  item.arcaneSource = { version: 1, abilityId: id, kind };
  expect(learnArcaneSource(s.world, s.person, s.body.id, item.id)).toBe('accepted');
  return item;
}
function focus(s: RealmSession) {
  const item = makeItem(s.world, 'book', 'Flight test focus', { owner: s.person.id, holder: s.person.id });
  item.arcaneFocus = { version: 1, amplitude: 20, aperture: 12, reserve: 320 };
  expect(changeEquipment(s.world, s.person, item.id, true, s.body.id)).toBe('accepted');
  // Use actual canonical recovery after equipping; the production assessment
  // never initializes or grants a reserve.
  s.world.physicalTime += 200; arcaneBody(s.world, s.body);
  return item;
}
function assess(s: RealmSession, overrides: Partial<typeof env & { altitude: number; routeDistance: number }> = {}) {
  return assessMagicalFlight(s.world, s.person, s.body, { ...env, ...overrides });
}
function stableSave(s: RealmSession) { const saved = JSON.parse(s.save()); delete saved.savedAt; return saved; }

describe('source-backed personal magical flight', () => {
  it('does not create flight, learning or mana merely from a rank, name or query', () => {
    const s = fixture();
    s.person.ontology.stage = 'Gold';
    const before = stableSave(s);
    expect(assess(s)).toMatchObject({ canHover: false, canFly: false, canCrossSpace: false, manaAvailable: 0 });
    expect(stableSave(s)).toEqual(before);
    expect(s.body.arcana).toBeUndefined();
  });
  it('derives limited local lift from an actual learned form without a rank gate', () => {
    const s = fixture(); learn(s, 'book-well');
    const normal = assess(s);
    expect(normal.canHover).toBe(true); expect(normal.canFly).toBe(true); expect(normal.canCrossSpace).toBe(false);
    expect(normal.speed).toBeGreaterThan(8); expect(normal.speed).toBeLessThan(11);
    expect(normal.estimatedEndurance).toBeGreaterThan(60); expect(normal.estimatedEndurance).toBeLessThan(120);
    expect(normal.maxAltitude).toBeLessThan(env.atmosphereHeight);
    s.person.ontology.stage = 'Gold'; expect(assess(s)).toEqual(normal);
    const before = stableSave(s);
    expect(assess(s)).toEqual(assess(s)); expect(stableSave(s)).toEqual(before);
  });
  it('keeps consumed essence learning and rejects missing, foreign or mismatched receipts', () => {
    const s = fixture(), item = learn(s, 'ess-gravity', 'essence');
    expect(item.quantity).toBe(0); expect(assess(s).canFly).toBe(true);
    const entry = s.person.arcana!.learned['ess-gravity'], event = s.world.event(entry.eventId)!;
    expect(assess(s).causes).toContain(event.id);
    const actor = event.actor; event.actor = 'other-person'; expect(assess(s).canHover).toBe(false); event.actor = actor;
    event.data.abilityId = 'book-well'; expect(assess(s).canHover).toBe(false); event.data.abilityId = 'ess-gravity';
    const id = entry.eventId; entry.eventId = 'missing'; expect(assess(s).canHover).toBe(false); entry.eventId = id;
    item.arcaneSource!.abilityId = 'book-well'; expect(assess(s).canHover).toBe(false);
  });
  it('supports a sustained space route using real equipped capacity and a learned ward', () => {
    const s = fixture(); learn(s, 'book-well'); learn(s, 'book-ward');
    const weak = assess(s); expect(weak.canCrossSpace).toBe(false);
    const gear = focus(s), strong = assess(s, { routeDistance: 70000 });
    expect(s.person.ontology.stage).toBe('Normal');
    expect(strong.canCrossSpace).toBe(true); expect(strong.capacity).toEqual({ amplitude: 20, aperture: 12, reserve: 320 });
    expect(strong.speed).toBeGreaterThan(800); expect(strong.speed).toBeLessThan(1200);
    expect(strong.manaPerSecond).toBeGreaterThan(1); expect(strong.manaPerSecond).toBeLessThan(3);
    expect(strong.routeManaRequired).toBeLessThan(strong.manaAvailable);
    expect(strong.causes).toContain(s.person.arcana!.learned['book-ward'].eventId);
    expect(assess(s, { routeDistance: 1000000 }).canCrossSpace).toBe(false);
    s.body.arcana!.mana = 60;
    expect(assess(s).maxAltitude).toBe(strong.maxAltitude);
    expect(assess(s, { routeDistance: 70000 }).canCrossSpace).toBe(false);
    gear.equipped = undefined;
    expect(assess(s).canCrossSpace).toBe(false);
    gear.equipped = { bodyId: s.body.id, slot: 'right-hand' }; gear.condition = 0;
    expect(assess(s).canCrossSpace).toBe(false);
  });
  it('refuses a forged ward and caps unprotected altitude below the atmosphere', () => {
    const s = fixture(); learn(s, 'book-well'); learn(s, 'book-ward'); focus(s);
    const event = s.world.event(s.person.arcana!.learned['book-ward'].eventId)!;
    event.data.source = 'scroll';
    const invalid = assess(s);
    expect(invalid.canFly).toBe(true); expect(invalid.canCrossSpace).toBe(false);
    expect(invalid.protectionStrength).toBe(0);
    expect(invalid.maxAltitude).toBe(env.atmosphereHeight * MAGICAL_FLIGHT_POLICY.unprotectedAtmosphereFraction);
    expect(assess(s, { altitude: env.atmosphereHeight })).toMatchObject({ canFly: false, canHover: true });
  });
  it('accounts for known load and body size without pretending all item mass is known', () => {
    const s = fixture(); learn(s, 'book-well'); learn(s, 'book-ward'); focus(s);
    const initial = assess(s);
    makeItem(s.world, 'stone', 'Carried stone', { owner: s.person.id, holder: s.person.id, quantity: 5 });
    const loaded = assess(s);
    expect(loaded.knownLoadKg - initial.knownLoadKg).toBe(75);
    expect(loaded.speed).toBeLessThan(initial.speed); expect(loaded.manaPerSecond).toBeGreaterThan(initial.manaPerSecond);
    expect(loaded.estimatedEndurance).toBeLessThan(initial.estimatedEndurance);
    makeItem(s.world, 'sword', 'Unweighed tool', { owner: s.person.id, holder: s.person.id });
    const unknown = assess(s);
    expect(unknown.unweighedStacks).toBe(initial.unweighedStacks + 1);
    expect(unknown.knownLoadKg).toBe(loaded.knownLoadKg);
    expect(unknown.reasons.some(reason => reason.includes('load accounting is incomplete'))).toBe(true);
    s.person.physiologyTraits.bodySizeFactor = 1.2;
    expect(assess(s).speed).toBeLessThan(loaded.speed);
  });
  it('distinguishes hovering from controlled forward flight and declines with body resources', () => {
    const s = fixture(); learn(s, 'book-well');
    s.person.physiology.fatigue = .65;
    const hover = assess(s, { gravity: 1 });
    expect(hover.canHover).toBe(true); expect(hover.canFly).toBe(false);
    s.person.physiology.fatigue = 0;
    const fit = assess(s);
    spendExertion(s.world, s.person, s.body, .1);
    expect(assess(s).speed).toBeLessThan(fit.speed);
    expect(assess(s).liftAcceleration).toBeLessThan(fit.liftAcceleration);
    s.person.physiology.hydration = .09; expect(assess(s).canHover).toBe(false);
    s.person.physiology.hydration = 1; s.body.health = 1; expect(assess(s).canFly).toBe(false);
    s.body.health = s.body.maxHealth; s.body.arcana!.mana = .01; expect(assess(s).canHover).toBe(false);
  });
  it('recognizes only the exact live canonical universe body when it is absent from the planar realm', () => {
    const s = fixture(); learn(s, 'book-well');
    expect(applyCanonicalUniverseCommand(s, { type: 'enter', id: 'magic-test-enter', revision: 0 }).ok).toBe(true);
    expect(s.body.present).toBe(false); expect(assess(s).canFly).toBe(true);
    const before = stableSave(s); assess(s); expect(stableSave(s)).toEqual(before);
    s.world.universeExpedition!.bodyId = 'other-body';
    const body = s.world.body(s.person.bodies[0])!;
    expect(assessMagicalFlight(s.world, s.person, body, env).canFly).toBe(false);
  });
  it('fails closed on invalid environment and preserves identical capability through save and reload', () => {
    const s = fixture(); learn(s, 'book-well'); learn(s, 'book-ward'); focus(s);
    const before = assess(s), loaded = new RealmSession(0, s.save());
    expect(assess(loaded)).toEqual(before);
    for (const invalid of [{ gravity: NaN }, { atmosphereHeight: -1 }, { routeDistance: Infinity }]) {
      const profile = assess(s, invalid);
      expect(profile.canHover || profile.canFly || profile.canCrossSpace).toBe(false);
      for (const value of Object.values(profile)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });
});
