import { World } from '../sim/core/world';
import { Simulation } from '../sim/mind/agent';
import { generateVillage } from '../sim/world/village';
import { moveByIntent, SPRINT_MULTIPLIER } from '../sim/physical/input';
import { meleeStrike, MELEE_REACH, MELEE_COOLDOWN } from '../sim/physical/melee';

export const BRIDGE_VERSION = 1;
export class BridgeSession {
  readonly world: World;
  readonly sim: Simulation;
  private move = { x: 0, z: 0, sprint: false, expires: 0 };
  private sequence = -1;
  constructor(seed = 918271) {
    this.world = new World(seed);
    generateVillage(this.world);
    this.sim = new Simulation(this.world);
  }
  resetInput(): void { this.sequence = -1; this.move = { x: 0, z: 0, sprint: false, expires: 0 }; }
  intent(input: unknown): { sequence: number; result: string } {
    if (!input || typeof input !== 'object') return { sequence: -1, result: 'invalid_message' };
    const m = input as Record<string, unknown>;
    const seq = m.sequence;
    if (m.version !== BRIDGE_VERSION || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= this.sequence) return { sequence: -1, result: 'invalid_sequence_or_version' };
    this.sequence = seq;
    const p = this.world.person(this.world.playerId)!;
    const b = this.world.primaryBody(p.id)!;
    let result = 'invalid_intent';
    if (m.type === 'move' && typeof m.x === 'number' && typeof m.z === 'number' && Number.isFinite(m.x) && Number.isFinite(m.z)) {
      this.move = { x: Math.max(-1, Math.min(1, m.x)), z: Math.max(-1, Math.min(1, m.z)), sprint: m.sprint === true, expires: this.world.physicalTime + 0.3 };
      result = 'accepted';
    } else if (m.type === 'attack') {
      // The client names a target it can see; the SIMULATION decides whether that is a body
      // within reach of this person, and resolves the blow through the same Simulation.attack
      // every NPC uses. No damage number ever crosses this boundary.
      result = meleeStrike(this.sim, p, b, typeof m.targetBodyId === 'string' ? m.targetBodyId : null);
    } else if (m.type === 'interact') {
      // The existing shared resource action resolves capability, tools and yield.
      result = this.sim.extractResourceAt(p, { x: b.pos.x - Math.sin(b.yaw) * 1.5, y: b.pos.y, z: b.pos.z - Math.cos(b.yaw) * 1.5 }) > 0 ? 'accepted' : 'no_resource';
    }
    return { sequence: seq, result };
  }
  step(dt = 0.05): void {
    const w = this.world;
    const wd = w.clock.advance(dt); w.physicalTime += dt;
    const p = w.person(w.playerId)!;
    const b = w.primaryBody(p.id)!;
    const live = this.move.expires > w.physicalTime;
    moveByIntent(this.sim, p, b, live ? this.move.x : 0, live ? this.move.z : 0, live && this.move.sprint, dt);
    this.sim.step(dt, wd); this.sim.flushSpeech();
  }
  snapshot() {
    const w = this.world;
    return {
      version: BRIDGE_VERSION, type: 'snapshot', tick: w.physicalTime, worldTime: w.now, ack: this.sequence, playerId: w.playerId,
      bodies: w.bodies().filter(b => b.shape === 'humanoid' && b.present).flatMap(b => {
        const p = w.person(b.ownerId); if (!p) return [];
        return [{ bodyId: b.id, entityId: p.id, name: p.name, pos: b.pos, velocity: b.vel, yaw: b.yaw,
          // Canonical, so the client never holds a movement constant of its own to predict with.
          speed: b.speed, sprintMultiplier: SPRINT_MULTIPLIER, reach: MELEE_REACH, cooldown: MELEE_COOLDOWN,
          // Combat state is read, never authored, by the presentation layer. `lastAttackAt` and
          // `lastHitAt` let it retrigger a swing/flinch that starts and ends between snapshots.
          attackTarget: b.attackTarget, lastAttackAt: b.lastAttackAt, lastHitAt: b.lastHitAt,
          pose: b.pose, health: b.health, maxHealth: b.maxHealth, alive: p.alive, dead: b.dead,
          incapacitated: b.pose === 'downed' || b.subduedUntil > w.physicalTime || !!p.surrender || !!p.custody?.active,
          occupation: p.occupation, appearance: p.appearance,
          activity: p.mind.plan.find(a => a.status === 'active')?.type ?? b.pose,
          inventory: p.inventory.map(id => w.item(id)).filter(Boolean).map(it => ({ id: it!.id, name: it!.name, type: it!.type, quantity: it!.quantity })),
          weapon: this.sim.weaponName(p), needs: p.needs,
          speech: p.speech && p.speech.until > w.physicalTime ? p.speech.text : '',
          // Explicitly developer-only. These fields are never fed into a character's knowledge.
          debug: { goal: p.mind.goal, pursuits: p.mind.pursuits, concerns: p.mind.concerns },
        }];
      }),
      events: w.events.filter(e => ['attack', 'death', 'kill', 'harvest', 'produce', 'trade', 'pickup', 'extract', 'haul_deliver'].includes(e.type)).slice(-24).map(e => ({ id: e.id, type: e.type, actor: e.actor, target: e.target, summary: e.summary, data: e.data })),
    };
  }
  scene() {
    const w = this.world;
    return { version: BRIDGE_VERSION, type: 'scene', seed: w.seed,
      // TS metres (x,y-up,z) map to UE centimetres (X=x,Y=z,Z=y), centred on the square.
      origin: { x: 96, y: 14, z: 96 }, unitsPerMetre: 100,
      places: w.places().map(p => ({ id: p.id, name: p.name, type: p.type, bounds: p.bounds, inside: p.inside, door: p.door })),
      resources: w.resourceNodes.map(n => ({ id: n.id, pos: n.pos, remaining: n.remaining, state: n.state })),
    };
  }
}
