import { beforeAll, describe, expect, it } from 'vitest';
import { loadFocusedGeometry } from '../../src/server/focusedGeometryLoader';
import { RealmRuntime } from '../../src/server/realmRuntime';
import { RealmSession } from '../../src/sim/world/realms/session';
import { seedForestLife } from '../../src/sim/world/realms/wildlife';
import { makeItem } from '../../src/sim/world/factory';
import { handInteractions, performHandInteraction } from '../../src/sim/physical/hand';
import { deriveObjectives, objectiveReceipts, settleObjectives, ObjectiveTracker, FIRST_HOUR_TOWER_FLOORS, type Objective } from '../../src/sim/quests';
import { ClientObjectives, hudObjectiveApi } from '../../src/web/quests/objectives';

/**
 * Objectives come from World state, and the only quest state is the receipts in history.
* Disclosed fixtures: a loaf handed to a resident by another resident, a body is stood beside the person it hands food to, a Tower floor-clear
 * receipt is emitted directly (its combat path is covered by the Tower suites), and killing
 * blows use the same `applyHit` fixture the boar suite discloses.
 */
const SEED = 918271;
const wealth = (s: RealmSession) => s.world.persons().reduce((n, p) => n + p.wealth, 0);
const strip = (list: Objective[]) => JSON.parse(JSON.stringify(list));
function standBeside(s: RealmSession, personId: string) {
  const b = s.world.primaryBody(personId)!;
  s.body.pos = { x: b.pos.x + 1, y: b.pos.y, z: b.pos.z }; s.body.yaw = Math.PI / 2;
}
function giveFoodTo(s: RealmSession, personId: string): string {
  standBeside(s, personId);
  const give = handInteractions(s.sim, s.person).find(a => a.kind === 'give' && a.id.endsWith(',' + personId) && /provisions/i.test(a.label));
  expect(give, JSON.stringify(handInteractions(s.sim, s.person).map(a => a.id))).toBeTruthy();
  return performHandInteraction(s.sim, s.person, give!.id);
}

beforeAll(() => loadFocusedGeometry());

describe('sim-derived objectives', () => {
  it('derives the same objectives from the same seed, and every one names its simulated cause', () => {
    const a = new RealmSession(SEED), b = new RealmSession(SEED);
    for (let i = 0; i < 120; i++) { a.step(1 / 60); b.step(1 / 60); }
    const first = deriveObjectives(a.world, a.person.id);
    expect(strip(first)).toEqual(strip(deriveObjectives(b.world, b.person.id)));
    expect(strip(first)).toEqual(strip(deriveObjectives(a.world, a.person.id)));
    expect(first.map(o => o.kind)).toEqual(expect.arrayContaining(['deliver', 'gather', 'reach_floor']));
    for (const o of first) expect(['npc_need', 'resource_shortage', 'wildlife_threat', 'outlaw_threat', 'tower_rumor']).toContain(o.cause);
    expect(first.filter(o => o.tracked)).toHaveLength(1);
    expect(first[0].stage).toBe('town');
    // A resident who is fed by someone else stops needing the player: no objective without a cause.
    const target = first.find(o => o.kind === 'deliver')!.target.personId!;
    const person = a.world.person(target)!;
    const other = a.world.persons().find(p => p.id !== a.person.id && p.id !== target)!;
    a.sim.giveItem(other, person, makeItem(a.world, 'bread', 'Fixture loaf', { owner: other.id, holder: other.id }));
    expect(deriveObjectives(a.world, a.person.id).some(o => o.key === `need:food:${target}` && !o.complete)).toBe(false);
  });

  it('a food delivery completes the need, pays once from the giver, and never pays again across save and load', () => {
    const s = new RealmSession(SEED), before = wealth(s);
    const need = deriveObjectives(s.world, s.person.id).find(o => o.kind === 'deliver')!;
    const giver = s.world.person(need.giverId!)!, giverWealth = giver.wealth, playerWealth = s.person.wealth;
    expect(giveFoodTo(s, need.target.personId!)).toBe('accepted');
    // One unit changed hands; the stack was split, not duplicated.
    const bread = s.person.inventory.map(id => s.world.item(id)!).find(i => i.type === 'bread')!;
    expect(bread.quantity).toBe(2);
    const done = deriveObjectives(s.world, s.person.id).find(o => o.id === need.id)!;
    expect(done.complete).toBe(true); expect(done.evidence).toHaveLength(1);
    const receipts = settleObjectives(s.world, s.person.id);
    expect(receipts.map(r => r.objectiveId)).toContain(need.id);
    const paid = receipts.find(r => r.objectiveId === need.id)!;
    expect(paid.silver).toBe(need.reward.silver);
    expect(giver.wealth).toBe(giverWealth - paid.silver - receipts.filter(r => r.objectiveId !== need.id && r.payerId === giver.id).reduce((n, r) => n + r.silver, 0));
    expect(s.person.wealth).toBe(playerWealth + receipts.reduce((n, r) => n + r.silver, 0));
    expect(wealth(s)).toBe(before);
    const receiptEvent = s.world.event(paid.eventId)!;
    expect(receiptEvent.type).toBe('objective_completed'); expect(receiptEvent.causes).toEqual(expect.arrayContaining(done.evidence));
    // Idempotent: settling again, or after a save/load round trip, issues nothing.
    expect(settleObjectives(s.world, s.person.id)).toEqual([]);
    const reloaded = new RealmSession(0, s.save());
    expect(settleObjectives(reloaded.world, reloaded.person.id)).toEqual([]);
    expect(objectiveReceipts(reloaded.world, reloaded.person.id)).toEqual(objectiveReceipts(s.world, s.person.id));
    expect(deriveObjectives(reloaded.world, reloaded.person.id).some(o => o.id === need.id)).toBe(false);
  });

  it('caps payment at what the giver holds and mints nothing', () => {
    const s = new RealmSession(SEED), need = deriveObjectives(s.world, s.person.id).find(o => o.kind === 'deliver')!;
    s.world.person(need.giverId!)!.wealth = 1;
    const before = wealth(s);
    giveFoodTo(s, need.target.personId!);
    const paid = settleObjectives(s.world, s.person.id).find(r => r.objectiveId === need.id)!;
    expect(paid.silver).toBe(1); expect(s.world.person(need.giverId!)!.wealth).toBe(0); expect(wealth(s)).toBe(before);
  });

  it('closes the shortage only when rations reach every neighbour with a player contribution', () => {
    const s = new RealmSession(SEED), shortage = deriveObjectives(s.world, s.person.id).find(o => o.kind === 'gather')!;
    expect(shortage.progress).toEqual({ current: 0, required: 2 });
    const neighbours = deriveObjectives(s.world, s.person.id).filter(o => o.kind === 'deliver').map(o => o.target.personId!);
    giveFoodTo(s, neighbours[0]);
    expect(deriveObjectives(s.world, s.person.id).find(o => o.key === shortage.key)!.progress.current).toBe(1);
    settleObjectives(s.world, s.person.id);
    const second = deriveObjectives(s.world, s.person.id).find(o => o.kind === 'deliver')!;
    giveFoodTo(s, second.target.personId!);
    const after = settleObjectives(s.world, s.person.id).map(r => r.key);
    expect(after).toEqual(expect.arrayContaining([shortage.key, second.key]));
    expect(deriveObjectives(s.world, s.person.id).some(o => o.stage === 'town')).toBe(false);
  });

  it('walks the Tower rumour through floors 1–5 from floor-clear receipts, one receipt per floor', () => {
    const s = new RealmSession(SEED), w = s.world, p = s.person;
    const towerOnly = () => deriveObjectives(w, p.id).filter(o => o.stage === 'tower');
    for (let floor = 1; floor <= FIRST_HOUR_TOWER_FLOORS; floor++) {
      expect(towerOnly().map(o => o.target.floor)).toEqual([floor]);
      w.emit('tower_floor_cleared', { actor: p.id, data: { runId: 'fixture', floor, seconds: 60 }, significance: .65, summary: `fixture clear ${floor}` });
      expect(towerOnly()[0].complete).toBe(true);
      expect(settleObjectives(w, p.id).map(r => r.key)).toContain(`tower:floor:${floor}`);
      expect(settleObjectives(w, p.id)).toEqual([]);
    }
    expect(towerOnly()).toEqual([]);
    expect(objectiveReceipts(w, p.id).filter(r => r.key.startsWith('tower:'))).toHaveLength(FIRST_HOUR_TOWER_FLOORS);
  });
});

describe('forest threats from the focused founder endowment', () => {
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
    expect(a.s.snapshot().wildlife.length + reloaded.world.creatures().length).toBeGreaterThan(0);
  }, 60000);

  it('orders the first-hour chain town → forest → Tower and resolves a boar threat by a kill', () => {
    const { s } = forest(), w = s.world;
    const list = deriveObjectives(w, s.person.id);
    const stages = list.map(o => o.stage);
    expect(stages.indexOf('town')).toBeLessThan(stages.indexOf('forest'));
    expect(stages.indexOf('forest')).toBeLessThan(stages.indexOf('tower'));
    const boars = list.find(o => o.key === 'threat:woodland_boar')!;
    expect(boars.cause).toBe('wildlife_threat'); expect(boars.target.bodyIds!.length).toBeGreaterThan(0);
    const victim = w.body(boars.target.bodyIds![0])!;
    s.body.pos = { x: victim.pos.x + 1, y: victim.pos.y, z: victim.pos.z };
    for (let i = 0; i < 20 && !victim.dead; i++) s.sim.applyHit(s.person, s.body, victim, 30, 'kill');
    expect(victim.dead).toBe(true);
    const done = deriveObjectives(w, s.person.id).find(o => o.id === boars.id)!;
    expect(done.complete).toBe(true);
    expect(settleObjectives(w, s.person.id).map(r => r.objectiveId)).toContain(boars.id);
    expect(settleObjectives(w, s.person.id)).toEqual([]);
  }, 60000);

  it('derives a hostile-humanoid objective for the armed outlaw and closes it when the player puts them down', () => {
    const { s, seeded } = forest(), w = s.world, outlaw = w.person(seeded.outlaw!)!, ob = w.primaryBody(outlaw.id)!;
    const o = deriveObjectives(w, s.person.id).find(x => x.cause === 'outlaw_threat')!;
    expect(o.target.personId).toBe(outlaw.id);
    expect(o.title).toContain(outlaw.name);
    s.body.pos = { x: ob.pos.x + 1, y: ob.pos.y, z: ob.pos.z };
    for (let i = 0; i < 30 && outlaw.alive; i++) s.sim.applyHit(s.person, s.body, ob, 30, 'kill');
    expect(deriveObjectives(w, s.person.id).find(x => x.id === o.id)!.complete).toBe(true);
  }, 60000);

  it('journals settlement as a host operation, so replay reaches the same receipts', () => {
    const live = new RealmRuntime(new RealmSession(SEED)), replay = new RealmRuntime(new RealmSession(SEED));
    const need = live.session.objectives().find(o => o.kind === 'deliver')!;
    for (const r of [live, replay]) { giveFoodTo(r.session, need.target.personId!); r.apply({ type: 'objectives' }); }
    expect(objectiveReceipts(replay.session.world, replay.session.person.id)).toEqual(objectiveReceipts(live.session.world, live.session.person.id));
    expect(live.apply({ type: 'objectives' })).toEqual([]);
  });
});

describe('objective API', () => {
  it('announces updates on change and each completion exactly once', () => {
    const s = new RealmSession(SEED), tracker = new ObjectiveTracker(), updates: string[] = [], completions: string[] = [];
    tracker.on('objective:update', e => updates.push(e.objective.id));
    tracker.on('objective:complete', e => completions.push(e.receipt.objectiveId));
    tracker.ingest(deriveObjectives(s.world, s.person.id));
    const initial = updates.length; expect(initial).toBe(tracker.getActiveObjectives().length);
    tracker.ingest(deriveObjectives(s.world, s.person.id)); expect(updates).toHaveLength(initial);
    const need = deriveObjectives(s.world, s.person.id).find(o => o.kind === 'deliver')!;
    giveFoodTo(s, need.target.personId!);
    const receipts = settleObjectives(s.world, s.person.id);
    tracker.ingest(deriveObjectives(s.world, s.person.id), receipts);
    tracker.ingest(deriveObjectives(s.world, s.person.id), receipts);
    expect(completions).toEqual(receipts.map(r => r.objectiveId));
    expect(tracker.getActiveObjectives().some(o => o.id === need.id)).toBe(false);
  });

  it('mirrors host messages in the browser store and the HUD adapter without re-announcing history', () => {
    const s = new RealmSession(SEED), client = new ClientObjectives(), hud = hudObjectiveApi(client), seen: string[] = [];
    hud.subscribe(e => seen.push(e.type));
    const need = deriveObjectives(s.world, s.person.id).find(o => o.kind === 'deliver')!;
    giveFoodTo(s, need.target.personId!); settleObjectives(s.world, s.person.id);
    client.ingestMessage({ type: 'state', state: s.snapshot() });
    expect(seen.includes('objective:complete')).toBe(false);
    expect(client.history().length).toBeGreaterThan(0);
    expect(hud.getActiveObjectives().map(o => o.id)).toEqual(client.getActiveObjectives().map(o => o.id));
    const next = deriveObjectives(s.world, s.person.id).find(o => o.kind === 'deliver')!;
    giveFoodTo(s, next.target.personId!);
    const settled = settleObjectives(s.world, s.person.id), receipt = settled.find(r => r.objectiveId === next.id)!;
    client.ingestMessage({ type: 'objective', receipt, objective: next });
    client.ingestMessage({ type: 'state', state: s.snapshot() });
    client.ingestMessage({ type: 'state', state: s.snapshot() });
    // This delivery also closed the shortage: one announcement per new receipt, none repeated.
    expect(seen.filter(t => t === 'objective:complete')).toHaveLength(settled.length);
  });
});
