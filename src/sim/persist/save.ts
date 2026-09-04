import { World } from '../core/world';
import { WorldClock } from '../core/time';
import { generateVillage } from '../world/village';
import type { Person, Body, Item, Place, Faction, WorldEvent, Conflict, Field, HaulTask, ResourceNode, ConstructionProject } from '../core/types';
import { syncFieldBlocks } from '../world/metabolism';
import { syncResourceNodeBlocks } from '../world/resources';
import { materializeStructure } from '../world/construction';

const KEY = 'infinite-rpg-save-v1';
// v0.2.1 Priority 8: bumped 2 -> 3 to add faction leaderId/knowledge persistence (see
// `factions` below) — a v0.2 canonical addition that was silently dropped on save/reload
// before this fix. Every other v0.2/v0.2.1 addition audited alongside this one
// (Person.factionId/hostile/cognitiveLOD, Faction.members/hostileTo, Mind.robCooldowns,
// Body.attackTarget) is intentionally NOT persisted because each is either fully
// reconstructed deterministically by `generateVillage`/periodic maintenance from data that
// IS saved (factionId, hostile, members, hostileTo: fixed at village generation, never
// mutated afterward; cognitiveLOD: recomputed every maintenance pass purely from current
// significance/position/goal, see core/cognition.ts), or short-lived tactical state that is
// correct to simply reset on load, exactly like `pose`/`plan` already are (robCooldowns,
// attackTarget: cleared naturally within seconds of play regardless). `leaderId` and
// `knowledge`, by contrast, depend on simulation HISTORY (who died when, what a leader
// personally learned) that cannot be re-derived from present state alone, so they must be
// persisted explicitly. See docs/V0_2_1_WORLD_ENGINE_STABILIZATION.md.
// v0.2.3: bumped 3 -> 4 for conflict-resolution canonical state (World.conflicts, Person
// surrender/custody, Body.subduedUntil).
// v0.2.4: bumped 4 -> 5 for world-metabolism canonical state — `World.fields` (crop lifecycle
// + soil moisture) and `Needs.thirst`. Grain/flour/bread stock are ordinary items and already
// round-trip. Crop *blocks* also round-trip via grid diffs, but the canonical plot state is
// authoritative and re-projected onto the grid on load. See docs/V0_2_4_WORLD_METABOLISM.md.
// v0.3: bumped 5 -> 6 for Living World I canonical state — `World.haulTasks` (a haul in
// transit / cargo that isn't at any Place), `World.resourceNodes` (tree/stone depletion +
// regrowth timing), `World.constructionProjects` (a half-supplied project, labour done,
// per-worker contributions). Materials/logs/planks/stone are ordinary items and round-trip;
// chopped/built voxels round-trip via grid diffs but node/project state is authoritative and
// re-projected on load. New Item fields (`haulTaskId`, `spoilAccum`) round-trip with the item.
export const SAVE_VERSION = 6;

/**
 * Persistence strategy: the base world is regenerated deterministically from the seed (so voxels and
 * entity ids match), then the saved *state* is overlaid: minds, bodies, items, events, clock, weather,
 * and voxel modifications. Consequences survive the renderer restarting.
 */
export function serialize(world: World): string {
  // investigated is a Set in memory (v0.2.2 Phase 3: O(1) membership instead of an
  // ever-growing array's O(length) .includes() on every guard's every think() tick) — JSON has
  // no native Set, so it round-trips as a plain array here and is rebuilt into a Set on load.
  const persons = world.persons().map(p => ({ id: p.id, needs: p.needs, emotions: p.emotions, relationships: p.relationships, memories: p.memories, knowledge: p.knowledge, inventory: p.inventory, wealth: p.wealth, alive: p.alive, desires: p.desires, deathTick: p.deathTick, goal: p.mind.goal, investigated: [...p.mind.investigated], decision: p.mind.decision, timeRate: p.timeRate, surrender: p.surrender ?? null, custody: p.custody ?? null }));
  // v0.2.3: a subdued body must reload still subdued (unlike `pose`, which is reset). Persist the
  // physical-time timestamp; a downed pose is reconstructed from it on load.
  const bodies = world.bodies().map(b => ({ id: b.id, pos: b.pos, yaw: b.yaw, health: b.health, maxHealth: b.maxHealth, dead: b.dead, pose: b.pose === 'dead' ? 'dead' : (b.subduedUntil > world.physicalTime ? 'downed' : 'stand'), present: b.present, subduedUntil: b.subduedUntil }));
  const items = world.items().map(i => ({ ...i, tags: [...i.tags], pos: i.pos ? { ...i.pos } : null, provenance: i.provenance.map(entry => ({ ...entry })) }));
  const places = world.places().map(p => ({ id: p.id, ownerId: p.ownerId, anchors: p.anchors.map(a => a.ownerId ?? null) }));
  // v0.2.1 Priority 8: leaderId (leadership succession) and knowledge (institutional memory,
  // see history/factions.ts) both change during play and cannot be re-derived from present
  // state alone — see the SAVE_VERSION comment above for what else was audited and why it's
  // deliberately excluded here.
  const factions = [...world.ofKind<Faction>('faction')].map(f => ({ id: f.id, leaderId: f.leaderId, knowledge: f.knowledge }));
  const diffs = [...world.grid.diffs.entries()];
  const doors = [...world.grid.doorStates.entries()];
  const events = eventsForPersistence(world);
  // v0.2.3: conflicts are plain serializable records (ids, ticks, strings, numbers). The whole
  // list is kept — a resolved conflict is history and its outcome feeds re-engagement gating.
  const conflicts = world.conflicts.map(c => ({ ...c }));
  // v0.2.4: fields carry the crop lifecycle + soil moisture. Plain data; whole list kept.
  const fields = world.fields.map(f => ({ ...f, plots: f.plots.map(p => ({ ...p })) }));
  // v0.3: haul tasks, resource nodes, construction projects — all plain serializable records.
  const haulTasks = world.haulTasks.map(t => ({ ...t }));
  const resourceNodes = world.resourceNodes.map(n => ({ ...n, pos: { ...n.pos }, blocks: n.blocks.map(b => ({ ...b })) }));
  const constructionProjects = world.constructionProjects.map(p => ({ ...p, required: p.required.map(r => ({ ...r })), contributions: { ...p.contributions }, siteBounds: { ...p.siteBounds } }));
  return JSON.stringify({ version: SAVE_VERSION, seed: world.seed, clock: world.clock.state(), physicalTime: world.physicalTime, weather: world.weather, counters: world.getCounters(), playerId: world.playerId, persons, bodies, items, places, factions, conflicts, fields, haulTasks, resourceNodes, constructionProjects, diffs, doors, events, savedAt: Date.now() });
}

/** Keep the save bounded without breaking any retained event's causal references. */
export function eventsForPersistence(world: World): WorldEvent[] {
  const recentCutoff = Math.max(0, world.events.length - 1500);
  const keep = new Set(world.events.filter((event, index) => event.category !== 'cognition' || event.significance >= 0.3 || index >= recentCutoff).map(event => event.id));
  const addCauses = (event: WorldEvent): void => {
    for (const causeId of event.causes) {
      if (keep.has(causeId)) continue;
      const cause = world.event(causeId); if (!cause) continue;
      keep.add(causeId); addCauses(cause);
    }
  };
  for (const id of [...keep]) { const event = world.event(id); if (event) addCauses(event); }
  return world.events.filter(event => keep.has(event.id)).map(event => ({
    ...event,
    data: { ...event.data },
    causes: event.causes.filter(id => keep.has(id)),
    effects: event.effects.filter(id => keep.has(id)),
    perceivedBy: event.perceivedBy.map(percept => ({ ...percept })),
  }));
}

export function save(world: World): boolean { try { localStorage.setItem(KEY, serialize(world)); return true; } catch (e) { console.warn('save failed', e); return false; } }
export function hasSave(): boolean {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return false;
    return JSON.parse(raw).version === SAVE_VERSION;
  } catch { return false; }
}
export function clearSave(): void { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function load(): { world: World; gen: ReturnType<typeof generateVillage> } | null {
  let raw: string | null = null; try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  return deserialize(raw);
}

/** Parse a save independently of browser storage so persistence can be regression-tested. */
export function deserialize(raw: string): { world: World; gen: ReturnType<typeof generateVillage> } | null {
  try {
    const data = JSON.parse(raw); if (data.version !== SAVE_VERSION) return null;
    const world = new World(data.seed); const gen = generateVillage(world);
    // overlay
    const genEvents = world.events; // history events regenerated; replace with saved log (which contains them)
    world.events = []; world.eventIndex.clear();
    for (const e of data.events) { world.events.push(e); world.eventIndex.set(e.id, e); }
    if (!world.events.length) { world.events = genEvents; for (const e of genEvents) world.eventIndex.set(e.id, e); }
    world.setCounters(data.counters); world.clock = new WorldClock(data.clock); world.physicalTime = data.physicalTime ?? 0; world.weather = data.weather; world.playerId = data.playerId;
    for (const s of data.persons) { const p = world.person(s.id); if (!p) continue; Object.assign(p, { needs: s.needs, emotions: s.emotions, relationships: s.relationships, memories: s.memories, knowledge: s.knowledge, inventory: s.inventory, wealth: s.wealth, alive: s.alive, desires: s.desires, deathTick: s.deathTick, timeRate: s.timeRate ?? 1, surrender: s.surrender ?? null, custody: s.custody ?? null }); p.mind.goal = s.goal ?? null; p.mind.plan = []; p.mind.investigated = new Set(s.investigated ?? []); p.mind.decision = s.decision ?? null; }
    for (const s of data.bodies) { const b = world.body(s.id); if (!b) continue; b.pos = s.pos; b.yaw = s.yaw; b.health = s.health; b.maxHealth = s.maxHealth; b.dead = s.dead; b.pose = s.pose; b.present = s.present; b.path = null; b.subduedUntil = s.subduedUntil ?? 0; }
    world.conflicts = (data.conflicts ?? []).map((c: Conflict) => ({ ...c }));
    if (data.fields?.length) { world.fields = data.fields.map((f: Field) => ({ ...f, plots: f.plots.map(p => ({ ...p })) })); }
    world.haulTasks = (data.haulTasks ?? []).map((t: HaulTask) => ({ ...t }));
    if (data.resourceNodes?.length) world.resourceNodes = data.resourceNodes.map((n: ResourceNode) => ({ ...n, pos: { ...n.pos }, blocks: n.blocks.map(b => ({ ...b })) }));
    if (data.constructionProjects?.length) world.constructionProjects = data.constructionProjects.map((p: ConstructionProject) => ({ ...p, required: p.required.map(r => ({ ...r })), contributions: { ...p.contributions }, siteBounds: { ...p.siteBounds } }));

    for (const s of data.items) { const i = world.item(s.id); if (i) Object.assign(i, s); else world.add({ ...s, tags: [...s.tags], pos: s.pos ? { ...s.pos } : null, provenance: s.provenance.map((entry: Item['provenance'][number]) => ({ ...entry })) } as Item); }
    for (const s of data.places) { const p = world.place(s.id); if (!p) continue; p.ownerId = s.ownerId; s.anchors.forEach((o: string | null, i: number) => { if (p.anchors[i]) p.anchors[i].ownerId = o ?? undefined; }); }
    for (const s of data.factions ?? []) { const f = world.faction(s.id); if (!f) continue; f.leaderId = s.leaderId; f.knowledge = s.knowledge; }
    if (data.diffs?.length) { world.grid.recording = false; world.grid.applyDiffs(data.diffs); world.grid.initCaches(); world.nav.rebuildAll(); world.grid.dirtyChunks.clear(); }
    if (data.doors?.length) world.grid.restoreDoorStates(data.doors);
    // v0.2.4: canonical plot state is authoritative — re-project it onto the grid (harmless if
    // the diffs already restored the same blocks; corrects any drift).
    if (world.fields.length) syncFieldBlocks(world);
    // v0.3: re-project resource-node state, and re-raise any completed structure (village
    // generation rebuilt its site as a bare 'construction' Place — the diffs restored the
    // blocks, this restores the Place's identity/anchors). Idempotent.
    if (world.resourceNodes.length) syncResourceNodeBlocks(world);
    for (const proj of world.constructionProjects) if (proj.status === 'complete') materializeStructure(world, proj);
    if (world.resourceNodes.length || world.constructionProjects.some(p => p.status === 'complete')) { world.grid.dirtyChunks.clear(); world.nav.rebuildAll(); }
    world.grid.recording = true;
    // Generated entity ids are part of the save schema. Refuse a malformed/incompatible
    // overlay rather than booting a world whose player has no physical manifestation.
    if (!world.person(world.playerId) || !world.primaryBody(world.playerId)) return null;
    return { world, gen };
  } catch (e) { console.warn('load failed', e); return null; }
}
export function newWorld(seed = 1337): { world: World; gen: ReturnType<typeof generateVillage> } { const world = new World(seed); const gen = generateVillage(world); world.grid.recording = true; return { world, gen }; }
