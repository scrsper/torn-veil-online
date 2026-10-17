import { describe, expect, it } from 'vitest';
import { RealmSession } from '../../src/sim/world/realms/session';
import { applyTowerCommand, type TowerCommand } from '../../src/server/canonicalTower';
import { currentTowerFloor, observeCanonicalTower } from '../../src/sim/world/interiors/tower';
import { FoldedRealmGrid } from '../../src/sim/world/interiors/grid';
import { towerFloorSpec, floorPlan } from '../../src/sim/world/interiors/floorSpec';
import { questLedger, reconcileQuests, questReceipts } from '../../src/sim/quests';

let seq = 0;
const command = (s: RealmSession, type: TowerCommand['type']): TowerCommand => ({ id: `floor-spec-${++seq}`, type, revision: s.world.canonicalTower?.revision ?? 0, runId: s.world.canonicalTower?.id });
const rel = (p: { solids: { x: number; z: number; w: number; d: number }[]; origin: { x: number; z: number }; exit: { z: number } }) =>
  p.solids.map(b => [b.x - p.origin.x, b.z - p.origin.z, b.w, b.d].map(v => Math.round(v * 100) / 100).join(',')).join(';') + `|${p.exit.z - p.origin.z}`;

describe('floor spec matches the canonical Tower', () => {
  it('climbs floors through ordinary combat and finds the spec plan, wardens and award on each', () => {
    const s = new RealmSession(), tower = s.grid.chunk('aether', 32, 32).buildings[0];
    s.world.setDoorOpen(tower.door, true, s.person.id); s.body.pos = { x: tower.door.x + .5, y: 1, z: tower.z + 4.5 };
    applyTowerCommand(s, command(s, 'enter'));
    const run = s.world.canonicalTower!;
    for (let floor = 1; floor <= 6; floor++) {
      const f = currentTowerFloor(s.world)!, spec = towerFloorSpec(run.seed, floor), plan = (s.grid as FoldedRealmGrid).interior(f.interiorId);
      expect(f.floor).toBe(floor);
      expect(rel(plan)).toBe(rel(floorPlan(run.seed, floor)));
      expect(f.enemyBodyIds.length).toBeLessThanOrEqual(spec.encounter.enemies);
      expect(f.enemyBodyIds.length).toBeGreaterThan(0);
      expect(f.enemyBodyIds.map(id => s.world.person(s.world.body(id)!.ownerId)!.tags.find(t => t.startsWith('warden:'))!.slice(7))).toEqual(spec.wardens.slice(0, f.enemyBodyIds.length));
      expect(f.rewardItemIds.map(id => s.world.item(id)!.arcaneSource?.abilityId).filter(Boolean)).toEqual([spec.award.abilityId]);
      expect(f.sourceItemIds.length > 0).toBe(spec.startingSources);
      // Gate: the stair refuses until the floor is cleared.
      s.body.pos = { ...plan.exit };
      expect(() => applyTowerCommand(s, command(s, 'ascend'))).toThrow();
      for (const id of f.enemyBodyIds) { s.sim.applyHit(s.person, s.body, s.world.body(id)!, 1000, 'injure'); observeCanonicalTower(s.world); }
      expect(currentTowerFloor(s.world)!.clearEventId).toBeTruthy();
      s.body.health = s.body.maxHealth;
      reconcileQuests(s.world, s.person.id);
      if (floor < 6) { s.body.pos = { ...plan.exit }; applyTowerCommand(s, command(s, 'ascend')); }
    }
    // John Smith's floor quests (1–5) close once each; reconciling again pays nothing more.
    const paid = questReceipts(s.world, s.person.id).filter(r => r.objectiveId.startsWith('system:tower:'));
    reconcileQuests(s.world, s.person.id);
    expect(questReceipts(s.world, s.person.id).filter(r => r.objectiveId.startsWith('system:tower:'))).toEqual(paid);
    expect(new Set(paid.map(r => r.objectiveId)).size).toBe(paid.length);
    expect(questLedger(s.world, s.person.id).entries.filter(e => e.origin === 'system' && e.id.startsWith('system:tower:floor:') && e.state === 'completed').length).toBeGreaterThanOrEqual(5);
  }, 120000);
});
