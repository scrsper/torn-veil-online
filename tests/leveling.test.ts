import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v, type TestWorld } from './helpers/world';
import type { Person } from '../src/sim/core/types';
import { makeItem } from '../src/sim/world/factory';
import { createAnimal } from '../src/sim/ecology/animals';
import { agreeCombatTrial, endCombatTrial } from '../src/sim/social/combatTrial';
import { recordCapabilityPractice } from '../src/sim/core/capability';
import { develop } from '../src/sim/core/development';
import { advanceRank, advanceToIron, assessRankBreakthrough } from '../src/sim/core/advancement';
import { initializeNearIronFixture } from '../src/headless/worldlab/capability';
import { GameSim } from '../src/sim/runtime/gameSim';
import { advanceKernelLab } from '../src/headless/kernel/lab';
import { deserialize, serialize } from '../src/sim/persist/save';
import { learnArcaneSource, requestArcaneCast, stepArcana } from '../src/sim/physical/arcana/runtime';
import { advanceExertion } from '../src/sim/physical/exertion';
import { arcaneCapacity, assessArcaneTransformation, integrateArcaneSources, TRANSFORMATIONS } from '../src/sim/physical/arcana/growth';
import { creditExperience, earnedStanding, experienceSummary } from '../src/sim/progression/experience';
import { creatureThreat, itemGrade, personThreat } from '../src/sim/progression/threat';
import {
  defeatXp, EMBODIED_TRIALS, floorLevel, gapFactor, LEVELED_RANKS, levelForPower, peakXp, rankOfLevel, standing, VESSELS, xpToNext,
} from '../src/sim/progression/levels';
import { levelingReport } from '../src/headless/leveling/report';
import { playerJournal } from '../src/bridge/journal';
import { RealmSession } from '../src/sim/world/realms/session';
import { applyTowerCommand } from '../src/server/canonicalTower';
import { currentTowerFloor, observeCanonicalTower } from '../src/sim/world/interiors/tower';

/** An agreed, consented fight that ends with `a` downing `b`: the ordinary opposed defeat. */
function opposedDefeat(tw: TestWorld, a: Person, b: Person, id: string, damage = 100) {
  const origin = tw.world.emit('tower_entered', { actor: a.id });
  agreeCombatTrial(tw.world, id, [[a], [b]], 'injure', origin.id);
  const e = tw.sim.applyHit(a, tw.world.primaryBody(a.id)!, tw.world.primaryBody(b.id)!, damage, 'injure')!;
  endCombatTrial(tw.world, id, [e.id]);
  return e;
}

describe('level curve and rank bands', () => {
  it('is exponential, ten levels per rank, and roughly six times costlier per rank', () => {
    for (let l = 1; l < 60; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    expect(xpToNext(1)).toBe(100); expect(xpToNext(11) / xpToNext(1)).toBeCloseTo(1.2 ** 10, 1);
    for (let r = 1; r < LEVELED_RANKS.length; r++) expect(peakXp(LEVELED_RANKS[r]) / peakXp(LEVELED_RANKS[r - 1])).toBeCloseTo(6.19, 1);
    expect(standing('Iron', 0)).toMatchObject({ sub: 0, level: 11, label: 'Iron 0', peak: false });
    expect(standing('Iron', xpToNext(11))).toMatchObject({ sub: 1, level: 12, xpIntoLevel: 0 });
    expect(standing('Iron', peakXp('Iron'))).toMatchObject({ sub: 9, level: 20, peak: true });
    expect(standing('Iron', peakXp('Iron') * 3).rankXp).toBe(peakXp('Iron'));
    expect([rankOfLevel(1), rankOfLevel(10), rankOfLevel(11), rankOfLevel(60)]).toEqual(['Normal', 'Normal', 'Iron', 'Diamond']);
  });
  it('pays stronger opponents more, fades weaker ones to nothing, and keeps ten even fights per level', () => {
    expect(gapFactor(15, 10)).toBeGreaterThan(gapFactor(10, 10)); expect(gapFactor(40, 10)).toBe(2.5);
    expect(gapFactor(4, 10)).toBeLessThan(1); expect(gapFactor(1, 13)).toBe(0); expect(defeatXp(1, 30)).toBe(0);
    for (const l of [3, 25, 47]) expect(xpToNext(l) / defeatXp(l, l)).toBeCloseTo(10, 5);
  });
});

describe('capability-derived threat for people, animals and items', () => {
  it('ranks real species, kits and items by what they can do, never by label', () => {
    const r = levelingReport(), species = Object.fromEntries(r.species.map(s => [s.species, s.level]));
    expect(species.field_hare).toBe(1); expect(species.roe_deer).toBe(1); expect(species.woodland_boar).toBeGreaterThan(3);
    const items = Object.fromEntries(r.items.map(i => [i.item, i.level]));
    expect(items.sword).toBeGreaterThan(items.axe); expect(items.axe).toBeGreaterThan(items.dagger);
    expect(items['warden focus (floor 100)']).toBeGreaterThan(items['warden focus (floor 50)']);
    expect(r.people[0].level).toBe(1); expect(r.people[1].level).toBeGreaterThan(r.people[0].level);
    expect(r.wardens[0].max).toBe(1); expect(Math.max(...r.wardens.map(w => w.max))).toBeGreaterThan(r.wardens[0].max);
    // Calibration: the implemented source ladder plus its vessels lands each rank in its own band,
    // and embodied foundations ready for the next trial stay within the current rank's band.
    for (const row of r.ladder) expect(rankOfLevel(row.level)).toBe(row.stage);
    for (const row of r.embodied) expect(rankOfLevel(row.level)).toBe(row.stage.split(',')[0]);
  });
  it('excludes transient condition, counts worn armor and vessels, and grades only combat items', () => {
    const tw = createTestWorld(4101), p = addPerson(tw, 'Assessed', 'villager', v(10, 1, 10)), b = tw.world.primaryBody(p.id)!;
    const base = personThreat(tw.world, p, b);
    p.physiology.fatigue = 0.9; p.physiology.energy = 0.1; expect(personThreat(tw.world, p, b).power).toBe(base.power);
    const armor = makeItem(tw.world, 'armor', 'harness', { owner: p.id, holder: p.id });
    armor.physicalArmor = { version: 1, coverage: ['torso', 'arm'], absorption: 4 };
    expect(itemGrade(armor)).toMatchObject({ role: 'armor' }); expect(itemGrade(armor)!.power).toBeGreaterThan(1);
    p.vessel = { version: 1, stage: 'Iron', eventId: 'fixture', ...VESSELS.Iron, base: { [b.id]: 80 } }; b.maxHealth = 128;
    expect(personThreat(tw.world, p, b, { equipped: false }).level).toBeGreaterThan(base.level);
    expect(itemGrade(makeItem(tw.world, 'bread', 'loaf', {}))).toBeNull();
    const broken = makeItem(tw.world, 'sword', 'snapped', {}); broken.condition = 0; expect(itemGrade(broken)).toBeNull();
    expect(levelForPower(0)).toBe(1); expect(levelForPower(1)).toBe(1); expect(levelForPower(1e12)).toBe(60);
  });
});

describe('earned experience from canonical deeds (shared by players and NPCs)', () => {
  it('pays an opposed defeat once, records first blood, and pays nothing for an unresisting victim', () => {
    const tw = createTestWorld(4102), a = addPerson(tw, 'Victor', 'villager', v(10, 1, 10)), b = addPerson(tw, 'Rival', 'villager', v(11, 1, 10));
    const e = opposedDefeat(tw, a, b, 'leveling:first');
    const l = a.experience!; expect(l.defeated).toEqual([b.id]); expect(l.rankXp).toBeGreaterThan(0);
    expect(e.data.experienceCredits[a.id]).toBeCloseTo(defeatXp(1, 1));
    expect(l.achievements['first-blood']).toBeDefined();
    expect(tw.world.event(l.achievements['first-blood'].eventId)!.type).toBe('achievement_earned');
    const before = l.rankXp; tw.world.primaryBody(b.id)!.health = 80; tw.world.primaryBody(b.id)!.pose = 'stand';
    opposedDefeat(tw, a, b, 'leveling:repeat'); expect(l.rankXp).toBe(before);
    const victim = addPerson(tw, 'Bystander', 'villager', v(12, 1, 10));
    tw.sim.applyHit(a, tw.world.primaryBody(a.id)!, tw.world.primaryBody(victim.id)!, 100, 'injure');
    expect(a.experience!.defeated).not.toContain(victim.id);
  });
  it('shares a defeat by contribution, credits a victim who struck back, and ignores a last tap', () => {
    const tw = createTestWorld(4103), a = addPerson(tw, 'First', 'villager', v(10, 1, 10)), c = addPerson(tw, 'Second', 'villager', v(10, 1, 11));
    const b = addPerson(tw, 'Brawler', 'villager', v(11, 1, 10)), [ab, cb, bb] = [a, c, b].map(p => tw.world.primaryBody(p.id)!);
    tw.sim.applyHit(b, bb, ab, 5, 'injure'); tw.sim.applyHit(b, bb, cb, 5, 'injure');
    tw.sim.applyHit(a, ab, bb, 40, 'injure'); const e = tw.sim.applyHit(c, cb, bb, 50, 'injure')!;
    expect(e.data.experienceCredits[a.id]).toBeCloseTo(defeatXp(1, 1) * 40 / 90);
    expect(e.data.experienceCredits[c.id]).toBeCloseTo(defeatXp(1, 1) * 50 / 90);
    const d = addPerson(tw, 'Other', 'villager', v(12, 1, 12)), db = tw.world.primaryBody(d.id)!;
    tw.sim.applyHit(d, db, ab, 5, 'injure'); tw.sim.applyHit(d, db, cb, 5, 'injure');
    tw.sim.applyHit(a, ab, db, 70, 'injure'); const tap = tw.sim.applyHit(c, cb, db, 15, 'injure')!;
    expect(tap.data.experienceCredits[c.id]).toBeUndefined(); expect(tap.data.experienceCredits[a.id]).toBeGreaterThan(0);
  });
  it('pays a wild kill by the animal\'s threat, with quarry and giant-slayer recognition', () => {
    const tw = createTestWorld(4104), hunter = addPerson(tw, 'Hunter', 'hunter', v(10, 1, 10));
    const boar = createAnimal(tw.world, 'woodland_boar', v(11.5, 1, 10.5)), body = tw.world.body(boar.bodies[0])!;
    const level = creatureThreat(tw.world, boar, body).level;
    const e = tw.sim.applyHit(hunter, tw.world.primaryBody(hunter.id)!, body, 200, 'kill')!;
    // Overcoming a stronger animal pays more than an even fight would.
    expect(body.dead).toBe(true); expect(e.data.experienceCredits[hunter.id]).toBeGreaterThan(defeatXp(level, level));
    expect(Object.keys(hunter.experience!.achievements)).toEqual(expect.arrayContaining(['quarry:woodland_boar', 'giant-slayer']));
    expect(hunter.experience!.receipts.some(r => r.kind === 'practice')).toBe(true);
  });
  it('turns credited practice and newly developed foundations into experience exactly once', () => {
    const tw = createTestWorld(4105), p = addPerson(tw, 'Fitter', 'villager', v(10, 1, 10));
    const work = tw.world.emit('mechanism_worked', { actor: p.id, data: { operation: 'connect', outcome: 'fitted', laborSeconds: 60 } });
    const credit = recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: work.id });
    expect(work.data.experienceCredits[p.id]).toBeCloseTo(credit.effectiveSeconds / 3600 * 300);
    expect(creditExperience(tw.world, p, { kind: 'practice', xp: 999, eventId: work.id })).toBe(0);
    const start = p.attributes.strength, receipts = p.experience!.receipts.length;
    develop(tw.world, p, { weights: { strength: 1 }, seconds: 8 * 3600, intensity: 1, challenge: 15 });
    const gained = p.attributes.strength - start; expect(gained).toBeGreaterThan(0);
    const paid = p.experience!.receipts.slice(receipts).filter(r => r.kind === 'foundation');
    expect(paid.map(r => r.key)).toEqual(Array.from({ length: gained }, (_, i) => `foundation:strength:${start + i + 1}`));
  });
  it('stops at peak: later experience overflows and only a breakthrough leads on', () => {
    const tw = createTestWorld(4106), p = addPerson(tw, 'Peaked', 'villager', v(10, 1, 10));
    const source = tw.world.emit('tower_floor_cleared', { actor: p.id }), extra = tw.world.emit('tower_floor_cleared', { actor: p.id });
    // Ledger arithmetic fixture: a direct credit on real events, not a production adapter.
    creditExperience(tw.world, p, { kind: 'tower', xp: peakXp('Normal') - 1, eventId: source.id });
    creditExperience(tw.world, p, { kind: 'tower', xp: 5000, eventId: extra.id });
    expect(earnedStanding(p)).toMatchObject({ peak: true, label: 'Normal 9' });
    expect(p.experience!.overflowXp).toBe(5000 - 1); expect(p.experience!.achievements['peak:Normal']).toBeDefined();
    const levels = tw.world.events.filter(e => e.type === 'level_attained' && e.actor === p.id);
    expect(levels.at(-1)!.data).toMatchObject({ peak: true, to: 9 });
  });
});

describe('rank vessels and the ladder to Diamond', () => {
  it('remakes the body at Iron without healing, opens Iron 0, and lets ranked foundations pass 20', () => {
    const tw = createTestWorld(4107), p = addPerson(tw, 'Founder', 'villager', v(12, 1, 12)), b = tw.world.primaryBody(p.id)!;
    initializeNearIronFixture(tw.world, p); b.health = 70; b.injuries = { arm: 0.1 };
    const last = tw.world.emit('mechanism_worked', { actor: p.id, data: { operation: 'replace', outcome: 'fitted', laborSeconds: 30 } });
    recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: last.id });
    expect(advanceToIron(tw.world, p)).toBe(true);
    expect(tw.world.events.at(-1)!.type).toBe('ontological_advancement');
    expect(b.maxHealth).toBe(128); expect(b.health / b.maxHealth).toBeCloseTo(70 / 80, 10); expect(b.injuries).toEqual({ arm: 0.1 });
    expect(p.vessel).toMatchObject({ stage: 'Iron', resilience: 1.6, ceiling: 26, eventId: p.ontology.breakthroughEventId });
    expect(earnedStanding(p)).toMatchObject({ label: 'Iron 0', level: 11 });
    expect(p.experience!.achievements['breakthrough:Iron'].eventId).toBe(p.ontology.breakthroughEventId);
    const normal = addPerson(tw, 'Ordinary', 'villager', v(14, 1, 14)); normal.attributes.strength = 20; p.attributes.strength = 20;
    for (const q of [normal, p]) { q.physiology.fatigue = 0; q.physiology.energy = q.physiology.hydration = 1; q.physiology.sleepDebt = 0;
      develop(tw.world, q, { weights: { strength: 1 }, seconds: 8 * 3600, intensity: 1, challenge: 30 }); }
    expect(normal.attributes.strength).toBe(20); expect(p.attributes.strength).toBeGreaterThan(20);
    const loaded = deserialize(serialize(tw.world))!.world.person(p.id)!;
    expect(loaded.vessel).toEqual(p.vessel); expect(loaded.experience).toEqual(p.experience);
  });
  it('requires peak Iron, Iron-band victories, foundations and practice for Bronze, through the shared timed action', () => {
    const tw = createTestWorld(4108, 40), p = addPerson(tw, 'Climber', 'villager', v(12, 1, 12), { controlled: true }), b = tw.world.primaryBody(p.id)!;
    tw.world.clock.timeScale = 1;
    initializeNearIronFixture(tw.world, p); p.capability!.bySkill.crafting.effectiveSeconds += 0.1;
    expect(advanceToIron(tw.world, p)).toBe(true);
    const rest = () => { p.physiology.fatigue = 0; p.physiology.energy = p.physiology.hydration = 0.95; p.physiology.sleepDebt = 0; };
    rest();
    const blocked = assessRankBreakthrough(tw.world, p);
    expect(blocked.next).toBe('Bronze'); expect(blocked.eligible).toBe(false);
    expect(blocked.reasons.join(' | ')).toMatch(/peak Iron is required.*0\/8 opposed victories.*8 hours/);
    // Eight real opposed victories over Iron-ranked opponents (earned level 11) are the feats.
    for (let n = 0; n < EMBODIED_TRIALS.Bronze.feats; n++) {
      const o = addPerson(tw, `Iron rival ${n}`, 'villager', v(14, 1, 12)); o.ontology = { stage: 'Iron' };
      opposedDefeat(tw, p, o, `bronze-feat:${n}`); tw.world.primaryBody(o.id)!.pos = v(30, 1, 30);
    }
    expect(p.experience!.feats.filter(f => f.level >= floorLevel('Iron'))).toHaveLength(8);
    // Disclosed fixture for what the report shows current content cannot yet supply quickly:
    // a full Iron track, trained foundations and sustained practice.
    const l = p.experience!; l.lifetimeXp += peakXp('Iron') - l.rankXp; l.rankXp = peakXp('Iron');
    for (const id of Object.keys(p.attributes) as (keyof typeof p.attributes)[]) p.attributes[id] = 18;
    p.attributes.dexterity = p.attributes.perception = 24; p.capability!.bySkill.crafting.effectiveSeconds = 8 * 3600; rest(); b.health = b.maxHealth;
    expect(assessRankBreakthrough(tw.world, p)).toMatchObject({ eligible: true, next: 'Bronze', path: { skill: 'crafting' } });
    const game = new GameSim(tw.sim); game.attach('human', p.id);
    expect(game.intend('human', { kind: 'advance' })).toBe(true);
    advanceKernelLab(tw.world, tw.sim, 61);
    expect(p.ontology.stage).toBe('Bronze');
    const event = tw.world.event(p.ontology.breakthroughEventId)!;
    expect(event.data).toMatchObject({ from: 'Iron', to: 'Bronze', adaptation: 'embodied capability', peak: true });
    expect(event.causes).toEqual(expect.arrayContaining(event.data.feats));
    expect(b.maxHealth).toBe(200); expect(p.vessel).toMatchObject({ stage: 'Bronze', ceiling: 34 });
    expect(earnedStanding(p)!.label).toBe('Bronze 0');
    const raw = serialize(tw.world); expect(deserialize(raw)).not.toBeNull();
    const tamper = (f: (person: any) => void) => { const data = JSON.parse(raw); f(data.persons.find((q: any) => q.id === p.id)); return deserialize(JSON.stringify(data)); };
    expect(tamper(q => { q.vessel.resilience = 9; })).toBeNull();
    expect(tamper(q => { q.experience.rankXp = peakXp('Bronze') + 1; })).toBeNull();
    expect(tamper(q => { q.attributes.strength = 40; })).toBeNull();
    expect(tamper(q => { q.experience.achievements['giant-slayer'] = { eventId: event.id, xp: 1, tick: 0 }; })).toBeNull();
    const v31 = JSON.parse(raw); v31.version = 31; expect(deserialize(JSON.stringify(v31))).toBeNull();
    expect(advanceRank(tw.world, p)).toBe(false);
  }, 30000);
  it('integrates source Diamond only from peak Gold with Gold-band victories, and saves its receipts', () => {
    // Mechanical threshold fixture (as tower-growth's Gold fixture): real sources, casts, consented
    // hits and integrations. Disclosed fixtures: a full Gold track, and Gold-ranked opponents.
    const tw = createTestWorld(4109); tw.world.clock.timeScale = 1;
    const p = addPerson(tw, 'Ascendant', 'traveler', v(10, 1, 10), { controlled: true }), b = tw.world.primaryBody(p.id)!;
    const source = (id: string, learn = true) => {
      const i = makeItem(tw.world, 'book', id, { owner: p.id, holder: p.id });
      i.arcaneSource = { version: 1, abilityId: id, kind: id.startsWith('ess-') ? 'essence' : 'book' };
      if (learn) expect(learnArcaneSource(tw.world, p, b.id, i.id)).toBe('accepted');
    };
    const forms = ['book-ember', 'ess-bone', 'book-sigil', 'book-thunder', 'ess-storm', 'ess-gravity', 'book-gust', 'ess-swift'];
    for (const id of [...forms, 'ess-fire', 'ess-iron', 'ess-life', 'ess-shadow']) source(id);
    for (let n = 0; n < 15; n++) source('ess-bone', false);
    expect(p.experience!.achievements.awakened).toBeDefined();
    const diamond = TRANSFORMATIONS[4], gold = TRANSFORMATIONS[3];
    let milestone = 0;
    for (let n = 0; n < diamond.victories; n++) {
      const t = addPerson(tw, `Opponent ${n}`, 'traveler', v(14, 1, 10), { controlled: true }), tb = tw.world.primaryBody(t.id)!;
      if (n >= diamond.victories - 24) t.ontology = { stage: 'Gold' };
      const origin = tw.world.emit('tower_entered', { actor: p.id }), trial = `diamond:${n}`;
      agreeCombatTrial(tw.world, trial, [[p], [t]], 'injure', origin.id);
      if (n < forms.length * 3) {
        tw.world.physicalTime += 30; tw.world.clock.advance(30); advanceExertion(tw.world);
        const abilityId = forms[Math.floor(n / 3)], dash = abilityId === 'ess-swift';
        // A dash must land clear of the opponent and within its 5 m reach at this rank.
        const target = dash ? { x: tb.pos.x + Math.sign(tb.pos.x - b.pos.x || 1), y: tb.pos.y, z: tb.pos.z } : { ...tb.pos };
        expect(requestArcaneCast(tw.world, p, { bodyId: b.id, abilityId, target })).toBe('accepted');
        tw.world.physicalTime += 2; tw.world.clock.advance(2);
        stepArcana(tw.world, (q, qb, target, damage, intent, event) => tw.sim.applyHit(q, qb, target, damage, intent, undefined, event));
      }
      const e = tw.sim.applyHit(p, b, tb, 1000, 'injure')!; endCombatTrial(tw.world, trial, [e.id]); tb.pos = v(35, 1, 35);
      if (n + 1 === gold.victories + 1) { const l = p.experience!; l.lifetimeXp += peakXp('Gold') - l.rankXp; l.rankXp = peakXp('Gold'); }
      if (n + 1 === TRANSFORMATIONS[milestone]?.victories) {
        if (milestone === 4) {
          expect(earnedStanding(p)!.peak).toBe(true);
          expect(p.experience!.feats.filter(f => f.level >= 41)).toHaveLength(24);
        }
        expect(assessArcaneTransformation(tw.world, p, b).reasons).toEqual([]);
        expect(integrateArcaneSources(tw.world, p, b)).toBe('accepted');
        expect(p.ontology.stage).toBe(TRANSFORMATIONS[milestone].stage); milestone++;
      }
      if (n + 1 === gold.victories) {
        const before = assessArcaneTransformation(tw.world, p, b).reasons.join(' | ');
        expect(before).toMatch(/Peak Gold is required/); expect(before).toMatch(/0\/24 opposed victories over Gold-band threats/);
      }
    }
    expect(milestone).toBe(5); expect(p.ontology.stage).toBe('Diamond');
    expect(arcaneCapacity(p)).toEqual({ amplitude: 45, aperture: 20, reserve: 480 });
    expect(b.maxHealth).toBe(800); expect(p.vessel).toMatchObject({ stage: 'Diamond', ceiling: 70, force: 10 });
    const event = tw.world.event(p.ontology.breakthroughEventId)!;
    expect(event.data.experience.feats).toHaveLength(24);
    expect(assessArcaneTransformation(tw.world, p, b).reasons[0]).toMatch(/No further essence transformation/);
    const raw = serialize(tw.world), loaded = deserialize(raw); expect(loaded).not.toBeNull();
    expect(loaded!.world.person(p.id)!.arcana).toEqual(p.arcana);
    const bad = JSON.parse(raw); bad.events.find((e: any) => e.id === event.id).data.experience.feats.pop();
    expect(deserialize(JSON.stringify(bad))).toBeNull();
    tw.world.compactEvents(5); expect(deserialize(serialize(tw.world))).not.toBeNull();
  }, 180000);
});

describe('Tower floors and the player journal', () => {
  it('credits a cleared canonical floor and its milestone trial, and shows growth in the journal', () => {
    const s = new RealmSession(317), gate = s.grid.chunk('aether', 32, 32).buildings[0];
    s.body.pos = { x: gate.door.x + .5, y: 1, z: gate.z + 4.5 };
    applyTowerCommand(s, { type: 'enter', id: 'leveling-enter', revision: 0 });
    const f = currentTowerFloor(s.world)!;
    for (const id of f.enemyBodyIds) s.sim.applyHit(s.person, s.body, s.world.body(id)!, 1000, 'injure');
    observeCanonicalTower(s.world);
    const cleared = s.world.event(f.clearEventId)!;
    expect(cleared.data.experienceCredits[s.person.id]).toBeGreaterThan(0);
    expect(s.person.experience!.achievements['tower:1']).toBeDefined();
    expect(s.person.experience!.defeated).toHaveLength(f.enemyBodyIds.length);
    const journal = playerJournal(s.world, s.person);
    expect(journal.experience).toMatchObject({ leveled: true, stage: 'Normal' });
    expect(journal.experience.achievements.map(a => a.id)).toEqual(expect.arrayContaining(['first-blood', 'tower:1']));
    expect(s.snapshot().development.experience).toEqual(experienceSummary(s.world, s.person));
    expect(new RealmSession(0, s.save()).person.experience).toEqual(s.person.experience);
  }, 30000);
  it('leaves people who did nothing without a ledger, and keeps ordinary NPC days unaffected by levels', () => {
    const tw = createTestWorld(4110), p = addPerson(tw, 'Idle', 'villager', v(10, 1, 10));
    step(tw, 2); expect(p.experience).toBeUndefined(); expect(experienceSummary(tw.world, p)).toMatchObject({ label: 'Normal 0', level: 1, lifetimeXp: 0 });
  });
});
