import type { Body } from './types';

/** Species composition is independent of entity cognition/ownership. A sapient nonhuman
 * can use Person with this species id; being nonhuman never selects the wildlife controller.
 * Unsupported components must be implemented explicitly, never silently treated as walking
 * animals. Capability ids are references for future canonical resolvers, not rule bypasses. */
export interface CreatureSpeciesSpec {
  id: string;
  name: string;
  bodyPlan: { id: string; shape: Body['shape']; massKg: number; heightM: number; radiusM: number };
  locomotion: Record<string, { speedMps: number }>;
  cognition: { controller: string };
  senses: { localRadiusM: number };
  innateCapabilityIds?: string[];
}
