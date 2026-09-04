import type { ResourceNode, ResourceNodeBlock, ItemType, Person, Vec3, EntityId, TreeGrowthStage } from '../core/types';
import type { World } from '../core/world';
import { B } from '../physical/blocks';
import { addPlaceStock } from './stock';
import { capabilityFor } from '../core/attributes';
import { wearTool } from '../core/tools';
import { practiceSkill } from '../core/skills';
import { learnAffordance } from '../mind/knowledge';

/**
 * Renewable / non-renewable resource nodes (v0.3 Living World I, Priority 5-6-8).
 *
 * A resource node is the smallest generalized "materials come from somewhere" concept: a patch
 * of the world (a tree, a rock outcrop) with a canonical amount left, a yield type, and a
 * renewability. The voxel blocks it owns are a projection of its state — a chopped-out tree's
 * blocks are cleared and its logs exist elsewhere; regrowth restores them over meaningful
 * world time. Not every voxel runs a loop: only the mapped nodes do, and only on the coarse
 * upkeep cadence.
 *
 * Trees and the player and NPCs all use the same `extractFromNode` API (Constitution VI).
 */

// ---- tuning
const LOGS_PER_TREE = 6;
const LOGS_PER_CHOP = 2;
const STONE_PER_OUTCROP = 24;
const STONE_PER_GATHER = 3;
/**
 * World-hours from a felled tree to a mature, harvestable one again (v0.4 §14). A felled
 * mature tree does not return in one month — real forestry timescales run in YEARS. ~2.5
 * in-game years (Constitution v0.4 §28's stated target) is deliberately long enough that
 * logging pressure, transport distance and land management become economically real, while
 * still being something a long-running world/save will visibly complete. Species variation
 * (fast softwood, slow hardwood, magical trees) is a real future axis — `regrowHours` already
 * lives per-node for exactly that; v0.4 uses one ordinary-tree timescale.
 */
const TREE_REGROW_HOURS = 2.5 * 365 * 24;
/** Fraction of `regrowHours` elapsed at which a regrowing tree enters each lifecycle stage
 * (Constitution v0.4 §14 "prefer lifecycle states over a magical respawn timer"). Only
 * `mature` (fraction >= 1) is harvestable — `state` flips to 'available' exactly then. */
const GROWTH_STAGE_THRESHOLDS: [number, TreeGrowthStage][] = [[0, 'felled'], [0.08, 'sapling'], [0.4, 'young'], [1, 'mature']];
function growthStageForFraction(f: number): TreeGrowthStage {
  let stage: TreeGrowthStage = 'felled';
  for (const [threshold, s] of GROWTH_STAGE_THRESHOLDS) if (f >= threshold) stage = s;
  return stage;
}

const dist2 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const isTrunk = (b: number) => b === B.Log || b === B.Log2;
const isLeaf = (b: number) => b === B.Leaves || b === B.Leaves2;

/**
 * A walkable cell at ground level next to (bx, bz) — never the node's own column (whose nav
 * floor sits on top of the trunk/boulder, unreachable from the ground). `groundBlockY` is the
 * y of the solid ground block; the walk floor a person stands on is `groundBlockY + 1`.
 * Returns the nearest such neighbour, or null.
 */
function groundStand(world: World, bx: number, bz: number, groundBlockY: number): Vec3 | null {
  const walkY = groundBlockY + 1;
  for (let r = 1; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = bx + dx, z = bz + dz;
      if (world.nav.floorY(x, z) === walkY && world.nav.isWalkable(x, z)) {
        return { x: x + 0.5, y: walkY, z: z + 0.5 };
      }
    }
  }
  return null;
}

/**
 * Map standing trees within a rectangular region into tree ResourceNodes (call once at village
 * generation, after vegetation). Caps the count so a forest doesn't become thousands of nodes —
 * v0.3 only needs enough for a believable timber supply near the woodcutter's clearing.
 */
export function registerTreeNodes(world: World, region: { x0: number; z0: number; x1: number; z1: number }, dropPlaceId: EntityId, areaPlaceId: EntityId, max = 24): void {
  const g = world.grid;
  const claimed = new Set<string>();
  let made = 0;
  for (let x = region.x0; x <= region.x1 && made < max; x++) {
    for (let z = region.z0; z <= region.z1 && made < max; z++) {
      if (claimed.has(`${x},${z}`)) continue;
      // Find the trunk base: a Log/Log2 cell whose block below is NOT a trunk (groundHeight is
      // no help here — the log column is itself "solid ground" to it).
      let base = -1;
      for (let y = 2; y < g.H - 2; y++) { if (isTrunk(g.get(x, y, z)) && !isTrunk(g.get(x, y - 1, z))) { base = y; break; } }
      if (base < 0) continue;
      // trunk column
      const blocks: ResourceNodeBlock[] = [];
      let y = base;
      while (y < g.H && isTrunk(g.get(x, y, z))) { blocks.push({ x, y, z, id: g.get(x, y, z) }); y++; }
      const top = y - 1;
      // connected leaf canopy near the top
      for (let ly = Math.max(base, top - 3); ly <= Math.min(g.H - 1, top + 2); ly++) {
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
          const lx = x + dx, lz = z + dz;
          if (isLeaf(g.get(lx, ly, lz))) blocks.push({ x: lx, y: ly, z: lz, id: g.get(lx, ly, lz) });
        }
      }
      claimed.add(`${x},${z}`);
      const pos = groundStand(world, x, z, base - 1);
      if (!pos) continue;
      world.resourceNodes.push({
        id: world.nextId('node'), kind: 'tree', yield: 'log', pos, blocks,
        remaining: LOGS_PER_TREE, capacity: LOGS_PER_TREE, renewable: true, regrowHours: TREE_REGROW_HOURS,
        state: 'available', dropPlaceId, placeId: areaPlaceId,
      });
      made++;
    }
  }
}

/**
 * Plant a deterministic grove: lay a small stand of trees on flat, walkable ground and register
 * each as a renewable tree node. Used when the surrounding terrain's own trees are on ground too
 * steep to path to — this guarantees the timber supply is actually reachable (a felled tree
 * whose logs no one can fetch teaches nothing).
 */
export function plantGrove(world: World, region: { x0: number; z0: number; x1: number; z1: number }, dropPlaceId: EntityId, areaPlaceId: EntityId, count: number, avoid: { x0: number; z0: number; x1: number; z1: number }[] = []): void {
  const g = world.grid;
  const inAvoid = (x: number, z: number) => avoid.some(a => x >= a.x0 - 1 && x <= a.x1 + 1 && z >= a.z0 - 1 && z <= a.z1 + 1);
  const placed: Vec3[] = [];
  let made = 0;
  for (let x = region.x0; x <= region.x1 && made < count; x += 4) {
    for (let z = region.z0; z <= region.z1 && made < count; z += 4) {
      if (inAvoid(x, z)) continue;
      if (placed.some(p => dist2(p, { x, y: 0, z }) < 3.5)) continue;
      const h = g.groundHeight(x, z);
      const surf = g.get(x, h, z);
      if (surf !== B.Grass && surf !== B.Dirt && surf !== B.Path) continue;
      if (g.get(x, h + 1, z) !== B.Air) continue; // something already there
      const th = 4 + (made % 3); // 4-6 tall
      const blocks: ResourceNodeBlock[] = [];
      for (let i = 1; i <= th; i++) { g.set(x, h + i, z, B.Log); blocks.push({ x, y: h + i, z, id: B.Log }); }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
        const lx = x + dx, ly = h + th + dy, lz = z + dz;
        if (dx === 0 && dz === 0 && dy < 0) continue;
        if (g.get(lx, ly, lz) === B.Air) { g.set(lx, ly, lz, B.Leaves); blocks.push({ x: lx, y: ly, z: lz, id: B.Leaves }); }
      }
      world.nav.rebuildArea(x - 3, z - 3, x + 3, z + 3);
      const pos = groundStand(world, x, z, h);
      if (!pos) { for (const b of blocks) g.set(b.x, b.y, b.z, B.Air); continue; } // undo — nowhere to stand
      placed.push({ x, y: h, z });
      world.resourceNodes.push({
        id: world.nextId('node'), kind: 'tree', yield: 'log', pos, blocks,
        remaining: LOGS_PER_TREE, capacity: LOGS_PER_TREE, renewable: true, regrowHours: TREE_REGROW_HOURS,
        state: 'available', dropPlaceId, placeId: areaPlaceId,
      });
      made++;
    }
  }
  world.nav.rebuildArea(region.x0 - 2, region.z0 - 2, region.x1 + 2, region.z1 + 2);
}

/**
 * Register stone outcrop nodes at a quarry Place: lays a small cluster of stone blocks (so the
 * quarry is visible) and maps each to a non-renewable stone node.
 */
export function registerStoneNodes(world: World, placeId: EntityId, spots: Vec3[]): void {
  const g = world.grid;
  for (const s of spots) {
    const bx = Math.floor(s.x), bz = Math.floor(s.z);
    const h = g.groundHeight(bx, bz);
    const blocks: ResourceNodeBlock[] = [];
    for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
      g.set(bx + dx, h + 1, bz + dz, B.StoneBrick);
      // `id` = the block while the node is AVAILABLE (a worked-out node shows Gravel instead).
      blocks.push({ x: bx + dx, y: h + 1, z: bz + dz, id: B.StoneBrick });
    }
    world.nav.rebuildArea(bx - 3, bz - 3, bx + 3, bz + 3);
    const pos = groundStand(world, bx, bz, h) ?? groundStand(world, bx + 1, bz + 1, h);
    if (!pos) continue;
    world.resourceNodes.push({
      id: world.nextId('node'), kind: 'stone', yield: 'stone', pos, blocks,
      remaining: STONE_PER_OUTCROP, capacity: STONE_PER_OUTCROP, renewable: false, regrowHours: 0,
      state: 'available', dropPlaceId: placeId, placeId,
    });
  }
  world.nav.rebuildArea(spots[0] ? Math.floor(spots[0].x) - 4 : 0, spots[0] ? Math.floor(spots[0].z) - 4 : 0, spots.reduce((m, s) => Math.max(m, Math.floor(s.x)), 0) + 4, spots.reduce((m, s) => Math.max(m, Math.floor(s.z)), 0) + 4);
}

/** Re-project every node's canonical state onto the grid (used after load — canonical node
 * state is authoritative over whatever the grid diffs happen to hold). */
export function syncResourceNodeBlocks(world: World): void {
  for (const n of world.resourceNodes) {
    for (const b of n.blocks) {
      const id = n.state === 'available' ? b.id : (n.kind === 'stone' ? B.Gravel : B.Air);
      world.grid.set(b.x, b.y, b.z, id);
    }
  }
}

export function nearestAvailableNode(world: World, kind: ResourceNode['kind'], pos: Vec3, maxDist: number, areaPlaceId?: EntityId): ResourceNode | null {
  let best: ResourceNode | null = null; let bd = maxDist;
  for (const n of world.resourceNodes) {
    if (n.kind !== kind || n.state !== 'available' || n.remaining <= 0) continue;
    if (areaPlaceId && n.placeId !== areaPlaceId) continue;
    const d = dist2(pos, n.pos);
    if (d < bd) { bd = d; best = n; }
    else if (d === bd && best && n.id < best.id) best = n;
  }
  return best;
}

/** World-seconds one extraction "swing" represents — used to cost the actor real energy/
 * fatigue/tool wear via the same capability layer every labour action goes through. */
const SWING_SECONDS = 5 * 60;

/**
 * Extract from a node (chop a tree / quarry a rock). Produces real items at the node's drop
 * Place; depletes the node when nothing is left. Shared by NPC `chop`/`gather` actions and the
 * player. Returns units produced (0 if the node is not currently workable).
 *
 * v0.4 §5-6: the amount produced per swing is no longer a flat constant — it scales with the
 * actor's strength and the tool they have access to (`bestToolFor`/`toolWorkMultiplier`, core/
 * tools.ts): an axe makes felling dramatically more effective than bare hands, a pickaxe does
 * the same for quarrying, and the tool wears slightly from use. The swing also costs the actor
 * real energy/hydration/fatigue (core/physiology.ts) at the `chop`/`quarry` activity rate.
 * Never zero — an improvised bare-handed attempt is always physically possible, just far less
 * productive (Constitution v0.4 §5).
 */
export function extractFromNode(world: World, node: ResourceNode, actor: Person): number {
  if (node.state !== 'available' || node.remaining <= 0) return 0;
  const action = node.kind === 'tree' ? 'chop' : 'quarry';
  const { cap, tool } = capabilityFor(world, actor, action, world.placeAt(node.pos)?.id ?? node.placeId ?? null);
  const basePer = node.kind === 'tree' ? LOGS_PER_CHOP : STONE_PER_GATHER;
  const per = Math.max(1, Math.round(basePer * cap.workRate * (0.6 + cap.effectiveStrength * 0.4)));
  const got = Math.min(per, node.remaining);
  node.remaining -= got;
  const verb = node.kind === 'tree' ? 'chopped' : 'quarried';
  const ev = world.emit('resource_extracted', {
    actor: actor.id, placeId: node.dropPlaceId, pos: { ...node.pos }, significance: 0.15,
    data: { nodeId: node.id, kind: node.kind, yield: node.yield, amount: got, remaining: node.remaining, tool: tool?.type ?? 'bare hands' },
    summary: `${actor.name} ${verb} ${got} ${node.yield}${tool ? ` with ${tool.name}` : ' bare-handed'}`,
  });
  addPlaceStock(world, node.yield, got, node.dropPlaceId, actor.id, ev.id, verb);
  // v0.8 §E: a real byproduct, not a separate production chain — felling a tree naturally
  // leaves small branches alongside the trunk (Constitution v0.8: "wood + felling → heat/ash"
  // language generalizes to "primary product + byproduct" for any real process; here the
  // byproduct is `stick`, world/crafting.ts's raw-material input, not waste). Deterministic:
  // exactly one per successful chop, never scaled with `got` (a stronger worker gets more logs
  // per swing from the same tree, not proportionally more branches).
  if (node.kind === 'tree') addPlaceStock(world, 'stick', 1, node.dropPlaceId, actor.id, ev.id, 'gathered as a byproduct while felling');
  // Energy/hydration/fatigue/heat cost is applied centrally, once per world-minute, by
  // Simulation.strategic()'s physiology step (it classifies the actor's current goal as this
  // same 'chop'/'quarry' activity) — see core/physiology.ts's `activityLevelFor`. Only tool
  // wear is per-swing, since it is tied to the specific tool used for this specific extraction.
  wearTool(world, tool, SWING_SECONDS / 3600);
  // v0.6 §V.9: a real successful extraction (got > 0, already guaranteed here) is meaningful
  // work — practice once per swing.
  practiceSkill(actor, action === 'chop' ? 'woodcutting' : 'quarrying', 1);
  // v0.7 §Affordances: using a tool for its real purpose is itself evidence of what it's good
  // for — learning by doing, the second acquisition path alongside profession seeding.
  if (tool) learnAffordance(world, actor, tool.type, { type: 'self' });
  if (node.remaining <= 0) depleteNode(world, node);
  return got;
}

function depleteNode(world: World, node: ResourceNode): void {
  node.state = 'depleted';
  node.depletedAt = world.now;
  node.regrowAt = node.renewable ? world.now + node.regrowHours * 3600 : undefined;
  if (node.renewable) node.growthStage = 'felled';
  for (const b of node.blocks) world.grid.set(b.x, b.y, b.z, node.kind === 'stone' ? B.Gravel : B.Air);
  const bx = Math.round(node.pos.x), bz = Math.round(node.pos.z);
  world.nav.rebuildArea(bx - 4, bz - 4, bx + 4, bz + 4);
  // A single felled tree is an ordinary world event (it regrows); a worked-out stone outcrop —
  // a non-renewable notable site being exhausted — is real history and Chronicle-eligible.
  world.emit('resource_depleted', {
    placeId: node.dropPlaceId, pos: { ...node.pos }, significance: node.kind === 'tree' ? 0.2 : 0.55,
    category: node.kind === 'tree' ? 'world' : 'history',
    data: { nodeId: node.id, kind: node.kind, renewable: node.renewable, regrowAt: node.regrowAt },
    summary: node.kind === 'tree' ? `A tree near ${world.nameOf(node.placeId)} was felled` : `The stone outcrop at ${world.nameOf(node.placeId)} was worked out`,
  });
}

/**
 * Deterministic upkeep: advance a depleted renewable node's growth stage (v0.4 §14 — a
 * felled → sapling → young → mature lifecycle, not a bare timer), and regrow it exactly once
 * that lifecycle reaches `mature`. Stage is always computed fresh from elapsed time /
 * `regrowHours` (never incremented step-by-step), so calling this at any cadence — including
 * once, long after depletion — reproduces the exact same stage/availability a player watching
 * continuously would have seen; no drift from how often upkeep happens to run.
 */
export function maintainResourceNodes(world: World): void {
  const now = world.now;
  for (const n of world.resourceNodes) {
    if (n.state === 'available' || !n.renewable || n.regrowAt === undefined || n.depletedAt === undefined) continue;
    const fraction = Math.min(1, (now - n.depletedAt) / (n.regrowHours * 3600));
    const stage = growthStageForFraction(fraction);
    if (stage !== n.growthStage) {
      n.growthStage = stage;
      world.emit('tree_growth_stage', {
        placeId: n.dropPlaceId, pos: { ...n.pos }, significance: 0.05,
        data: { nodeId: n.id, stage }, summary: `A felled tree near ${world.nameOf(n.placeId)} is now ${stage}`,
      });
    }
    if (now < n.regrowAt) continue;
    n.state = 'available'; n.remaining = n.capacity; n.regrowAt = undefined; n.depletedAt = undefined; n.growthStage = 'mature';
    for (const b of n.blocks) world.grid.set(b.x, b.y, b.z, b.id);
    const bx = Math.round(n.pos.x), bz = Math.round(n.pos.z);
    world.nav.rebuildArea(bx - 4, bz - 4, bx + 4, bz + 4);
    world.emit('resource_regrew', {
      placeId: n.dropPlaceId, pos: { ...n.pos }, significance: 0.2,
      data: { nodeId: n.id, kind: n.kind },
      summary: `A new tree has grown near ${world.nameOf(n.placeId)}`,
    });
  }
}

// ---------------------------------------------------------------- observability
export interface ResourceNodeSummary {
  trees: { total: number; available: number; depleted: number; regrowing: number };
  /** v0.4 §14/§23: lifecycle-stage breakdown of currently-regrowing trees — "saplings/young/
   * mature" (mature-and-regrowing is transient: it flips to `available` the same pass). */
  treeGrowthStages: Record<'felled' | 'sapling' | 'young' | 'mature', number>;
  stone: { total: number; available: number; remaining: number };
  extracted: number; depletedEvents: number; regrewEvents: number;
}
export function resourceNodeSummary(world: World): ResourceNodeSummary {
  const trees = world.resourceNodes.filter(n => n.kind === 'tree');
  const stone = world.resourceNodes.filter(n => n.kind === 'stone');
  const stages: ResourceNodeSummary['treeGrowthStages'] = { felled: 0, sapling: 0, young: 0, mature: 0 };
  for (const n of trees) if (n.state !== 'available' && n.growthStage) stages[n.growthStage]++;
  return {
    trees: {
      total: trees.length,
      available: trees.filter(n => n.state === 'available').length,
      depleted: trees.filter(n => n.state === 'depleted').length,
      regrowing: trees.filter(n => n.state === 'regrowing').length,
    },
    treeGrowthStages: stages,
    stone: {
      total: stone.length,
      available: stone.filter(n => n.state === 'available').length,
      remaining: stone.reduce((a, n) => a + n.remaining, 0),
    },
    extracted: world.runTally.resource_extracted ?? 0,
    depletedEvents: world.runTally.resource_depleted ?? 0,
    regrewEvents: world.runTally.resource_regrew ?? 0,
  };
}
