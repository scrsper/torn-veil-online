import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BridgeSession } from '../../bridge/session';
import { arrangeCombatArena } from '../../bridge/combatArena';
import { B } from '../../sim/physical/blocks';
import { requestCombatAction, requestDefense, captureCombatTransforms } from '../../sim/physical/combatAction';
import { applyInteractionMovement } from '../../sim/physical/interactionMovement';
import { setExternalControl } from '../../sim/runtime/controllers';
import type { DefenseKind } from '../../sim/physical/combatActionTypes';

const cases: { name: string; defense?: DefenseKind; at?: number; blocked?: boolean;
  low?: boolean; move?: boolean; npc?: boolean; lateReaction?: boolean; outcome: string }[] = [
  { name: 'A no defense', outcome: 'hit' },
  { name: 'B timely sidestep', defense: 'sidestep', at: .1, outcome: 'miss' },
  { name: 'C late sidestep', defense: 'sidestep', at: .39, outcome: 'hit' },
  { name: 'D blocked backstep', defense: 'backstep', at: .1, blocked: true, outcome: 'hit' },
  { name: 'E timely backstep', defense: 'backstep', at: .1, outcome: 'miss' },
  { name: 'F duck against high', defense: 'duck', at: .1, outcome: 'miss' },
  { name: 'G duck against low', defense: 'duck', at: .1, low: true, outcome: 'hit' },
  { name: 'H target leaves path after commitment', move: true, outcome: 'miss' },
  { name: 'I NPC timely perception response', npc: true, outcome: 'miss' },
  { name: 'I NPC delayed response', npc: true, lateReaction: true, outcome: 'hit' },
];

const results = cases.map(test => {
  const s = new BridgeSession(123, { arena: true });
  arrangeCombatArena(s, 'idle');
  const w = s.world, [p, target] = w.persons(), ab = w.primaryBody(p.id)!, tb = w.primaryBody(target.id)!;
  ab.pos.x = 20.6; tb.pos.x = 21.65;
  if (test.blocked) {
    for (let z = 18; z <= 22; z++) for (let y = 1; y <= 3; y++) w.grid.set(22, y, z, B.Stone);
    w.nav.rebuildArea(21, 18, 23, 22);
  }
  if (test.npc) setExternalControl(target, false);
  const initialPosition = { ...tb.pos }, initialHealth = tb.health;
  const r = requestCombatAction(w, { attackerId: p.id, attackerBodyId: ab.id, targetBodyId: tb.id,
    attackMode: 'strike', trajectory: test.low ? 'low' : 'high' }, 'arena-attack');
  assert(r.attempted && !r.hit && !r.injury);
  assert.equal(tb.health, initialHealth);
  let defended = false, limitedReaction = false;
  const frames = [];
  for (let tick = 0; tick < 60; tick++) {
    const before = captureCombatTransforms(w), dt = 1 / 60;
    if (test.defense && !defended && w.physicalTime + 1e-9 >= test.at!) {
      assert.equal(requestDefense(w, tb.id, test.defense, 1, 'arena-defense'), 'accepted'); defended = true;
    }
    if (test.move && w.physicalTime >= .22) applyInteractionMovement(w, target, tb, { x: 0, z: 1, sprint: false }, dt);
    if (test.lateReaction && target.mind.combatCue && !limitedReaction) {
      target.mind.combatCue.reactAt += .4; limitedReaction = true;
    }
    w.physicalTime += dt; s.sim.stepScheduled(dt, dt, before);
    if (w.physicalTime < .3) assert.equal(tb.health, initialHealth);
    frames.push({ time: w.physicalTime, phase: ab.combatAction!.phase, outcome: ab.combatAction!.outcome,
      defenderPosition: { ...tb.pos }, defense: tb.combatAction?.kind ?? null, health: tb.health });
  }
  const action = ab.combatAction!;
  assert.equal(action.outcome, test.outcome, test.name);
  assert.equal(w.events.filter(e => e.type === 'attack').length, test.outcome === 'hit' ? 1 : 0);
  if (test.blocked) assert(tb.pos.x - initialPosition.x < .1);
  return { name: test.name, outcome: action.outcome, start: action.startedAt, active: action.activeAt,
    recovery: action.recoveryAt, complete: action.completeAt, initialHealth, finalHealth: tb.health,
    displacement: Math.hypot(tb.pos.x - initialPosition.x, tb.pos.z - initialPosition.z),
    contact: action.contact ?? null, facingChange: action.facing - action.initialFacing,
    reactionEvidence: target.mind.combatCue?.evidenceId ?? null, frames };
});
mkdirSync('docs/evidence/realtime', { recursive: true });
writeFileSync('docs/evidence/realtime/combat-counterfactuals.json', JSON.stringify({
  seed: 123, stepHz: 60, maxContactSegmentSeconds: 1 / 120, results,
  scope: 'Deterministic canonical arena; these results alone do not validate rendered clients or human approval.',
}, null, 2));
console.log(JSON.stringify(results.map(({ frames, ...result }) => result), null, 2));
