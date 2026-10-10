import { randomUUID } from 'node:crypto';
import { BridgeSession, LOCAL_CHANNEL } from '../bridge/session';
import { projectRegion, regionDynamics } from '../bridge/regions';
import { INTERACTION_SPEC } from '../sim/physical/prediction';
import type { Observatory } from './runtime';

/** One disposable controller over the exact World and Simulation inspected by the Observatory. */
export class ObservatoryViewport {
  private bridge: BridgeSession | null = null;
  private lease = '';
  private touched = 0;
  private receipts: unknown[] = [];
  private personId = '';
  private interaction: ReturnType<BridgeSession['bindInteraction']> | undefined;
  private generation = -1;
  enabled = false;
  constructor(private readonly runtime: Observatory) {}
  private current() {
    if (this.generation !== this.runtime.revision) this.reset();
    return this.bridge;
  }
  reset() {
    this.bridge?.releaseChannel(LOCAL_CHANNEL);
    this.bridge = null; this.lease = ''; this.receipts = []; this.personId = '';
    this.enabled = false; this.generation = this.runtime.revision;
  }
  expire() {
    if (this.lease && performance.now() - this.touched > 30000) {
      this.bridge?.releaseChannel(LOCAL_CHANNEL); this.lease = ''; this.receipts = [];
    }
  }
  release() { this.bridge?.releaseChannel(LOCAL_CHANNEL); this.lease = ''; this.receipts = []; }
  connect(personId: string) {
    this.runtime.requireIdle(); this.current();
    if (this.lease && performance.now() - this.touched < 30000) throw new Error('A viewport already controls this world. Close it first.');
    const p = this.runtime.world.person(personId), body = p && this.runtime.world.primaryBody(p.id);
    if (!p?.alive || !body?.present || body.dead) throw new Error('Select a living, embodied person first.');
    this.bridge?.releaseChannel(LOCAL_CHANNEL);
    this.bridge ??= new BridgeSession(this.runtime.world.seed, { state: this.runtime.state, defaultPlayer: false });
    if (!this.bridge.openChannel(LOCAL_CHANNEL, p.id)) throw new Error('Character unavailable');
    this.enabled = true; this.personId = p.id; this.lease = randomUUID(); this.touched = performance.now();
    this.interaction = this.bridge.bindInteraction(this.lease); this.receipts = [];
    this.bridge.resetAppearanceDelta();
    return { lease: this.lease, revision: this.runtime.revision, hello: this.hello(), scene: this.bridge.scene() };
  }
  private hello() {
    const p = this.runtime.world.person(this.personId)!;
    return { type: 'hello', regionProtocol: 2, alphaProtocol: 1, release: 'observatory-workbench',
      worldId: `observatory:${this.runtime.revision}:${this.runtime.world.seed}`, controls: true, playerId: p.id,
      interaction: this.interaction, account: { id: 'developer', displayName: 'Isolated Observatory', developer: true },
      character: { personId: p.id, name: p.name, created: false, characters: [{ personId: p.id, name: p.name, alive: p.alive }] },
      durability: { checkpointSeconds: 0, lastCheckpointIso: null }, maintenance: null };
  }
  private require(lease: string) {
    const bridge = this.current();
    if (!bridge || !lease || lease !== this.lease) throw new Error('Viewport expired; reopen it for the current world.');
    this.touched = performance.now(); return bridge;
  }
  stopInput() {
    const b = this.current(); if (!b || !this.lease) return;
    b.resetInput(); this.interaction = b.bindInteraction(this.lease); this.receipts = [];
  }
  disconnect(lease: string) {
    const b = this.require(lease); b.releaseChannel(LOCAL_CHANNEL); this.lease = ''; this.receipts = [];
  }
  step(dt: number) {
    const b = this.current(); if (!this.enabled || !b) return false;
    this.expire();
    // Headless mode remains unchanged. Opted-in workbenches use the existing gameplay scheduler.
    const count = Math.round(dt / INTERACTION_SPEC.stepSeconds);
    for (let i = 0; i < count; i++) this.receipts.push(...b.stepInteraction());
    if (this.receipts.length > 512) this.receipts.splice(0, this.receipts.length - 512);
    this.runtime.sim.flushSpeech(); return true;
  }
  frame(lease: string) {
    const b = this.require(lease), w = this.runtime.world;
    const pos = w.positionOf(this.personId)!;
    const regionId = `${Math.floor(pos.x / 256)},${Math.floor(pos.z / 256)}`;
    return { paused: this.runtime.paused, busy: !!this.runtime.job?.active, speed: this.runtime.speed,
      revision: this.runtime.revision, hello: this.hello(), regionId,
      snapshot: b.snapshot(), local: b.localState(), receipts: this.receipts.splice(0),
      dynamic: regionDynamics(w, new Set([regionId]), this.personId) };
  }
  region(lease: string, id: string) {
    this.require(lease);
    const pos = this.runtime.world.positionOf(this.personId)!;
    const rx = Math.floor(pos.x / 256), rz = Math.floor(pos.z / 256);
    if (id !== `${rx},${rz}`) throw new Error('Region is outside the viewport');
    return projectRegion(this.runtime.world, rx, rz, { structures: true });
  }
  command(lease: string, command: unknown) {
    const b = this.require(lease);
    if (this.runtime.paused || this.runtime.job?.active || this.runtime.speed !== 1) throw new Error('Play requires Resume at 1x with no time-advance job.');
    return b.receiveCommand(command);
  }
  intent(lease: string, body: Record<string, unknown>) {
    const b = this.require(lease);
    if (body.type === 'save') { this.runtime.saveCheckpoint(); return { sequence: body.sequence, result: 'saved' }; }
    if (this.runtime.paused || this.runtime.job?.active || this.runtime.speed !== 1) return { sequence: body.sequence, result: 'world_paused' };
    return b.intent(body);
  }
}
