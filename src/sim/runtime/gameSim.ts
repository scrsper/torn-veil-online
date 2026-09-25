import type { Action, Person, Vec3 } from '../core/types';
import { makePerson, makeBody } from '../world/factory';
import { reachable } from '../kernel/mechanics';
import { Simulation } from '../mind/agent';
import { knowsVeil, MEDITATION_SECONDS } from '../physical/veil';
import { availableForMartial } from '../mind/martialPractice';
import { canExecuteTechnique } from '../mind/martialKnowledge';
import { setExternalControl } from './controllers';
import { knowledgeView, personKnowledgeView } from './knowledgeView';

export type PersonIntent = { kind: 'yield' } | { kind: 'advance' } | { kind: 'rest' } | { kind: 'wake' } | { kind: 'meditate' } | { kind: 'train' }
  | { kind: 'ask'; target: string; assemblyId: string }
  | { kind: 'introduce'; target: string; name?: string }
  | { kind: 'inspect' | 'diagnose' | 'reverse_engineer' | 'test' | 'dismantle' | 'abandon'; assemblyId: string }
  | { kind: 'replace'; assemblyId: string; part: number; componentId: string }
  | { kind: 'connect' | 'disconnect'; assemblyId: string; from: number; to: number }
  | { kind: 'manufacture'; assemblyId: string; definition: string }
  | { kind: 'reconstruct'; methodKey: string; sourceAssemblyId: string }
  | { kind: 'read'; itemId: string }
  | { kind: 'teach'; target: string; key: string };

export interface SpawnOptions { gender?: 'f' | 'm'; age?: number }

/** Connection routing is outside the world-facing Person. No account, human personality,
 * player flag or control origin enters a simulated mind. One facade can host many controls. */
export class GameSim {
  private readonly connections = new Map<string, string>();
  constructor(private readonly simulation: Simulation) {}
  attach(connection: string, personId: string): boolean {
    const p = this.simulation.world.person(personId);
    if (!p?.alive || [...this.connections].some(([c, id]) => c !== connection && id === personId)) return false;
    if (this.connections.get(connection) === personId) return true;
    this.detach(connection); this.connections.set(connection, personId); setExternalControl(p, true); return true;
  }
  detach(connection: string): void {
    const p = this.person(connection); if (p) setExternalControl(p, false); this.connections.delete(connection);
  }
  /** A newly arriving ordinary traveler. Only presentation-level choices (name, sex, adult age)
   * are accepted; attributes, skills, wealth and knowledge follow the ordinary person factory. */
  spawn(connection: string, name: string, pos: Vec3, options: SpawnOptions = {}): string {
    const w = this.simulation.world;
    const age = Number.isInteger(options.age) && options.age! >= 18 && options.age! <= 60 ? options.age! : 25;
    const p = makePerson(w, { name, age, gender: options.gender === 'm' ? 'm' : 'f', occupation: 'traveler', traits: {}, appearance: {}, bio: '' });
    p.bodies.push(makeBody(w, p.id, pos).id); this.attach(connection, p.id); return p.id;
  }
  private person(connection: string): Person | undefined { return this.simulation.world.person(this.connections.get(connection)); }
  controlsBody(connection: string, bodyId: string): boolean {
    const p=this.person(connection),b=this.simulation.world.body(bodyId);
    return !!p&&!!b&&b.ownerId===p.id&&p.bodies.includes(bodyId)&&b.present&&!b.dead;
  }
  perceive(connection: string) { const p = this.person(connection); return p ? knowledgeView(this.simulation.world, p) : null; }
  beliefs(connection: string, subject: string) { const p = this.person(connection); return p ? personKnowledgeView(p, subject) : null; }
  intend(connection: string, intent: PersonIntent): boolean {
    const p = this.person(connection); if (!p?.alive || !intent || typeof intent !== 'object') return false;
    if (intent.kind === 'rest' || intent.kind === 'wake') return this.restOrWake(p, intent.kind);
    if (intent.kind === 'meditate') return this.meditate(p);
    if (intent.kind === 'train') return this.train(p);
    const kinds = ['ask', 'yield', 'advance', 'introduce', 'inspect', 'diagnose', 'reverse_engineer', 'test', 'dismantle', 'abandon', 'replace', 'connect', 'disconnect', 'read', 'teach', 'manufacture', 'reconstruct'];
    if (!kinds.includes(intent.kind)) return false;
    const input = intent as unknown as Record<string, unknown>;
    const fields = intent.kind === 'yield' || intent.kind === 'advance' ? [] : intent.kind === 'introduce' ? ['target'] : intent.kind === 'ask' ? ['target', 'assemblyId'] : intent.kind === 'teach' ? ['target', 'key']
      : intent.kind === 'read' ? ['itemId'] : intent.kind === 'reconstruct' ? ['methodKey', 'sourceAssemblyId']
      : ['assemblyId', ...(intent.kind === 'replace' ? ['componentId'] : intent.kind === 'manufacture' ? ['definition'] : [])];
    if (fields.some(field => typeof input[field] !== 'string' || !(input[field] as string).length || (input[field] as string).length > 200)) return false;
    if (intent.kind === 'introduce' && intent.name !== undefined && (typeof intent.name !== 'string' || intent.name.length > 100)) return false;
    if (['replace', 'connect', 'disconnect'].includes(intent.kind)) {
      for (const field of intent.kind === 'replace' ? ['part'] : ['from', 'to']) {
        const n = (intent as unknown as Record<string, unknown>)[field]; if (!Number.isInteger(n) || Number(n) < 0 || Number(n) > 5) return false;
      }
    }
    if (intent.kind === 'reconstruct') {
      const w = this.simulation.world, method = p.knowledge[intent.methodKey]?.claim.method;
      const source = w.kernel.assemblies.find(a => a.id === intent.sourceAssemblyId);
      const bindings = p.knowledge[`mechanical-evidence:${intent.sourceAssemblyId}`]?.claim.mechanicalEvidence?.bindings;
      if (!method || !source || !bindings?.energyId || !reachable(w, p, source.pos)) return false;
      this.simulation.submitIntention(p, { type: 'construct_mechanism', status: 'pending', data: { method: structuredClone(method), bindings: { ...bindings }, pos: { ...source.pos }, evidenceEvent: p.knowledge[intent.methodKey].source.viaEvent } });
      return true;
    }
    const action: Action = intent.kind === 'advance' ? { type: 'attempt_breakthrough', duration: 60, status: 'pending' } : intent.kind === 'ask' ? { type: 'ask_mechanism', targetEntity: intent.target, data: { assemblyId: intent.assemblyId }, status: 'pending' } : intent.kind === 'yield' ? { type: 'yield', status: 'pending' } : intent.kind === 'introduce' ? { type: 'introduce', targetEntity: intent.target, text: intent.name, status: 'pending' }
      : intent.kind === 'read' ? { type: 'read_record', targetEntity: intent.itemId, data: { recordId: intent.itemId }, status: 'pending' }
      : intent.kind === 'teach' ? { type: 'tell', targetEntity: intent.target, data: { key: intent.key }, status: 'pending' }
      : { type: 'mechanism_task', data: Object.fromEntries(['kind', 'assemblyId', 'part', 'componentId', 'from', 'to', 'definition'].filter(key => input[key] !== undefined).map(key => [key, input[key]])), status: 'pending' };
    this.simulation.submitIntention(p, action); return true;
  }
  /** Drill bodily technique alone for a few rounds: the same solo martial session an NPC runs.
   * Solitary drilling develops the body only as far as it demands (unlike sparring). */
  private train(p: Person): boolean {
    const w = this.simulation.world, body = w.primaryBody(p.id);
    if (!body || p.custody?.active || !availableForMartial(w, p, body.id)) return false;
    const drills = ['motor:basic-punch', 'motor:second-punch', 'motor:crude-kick', 'motor:shove'].filter(id => canExecuteTechnique(w, p, id, body.id));
    if (!drills.length) return false;
    const done = Object.values(p.capability?.repetitionCounts ?? {}).reduce((a, b) => a + b, 0);
    const round = (i: number): Action => ({ type: 'work', status: 'pending', data: { martial: 'practice', techniqueId: drills[(done + i) % drills.length], bodyId: body.id } });
    this.simulation.submitIntention(p, round(0));
    for (let i = 1; i < 5; i++) p.mind.plan.push(round(i));
    return true;
  }
  /** Sit and practise the veil where one stands: the same `meditate` action anyone taught can plan. */
  private meditate(p: Person): boolean {
    const w = this.simulation.world, body = w.primaryBody(p.id);
    if (!body || body.dead || !body.present || ['downed', 'sleep'].includes(body.pose) || p.custody?.active || !knowsVeil(p)) return false;
    this.simulation.submitIntention(p, { type: 'meditate', pos: { ...body.pos }, duration: MEDITATION_SECONDS, status: 'pending' });
    return true;
  }
  /** Sleep where one stands (the same `sleep` action a mind plans), or wake by choice. */
  private restOrWake(p: Person, kind: 'rest' | 'wake'): boolean {
    const w = this.simulation.world, body = w.primaryBody(p.id);
    if (!body || body.dead || !body.present || body.pose === 'downed' || p.custody?.active) return false;
    if (kind === 'wake') {
      if (body.pose !== 'sleep') return false;
      p.mind.plan = []; p.mind.goal = null; body.pose = 'stand';
      w.emit('woke', { actor: p.id, significance: 0.02, summary: `${p.name} got up` });
      return true;
    }
    if (body.pose === 'sleep') return false;
    this.simulation.submitIntention(p, { type: 'sleep', pos: { ...body.pos }, duration: 8 * 3600, status: 'pending' });
    return true;
  }
  /** Explicit developer entry point. Never embedded in perceive()/beliefs() responses. */
  debugTruth(personId: string) {
    const p = this.simulation.world.person(personId); return p ? structuredClone(p) : null;
  }
}
