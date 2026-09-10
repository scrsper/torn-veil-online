import { ITEM_LABEL } from '../world/factory';
import type { Ruleset, KernelState, Port } from './types';

const finite = (x: number, min = 0) => Number.isFinite(x) && x >= min;
const requireValue = (ok: unknown, message: string): void => { if (!ok) throw new Error(`Kernel definition: ${message}`); };
export const portsMatch = (out?: Port, input?: Port): boolean => !!out && !!input && out.medium === input.medium && out.coupling === input.coupling;

/** Validate the complete ruleset before installing it; no mutable global definition registry. */
export function validateRuleset(r: Ruleset): void {
  requireValue(typeof r.id === 'string' && r.id.length > 0, 'ruleset id');
  const ids = new Set<string>();
  for (const d of [...r.materials, ...r.components, ...r.processes]) {
    requireValue(typeof d.id === 'string' && d.id.startsWith(r.id + '/') && !ids.has(d.id), `scoped unique id ${d.id}`); ids.add(d.id);
  }
  for (const m of r.materials) {
    requireValue(m.unit && finite(m.kgPerUnit, Number.EPSILON) && finite(m.maxPowerW) && ['solid', 'liquid'].includes(m.phase), m.id);
    requireValue(!m.legacyItem || Object.hasOwn(ITEM_LABEL, m.legacyItem), 'unknown legacy item');
  }
  requireValue(new Set(r.materials.filter(m => m.legacyItem).map(m => m.legacyItem)).size === r.materials.filter(m => m.legacyItem).length, 'duplicate legacy material truth');
  for (const p of r.processes) {
    const flows = [p.input, p.output, ...p.byproducts];
    requireValue(flows.every(f => r.materials.some(m => m.id === f.material) && finite(f.quantity, Number.EPSILON)), p.id);
    requireValue(finite(p.joulesPerBatch, Number.EPSILON) && finite(p.maxBatchesPerSecond, Number.EPSILON), p.id);
    const mass = (f: typeof p.input) => r.materials.find(m => m.id === f.material)!.kgPerUnit * f.quantity;
    requireValue(Math.abs(mass(p.input) - mass(p.output) - p.byproducts.reduce((n, f) => n + mass(f), 0)) < 1e-9, `mass balance ${p.id}`);
  }
  for (const c of r.components) {
    requireValue(r.materials.some(m => m.id === c.material && m.phase === 'solid'), c.id);
    requireValue(['source', 'converter', 'transmission', 'process', 'transfer'].includes(c.kind), c.id);
    requireValue(finite(c.massKg, Number.EPSILON) && finite(c.efficiency, Number.EPSILON) && c.efficiency <= 1 && finite(c.maxPowerW, Number.EPSILON) && finite(c.minPowerW) && c.minPowerW <= c.maxPowerW, c.id);
    requireValue(finite(c.installSeconds, Number.EPSILON) && finite(c.wearPerJ), c.id);
    requireValue((c.kind === 'source') === !c.input && (['process', 'transfer'].includes(c.kind)) === !c.output, `ports ${c.id}`);
    for (const port of [c.input, c.output].filter(Boolean)) requireValue(port!.medium && port!.coupling, `port ${c.id}`);
    if (c.kind === 'process') requireValue(r.processes.some(p => p.id === c.process), `process ${c.id}`);
    if (c.kind === 'transfer') requireValue(['liquid', 'solid'].includes(c.phase!) && finite(c.joulesPerKg!, Number.EPSILON) && finite(c.maxKgPerSecond!, Number.EPSILON), `transfer ${c.id}`);
  }
}

export function installRuleset(state: KernelState, ruleset: Ruleset): void {
  validateRuleset(ruleset);
  if (state.components.length || state.assemblies.length || state.reservoirs.length || state.energy.length) throw new Error('Cannot replace an instantiated ruleset');
  state.ruleset = structuredClone(ruleset);
}

/** Persistence boundary: validate data before restoring capability or spendable stores. */
export function restoreKernel(raw: KernelState): KernelState {
  validateRuleset(raw.ruleset);
  const ids = new Set<string>();
  const pos = (p: { x: number; y: number; z: number }) => p && [p.x, p.y, p.z].every(Number.isFinite);
  for (const v of [...raw.components, ...raw.reservoirs, ...raw.energy, ...raw.assemblies]) {
    requireValue(typeof v.id === 'string' && !ids.has(v.id) && pos(v.pos), 'instance id/position'); ids.add(v.id);
  }
  for (const c of raw.components) requireValue(raw.ruleset.components.some(d => d.id === c.definition) && finite(c.condition) && c.condition <= 1 && !(c.holderId && c.assemblyId), 'component state');
  for (const t of raw.reservoirs) requireValue(raw.ruleset.materials.some(d => d.id === t.material) && finite(t.quantity) && finite(t.capacity) && t.quantity <= t.capacity, 'reservoir state');
  for (const e of raw.energy) requireValue(e.medium && e.origin && finite(e.initialJ) && finite(e.remainingJ) && e.remainingJ <= e.initialJ && finite(e.maxPowerW), 'energy state');
  for (const a of raw.assemblies) {
    requireValue(a.method.ruleset === raw.ruleset.id && a.method.definitions.every(id => raw.ruleset.components.some(d => d.id === id)) && a.parts.length <= 6 && new Set(a.parts).size === a.parts.length, 'assembly definition');
    requireValue(a.parts.every(id => raw.components.some(c => c.id === id && c.assemblyId === a.id && c.ownerId === a.ownerId)), 'assembly membership');
    requireValue([a.laborSeconds, a.operatedSeconds, a.inputJ, a.usefulJ, a.dissipatedJ, a.outputQuantity, ...Object.values(a.progress)].every(x => finite(x)) && Math.abs(a.inputJ - a.usefulJ - a.dissipatedJ) < 1e-6, 'assembly accounting');
    requireValue(a.connections.every(e => Number.isInteger(e.from) && Number.isInteger(e.to) && e.from >= 0 && e.to >= 0 && e.from < a.parts.length && e.to < a.parts.length), 'connection endpoints');
    requireValue(new Set(a.connections.map(c => c.from)).size === a.connections.length && new Set(a.connections.map(c => c.to)).size === a.connections.length, 'branching connections');
    const defs = a.parts.map(id => raw.ruleset.components.find(d => d.id === raw.components.find(c => c.id === id)!.definition)!);
    for (const edge of a.connections) {
      requireValue(portsMatch(defs[edge.from].output, defs[edge.to].input), 'incompatible connection');
      const seen = new Set<number>(); let at: number | undefined = edge.from;
      while (at !== undefined) { requireValue(!seen.has(at), 'cyclic connection'); seen.add(at); at = a.connections.find(e => e.from === at)?.to; }
    }
  }
  requireValue(raw.components.every(c => !c.assemblyId || raw.assemblies.some(a => a.id === c.assemblyId && a.parts.includes(c.id))), 'orphan component');
  return structuredClone(raw);
}

/** Authored engine primitives. There is deliberately no finished arrangement in this data. */
export function mechanicalPrimitives(): Ruleset {
  const id = 'torn-veil:mechanics-v1', q = (name: string) => `${id}/${name}`;
  const air = { medium: 'kinetic', coupling: 'air' }, axle = { medium: 'rotation', coupling: 'axle' }, drive = { medium: 'rotation', coupling: 'drive' };
  const common = { material: q('wood'), massKg: 4, efficiency: 0.9, maxPowerW: 200, minPowerW: 0, installSeconds: 1, wearPerJ: 0.000001 };
  return { id, materials: [
    { id: q('wood'), unit: 'kg', kgPerUnit: 1, phase: 'solid', maxPowerW: 180 },
    { id: q('grain'), unit: 'legacy grain measure', kgPerUnit: 1, phase: 'solid', maxPowerW: 0, legacyItem: 'grain' },
    { id: q('flour'), unit: 'legacy flour measure', kgPerUnit: 0.75, phase: 'solid', maxPowerW: 0, legacyItem: 'flour' },
    { id: q('water'), unit: 'litre', kgPerUnit: 1, phase: 'liquid', maxPowerW: 0 },
  ], processes: [{ id: q('grinding'), input: { material: q('grain'), quantity: 3 }, output: { material: q('flour'), quantity: 4 }, byproducts: [], joulesPerBatch: 120, maxBatchesPerSecond: 1 }], components: [
    { ...common, id: q('intake'), kind: 'source', output: air, efficiency: 1 },
    { ...common, id: q('rotor'), kind: 'converter', input: air, output: axle, efficiency: 0.75 },
    { ...common, id: q('a-slipping-cord'), kind: 'transmission', input: axle, output: drive, efficiency: 0.08, massKg: 1 },
    { ...common, id: q('belt'), kind: 'transmission', input: axle, output: drive },
    { ...common, id: q('stones'), kind: 'process', input: drive, process: q('grinding'), minPowerW: 30 },
    { ...common, id: q('impeller'), kind: 'transfer', input: drive, phase: 'liquid', joulesPerKg: 30, maxKgPerSecond: 3, minPowerW: 25 },
  ] };
}
