import type { World } from '../../core/world';
import { realmAt, realmSeed } from '../realms/layout';
import { FoldedRealmGrid } from './grid';
import { interiorSlot } from './layout';
import type { CanonicalTowerRun } from './towerTypes';
import { canonicalPlayerBodyId } from '../universe/binding';

const ids = (x: unknown, max: number): x is string[] => Array.isArray(x) && x.length <= max
  && x.every(id => typeof id === 'string' && !!id && id.length <= 200) && new Set(x).size === x.length;
/** Reject partial overlays and contradictory receipts. This is integrity checking of
 * a host save, not an authentication scheme for arbitrary user-edited files. */
export function validCanonicalTower(w: World, value: unknown, version: number): value is CanonicalTowerRun | undefined {
  if (value === undefined) return true;
  try {
    const r = value as CanonicalTowerRun;
    if (version < 30 || !r || r.version !== 1 || r.authority !== 'canonical' || !(w.grid instanceof FoldedRealmGrid)
      || typeof r.id !== 'string' || !r.id || r.id.length > 128 || r.seed !== realmSeed(w.seed, 'canonical-tower')
      || r.personId !== w.playerId || canonicalPlayerBodyId(w, r.personId) !== r.bodyId || r.towerId !== 'veil:tower:chrysanthus'
      || !['aether', 'brass'].includes(r.realm) || ![r.returnPos?.x, r.returnPos?.y, r.returnPos?.z].every(Number.isFinite)
      || (w.realmSpec?.focusedKit&&r.realm==='brass'? !w.grid.movementGeometryAt(r.returnPos.x,r.returnPos.z)?.fits(r.returnPos.x,r.returnPos.y,r.returnPos.z,.3,1.75):r.returnPos.y!==1) || realmAt(r.returnPos.x, r.returnPos.z) !== r.realm
      || typeof r.active !== 'boolean' || r.active && (w.realmExpedition?.active || w.universeExpedition?.active)
      || !['open', 'fallen', 'completed'].includes(r.status) || !Number.isSafeInteger(r.revision) || r.revision < 0
      || !Number.isInteger(r.floor) || r.floor < 1 || r.floor > 100
      || !Array.isArray(r.floors) || r.floors.length !== r.floor || !Array.isArray(r.commands) || r.commands.length > 512) return false;
    const tower = r.realm==='brass'&&w.grid.focusedTown?w.grid.focusedTown.tower:w.grid.chunk(r.realm, 32, 32).buildings[0], opened = w.event(r.openedEventId);
    if (!(r.returnPos.x > tower.x && r.returnPos.x < tower.x + tower.w - 1 && r.returnPos.z > tower.z && r.returnPos.z < tower.z + tower.d - 1)
      || opened?.type !== 'tower_entered' || opened.actor !== r.personId || opened.data.bodyId !== r.bodyId) return false;
    if (new Set(r.commands.map(c => c.id)).size !== r.commands.length || r.commands.some((c, i) =>
      !c || typeof c.id !== 'string' || c.id.length < 8 || c.id.length > 100 || !/^[a-f0-9]{64}$/.test(c.digest)
      || !Number.isSafeInteger(c.revision) || c.revision < 1 || c.revision > r.revision || i > 0 && c.revision <= r.commands[i - 1].revision)) return false;
    const body = w.body(r.bodyId)!;
    if (r.status === 'fallen' && !body.dead && w.person(r.personId)?.alive || r.status === 'completed' && r.floor !== 100) return false;
    for (const [index, f] of r.floors.entries()) {
      const d = w.interiors!.descriptors.find(d => d.id === f.interiorId), e = w.event(f.openedEventId), agreement = w.event(f.agreementEventId);
      if (f.floor !== index + 1 || f.interiorId !== `${r.id}:floor:${f.floor}` || !d || d.seed !== r.seed || d.floor !== f.floor || d.buildingId !== r.towerId
        || !w.place(f.placeId) || e?.type !== 'tower_floor_opened' || e.actor !== r.personId || e.placeId !== f.placeId
        || e.data.runId !== r.id || e.data.floor !== f.floor || e.data.interiorId !== f.interiorId
        || agreement?.type !== 'combat_trial_agreed' || agreement.data.trialId !== f.trialId || !agreement.causes.includes(e.id)
        || !Number.isFinite(f.enteredAt) || f.enteredAt < 0 || f.enteredAt > w.physicalTime
        || !ids(f.enemyBodyIds, 32) || !f.enemyBodyIds.length || !ids(f.sourceItemIds, 8) || !ids(f.rewardItemIds, 8)
        || !Array.isArray(f.defeats) || f.defeats.length > f.enemyBodyIds.length || new Set(f.defeats.map(x => x.bodyId)).size !== f.defeats.length) return false;
      const rivals = f.enemyBodyIds.map(id => w.body(id)?.ownerId);
      const participants = new Set([r.personId, ...rivals]);
      if (rivals.some(id => { const at = w.person(id)?.towerUpkeepAt; return at !== undefined && (version < 31 || !Number.isFinite(at) || at < 0 || at > w.now); })) return false;
      if (rivals.some(id => !id || id === r.personId || w.person(id)?.combatTrial?.id !== f.trialId)
        || JSON.stringify(agreement.data.sides) !== JSON.stringify([[r.personId], rivals])) return false;
      for (const defeat of f.defeats) {
        const enemy = w.body(defeat.bodyId), evidence = w.event(defeat.evidenceEventId), ended = w.event(defeat.endedEventId);
        if (!enemy || !f.enemyBodyIds.includes(enemy.id) || !evidence || evidence.tick < e.tick
          || !(participants.has(evidence.actor!) && evidence.target === enemy.ownerId && (evidence.type === 'kill'
            || evidence.type === 'attack' && evidence.data.targetBodyId === enemy.id && evidence.data.health <= 0)
            || evidence.type === 'entity_surrendered' && evidence.actor === enemy.ownerId && participants.has(evidence.target!))
          || ended?.type !== 'combat_trial_ended' || ended.data.trialId !== f.trialId || !ended.data.participants?.includes(enemy.ownerId)
          || !ended.causes.includes(evidence.id) || w.person(enemy.ownerId)?.combatTrial?.endedEventId !== ended.id) return false;
      }
      const clear = f.clearEventId ? w.event(f.clearEventId) : null, reserve = w.container(f.rewardContainerId);
      if (!reserve || reserve.placeId !== f.placeId || reserve.ownerId !== (clear ? r.personId : f.placeId)
        || f.clearEventId && (clear?.type !== 'tower_floor_cleared' || clear.actor !== r.personId || clear.data.runId !== r.id || clear.data.floor !== f.floor
          || f.defeats.length !== f.enemyBodyIds.length || f.defeats.some(x => !clear.causes.includes(x.evidenceEventId)))
        || index < r.floor - 1 && !clear || r.status === 'completed' && !clear) return false;
      for (const id of [...f.sourceItemIds, ...f.rewardItemIds]) {
        const item = w.item(id);
        if (!item || !item.provenance.some(p => p.eventId === e.id)) return false;
        if (f.rewardItemIds.includes(id) && (!clear && (item.ownerId !== f.placeId || item.containerId !== reserve.id)
          || clear && !item.provenance.some(p => p.eventId === clear.id && p.to === r.personId))) return false;
      }
      if (r.active && f.floor === r.floor && interiorSlot(body.pos.x, body.pos.z) !== d.slot) return false;
    }
    return true;
  } catch { return false; }
}
