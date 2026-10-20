import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RealmSession } from '../src/sim/world/realms/session';
import { applyTowerCommand, type TowerCommand } from '../src/server/canonicalTower';
import { currentTowerFloor, observeCanonicalTower } from '../src/sim/world/interiors/tower';
import { FoldedRealmGrid } from '../src/sim/world/interiors/grid';
import { TowerController } from '../src/server/towerController';
import { RealmRuntime, type RealmOperation } from '../src/server/realmRuntime';
import { RealmJournalStore } from '../src/server/realmJournalStore';
import { performContainerTransfer, performHandInteraction } from '../src/sim/physical/hand';
import { portalPoint } from '../src/sim/world/realms/layout';
import { applyJohnSmithCommand, johnSmithView, observeJohnSmith } from '../src/sim/orchestrator';
import { holderRecord } from '../src/sim/orchestrator/state';
import type { Quest } from '../src/sim/orchestrator/types';

let seq = 0;
const command = (s: RealmSession, type: TowerCommand['type']): TowerCommand => ({ id: `js-tower-${++seq}`, type, revision: s.world.canonicalTower?.revision ?? 0, runId: s.world.canonicalTower?.id });
/** A fresh world is watched from its first host step, before anyone walks into the Tower. */
function entered(): RealmSession { const s = new RealmSession(); observeJohnSmith(s.world); atrium(s); applyTowerCommand(s, command(s, 'enter')); return s; }
function atrium(s: RealmSession) {
  const tower = s.grid.chunk('aether', 32, 32).buildings[0]; s.world.setDoorOpen(tower.door, true, s.person.id);
  s.body.pos = { x: tower.door.x + .5, y: 1, z: tower.z + 4.5 };
}
/** One canonical fixed step per call, with John Smith's watch after it: the host's own path. */
function run(c: TowerController, steps = 70) { for (let i = 0; i < steps; i++) c.step(); }
function host(s: RealmSession) { const c = new TowerController(s); c.bind(`js-${++seq}`); return c; }
const quests = (s: RealmSession) => holderRecord(s.world.johnSmith!, s.person.id).quests;
const find = (s: RealmSession, kind: Quest['kind'], status?: Quest['status']) => quests(s).filter(q => q.kind === kind && (!status || q.status === status));
/** Fixture: canonical hits that ground every warden. Not timing or playability evidence. */
function clearFloor(s: RealmSession) {
  for (const id of currentTowerFloor(s.world)!.enemyBodyIds) { s.sim.applyHit(s.person, s.body, s.world.body(id)!, 1000, 'injure'); observeCanonicalTower(s.world); }
}
function claimAward(s: RealmSession) {
  const award = s.world.container(currentTowerFloor(s.world)!.rewardContainerId)!;
  s.body.pos = { ...award.pos!, z: award.pos!.z + 1 };
  expect(performHandInteraction(s.sim, s.person, `open:${award.id}`)).toBe('accepted');
  for (const id of [...award.itemIds]) expect(performContainerTransfer(s.sim, s.person, award.id, id, 'out')).toBe('accepted');
}
const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('John Smith in the connected realms and the canonical Tower', () => {
  it('recognizes the trial the holder agreed to, refuses caches mid-trial, and follows clear, award and coffer to their ends', () => {
    const s = entered();
    const c = host(s); run(c);
    const floor = currentTowerFloor(s.world)!;
    let trial = find(s, 'trial')[0];
    expect(trial).toEqual(expect.objectContaining({ title: 'Trial of floor 1', status: 'open', watched: true }));
    expect(trial.objectives[0]).toEqual(expect.objectContaining({ have: 0, need: floor.enemyBodyIds.length }));
    const ledger = s.world.johnSmith!.ledgers[s.person.id];
    expect(ledger.feats['tower-door']).toBeDefined();
    const cache = s.world.johnSmith!.caches.find(x => x.recipientId === s.person.id)!;
    expect(applyJohnSmithCommand(s.world, s.person.id, { type: 'open_cache', cacheId: cache.id }).result).toBe('unsafe:trial_active');
    clearFloor(s); run(c);
    trial = find(s, 'trial')[0];
    expect(trial.status).toBe('completed');
    expect(trial.outcome?.eventId).toBe(currentTowerFloor(s.world)!.clearEventId);
    expect(trial.cacheId).toBeUndefined(); // floor 1 is not a milestone; its sealed award is the reward
    for (const id of ['first-down', 'floor-1', 'untouched', 'settled']) expect(s.world.johnSmith!.ledgers[s.person.id].feats[id], id).toBeDefined();
    const award = find(s, 'award', 'open')[0];
    expect(award.target?.label).toBe('Floor 1 sealed award');
    // A cleared trial is a safe moment: the cache unfolds as an owned coffer the holder must empty.
    const opened = applyJohnSmithCommand(s.world, s.person.id, { type: 'open_cache', cacheId: cache.id });
    expect(opened.result).toBe('opened');
    run(c);
    expect(find(s, 'coffer', 'open')).toHaveLength(1);
    for (const id of opened.itemIds!) expect(performContainerTransfer(s.sim, s.person, opened.cofferId!, id, 'out')).toBe('accepted');
    run(c);
    expect(find(s, 'coffer')[0].status).toBe('completed');
    expect(s.world.container(opened.cofferId!)!.pos).toBeNull();
    claimAward(s); run(c);
    expect(find(s, 'award')[0].status).toBe('completed');
    expect(s.world.johnSmith!.ledgers[s.person.id].feats.award).toBeDefined();
    // Nothing in the holder's interface names a warden it never learned.
    const view = JSON.stringify(johnSmithView(s.world, s.person.id));
    expect(view).not.toMatch(/Trial \d+ warden \d+/);
    expect(view).toContain('a trial warden');
  });

  it('records a floor cleared between two passes once, as closed, and marks Tower milestones with the reserve', () => {
    const s = entered();
    const c = host(s); run(c);
    for (let floor = 1; floor <= 5; floor++) {
      // From floor 2 on, the floor is cleared before any watch pass has seen it open.
      clearFloor(s);
      run(c); claimAward(s); run(c);
      if (floor < 5) {
        s.body.pos = { ...(s.grid as FoldedRealmGrid).interior(currentTowerFloor(s.world)!.interiorId).exit };
        applyTowerCommand(s, command(s, 'ascend'));
      }
    }
    const trials = find(s, 'trial');
    expect(trials.map(q => [q.title, q.status])).toEqual([1, 2, 3, 4, 5].map(n => [`Trial of floor ${n}`, 'completed']));
    const notices = holderRecord(s.world.johnSmith!, s.person.id).notices;
    expect(notices.filter(n => n.title === 'Trial of floor 3')).toHaveLength(1);
    expect(trials[4].cacheId).toMatch(/^veil-cache:silver:/);
    expect(trials.slice(0, 4).every(q => q.cacheId === undefined)).toBe(true);
    expect(s.world.johnSmith!.ledgers[s.person.id].feats['floor-5']).toBeDefined();
    expect(holderRecord(s.world.johnSmith!, s.person.id).bestTrial).toBe(5);
  });

  it('pays a Tower milestone only at new altitude', () => {
    const s = entered();
    holderRecord(s.world.johnSmith!, s.person.id).bestTrial = 7; // as if an earlier run had climbed higher
    const c = host(s); run(c);
    for (let floor = 1; floor <= 5; floor++) {
      clearFloor(s); run(c); claimAward(s); run(c);
      if (floor < 5) { s.body.pos = { ...(s.grid as FoldedRealmGrid).interior(currentTowerFloor(s.world)!.interiorId).exit }; applyTowerCommand(s, command(s, 'ascend')); }
    }
    const fifth = find(s, 'trial').find(q => q.title === 'Trial of floor 5')!;
    expect(fifth.status).toBe('completed');
    expect(fifth.rewardTier).toBe(-1);
    expect(fifth.cacheId).toBeUndefined();
    expect(holderRecord(s.world.johnSmith!, s.person.id).bestTrial).toBe(7);
  });

  it('notices the threshold the holder has seen, and the Tower they have glimpsed, until each is walked through', () => {
    const s = new RealmSession(), c = host(s), w = s.world;
    s.body.pos = { ...portalPoint('aether'), z: portalPoint('aether').z - 2 }; run(c);
    const veil = find(s, 'veil')[0];
    expect(veil).toEqual(expect.objectContaining({ title: 'Cross the Veil', status: 'open' }));
    expect(veil.target?.pos).toEqual(portalPoint('aether'));
    expect(s.interact()).toMatch(/Veil opens/);
    expect(s.confirm(s.snapshot().pending!.id)).toBe(true);
    run(c);
    expect(find(s, 'veil')[0].status).toBe('completed');
    expect(w.johnSmith!.ledgers[s.person.id].feats.veil).toBeDefined();
    // Back across, then within sight of the Tower but outside it.
    s.body.pos = { ...portalPoint('brass'), z: portalPoint('brass').z - 2 }; s.interact(); s.confirm(s.snapshot().pending!.id); run(c);
    const tower = s.grid.chunk('aether', 32, 32).buildings[0];
    s.body.pos = { x: tower.door.x + .5, y: 1, z: tower.z - 18 }; run(c);
    const visit = find(s, 'landmark').find(q => q.title === 'Visit Tower of Chrysanthus')!;
    expect(visit.status).toBe('open');
    atrium(s); run(c);
    expect(visit.status).toBe('completed');
  });

  it('gives a bearing only to targets the holder can walk to from where they stand', () => {
    const s = new RealmSession(), c = host(s);
    s.body.pos = { ...portalPoint('aether'), z: portalPoint('aether').z - 2 }; run(c);
    const veil = () => johnSmithView(s.world, s.person.id)!.quests.find(q => q.kind === 'veil')!.target;
    expect(veil()).toEqual(expect.objectContaining({ label: 'The Veil threshold', reach: 'here' }));
    s.body.pos = { ...portalPoint('brass'), z: portalPoint('brass').z - 3 };
    expect(veil()?.reach).toBe('veil');
    atrium(s); applyTowerCommand(s, command(s, 'enter'));
    expect(veil()?.reach).toBe('walls'); // the folded Tower floor is not walking distance from the square
  });

  it('survives save and load exactly and keeps watching identically afterwards', () => {
    const s = entered();
    const c = host(s); run(c); clearFloor(s); run(c);
    const restored = new RealmSession(0, s.save());
    expect(restored.world.johnSmith).toEqual(s.world.johnSmith);
    const c2 = host(restored);
    claimAward(s); claimAward(restored); run(c); run(c2);
    expect(JSON.stringify(restored.world.johnSmith)).toBe(JSON.stringify(s.world.johnSmith));
  });

  it('replays journaled John Smith commands and watch passes to the same canonical world', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veil-js-')); roots.push(dir);
    const session = new RealmSession(731); observeJohnSmith(session.world); atrium(session); applyTowerCommand(session, { id: 'enter-js-fixture', type: 'enter', revision: 0 });
    const r = new RealmRuntime(session), store = new RealmJournalStore(join(dir, 'world.json'), 'js-test');
    await store.checkpoint(r, 0);
    const ops: RealmOperation[] = [{ type: 'bind', id: 'js-controller', epoch: 'js-epoch' }];
    for (let i = 0; i < 80; i++) ops.push({ type: 'step', now: i * 17 + 1 });
    for (const op of ops) r.apply(op);
    const trial = find(r.session, 'trial')[0], cache = r.session.world.johnSmith!.caches[0];
    const later: RealmOperation[] = [
      { type: 'johnsmith', command: { type: 'watch_quest', questId: trial.id, watch: false } },
      { type: 'johnsmith', command: { type: 'open_cache', cacheId: cache.id } },
      { type: 'johnsmith', command: { type: 'nonsense' } },
      ...Array.from({ length: 70 }, (_, i): RealmOperation => ({ type: 'step', now: (80 + i) * 17 + 1 })),
    ];
    const results = later.map(op => r.apply(op));
    expect(results[0]).toEqual({ result: 'accepted' });
    expect(results[1]).toEqual({ result: 'unsafe:trial_active' });
    expect(results[2]).toEqual({ result: 'invalid_command' });
    await store.append([...ops, ...later].map((op, i) => ({ sequence: i + 1, op })));
    const replayed = store.load(731).runtime;
    const canonical = (x: RealmRuntime) => { const raw = JSON.parse(x.session.save()); delete raw.savedAt; return raw; };
    expect(canonical(replayed)).toEqual(canonical(r));
    expect(find(replayed.session, 'trial')[0].watched).toBe(false);
  });
});
