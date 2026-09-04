import type { CognitiveLOD, Person } from './types';
import { World } from './world';

/**
 * Cognitive Level of Detail (Constitution §21-27). This is the v0.2 mechanism, not a
 * civilization-scale population system: it demonstrates that fidelity can change, cheaply
 * and reversibly, without ever altering what an entity already knows, who it is, or how
 * powerful it is (Constitution invariants under §20 "Three Independent Axes" and §26).
 *
 * `thinkInterval` is the only thing a fidelity change touches. Everything an entity knows —
 * memories, relationships, knowledge, goals in flight — is untouched, so downgrading and
 * later upgrading an entity is lossless (see cognition.test.ts).
 */
const BASE_THINK_INTERVAL = 1.5; // Simulation's default thinkInterval for a freshly-made person (factory.ts)
const LOD_THINK_MULTIPLIER: Record<CognitiveLOD, number> = { deep: 0.5, full: 1, lightweight: 5, aggregate: 30 };

export function thinkIntervalFor(lod: CognitiveLOD): number { return BASE_THINK_INTERVAL * LOD_THINK_MULTIPLIER[lod]; }

/** Change an entity's cognitive fidelity in place. Reversible: calling this again with a
 * different (or the same) level never discards state. */
export function setCognitiveLOD(world: World, p: Person, lod: CognitiveLOD): void {
  const prev: CognitiveLOD = p.cognitiveLOD ?? 'full';
  if (prev === lod) return;
  p.cognitiveLOD = lod;
  p.mind.thinkInterval = thinkIntervalFor(lod);
  world.emit('cognitive_lod_changed', { actor: p.id, significance: 0, category: 'cognition', data: { from: prev, to: lod }, summary: `${p.name}'s cognitive fidelity shifted from ${prev} to ${lod}` });
}

export interface CognitiveLODRebalanceOptions {
  /** Distance (blocks) from the player within which a person stays/becomes 'full'. */
  nearRadius?: number;
  /** Historical-significance score at or above which a person stays/becomes 'full'
   * regardless of distance — a consequential person doesn't go cheap just because the
   * player wandered off (Constitution §27, "entities earn compute through history"). */
  significanceFloor?: number;
}

/**
 * A deterministic downgrade/upgrade pass: demonstrates the CLOD mechanism (v0.2 Part 8) by
 * assigning 'lightweight' cognition to distant, historically minor, currently-uninvolved
 * villagers, and 'full' to everyone else. Intended to be called periodically (e.g. hourly)
 * by a long-running loop such as the headless runner — not every physical step, since the
 * whole point is to spend less on entities that currently don't matter.
 *
 * This never touches the player, never assigns 'aggregate' or 'deep' (those tiers are
 * infrastructure for future population/urgent-cognition scale, not wired into any decision
 * in v0.2 — see docs/V0_2_WORLD_ENGINE.md), and never changes what anyone already knows.
 */
export function rebalanceCognitiveLOD(world: World, significance: Map<string, number>, opts: CognitiveLODRebalanceOptions = {}): { fullCount: number; lightweightCount: number } {
  const nearRadius = opts.nearRadius ?? 40;
  const significanceFloor = opts.significanceFloor ?? 0.5;
  const playerPos = world.playerId ? world.positionOf(world.playerId) : undefined;
  // v0.2.3: 'rob'/'surrender'/'escort_custody' are as time-critical as flee/attack — a
  // lightweight actor that only thinks every ~7.5s cannot surrender, disengage, or finish a
  // robbery promptly, which stretches every conflict out (and multiplies its event workload).
  const urgentGoals = new Set(['flee', 'attack', 'confront', 'investigate', 'report', 'help', 'rob', 'surrender', 'escort_custody']);
  // Anyone currently in an unresolved (active/disengaging) conflict stays 'full' regardless of
  // goal — the conflict-resolution logic (surrender checks, disengagement, re-engagement gating)
  // lives in think() and must run at full cadence for a fight to end cleanly (Constitution §11;
  // v0.2.3 Priority 16).
  const inConflict = new Set<string>();
  for (const c of world.conflicts) if (c.status === 'active' || c.status === 'disengaging') for (const id of c.participants) inConflict.add(id);
  let fullCount = 0, lightweightCount = 0;
  for (const p of world.persons()) {
    if (!p.alive || p.controlled) continue;
    const pos = world.positionOf(p.id);
    const near = !!playerPos && !!pos && world.distance2d(playerPos, pos) <= nearRadius;
    const significant = (significance.get(p.id) ?? 0) >= significanceFloor;
    const urgentlyInvolved = (!!p.mind.goal && urgentGoals.has(p.mind.goal.type)) || inConflict.has(p.id);
    const shouldBeFull = near || significant || urgentlyInvolved;
    setCognitiveLOD(world, p, shouldBeFull ? 'full' : 'lightweight');
    if (shouldBeFull) fullCount++; else lightweightCount++;
  }
  return { fullCount, lightweightCount };
}
