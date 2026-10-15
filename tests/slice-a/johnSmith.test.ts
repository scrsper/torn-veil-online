import { beforeAll, describe, expect, it } from 'vitest';
import { loadFocusedGeometry } from '../../src/server/focusedGeometryLoader';
import { RealmSession } from '../../src/sim/world/realms/session';
import { seedForestLife } from '../../src/sim/world/realms/wildlife';
import { handInteractions, performHandInteraction } from '../../src/sim/physical/hand';
import { deserialize } from '../../src/sim/persist/save';
import { ATTAINABLE_STAGES, ONTOLOGICAL_STAGES, ONTOLOGY_BOUNDARY, STAGE_EXTENSIONS, isAttainableStage } from '../../src/sim/core/stages';
import { TRANSFORMATIONS, LEGACY_TRANSFORMATIONS } from '../../src/sim/physical/arcana/growth';
import { JOHN_SMITH, SYSTEM_RESERVE, FIRST_HOUR_TOWER_FLOORS, reconcileQuests, questObjectives, questJournal, questLedger, questReceipts } from '../../src/sim/quests';
import type { Request } from '../../src/sim/core/types';

/**
 * John Smith's system quest layer (Constitution §16–18): an authored, seeded catalogue issued
 * from world conditions, archived with emergent quests in one persistent ledger, paying each
 * reward once from a finite reserve, and never a stage anyone can hold.
 * Disclosed fixtures: a resident's energy is lowered to stand in for a day without food; the
 * player is stood beside them; Tower floor-clear receipts are emitted directly; a boar's attack
 * on a resident is emitted directly (as a perceivable event the player then perceives); killing
 * blows use the same `applyHit` fixture the boar suite discloses.
 */
const SEED = 918271;
const resident = (s: RealmSession) => s.world.livingPersons().find(p => p.id !== s.person.id)!;
const ids = (s: RealmSession) => questJournal(s.world, s.person.id).map(e => `${e.id}=${e.state}`);
const clear = (s: RealmSession, floor: number) => s.world.emit('tower_floor_cleared', { actor: s.person.id, data: { runId: 'fixture', floor, seconds: 60 }, significance: .65, summary: `fixture clear ${floor}` });
const systemPaid = (s: RealmSession) => questJournal(s.world, s.person.id).filter(e => e.origin === 'system').reduce((n, e) => n + (e.claim?.paid ?? 0), 0);
function standBeside(s: RealmSession, personId: string) {
  const b = s.world.primaryBody(personId)!;
  s.body.pos = { x: b.pos.x + 1, y: b.pos.y, z: b.pos.z }; s.body.yaw = Math.PI / 2; s.body.path = null;
}
function stepUntil(s: RealmSession, done: () => boolean, beside?: string, max = 120000) {
  for (let i = 0; i < max && !done(); i++) { if (beside) standBeside(s, beside); s.step(1 / 60); }
  expect(done()).toBe(true);
}
function hungryAsk(s: RealmSession, personId: string): Request {
  s.world.person(personId)!.physiology.energy = .3;
  stepUntil(s, () => s.world.requests.some(r => r.type === 'provision' && r.requesterId === personId), personId);
  const r = s.world.requests.find(r => r.type === 'provision' && r.requesterId === personId)!;
  const ask = s.world.events.find(e => e.type === 'request_created' && e.data.requestId === r.id)!;
  stepUntil(s, () => ask.perceivedBy.some(x => x.who === s.person.id), personId, 600);
  return r;
}
function feed(s: RealmSession, personId: string) {
  standBeside(s, personId);
  const give = handInteractions(s.sim, s.person).find(a => a.kind === 'give' && a.id.endsWith(',' + personId) && /provisions/i.test(a.label))!;
  expect(performHandInteraction(s.sim, s.person, give.id)).toBe('accepted');
}
/** The town onboarding played through the ordinary sim, with John Smith's pass after each beat. */
function playTown(seed = SEED) {
  const s = new RealmSession(seed), who = resident(s), log: string[][] = [];
  reconcileQuests(s.world, s.person.id); log.push(ids(s));
  const r = hungryAsk(s, who.id);
  reconcileQuests(s.world, s.person.id); log.push(ids(s));
  feed(s, who.id); stepUntil(s, () => r.status === 'completed');
  reconcileQuests(s.world, s.person.id); log.push(ids(s));
  return { s, who, r, log };
}

beforeAll(() => loadFocusedGeometry());

describe('John Smith system quests', () => {
  it('issues onboarding from world state, then the Tower, and archives the emergent request beside them', () => {
    const { s, who, r, log } = playTown();
    expect(log[0]).toEqual(['system:onboarding:listen=active']);
    // Hearing the ask is what meets "listen"; John Smith did not raise the ask.
    expect(new Set(log[1])).toEqual(new Set(['system:onboarding:listen=completed', `request:${r.id}=active`, 'system:onboarding:answer=active']));
    expect(new Set(log[2])).toEqual(new Set(['system:onboarding:listen=completed', `request:${r.id}=completed`, 'system:onboarding:answer=completed', 'system:tower:floor:1=active']));
    const journal = questJournal(s.world, s.person.id), emergent = journal.find(e => e.id === `request:${r.id}`)!;
    expect(emergent).toMatchObject({ origin: 'emergent', source: { type: 'request', requestType: 'provision' }, claim: { paid: r.reward, from: who.id } });
    for (const e of journal.filter(x => x.origin === 'system')) {
      expect(e.source).toEqual({ type: 'system', questId: e.id.slice('system:'.length), issuer: 'john_smith' });
      expect(e.title + e.detail).not.toMatch(/[{}]/);
    }
    // The system quest's basis is the canonical ask the player heard.
    const listen = journal.find(e => e.id === 'system:onboarding:listen')!;
    expect(s.world.event(listen.endedBy!)!.type).toBe('request_created');
    const objectives = questObjectives(s.world, s.person.id);
    expect(objectives.map(o => o.id)).toContain('system:tower:floor:1');
    expect(objectives.find(o => o.id === 'system:tower:floor:1')).toMatchObject({ origin: 'system', stage: 'tower', kind: 'reach_floor', reward: { from: 'john_smith' } });
  }, 120000);

  it('is deterministic: the same seed and the same play give the same ledger, text and objectives', () => {
    const a = playTown(), b = playTown();
    expect(a.log).toEqual(b.log);
    expect(JSON.parse(JSON.stringify(questLedger(a.s.world, a.s.person.id)))).toEqual(JSON.parse(JSON.stringify(questLedger(b.s.world, b.s.person.id))));
    expect(JSON.parse(JSON.stringify(questObjectives(a.s.world, a.s.person.id)))).toEqual(JSON.parse(JSON.stringify(questObjectives(b.s.world, b.s.person.id))));
    // Phrasing is seeded by the World seed and quest id only, so another seed may phrase differently but issues the same quests.
    const other = new RealmSession(SEED + 1); reconcileQuests(other.world, other.person.id);
    expect(questJournal(other.world, other.person.id).map(e => e.id)).toEqual(['system:onboarding:listen']);
  }, 180000);

  it('pays each reward exactly once, from a finite reserve, across repeated passes and save/load', () => {
    const { s } = playTown(), p = s.person;
    const paid = systemPaid(s), wealth = p.wealth, ledger = questLedger(s.world, p.id)!;
    expect(paid).toBe(2 + 3);
    expect(ledger.reserve).toEqual({ initial: SYSTEM_RESERVE, remaining: SYSTEM_RESERVE - paid });
    for (let i = 0; i < 5; i++) expect(reconcileQuests(s.world, p.id).completed).toEqual([]);
    expect(p.wealth).toBe(wealth);
    const reloaded = new RealmSession(0, s.save());
    expect(questLedger(reloaded.world, reloaded.person.id)).toEqual(ledger);
    expect(reconcileQuests(reloaded.world, reloaded.person.id).completed).toEqual([]);
    expect(reloaded.person.wealth).toBe(wealth);
    const rewardEvents = reloaded.world.events.filter(e => e.type === 'system_quest_reward');
    expect(rewardEvents.map(e => e.data.questId).sort()).toEqual(['system:onboarding:answer', 'system:onboarding:listen']);
    expect(rewardEvents.every(e => !e.pos && !e.actor)).toBe(true); // John Smith is not in the world: nothing to perceive
    // A ledger whose claims and reserve disagree is refused, not repaired.
    const data = JSON.parse(s.save()); data.questLedgers[p.id].entries.find((e: { id: string }) => e.id === 'system:onboarding:listen').claim = null;
    expect(deserialize(JSON.stringify(data))).toBeNull();
  }, 120000);

  it('walks Tower floors 1–5 from floor-clear receipts, one paid completion per floor and nothing past the first hour', () => {
    const s = new RealmSession(SEED), p = s.person;
    reconcileQuests(s.world, p.id);
    expect(questJournal(s.world, p.id).some(e => e.id.startsWith('system:tower:'))).toBe(false); // the town comes first
    for (let floor = 1; floor <= FIRST_HOUR_TOWER_FLOORS; floor++) {
      clear(s, floor);
      const done = reconcileQuests(s.world, p.id).completed.map(r => r.objectiveId);
      expect(done).toEqual([`system:tower:floor:${floor}`]);
      expect(reconcileQuests(s.world, p.id).completed).toEqual([]);
    }
    expect(questObjectives(s.world, p.id).filter(o => o.stage === 'tower')).toEqual([]);
    const floors = questJournal(s.world, p.id).filter(e => e.id.startsWith('system:tower:'));
    expect(floors.map(e => e.claim!.paid)).toEqual([3, 4, 5, 6, 7]);
    expect(questReceipts(s.world, p.id).filter(r => r.objectiveId.startsWith('system:tower:'))).toHaveLength(FIRST_HOUR_TOWER_FLOORS);
  });

  it('runs dry honestly: once the reserve is spent, completions pay nothing and the archive still balances', () => {
    const s = new RealmSession(SEED), p = s.person;
    reconcileQuests(s.world, p.id);
    questLedger(s.world, p.id)!.reserve = { initial: 0, remaining: 0 }; // fixture: a reserve with nothing in it
    const before = p.wealth; clear(s, 1); reconcileQuests(s.world, p.id);
    expect(questJournal(s.world, p.id).find(e => e.id === 'system:tower:floor:1')!.claim).toMatchObject({ paid: 0, from: 'john_smith' });
    expect(p.wealth).toBe(before);
    expect(deserialize(s.save())).not.toBeNull();
  });
});

describe('John Smith threat responses', () => {
  function forest() { const s = new RealmSession(SEED); s.adoptFocusedWorld(); seedForestLife(s.world); return s; }
  function witnessAttack(s: RealmSession) {
    const w = s.world, boar = w.creatures().find(c => c.species === 'woodland_boar')!, bb = w.primaryBody(boar.id)!, victim = resident(s);
    s.body.pos = { x: bb.pos.x + 3, y: bb.pos.y, z: bb.pos.z }; s.body.yaw = -Math.PI / 2; s.body.path = null;
    const ev = w.emit('attack', { actor: boar.id, target: victim.id, pos: { ...bb.pos }, visibility: 26, loudness: 14, significance: .6, summary: `fixture: ${boar.name} gored ${victim.name}` });
    stepUntil(s, () => !!s.person.knowledge[`ev:${ev.id}`], undefined, 600);
    return { boar, bb, victim, ev };
  }

  it('issues a threat response only once the player knows of the attack, and pays it when the player ends the threat', () => {
    const s = forest(), w = s.world;
    reconcileQuests(w, s.person.id);
    expect(questJournal(w, s.person.id).some(e => e.id.startsWith('system:threat:'))).toBe(false);
    const { boar, bb, victim } = witnessAttack(s);
    reconcileQuests(w, s.person.id);
    const threat = questJournal(w, s.person.id).find(e => e.id === `system:threat:${boar.id}`)!;
    expect(threat).toMatchObject({ state: 'active', stage: 'forest', kind: 'hunt', facts: { threatId: boar.id } });
    expect(threat.title + threat.detail).toContain(boar.name);
    expect(threat.detail).toContain(victim.name);
    const ordered = questObjectives(w, s.person.id).map(o => o.stage);
    expect(ordered.lastIndexOf('town')).toBeLessThan(ordered.indexOf('forest'));
    s.body.pos = { x: bb.pos.x + 1, y: bb.pos.y, z: bb.pos.z };
    for (let i = 0; i < 20 && !bb.dead; i++) s.sim.applyHit(s.person, s.body, bb, 30, 'kill');
    expect(bb.dead).toBe(true);
    const before = s.person.wealth;
    expect(reconcileQuests(w, s.person.id).completed.map(r => r.objectiveId)).toContain(threat.id);
    expect(threat).toMatchObject({ state: 'completed', claim: { paid: 4, from: 'john_smith' } });
    expect(w.event(threat.endedBy!)!).toMatchObject({ type: 'kill', actor: s.person.id, target: boar.id });
    expect(s.person.wealth).toBe(before + 4);
    expect(reconcileQuests(w, s.person.id).completed).toEqual([]);
    // One response per threat, ever: a later attack the player learns of does not reissue it.
    expect(questJournal(w, s.person.id).filter(e => e.id === threat.id)).toHaveLength(1);
  }, 120000);

  it('closes without payment when someone else ends the threat', () => {
    const s = forest(), w = s.world, { boar, bb, victim } = witnessAttack(s);
    reconcileQuests(w, s.person.id);
    const vb = w.primaryBody(victim.id)!; vb.pos = { x: bb.pos.x + 1, y: bb.pos.y, z: bb.pos.z };
    for (let i = 0; i < 20 && !bb.dead; i++) s.sim.applyHit(victim, vb, bb, 30, 'kill');
    expect(bb.dead).toBe(true);
    const before = s.person.wealth;
    reconcileQuests(w, s.person.id);
    expect(questJournal(w, s.person.id).find(e => e.id === `system:threat:${boar.id}`)).toMatchObject({ state: 'resolved', claim: null });
    expect(s.person.wealth).toBe(before);
  }, 120000);
});

describe('John Smith is outside the progression ontology', () => {
  it('is drawn on the conceptual ladder only beyond the boundary, never as an attainable stage', () => {
    expect(ONTOLOGICAL_STAGES.at(-1)).toBe(ONTOLOGY_BOUNDARY);
    expect(ONTOLOGY_BOUNDARY).toBe('John Smith');
    expect(ATTAINABLE_STAGES).not.toContain('John Smith');
    expect(ATTAINABLE_STAGES.at(-1)).toBe('Astral Being');
    expect(isAttainableStage('John Smith')).toBe(false);
    expect(STAGE_EXTENSIONS.find(s => s.name === 'John Smith')).toMatchObject({ attainable: false, implemented: false });
    expect([...TRANSFORMATIONS, ...LEGACY_TRANSFORMATIONS].map(t => t.stage)).not.toContain('John Smith');
    expect(JOHN_SMITH.beyond).toBe(ONTOLOGY_BOUNDARY);
  });

  it('is never an entity in the world, and a save claiming his stage for anyone is refused', () => {
    const { s } = playTown();
    expect(s.world.get(JOHN_SMITH.id)).toBeUndefined();
    expect(s.world.persons().some(p => p.name === JOHN_SMITH.name || (p.ontology.stage as string) === 'John Smith')).toBe(false);
    expect(s.person.ontology.stage).toBe('Normal'); // rewards never touch progression
    const data = JSON.parse(s.save()); data.persons.find((p: { id: string }) => p.id === s.person.id).ontology.stage = 'John Smith';
    expect(deserialize(JSON.stringify(data))).toBeNull();
  }, 120000);
});
