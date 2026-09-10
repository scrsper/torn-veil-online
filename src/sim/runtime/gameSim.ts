import type { Action, Person, Vec3 } from '../core/types';
import { makePerson, makeBody } from '../world/factory';
import { reachable } from '../kernel/mechanics';
import { Simulation } from '../mind/agent';
import { setExternalControl } from './controllers';
import { knowledgeView, personKnowledgeView } from './knowledgeView';

export type PersonIntent = { kind: 'yield' }
  | { kind: 'introduce'; target: string; name?: string }
  | { kind: 'inspect' | 'diagnose' | 'reverse_engineer' | 'test' | 'dismantle' | 'abandon'; assemblyId: string }
  | { kind: 'replace'; assemblyId: string; part: number; componentId: string }
  | { kind: 'connect' | 'disconnect'; assemblyId: string; from: number; to: number }
  | { kind: 'manufacture'; assemblyId: string; definition: string }
  | { kind: 'reconstruct'; methodKey: string; sourceAssemblyId: string }
  | { kind: 'read'; itemId: string }
  | { kind: 'teach'; target: string; key: string };

/** Connection routing is outside the world-facing Person. No account, human personality,
 * player flag or control origin enters a simulated mind. One facade can host many controls. */
export class GameSim {
  private readonly connections = new Map<string, string>();
  constructor(private readonly simulation: Simulation) {}
  attach(connection: string, personId: string): boolean {
    const p = this.simulation.world.person(personId);
    if (!p?.alive || [...this.connections].some(([c, id]) => c !== connection && id === personId)) return false;
    this.detach(connection); this.connections.set(connection, personId); setExternalControl(p, true); return true;
  }
  detach(connection: string): void {
    const p = this.person(connection); if (p) setExternalControl(p, false); this.connections.delete(connection);
  }
  spawn(connection: string, name: string, pos: Vec3): string {
    const w = this.simulation.world;
    const p = makePerson(w, { name, age: 25, gender: 'f', occupation: 'traveler', traits: {}, appearance: {}, bio: '' });
    p.bodies.push(makeBody(w, p.id, pos).id); this.attach(connection, p.id); return p.id;
  }
  private person(connection: string): Person | undefined { return this.simulation.world.person(this.connections.get(connection)); }
  perceive(connection: string) { const p = this.person(connection); return p ? knowledgeView(this.simulation.world, p) : null; }
  beliefs(connection: string, subject: string) { const p = this.person(connection); return p ? personKnowledgeView(p, subject) : null; }
  intend(connection: string, intent: PersonIntent): boolean {
    const p = this.person(connection); if (!p?.alive || !intent || typeof intent !== 'object') return false;
    const kinds = ['yield', 'introduce', 'inspect', 'diagnose', 'reverse_engineer', 'test', 'dismantle', 'abandon', 'replace', 'connect', 'disconnect', 'read', 'teach', 'manufacture', 'reconstruct'];
    if (!kinds.includes(intent.kind)) return false;
    if (['replace', 'connect', 'disconnect'].includes(intent.kind)) {
      for (const field of intent.kind === 'replace' ? ['part'] : ['from', 'to']) {
        const n = (intent as unknown as Record<string, unknown>)[field]; if (!Number.isInteger(n) || Number(n) < 0 || Number(n) > 5) return false;
      }
    }
    if (intent.kind === 'reconstruct') {
      const w = this.simulation.world, method = p.knowledge[intent.methodKey]?.claim.method;
      const source = w.kernel.assemblies.find(a => a.id === intent.sourceAssemblyId);
      if (!method || !source || !reachable(w, p, source.pos)) return false;
      this.simulation.submitIntention(p, { type: 'construct_mechanism', status: 'pending', data: { method: structuredClone(method), bindings: { ...source.bindings }, pos: { ...source.pos }, evidenceEvent: p.knowledge[intent.methodKey].source.viaEvent } });
      return true;
    }
    const action: Action = intent.kind === 'yield' ? { type: 'yield', status: 'pending' } : intent.kind === 'introduce' ? { type: 'introduce', targetEntity: intent.target, text: intent.name, status: 'pending' }
      : intent.kind === 'read' ? { type: 'read_record', targetEntity: intent.itemId, data: { recordId: intent.itemId }, status: 'pending' }
      : intent.kind === 'teach' ? { type: 'tell', targetEntity: intent.target, data: { key: intent.key }, status: 'pending' }
      : { type: 'mechanism_task', data: { ...intent }, status: 'pending' };
    this.simulation.submitIntention(p, action); return true;
  }
  /** Explicit developer entry point. Never embedded in perceive()/beliefs() responses. */
  debugTruth(personId: string) {
    const p = this.simulation.world.person(personId); return p ? structuredClone(p) : null;
  }
}

