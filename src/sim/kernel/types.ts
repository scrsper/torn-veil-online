import type { EntityId, ItemType, Vec3 } from '../core/types';

/** All rates use PHYSICAL seconds, J, W=J/s, kg, and metres. Calendar stamps use world.now.
 * Material quantities use their declared unit; kgPerUnit bridges existing item measures. */
export interface MaterialDefinition {
  id: string; unit: string; kgPerUnit: number; phase: 'solid' | 'liquid';
  maxPowerW: number; legacyItem?: ItemType;
  /** Dimensionless functional properties, scoped to this world's ruleset. */
  properties?: Record<string, number>;
}
export interface Port { medium: string; coupling: string }
export interface ComponentDefinition {
  id: string; material: string; massKg: number;
  kind: 'source' | 'converter' | 'transmission' | 'process' | 'transfer';
  input?: Port; output?: Port; efficiency: number; maxPowerW: number; minPowerW: number;
  installSeconds: number; wearPerJ: number;
  process?: string;
  /** Generic transfer restriction and work, independent of the material's name. */
  phase?: MaterialDefinition['phase']; joulesPerKg?: number; maxKgPerSecond?: number;
  /** Manufacture a primitive shape from its material. No finished-device recipe. */
  fabrication?: { seconds: number; min: Record<string, number>; max?: Record<string, number> };
}
export interface ProcessDefinition {
  id: string; input: { material: string; quantity: number };
  output: { material: string; quantity: number };
  byproducts: { material: string; quantity: number }[];
  joulesPerBatch: number; maxBatchesPerSecond: number;
}
export interface Ruleset {
  id: string; materials: MaterialDefinition[]; components: ComponentDefinition[]; processes: ProcessDefinition[];
}
export interface Component {
  id: string; definition: string; condition: number; ownerId: EntityId | null;
  pos: Vec3; holderId: EntityId | null; assemblyId: string | null;
  madeEvent?: string;
}
export interface Reservoir {
  id: string; material: string; quantity: number; capacity: number; pos: Vec3; ownerId: EntityId | null;
}
/** A finite environmental boundary, never replenished implicitly. No assembly can write energy
 * back to it. initialJ is the reported initial condition; remainingJ is the spendable stock. */
export interface EnergySource {
  id: string; medium: string; initialJ: number; remainingJ: number; maxPowerW: number;
  origin: string; pos: Vec3; ownerId: EntityId | null;
  /** Open environmental boundary: imported = used + escaped + remaining - initial.
   * Only the simulation clock advances this flux, never an operation or a reader. */
  wind?: { areaM2: number; airDensity: number; exposure: number; importedJ: number; escapedJ: number; lastPowerW?: number };
  lastEvent?: string;
}
export interface Connection { from: number; to: number }
export interface Method {
  ruleset: string; definitions: string[]; connections: Connection[]; effect: string; provenance?: string[];
}
export interface Bindings { energyId: string; placeId?: EntityId; inputId?: string; outputId?: string }
export interface Assembly {
  id: string; ownerId: EntityId; pos: Vec3; parts: string[]; connections: Connection[];
  /** Project intent belongs to its author. Inheriting hardware does not inherit a mind. */
  creatorId?: EntityId;
  bindings: Bindings; lastEvent?: string;
  /** Planned topology is intent, never used by physical execution until connections exist. */
  method: Method; needKey?: string; tested: boolean; learned: boolean;
  laborSeconds: number; operatedSeconds: number; inputJ: number; usefulJ: number; dissipatedJ: number;
  outputQuantity: number; lastReason?: string;
  /** Construction progress survives interrupted plans and save/load. */
  progress: Record<string, number>;
  history?: { eventId: string; operation: string; parents: string[]; method: Method }[];
}
export interface KernelState {
  ruleset: Ruleset; components: Component[]; reservoirs: Reservoir[]; energy: EnergySource[]; assemblies: Assembly[];
}
export const emptyKernel = (): KernelState => ({ ruleset: { id: 'torn-veil:mechanics-v1', materials: [], components: [], processes: [] }, components: [], reservoirs: [], energy: [], assemblies: [] });
export interface RunResult { reason: string; output: number; consumed: number; inputJ: number; usefulJ: number; dissipatedJ: number; eventId: string }
