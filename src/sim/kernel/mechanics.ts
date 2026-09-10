import type { World } from '../core/world';
import type { KnowledgeItem, Person, Vec3 } from '../core/types';
import { transform } from '../world/metabolism';
import { addPlaceStock, outboundStock, stockItemsAt } from '../world/stock';
import { portsMatch } from './definitions';
import type { Assembly, Bindings, Component, Method, RunResult } from './types';
import { getPhysicalCapability } from '../core/attributes';

export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const owns = (p: Person, owner: string | null) => owner === null || owner === p.id;
/** A work assignment permits using the employer's productive assets at that workplace.
 * It transfers neither title nor private assets belonging to other workers. */
export function mayUseProperty(world: World, p: Person, owner: string | null, placeId?: string): boolean {
  if (owns(p, owner)) return true;
  const place = world.place(placeId);
  return !!place && place.ownerId === owner && p.workId === place.id && place.workers.includes(p.id)
    && (p.relationships[owner!]?.trust ?? 0) >= -0.25;
}
export function understandsAssembly(p: Person, a: Assembly): boolean {
  return !!assemblyInstruction(p, a);
}
function assemblyInstruction(p: Person, a: Assembly): KnowledgeItem | undefined {
  const shape = (m: Method) => JSON.stringify([m.ruleset, m.definitions, m.connections, m.effect]);
  return Object.values(p.knowledge).find(k => k.confidence > 0.2 && k.claim.method && shape(k.claim.method) === shape(a.method));
}
export function mayOperate(world: World, p: Person, a: Assembly): boolean {
  return mayUseProperty(world, p, a.ownerId, a.bindings.placeId);
}
export function reachable(world: World, p: Person, pos: Vec3, range = 3): boolean {
  return p.alive && world.bodies().some(b => b.ownerId === p.id && b.present && !b.dead && b.pose !== 'downed' && b.pose !== 'sleep'
    && distance(b.pos, pos) <= range && world.grid.lineOfSight({ ...b.pos, y: b.pos.y + 1 }, { ...pos, y: pos.y + 1 }, 16));
}
export function createComponent(world: World, definition: string, ownerId: string | null, pos: Vec3): Component {
  if (!world.kernel.ruleset.components.some(c => c.id === definition)) throw new Error('Unknown component definition');
  const c: Component = { id: world.nextId('component'), definition, ownerId, pos: { ...pos }, holderId: null, assemblyId: null, condition: 1 };
  world.kernel.components.push(c); return c;
}
export function acquireComponent(world: World, p: Person, id: string): boolean {
  const c = world.kernel.components.find(c => c.id === id);
  if (!c || c.assemblyId || (c.holderId && c.holderId !== p.id) || !owns(p, c.ownerId) || !reachable(world, p, c.pos)) return false;
  c.ownerId = p.id; c.holderId = p.id;
  world.emit('component_acquired', { actor: p.id, pos: c.pos, causes: c.madeEvent ? [c.madeEvent] : [], data: { componentId: id }, visibility: 6, significance: 0.2, summary: `${p.name} picked up a component` });
  return true;
}
export function startAssembly(world: World, p: Person, method: Method, bindings: Bindings, pos: Vec3, needKey?: string): Assembly | null {
  if (method.ruleset !== world.kernel.ruleset.id || !reachable(world, p, pos) || method.definitions.length > 6 || method.definitions.length < 2
    || method.definitions.some(id => !world.kernel.ruleset.components.some(c => c.id === id))) return null;
  const a: Assembly = { id: world.nextId('assembly'), ownerId: p.id, creatorId: p.id, pos: { ...pos }, parts: [], connections: [], bindings: { ...bindings }, method: structuredClone(method), needKey,
    history: [], tested: false, learned: false, laborSeconds: 0, operatedSeconds: 0, inputJ: 0, usefulJ: 0, dissipatedJ: 0, outputQuantity: 0, progress: {} };
  const cause = Object.values(p.knowledge).find(k => k.claim.method && JSON.stringify(k.claim.method) === JSON.stringify(method))?.source.viaEvent ?? p.mind.goal?.causeEvent;
  if (cause && world.event(cause)) a.lastEvent = cause;
  world.kernel.assemblies.push(a); changed(world, p, a, 'started', method.provenance ?? []);
  a.history!.push({ eventId: a.lastEvent!, operation: 'copied or conceived', parents: [...(method.provenance ?? [])], method: structuredClone(method) }); return a;
}
function changed(world: World, p: Person, a: Assembly, operation: string, materialCauses: string[] = []): void {
  const ev = world.emit('assembly_changed', { actor: p.id, pos: a.pos, causes: [...new Set([...(a.lastEvent ? [a.lastEvent] : []), ...materialCauses])], visibility: 8, significance: 0.3,
    data: { assemblyId: a.id, operation, parts: [...a.parts], connections: structuredClone(a.connections) }, summary: `${p.name} ${operation} an assembly` });
  a.lastEvent = ev.id;
}
/** Shared labor entry point for player/NPC construction. Installing and joining also check
 * this progress, so neither physical mutation can bypass its authored labor requirement. */
export function contributeAssemblyLabor(world: World, p: Person, a: Assembly, key: string, required: number, seconds: number): boolean {
  if ((key === 'run' ? !mayOperate(world, p, a) : a.ownerId !== p.id) || !reachable(world, p, a.pos) || getPhysicalCapability(p, world).currentExertionCapacity <= 0.15 || !Number.isFinite(required) || required <= 0 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60) return false;
  const amount = Math.min(seconds, Math.max(0, required - (a.progress[key] ?? 0)));
  a.progress[key] = (a.progress[key] ?? 0) + amount; a.laborSeconds += amount;
  return a.progress[key] >= required - 1e-9;
}
export function installComponent(world: World, p: Person, a: Assembly, id: string): boolean {
  const c = world.kernel.components.find(c => c.id === id);
  if (a.ownerId !== p.id || !reachable(world, p, a.pos) || !c || c.holderId !== p.id || c.ownerId !== p.id || c.assemblyId || a.parts.length >= 6) return false;
  const key = `install:${a.parts.length}`, definition = world.kernel.ruleset.components.find(d => d.id === c.definition)!;
  if ((a.progress[key] ?? 0) < definition.installSeconds - 1e-9) return false;
  delete a.progress[key];
  c.assemblyId = a.id; c.holderId = null; c.pos = { ...a.pos }; a.parts.push(id); changed(world, p, a, 'installed a component in', c.madeEvent ? [c.madeEvent] : []); return true;
}
/** v0.1 deliberately supports unbranched directed networks. Cycles, fan-out/fan-in and reuse
 * cannot duplicate power; incompatible physical couplings cannot be joined. */
export function connect(world: World, p: Person, a: Assembly, from: number, to: number): boolean {
  if (!mayUseProperty(world, p, a.ownerId, a.bindings.placeId) || !reachable(world, p, a.pos) || from === to || !Number.isInteger(from) || !Number.isInteger(to)) return false;
  const parts = a.parts.map(id => world.kernel.components.find(c => c.id === id));
  const defs = parts.map(c => world.kernel.ruleset.components.find(d => d.id === c?.definition));
  if (!parts[from] || !parts[to] || parts[from]!.assemblyId !== a.id || parts[to]!.assemblyId !== a.id || !portsMatch(defs[from]?.output, defs[to]?.input)
    || a.connections.some(c => c.from === from || c.to === to)) return false;
  let at = to; const visited = new Set([from]);
  while (true) { if (visited.has(at)) return false; visited.add(at); const next = a.connections.find(c => c.from === at); if (!next) break; at = next.to; }
  const key = `join:${from}:${to}`; if ((a.progress[key] ?? 0) < 0.5 - 1e-9) return false;
  delete a.progress[key];
  a.connections.push({ from, to }); changed(world, p, a, 'connected'); return true;
}
export function disconnect(world: World, p: Person, a: Assembly, from: number, to: number): boolean {
  if (!mayUseProperty(world, p, a.ownerId, a.bindings.placeId) || !reachable(world, p, a.pos)) return false;
  const i = a.connections.findIndex(c => c.from === from && c.to === to); if (i < 0) return false;
  a.connections.splice(i, 1); changed(world, p, a, 'disconnected'); return true;
}
export function dismantle(world: World, p: Person, a: Assembly): boolean {
  if (!mayUseProperty(world, p, a.ownerId, a.bindings.placeId) || !reachable(world, p, a.pos)) return false;
  for (const id of a.parts) { const c = world.kernel.components.find(c => c.id === id); if (c?.assemblyId === a.id) { c.assemblyId = null; c.pos = { ...a.pos }; } }
  a.parts = []; a.connections = []; changed(world, p, a, 'dismantled'); return true;
}

/** Shared physical execution. No knowledge, NPC occupation, method, or name participates. */
export function operateAssembly(world: World, p: Person, a: Assembly, seconds: number, intentionEvent?: string): RunResult {
  let reason = 'disconnected', output = 0, consumed = 0, inputJ = 0, usefulJ = 0;
  const instruction = assemblyInstruction(p, a)?.source.viaEvent;
  const causes = () => [...new Set([a.lastEvent, instruction, intentionEvent].filter((id): id is string => !!id))];
  const finish = (): RunResult => {
    const dissipatedJ = inputJ - usefulJ;
    const ev = world.emit('mechanism_trial', { actor: p.id, pos: a.pos, placeId: a.bindings.placeId, causes: causes(), visibility: 10, loudness: inputJ > 0 ? 6 : 0, significance: 0.4,
      data: { assemblyId: a.id, reason, output, consumed, inputJ, usefulJ, dissipatedJ, seconds }, summary: `${p.name} operated an assembly: ${reason}` });
    a.lastEvent = ev.id; a.lastReason = reason; a.inputJ += inputJ; a.usefulJ += usefulJ; a.dissipatedJ += dissipatedJ; a.outputQuantity += output;
    if (Number.isFinite(seconds) && seconds > 0 && reason !== 'inaccessible') a.operatedSeconds += seconds;
    return { reason, output, consumed, inputJ, usefulJ, dissipatedJ, eventId: ev.id };
  };
  if (!(seconds > 0 && seconds <= 60) || !Number.isFinite(seconds) || !mayOperate(world, p, a) || !reachable(world, p, a.pos) || getPhysicalCapability(p, world).currentExertionCapacity <= 0.15) { reason = 'inaccessible'; return finish(); }
  const parts = a.parts.map(id => world.kernel.components.find(c => c.id === id));
  const defs = parts.map(c => world.kernel.ruleset.components.find(d => d.id === c?.definition));
  if (parts.length < 2 || new Set(a.parts).size !== parts.length || parts.some(c => !c || c.assemblyId !== a.id || c.holderId || c.ownerId !== a.ownerId || distance(c.pos, a.pos) > 0.01) || defs.some(d => !d)) return finish();
  if (parts.some(c => c!.condition <= 0)) { reason = 'broken'; return finish(); }
  if (a.connections.length !== parts.length - 1 || new Set(a.connections.map(c => c.from)).size !== a.connections.length || new Set(a.connections.map(c => c.to)).size !== a.connections.length) return finish();
  const first = defs.findIndex(d => d!.kind === 'source');
  if (first < 0 || defs.filter(d => d!.kind === 'source').length !== 1) return finish();
  const path: number[] = []; let at = first;
  while (!path.includes(at) && defs[at]) { path.push(at); const next = a.connections.find(c => c.from === at); if (!next) break;
    if (!portsMatch(defs[at]!.output, defs[next.to]?.input)) { reason = 'incompatible'; return finish(); } at = next.to; }
  const end = defs[path.at(-1)!]!;
  if (path.length !== parts.length || !['process', 'transfer'].includes(end.kind) || a.connections.some(c => !path.includes(c.from) || !path.includes(c.to))) return finish();
  const energy = world.kernel.energy.find(e => e.id === a.bindings.energyId);
  if (!energy || !mayUseProperty(world, p, energy.ownerId, a.bindings.placeId) || distance(energy.pos, a.pos) > 3 || energy.medium !== defs[first]!.output!.medium) { reason = 'source unavailable'; return finish(); }
  const r = world.kernel.ruleset;
  let maxBatches = 0, joulesPerBatch = 0;
  const process = end.kind === 'process' ? r.processes.find(d => d.id === end.process) : undefined;
  const src = world.kernel.reservoirs.find(t => t.id === a.bindings.inputId), dst = world.kernel.reservoirs.find(t => t.id === a.bindings.outputId);
  let stockOwner: string | null = p.id;
  if (process) {
    const place = world.place(a.bindings.placeId);
    if (!place || distance(place.inside, a.pos) > 3 || !mayUseProperty(world, p, place.ownerId, place.id)) { reason = 'inaccessible stock'; return finish(); }
    const input = r.materials.find(m => m.id === process.input.material)!;
    if (!input.legacyItem || [process.output, ...process.byproducts].some(f => !r.materials.find(m => m.id === f.material)?.legacyItem)) { reason = 'unsupported stock adapter'; return finish(); }
    const stock = stockItemsAt(world, input.legacyItem, place.id);
    const own = stock.filter(i => i.ownerId === p.id).reduce((n, i) => n + i.quantity, 0);
    stockOwner = own > 0 ? p.id : stock.some(i => i.ownerId === place.ownerId) ? place.ownerId : null;
    const available = Math.max(0, stock.filter(i => i.ownerId === stockOwner).reduce((n, i) => n + i.quantity, 0) - outboundStock(world, input.legacyItem, place.id));
    maxBatches = Math.min(available / process.input.quantity, process.maxBatchesPerSecond * seconds); joulesPerBatch = process.joulesPerBatch;
  } else if (end.kind === 'transfer') {
    if (!src || !dst || src.id === dst.id || !mayUseProperty(world, p, src.ownerId, a.bindings.placeId) || !mayUseProperty(world, p, dst.ownerId, a.bindings.placeId) || distance(src.pos, a.pos) > 3 || distance(dst.pos, a.pos) > 3 || src.material !== dst.material) { reason = 'reservoir unavailable'; return finish(); }
    const material = r.materials.find(m => m.id === src.material)!;
    if (!material || material.phase !== end.phase) { reason = 'incompatible material'; return finish(); }
    // Work includes declared friction plus real gravitational lift. No energy recovered on descent.
    joulesPerBatch = material.kgPerUnit * (end.joulesPerKg! + 9.81 * Math.max(0, dst.pos.y - src.pos.y));
    maxBatches = Math.min(src.quantity, dst.capacity - dst.quantity, end.maxKgPerSecond! * seconds / material.kgPerUnit);
  }
  if (maxBatches <= 1e-9) { reason = 'missing input or full output'; return finish(); }
  let power = Math.min(energy.maxPowerW, energy.remainingJ / seconds);
  if (power <= 1e-9) { reason = 'source exhausted'; return finish(); }
  // Source draw is bounded before conversion; excess throughput is throttled upstream. At a
  // stall power is dissipated as friction, which is a real, measured experimental cost.
  const sourceLimit = Math.min(defs[first]!.maxPowerW, r.materials.find(m => m.id === defs[first]!.material)!.maxPowerW) * parts[first]!.condition;
  power = Math.min(power, sourceLimit); const sourceW = power;
  const traversed: { index: number; watts: number }[] = []; let stalled = false;
  for (const index of path) {
    const d = defs[index]!, c = parts[index]!;
    power = Math.min(power, d.maxPowerW * c.condition, r.materials.find(m => m.id === d.material)!.maxPowerW * c.condition);
    traversed.push({ index, watts: power });
    if (power < d.minPowerW) stalled = true;
    power *= d.efficiency;
  }
  if (power <= 1e-9) stalled = true;
  const batches = stalled ? 0 : Math.min(maxBatches, power * seconds / joulesPerBatch);
  const throttle = stalled ? 1 : Math.min(1, batches * joulesPerBatch / (power * seconds));
  inputJ = sourceW * seconds * throttle; usefulJ = batches * joulesPerBatch;
  energy.remainingJ = Math.max(0, energy.remainingJ - inputJ);
  for (const { index, watts } of traversed) parts[index]!.condition = Math.max(0, parts[index]!.condition - watts * seconds * throttle * defs[index]!.wearPerJ);
  if (stalled) { reason = 'insufficient power'; return finish(); }
  if (process) {
    const im = r.materials.find(m => m.id === process.input.material)!, om = r.materials.find(m => m.id === process.output.material)!;
    const result = transform(world, { actor: p.id, inputType: im.legacyItem!, inputQty: batches * process.input.quantity, inputPlaces: [a.bindings.placeId!], outputType: om.legacyItem!, outputQty: batches * process.output.quantity, outputPlace: a.bindings.placeId!, ownerId: stockOwner ?? a.ownerId, inputOwner: stockOwner, how: 'mechanical processing', causes: [...causes(), ...(energy.lastEvent ? [energy.lastEvent] : [])] });
    consumed = result.consumed; output = result.produced;
    if (result.eventId) a.lastEvent = result.eventId;
    if (result.ok) for (const by of process.byproducts) addPlaceStock(world, r.materials.find(m => m.id === by.material)!.legacyItem!, by.quantity * batches, a.bindings.placeId!, stockOwner ?? a.ownerId, result.eventId, 'mechanical byproduct');
  } else { src!.quantity -= batches; dst!.quantity += batches; consumed = batches; output = batches; }
  reason = output > 0 ? 'productive' : 'no effect'; return finish();
}
