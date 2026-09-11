import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, v, wall } from './helpers/world';
import { requestCombatAction, requestDefense, cancelCombatAction } from '../src/sim/physical/combatAction';
import { captureCombatTransforms } from '../src/sim/physical/combatAction';
import { deserialize, serialize } from '../src/sim/persist/save';
import { observeCombatPreparation } from '../src/sim/mind/combatReaction';
import { setExternalControl } from '../src/sim/runtime/controllers';
import { Simulation } from '../src/sim/mind/agent';
import { makeItem } from '../src/sim/world/factory';
import { GameSim } from '../src/sim/runtime/gameSim';
import { CommandQueue } from '../src/bridge/commands';
import { INTERACTION_SPEC, predictMovement } from '../src/sim/physical/prediction';
import { applyInteractionMovement, movementState } from '../src/sim/physical/interactionMovement';
import type { CombatAttackIntent } from '../src/sim/physical/combat';

function setup() {
  const tw = createTestWorld(123);
  const attacker = addPerson(tw, 'Attacker', 'farmer', v(10, 1, 10), { controlled: true });
  const target = addPerson(tw, 'Target', 'farmer', v(11.05, 1, 10), { controlled: true });
  const attackerBody = tw.world.primaryBody(attacker.id)!;
  const targetBody = tw.world.primaryBody(target.id)!;
  target.mind.plan = [];
  const intent: CombatAttackIntent = {
    attackerId: attacker.id, attackerBodyId: attackerBody.id, targetBodyId: targetBody.id,
    attackMode: 'strike', trajectory: 'mid',
  };
  return { ...tw, attacker, target, attackerBody, targetBody, intent };
}

function advance(x: ReturnType<typeof setup>, seconds: number) {
  const dt = 1 / 60;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
    const before = captureCombatTransforms(x.world);
    x.world.physicalTime += dt;
    x.sim.step(dt, dt);
    // Keep the assertion helper honest if a future scheduler changes step's combat hook.
    void before;
  }
}

describe('canonical realtime combat action requests', () => {
  it('corrects an open-space backstep prediction to blocked authority without replaying costs or events', () => {
    const x = setup(); x.targetBody.pos.x = 11.65; x.targetBody.yaw = Math.PI / 2;
    wall(x, 12, 9, 11);
    const q = new CommandQueue('epoch', 'defender', x.targetBody.id);
    const command = { version: 2 as const, type: 'command' as const, epoch: q.epoch, controllerId: q.controllerId,
      bodyId: q.bodyId, sequence: 1, commandId: 'blocked-backstep', specRevision: INTERACTION_SPEC.revision,
      clientTimeMs: 0, command: { type: 'defend' as const, kind: 'backstep' as const } };
    const initialFatigue = x.target.physiology.fatigue;
    let predicted = { ...movementState(x.world, x.target, x.targetBody), speed: INTERACTION_SPEC.backstepMetres / INTERACTION_SPEC.defenseSeconds };
    expect(q.receive(command, 0, 0).status).toBe('received');
    const receipt = q.apply(0, 1, () => requestDefense(x.world, x.targetBody.id, 'backstep', 1, command.commandId))[0];
    expect(receipt.status).toBe('applied');
    for (let i = 0; i < 18; i++) {
      predicted = predictMovement(predicted, { x: 1, z: 0, sprint: false }, 1 / 60,
        () => ({ floor: 1, walkable: true, solids: [0] }));
    }
    advance(x, .3);
    const correction = Math.abs(predicted.pos.x - x.targetBody.pos.x);
    expect(correction).toBeGreaterThan(.75); expect(correction).toBeLessThanOrEqual(.85);
    expect(x.targetBody.pos.x).toBeLessThan(11.71);
    const events = x.world.events.length, fatigue = x.target.physiology.fatigue;
    expect(fatigue).toBeCloseTo(initialFatigue + .018, 3);
    expect(q.receive(command, .3, 20).status).toBe('applied');
    expect(q.apply(.3, 21, () => { throw new Error('replayed consequence'); })).toEqual([]);
    expect(x.world.events).toHaveLength(events); expect(x.target.physiology.fatigue).toBe(fatigue);
  });
  it('accepts attack startup without applying contact or damage immediately', () => {
    const x = setup();
    const beforeHealth = x.targetBody.health;
    const result = requestCombatAction(x.world, x.intent, 'attack-command-1');
    expect(result.attempted).toBe(true);
    expect(result.hit).toBe(false);
    expect(result.actionId).toBeTruthy();
    expect(x.targetBody.health).toBe(beforeHealth);
    const phases=x.world.events.filter(e=>e.type==='combat_action');
    expect(phases[1].causes).toContain(phases[0].id);
    expect(phases[2].causes).toContain(phases[1].id);
    expect(x.attackerBody.combatAction).toMatchObject({
      id: result.actionId, commandId: 'attack-command-1', kind: 'attack', phase: 'preparation',
      trajectory: 'mid', targetBodyId: x.targetBody.id,
    });
  });

  it('rejects a second action while the manifestation is busy and cancels a pending defense once', () => {
    const x = setup();
    expect(requestDefense(x.world, x.attackerBody.id, 'sidestep', -1, 'defense-command-1')).toBe('accepted');
    expect(requestDefense(x.world, x.attackerBody.id, 'backstep', 1, 'defense-command-2')).toBe('cooldown');
    expect(cancelCombatAction(x.world, x.attackerBody.id)).toBe('accepted');
    expect(x.attackerBody.combatAction?.outcome).toBe('cancelled');
  });

  it('preserves a committed action across save/load at the same physical time', () => {
    const x = setup();
    const result = requestCombatAction(x.world, x.intent, 'attack-save-1');
    const restored = deserialize(serialize(x.world));
    expect(restored).not.toBeNull();
    const action = restored!.world.body(x.attackerBody.id)!.combatAction;
    expect(action).toMatchObject({ id: result.actionId, commandId: 'attack-save-1', phase: 'preparation', outcome: 'pending' });
    expect(restored!.world.physicalTime).toBe(x.world.physicalTime);
  });

  it('rejects corrupt persisted executable actions instead of dropping them', () => {
    const x = setup(); requestCombatAction(x.world, x.intent);
    const saved = JSON.parse(serialize(x.world));
    const action = saved.bodies.find((b: { id: string }) => b.id === x.attackerBody.id).combatAction;
    action.recoveryAt = -1;
    expect(deserialize(JSON.stringify(saved))).toBeNull();
  });

  it('resolves one canonical contact during the active window, after startup', () => {
    const x = setup();
    x.attackerBody.yaw = -Math.PI / 2;
    const beforeHealth = x.targetBody.health;
    const result = requestCombatAction(x.world, x.intent, 'attack-contact-1');
    expect(result.hit).toBe(false);
    advance(x, 0.31);
    expect(x.targetBody.health).toBe(beforeHealth);
    advance(x, 0.2);
    expect(x.targetBody.health).toBeLessThan(beforeHealth);
    expect(x.attackerBody.combatAction?.outcome).toBe('hit');
    expect(x.attackerBody.combatAction?.contact?.region).toBeTruthy();
    const healthAfterContact = x.targetBody.health;
    advance(x, 0.45);
    expect(x.targetBody.health).toBe(healthAfterContact);
  });

  it('records a miss when the target remains outside the strike trajectory', () => {
    const x = setup();
    x.attackerBody.yaw = Math.PI / 2;
    const result = requestCombatAction(x.world, x.intent, 'attack-miss-1');
    expect(result.attempted).toBe(true);
    const beforeHealth = x.targetBody.health;
    advance(x, 0.7);
    expect(x.targetBody.health).toBe(beforeHealth);
    expect(x.attackerBody.combatAction?.outcome).toBe('miss');
    expect(x.world.events.some(event => event.type === 'attack_missed')).toBe(true);
  });

  it('gives an NPC a provenance backed preparation cue after observing an incoming strike', () => {
    const x = setup();
    setExternalControl(x.target, false);
    x.target.mind.plan = [];
    x.targetBody.yaw = Math.PI / 2;
    x.attackerBody.yaw = -Math.PI / 2;
    const result = requestCombatAction(x.world, x.intent, 'attack-cue-1');
    expect(result.actionId).toBeTruthy();
    observeCombatPreparation(x.world);
    expect(x.target.mind.combatCue).toMatchObject({ actionId: result.actionId, actorBodyId: x.attackerBody.id, responded: false });
    expect(x.world.events.some(event => event.type === 'perceived' && event.causes.includes(x.attackerBody.combatAction!.eventId))).toBe(true);
  });

  it('keeps combat phases canonical without flooding social memories, and cues a controlled defender without auto-defense', () => {
    const x = setup();
    x.targetBody.yaw = Math.PI / 2;
    x.attackerBody.yaw = -Math.PI / 2;
    const memoriesBefore = x.target.memories.length;
    const result = requestCombatAction(x.world, x.intent, 'attack-controlled-cue-1');
    observeCombatPreparation(x.world);
    const phases = x.world.events.filter(event => event.type === 'combat_action');
    expect(phases).toHaveLength(3);
    expect(phases[1].causes).toContain(phases[0].id);
    expect(phases[2].causes).toContain(phases[1].id);
    expect(x.target.mind.combatCue).toMatchObject({ actionId: result.actionId, responded: false });
    const cue = x.target.mind.combatCue!;
    expect(cue.evidenceId).toBeTruthy();
    const evidence = x.world.event(cue.evidenceId);
    expect(evidence?.type).toBe('perceived');
    expect(evidence?.causes).toContain(x.attackerBody.combatAction!.eventId);
    expect(x.target.memories).toHaveLength(memoriesBefore);
    expect(x.targetBody.combatAction).toBeUndefined();
  });

  it('applies bounded sidestep and backstep displacement through the action clock', () => {
    const side = setup();
    const sideBefore = { ...side.attackerBody.pos };
    expect(requestDefense(side.world, side.attackerBody.id, 'sidestep', 1, 'side-1')).toBe('accepted');
    advance(side, 0.2);
    expect(side.attackerBody.pos.x - sideBefore.x).toBeGreaterThan(0.5);
    expect(side.attackerBody.pos.x - sideBefore.x).toBeLessThanOrEqual(1.05 + 1e-6);

    const back = setup();
    const backBefore = { ...back.attackerBody.pos };
    expect(requestDefense(back.world, back.attackerBody.id, 'backstep', 1, 'back-1')).toBe('accepted');
    advance(back, 0.2);
    expect(back.attackerBody.pos.z - backBefore.z).toBeGreaterThan(0.4);
    expect(back.attackerBody.pos.z - backBefore.z).toBeLessThanOrEqual(0.85 + 1e-6);
  });

  it('resolves paired trajectory counterfactuals from the same initial state', () => {
    const resolve = (trajectory: 'high' | 'low', defend = false) => {
      const x = setup();
      x.attackerBody.yaw = -Math.PI / 2;
      const intent = { ...x.intent, trajectory };
      expect(requestCombatAction(x.world, intent, `${trajectory}-${defend}`)).toMatchObject({ attempted: true, hit: false });
      if (defend) {
        x.world.physicalTime += 0.1;
        expect(requestDefense(x.world, x.targetBody.id, 'duck', 1, `duck-${trajectory}`)).toBe('accepted');
      }
      advance(x, 0.7);
      return { x, outcome: x.attackerBody.combatAction?.outcome, health: x.targetBody.health };
    };
    const plain = resolve('high');
    const duckHigh = resolve('high', true);
    const duckLow = resolve('low', true);
    expect(plain.outcome).toBe('hit');
    expect(duckHigh.outcome).toBe('miss');
    expect(duckHigh.health).toBe(plain.x.targetBody.maxHealth);
    expect(duckLow.health).toBeLessThan(duckHigh.health);
    expect(duckLow.outcome).toBe('hit');
  });

  it('distinguishes timely from late sidestep against the same strike', () => {
    const run = (at: number) => {
      const x = setup(); x.attackerBody.yaw = -Math.PI / 2; x.targetBody.yaw = Math.PI / 2;
      expect(requestCombatAction(x.world, x.intent, `side-attack-${at}`)).toMatchObject({ attempted: true });
      if (at > 0) advance(x, at);
      expect(requestDefense(x.world, x.targetBody.id, 'sidestep', 1, `side-defense-${at}`)).toBe('accepted');
      advance(x, 0.8 - at);
      return { outcome: x.attackerBody.combatAction?.outcome, health: x.targetBody.health };
    };
    const timely = run(0.1), late = run(0.39);
    expect(timely.outcome).toBe('miss');
    expect(late.outcome).toBe('hit');
    expect(timely.health).toBeGreaterThan(late.health);
  });

  it('makes timely backstep evade, while a wall constrained backstep still permits contact', () => {
    const run = (blocked: boolean) => {
      const x = setup(); x.attackerBody.yaw = -Math.PI / 2; x.targetBody.yaw = Math.PI / 2;
      x.attackerBody.pos.x = 10.6; x.targetBody.pos.x = 11.65;
      if (blocked) wall(x, 12, 9, 11);
      expect(requestCombatAction(x.world, x.intent, `back-attack-${blocked}`)).toMatchObject({ attempted: true });
      x.world.physicalTime += 0.1;
      expect(requestDefense(x.world, x.targetBody.id, 'backstep', 1, `back-defense-${blocked}`)).toBe('accepted');
      const before = { ...x.targetBody.pos }; advance(x, 0.8);
      return { x, moved: Math.hypot(x.targetBody.pos.x - before.x, x.targetBody.pos.z - before.z) };
    };
    const timely = run(false), blocked = run(true);
    expect(timely.x.attackerBody.combatAction?.outcome).toBe('miss');
    expect(timely.moved).toBeGreaterThan(0.4);
    expect(blocked.x.attackerBody.combatAction?.outcome).toBe('hit');
    expect(blocked.moved).toBeLessThan(0.1);
  });

  it('continues identically from a mid-active save', () => {
    const x = setup(); x.attackerBody.yaw = -Math.PI / 2;
    expect(requestCombatAction(x.world, x.intent, 'active-save-1')).toMatchObject({ attempted: true });
    advance(x, 0.35);
    expect(x.attackerBody.combatAction?.phase).toBe('active');
    const resumed = deserialize(serialize(x.world))!;
    const resumedSim = new Simulation(resumed.world);
    for (let i = 0; i < 30; i++) {
      const dt = 1 / 60;
      x.world.physicalTime += dt; x.sim.step(dt, dt);
      resumed.world.physicalTime += dt; resumedSim.step(dt, dt);
    }
    expect(resumed.world.body(x.attackerBody.id)!.health).toBe(x.attackerBody.health);
    expect(resumed.world.body(x.attackerBody.id)!.combatAction).toEqual(x.attackerBody.combatAction);
    expect(resumed.world.body(x.targetBody.id)!.health).toBe(x.targetBody.health);
    const combatEvents = (events: typeof x.world.events) => events.filter(e => e.type === 'combat_action' || e.type === 'attack' || e.type === 'attack_missed').map(e => [e.type, e.data]);
    expect(combatEvents(resumed.world.events)).toEqual(combatEvents(x.world.events));
  });

  it('starts two independently controlled attacks exactly once and keeps simultaneous contacts order independent', () => {
    const run = (reverse: boolean) => {
      const x = setup();
      x.attackerBody.yaw = -Math.PI / 2; x.targetBody.yaw = Math.PI / 2;
      const game = new GameSim(x.sim);
      expect(game.attach('left', x.attacker.id)).toBe(true);
      expect(game.attach('right', x.target.id)).toBe(true);
      const left = new CommandQueue('epoch-left', 'left', x.attackerBody.id);
      const right = new CommandQueue('epoch-right', 'right', x.targetBody.id);
      const envelope = (q: CommandQueue, sequence: number, id: string, targetBodyId: string) => ({ version: 2 as const, type: 'command' as const, epoch: q.epoch, controllerId: q.controllerId, bodyId: q.bodyId, sequence, commandId: id, specRevision: INTERACTION_SPEC.revision, clientTimeMs: sequence, command: { type: 'attack' as const, targetBodyId } });
      const l = envelope(left, 0, 'left-attack', x.targetBody.id), r = envelope(right, 0, 'right-attack', x.attackerBody.id);
      expect(left.receive(l, 0, 0).status).toBe('received');
      expect(right.receive(r, 0, 0).status).toBe('received');
      expect(left.receive(l, 0, 1).status).toBe('received');
      expect(right.receive(r, 0, 1).status).toBe('received');
      const execute = (bodyId: string, targetBodyId: string, id: string) => requestCombatAction(x.world, { attackerId: x.world.body(bodyId)!.ownerId, attackerBodyId: bodyId, targetBodyId, attackMode: 'strike' }, id).attempted ? 'accepted' : 'rejected';
      const applyLeft = () => left.apply(1, 1, () => execute(x.attackerBody.id, x.targetBody.id, 'left-attack'));
      const applyRight = () => right.apply(1, 1, () => execute(x.targetBody.id, x.attackerBody.id, 'right-attack'));
      const receipts = reverse ? [...applyRight(), ...applyLeft()] : [...applyLeft(), ...applyRight()];
      expect(receipts.every(receipt => receipt.status === 'applied')).toBe(true);
      expect(x.attackerBody.combatAction?.id).toBeTruthy();
      expect(x.targetBody.combatAction?.id).toBeTruthy();
      expect(x.attackerBody.combatAction?.id).not.toBe(x.targetBody.combatAction?.id);
      expect(x.attackerBody.health).toBe(x.attackerBody.maxHealth);
      expect(x.targetBody.health).toBe(x.targetBody.maxHealth);
      advance(x, 0.8);
      expect(x.world.events.filter(e => e.type === 'attack')).toHaveLength(2);
      return x.world.events.filter(e => e.type === 'attack').map(e => {
        const combat = e.data.combat as { attackerBodyId: string; targetBodyId: string; contactRegion?: string; hit: boolean };
        return { attackerBodyId: combat.attackerBodyId, targetBodyId: combat.targetBodyId, contactRegion: combat.contactRegion, hit: combat.hit };
      }).sort((a, b) => a.attackerBodyId.localeCompare(b.attackerBodyId));
    };
    expect(run(false)).toEqual(run(true));
  });

  it('lets an ordinary NPC react through its action plan, while a delayed cue arrives too late', () => {
    const run = (delay: boolean) => {
      const x = setup();
      setExternalControl(x.target, false); x.target.mind.plan = []; x.target.mind.thinkInterval = Number.POSITIVE_INFINITY;
      x.attackerBody.yaw = -Math.PI / 2; x.targetBody.yaw = Math.PI / 2;
      expect(requestCombatAction(x.world, x.intent, `npc-attack-${delay}`)).toMatchObject({ attempted: true });
      advance(x, 0.05);
      expect(x.target.mind.combatCue).toBeTruthy();
      if (delay) x.target.mind.combatCue!.reactAt = 1;
      advance(x, 0.75);
      return x.attackerBody.combatAction?.outcome;
    };
    expect(run(false)).toBe('miss');
    expect(run(true)).toBe('hit');
  });

  it('uses the same delayed lifecycle for player-vs-NPC, NPC-vs-player, and NPC-vs-NPC attacks', () => {
    const run = (attackerNpc: boolean, targetNpc: boolean) => {
      const x = setup();
      setExternalControl(x.attacker, !attackerNpc); setExternalControl(x.target, !targetNpc);
      x.attacker.mind.plan = []; x.target.mind.plan = [];
      if (attackerNpc) x.attacker.mind.thinkInterval = Number.POSITIVE_INFINITY;
      if (targetNpc) x.target.mind.thinkInterval = Number.POSITIVE_INFINITY;
      x.attackerBody.yaw = -Math.PI / 2; x.targetBody.yaw = 0; // Incoming attacker is outside the defensive perception cone.
      if (attackerNpc) {
        x.attacker.mind.thinkInterval = Number.POSITIVE_INFINITY;
        x.attacker.mind.plan = [{ type: 'attack', targetEntity: x.target.id, status: 'pending', data: { intent: 'injure' } }];
      } else expect(requestCombatAction(x.world, x.intent, `parity-${attackerNpc}-${targetNpc}`)).toMatchObject({ attempted: true });
      advance(x, .2);
      expect(x.attackerBody.combatAction?.phase).toBe('preparation');
      expect(x.targetBody.health).toBe(x.targetBody.maxHealth);
      advance(x, .6);
      return { attackSeq: x.attackerBody.attackSeq, health: x.targetBody.health, targetHealth: x.targetBody.maxHealth };
    };
    for (const pair of [[false, true], [true, false], [true, true]] as const) {
      const result = run(pair[0], pair[1]);
      expect(result.attackSeq).toBe(1);
      expect(result.health).toBeLessThan(result.targetHealth);
    }
  });

  it('interrupts an armed action when its weapon is withdrawn during preparation', () => {
    const x = setup();
    const sword = makeItem(x.world, 'sword', 'withdrawn sword', { holder: x.attacker.id, damage: 26 });
    x.attacker.inventory.push(sword.id); x.attackerBody.yaw = -Math.PI / 2;
    expect(requestCombatAction(x.world, { ...x.intent, weaponId: sword.id }, 'withdraw-weapon-1')).toMatchObject({ attempted: true });
    x.attacker.inventory = x.attacker.inventory.filter(id => id !== sword.id);
    x.world.physicalTime += 0.1;
    x.sim.step(0.1, 0.1);
    expect(x.attackerBody.combatAction?.outcome).toBe('interrupted');
    expect(x.attackerBody.combatAction?.stopReason).toBe('weapon_unavailable');
    expect(x.targetBody.health).toBe(x.targetBody.maxHealth);
  });

  it('keeps committed facing locked while ordinary movement leaves the strike path', () => {
    const x = setup();
    x.attackerBody.pos.x = 10.6; x.targetBody.pos.x = 11.65;
    x.attackerBody.yaw = -Math.PI / 2;
    expect(requestCombatAction(x.world, x.intent, 'movement-escape-1')).toMatchObject({ attempted: true });
    const lockedFacing = x.attackerBody.combatAction!.facing;
    advance(x, 0.22);
    for (let i = 0; i < 18; i++) {
      const dt = 1 / 60;
      applyInteractionMovement(x.world, x.target, x.targetBody, { x: 0, z: 1, sprint: false }, dt);
      x.world.physicalTime += dt;
      x.sim.stepScheduled(dt, dt);
    }
    expect(x.attackerBody.combatAction!.facing).toBe(lockedFacing);
    expect(x.targetBody.pos.z).toBeGreaterThan(10.2);
    advance(x, 0.4);
    expect(x.attackerBody.combatAction?.outcome).toBe('miss');
  });

});
