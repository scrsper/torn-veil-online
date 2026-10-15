import { beforeAll, describe, expect, it } from 'vitest';
import { loadFocusedGeometry } from '../../src/server/focusedGeometryLoader';
import { RealmRuntime } from '../../src/server/realmRuntime';
import { RealmSession } from '../../src/sim/world/realms/session';
import { seedForestLife } from '../../src/sim/world/realms/wildlife';
import { makeItem } from '../../src/sim/world/factory';
import { createRequest } from '../../src/sim/core/requests';
import { acceptProtection } from '../../src/sim/social/protection';
import { handInteractions, performHandInteraction } from '../../src/sim/physical/hand';
import { deriveObjectives, objectiveReceipts, ObjectiveTracker, FIRST_HOUR_TOWER_FLOORS, type Objective } from '../../src/sim/quests';
import type { Request } from '../../src/sim/core/types';
import { ClientObjectives, hudObjectiveApi } from '../../src/web/quests/objectives';

/**
 * Objectives are read from World state: requests people raised for their own reasons and the
 * player knows of, the player character's own concerns, and their Tower run. Completions are the
 * canonical events that ended those (request_completed, concern_resolved, tower_floor_cleared).
 * Disclosed fixtures: a resident's energy is lowered to stand in for a day without food (the ask,
 * its perception and its settlement are the ordinary sim path); the player is stood beside the
 * resident; Tower floor-clear receipts are emitted directly (their combat path is covered by the
 * Tower suites); one protection request is raised directly to place a forest-stage objective.
 */
const SEED = 918271;
const wealth = (s: RealmSession) => s.world.persons().reduce((n, p) => n + p.wealth, 0);
const strip = (list: Objective[]) => JSON.parse(JSON.stringify(list));
const resident = (s: RealmSession) => s.world.livingPersons().find(p => p.id !== s.person.id)!;
function standBeside(s: RealmSession, personId: string) {
  const b = s.world.primaryBody(personId)!;
  s.body.pos = { x: b.pos.x + 1, y: b.pos.y, z: b.pos.z }; s.body.yaw = Math.PI / 2; s.body.path = null;
}
/** Step the ordinary simulation until `done`, optionally keeping the player beside someone. */
function stepUntil(s: RealmSession, done: () => boolean, beside?: string, max = 120000) {
  for (let i = 0; i < max && !done(); i++) { if (beside) standBeside(s, beside); s.step(1 / 60); }
  expect(done()).toBe(true);
}
function hungryAsk(s: RealmSession, personId: string, follow = true): Request {
  s.world.person(personId)!.physiology.energy = .3;
  stepUntil(s, () => s.world.requests.some(r => r.type === 'provision' && r.requesterId === personId), follow ? personId : undefined);
  const r = s.world.requests.find(r => r.type === 'provision' && r.requesterId === personId)!;
  const ask = s.world.events.find(e => e.type === 'request_created' && e.data.requestId === r.id)!;
  if (follow) stepUntil(s, () => ask.perceivedBy.some(x => x.who === s.person.id), personId, 600);
  return r;
}
function giveFoodTo(s: RealmSession, personId: string): string {
  standBeside(s, personId);
  const give = handInteractions(s.sim, s.person).find(a => a.kind === 'give' && a.id.endsWith(',' + personId) && /provisions/i.test(a.label));
  expect(give, JSON.stringify(handInteractions(s.sim, s.person).map(a => a.id))).toBeTruthy();
  return performHandInteraction(s.sim, s.person, give!.id);
}

beforeAll(() => loadFocusedGeometry());

describe('sim-derived objectives', () => {
  it('derives the same objectives from the same seed, each from one of the three canonical sources', () => {
    const a = new RealmSession(SEED), b = new RealmSession(SEED);
    for (const s of [a, b]) hungryAsk(s, resident(s).id);
    const first = deriveObjectives(a.world, a.person.id);
    expect(strip(first)).toEqual(strip(deriveObjectives(b.world, b.person.id)));
    expect(strip(first)).toEqual(strip(deriveObjectives(a.world, a.person.id)));
    expect(first.map(o => o.kind)).toEqual(expect.arrayContaining(['deliver', 'reach_floor']));
    for (const o of first) expect(['request', 'concern', 'tower_run']).toContain(o.source.type);
    expect(first.filter(o => o.tracked)).toHaveLength(1);
    expect(first[0].stage).toBe('town');
  }, 60000);

  it('offers a request only to a player who heard it asked', () => {
    const s = new RealmSession(SEED), who = resident(s);
    s.body.pos = { x: s.body.pos.x + 400, y: s.body.pos.y, z: s.body.pos.z };
    const r = hungryAsk(s, who.id, false);
    expect(deriveObjectives(s.world, s.person.id).some(o => o.id === `request:${r.id}`)).toBe(false);
  }, 60000);

  it('a heard ask becomes an objective; the player’s food settles it, paid once from the asker, conserved across save and load', () => {
    const s = new RealmSession(SEED), who = resident(s), r = hungryAsk(s, who.id);
    const o = deriveObjectives(s.world, s.person.id).find(x => x.id === `request:${r.id}`)!;
    expect(o).toBeTruthy();
    expect(o).toMatchObject({ kind: 'deliver', stage: 'town', giverId: who.id, source: { type: 'request', requestType: 'provision' }, reward: { silver: r.reward, from: who.id } });
    expect(o.knownVia).toHaveLength(1);
    const before = wealth(s), payer = who.wealth, mine = s.person.wealth;
    expect(giveFoodTo(s, who.id)).toBe('accepted');
    stepUntil(s, () => r.status === 'completed');
    expect(r.acceptedBy).toBe(s.person.id);
    const receipt = objectiveReceipts(s.world, s.person.id).find(x => x.objectiveId === o.id)!;
    expect(receipt).toMatchObject({ silver: r.reward, payerId: who.id });
    expect(s.world.event(receipt.eventId)!.type).toBe('request_completed');
    expect(who.wealth).toBe(payer - r.reward); expect(s.person.wealth).toBe(mine + r.reward); expect(wealth(s)).toBe(before);
    expect(deriveObjectives(s.world, s.person.id).some(x => x.id === o.id)).toBe(false);
    // Nothing settles twice: more time, or a save/load round trip, pays nothing further.
    for (let i = 0; i < 40000; i++) s.step(1 / 60);
    expect(objectiveReceipts(s.world, s.person.id).filter(x => x.objectiveId === o.id)).toHaveLength(1);
    expect(s.person.wealth).toBe(mine + r.reward);
    const reloaded = new RealmSession(0, s.save());
    expect(objectiveReceipts(reloaded.world, reloaded.person.id)).toEqual(objectiveReceipts(s.world, s.person.id));
    expect(deriveObjectives(reloaded.world, reloaded.person.id).some(x => x.id === o.id)).toBe(false);
  }, 60000);

  it('anyone can meet the need: a neighbour’s gift settles it and the player is credited nothing', () => {
    const s = new RealmSession(SEED), who = resident(s), r = hungryAsk(s, who.id);
    const other = s.world.livingPersons().find(p => p.id !== s.person.id && p.id !== who.id)!;
    s.sim.giveItem(other, who, makeItem(s.world, 'bread', 'Neighbour’s loaf', { owner: other.id, holder: other.id }));
    stepUntil(s, () => r.status === 'completed');
    expect(r.acceptedBy).toBe(other.id);
    expect(objectiveReceipts(s.world, s.person.id).some(x => x.objectiveId === `request:${r.id}`)).toBe(false);
    expect(deriveObjectives(s.world, s.person.id).some(x => x.id === `request:${r.id}`)).toBe(false);
  }, 60000);

  it('walks the Tower through floors 1–5 from floor-clear receipts, one receipt per floor', () => {
    const s = new RealmSession(SEED), w = s.world, p = s.person;
    const towerOnly = () => deriveObjectives(w, p.id).filter(o => o.stage === 'tower');
    for (let floor = 1; floor <= FIRST_HOUR_TOWER_FLOORS; floor++) {
      expect(towerOnly().map(o => o.target.floor)).toEqual([floor]);
      w.emit('tower_floor_cleared', { actor: p.id, data: { runId: 'fixture', floor, seconds: 60 }, significance: .65, summary: `fixture clear ${floor}` });
    }
    expect(towerOnly()).toEqual([]);
    expect(objectiveReceipts(w, p.id).filter(r => r.objectiveId.startsWith('tower:'))).toHaveLength(FIRST_HOUR_TOWER_FLOORS);
  });
});

describe('forest stage', () => {
  function forest() { const s = new RealmSession(SEED); s.adoptFocusedWorld(); const seeded = seedForestLife(s.world); return { s, seeded }; }

  it('seeds the same founders deterministically, once, and they survive save and load', () => {
    const a = forest(), b = forest();
    expect(a.seeded.animals).toBeGreaterThanOrEqual(4); expect(a.seeded.outlaw).toBeTruthy();
    const layout = (s: RealmSession) => s.world.creatures().map(c => [c.id, c.species, s.world.primaryBody(c.id)!.pos]);
    expect(layout(a.s)).toEqual(layout(b.s));
    expect(seedForestLife(a.s.world)).toEqual({ animals: 0, outlaw: null, residents: 0 });
    expect(a.seeded.residents).toBe(4);
    const reloaded = new RealmSession(0, a.s.save());
    expect(layout(reloaded)).toEqual(layout(a.s));
  }, 60000);

  it('orders a taken-on protection request after town and before the Tower', () => {
    const { s } = forest(), w = s.world, who = resident(s), boar = w.creatures().find(c => c.species === 'woodland_boar')!;
    const r = createRequest(w, { type: 'protection', requesterId: who.id, reward: 6, cause: `a ${boar.name} is menacing people`,
      payload: { creatureId: boar.id, species: boar.species, seenAt: { ...w.primaryBody(boar.id)!.pos } } });
    expect(deriveObjectives(w, s.person.id).some(o => o.id === `request:${r.id}`)).toBe(false); // never heard, not taken on
    expect(acceptProtection(w, r, s.person)).toBe(true);
    const list = deriveObjectives(w, s.person.id), stages = list.map(o => o.stage);
    const hunt = list.find(o => o.id === `request:${r.id}`)!;
    expect(hunt).toMatchObject({ kind: 'hunt', stage: 'forest', target: { species: 'woodland_boar' } });
    expect(stages.lastIndexOf('town')).toBeLessThan(stages.indexOf('forest'));
    expect(stages.indexOf('forest')).toBeLessThan(stages.indexOf('tower'));
  }, 60000);
});

describe('objective API', () => {
  it('announces updates on change and each completion exactly once', () => {
    const s = new RealmSession(SEED), who = resident(s), tracker = new ObjectiveTracker(), updates: string[] = [], completions: string[] = [];
    tracker.on('objective:update', e => updates.push(e.objective.id));
    tracker.on('objective:complete', e => completions.push(e.receipt.objectiveId));
    const r = hungryAsk(s, who.id);
    tracker.ingest(deriveObjectives(s.world, s.person.id));
    const initial = updates.length; expect(initial).toBe(tracker.getActiveObjectives().length);
    tracker.ingest(deriveObjectives(s.world, s.person.id)); expect(updates).toHaveLength(initial);
    giveFoodTo(s, who.id); stepUntil(s, () => r.status === 'completed');
    const receipts = objectiveReceipts(s.world, s.person.id);
    tracker.ingest(deriveObjectives(s.world, s.person.id), receipts);
    tracker.ingest(deriveObjectives(s.world, s.person.id), receipts);
    expect(completions).toEqual([`request:${r.id}`]);
    expect(tracker.getActiveObjectives().some(o => o.id === `request:${r.id}`)).toBe(false);
  }, 60000);

  it('mirrors host messages in the browser store and HUD adapter without re-announcing history', () => {
    const s = new RealmSession(SEED), client = new ClientObjectives(), hud = hudObjectiveApi(client), seen: string[] = [];
    hud.subscribe(e => seen.push(e.type));
    for (let floor = 1; floor <= 2; floor++) s.world.emit('tower_floor_cleared', { actor: s.person.id, data: { runId: 'fixture', floor, seconds: 60 }, significance: .65, summary: 'fixture' });
    client.ingestMessage({ type: 'state', state: s.snapshot() });
    expect(seen.includes('objective:complete')).toBe(false);
    expect(client.history()).toHaveLength(2);
    expect(hud.getActiveObjectives().map(o => o.id)).toEqual(client.getActiveObjectives().map(o => o.id));
    s.world.emit('tower_floor_cleared', { actor: s.person.id, data: { runId: 'fixture', floor: 3, seconds: 60 }, significance: .65, summary: 'fixture' });
    const receipt = objectiveReceipts(s.world, s.person.id).at(-1)!;
    client.ingestMessage({ type: 'objective', receipt });
    client.ingestMessage({ type: 'state', state: s.snapshot() });
    client.ingestMessage({ type: 'state', state: s.snapshot() });
    expect(seen.filter(t => t === 'objective:complete')).toHaveLength(1);
  });

  it('the host objectives operation only reads history, so replay agrees', () => {
    const live = new RealmRuntime(new RealmSession(SEED)), replay = new RealmRuntime(new RealmSession(SEED));
    for (const r of [live, replay]) {
      r.session.world.emit('tower_floor_cleared', { actor: r.session.person.id, data: { runId: 'fixture', floor: 1, seconds: 60 }, significance: .65, summary: 'fixture' });
      r.apply({ type: 'objectives' });
    }
    expect(replay.apply({ type: 'objectives' })).toEqual(live.apply({ type: 'objectives' }));
  });
});
