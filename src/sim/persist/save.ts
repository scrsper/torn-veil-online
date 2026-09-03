import { World } from '../core/world';
import { WorldClock } from '../core/time';
import { generateVillage } from '../world/village';
import type { Person, Body, Item, Place, Faction, WorldEvent } from '../core/types';

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
export const SAVE_VERSION = 3;

/**
 * Persistence strategy: the base world is regenerated deterministically from the seed (so voxels and
 * entity ids match), then the saved *state* is overlaid: minds, bodies, items, events, clock, weather,
 * and voxel modifications. Consequences survive the renderer restarting.
 */
export function serialize(world: World): string {
  const persons = world.persons().map(p => ({ id: p.id, needs: p.needs, emotions: p.emotions, relationships: p.relationships, memories: p.memories, knowledge: p.knowledge, inventory: p.inventory, wealth: p.wealth, alive: p.alive, desires: p.desires, deathTick: p.deathTick, goal: p.mind.goal, investigated: p.mind.investigated, decision: p.mind.decision, timeRate: p.timeRate }));
  const bodies = world.bodies().map(b => ({ id: b.id, pos: b.pos, yaw: b.yaw, health: b.health, maxHealth: b.maxHealth, dead: b.dead, pose: b.pose === 'dead' ? 'dead' : 'stand', present: b.present }));
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
  return JSON.stringify({ version: SAVE_VERSION, seed: world.seed, clock: world.clock.state(), physicalTime: world.physicalTime, weather: world.weather, counters: world.getCounters(), playerId: world.playerId, persons, bodies, items, places, factions, diffs, doors, events, savedAt: Date.now() });
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
    for (const s of data.persons) { const p = world.person(s.id); if (!p) continue; Object.assign(p, { needs: s.needs, emotions: s.emotions, relationships: s.relationships, memories: s.memories, knowledge: s.knowledge, inventory: s.inventory, wealth: s.wealth, alive: s.alive, desires: s.desires, deathTick: s.deathTick, timeRate: s.timeRate ?? 1 }); p.mind.goal = s.goal ?? null; p.mind.plan = []; p.mind.investigated = s.investigated ?? []; p.mind.decision = s.decision ?? null; }
    for (const s of data.bodies) { const b = world.body(s.id); if (!b) continue; b.pos = s.pos; b.yaw = s.yaw; b.health = s.health; b.maxHealth = s.maxHealth; b.dead = s.dead; b.pose = s.pose; b.present = s.present; b.path = null; }
    for (const s of data.items) { const i = world.item(s.id); if (i) Object.assign(i, s); else world.add({ ...s, tags: [...s.tags], pos: s.pos ? { ...s.pos } : null, provenance: s.provenance.map((entry: Item['provenance'][number]) => ({ ...entry })) } as Item); }
    for (const s of data.places) { const p = world.place(s.id); if (!p) continue; p.ownerId = s.ownerId; s.anchors.forEach((o: string | null, i: number) => { if (p.anchors[i]) p.anchors[i].ownerId = o ?? undefined; }); }
    for (const s of data.factions ?? []) { const f = world.faction(s.id); if (!f) continue; f.leaderId = s.leaderId; f.knowledge = s.knowledge; }
    if (data.diffs?.length) { world.grid.recording = false; world.grid.applyDiffs(data.diffs); world.grid.initCaches(); world.nav.rebuildAll(); world.grid.dirtyChunks.clear(); }
    if (data.doors?.length) world.grid.restoreDoorStates(data.doors);
    world.grid.recording = true;
    // Generated entity ids are part of the save schema. Refuse a malformed/incompatible
    // overlay rather than booting a world whose player has no physical manifestation.
    if (!world.person(world.playerId) || !world.primaryBody(world.playerId)) return null;
    return { world, gen };
  } catch (e) { console.warn('load failed', e); return null; }
}
export function newWorld(seed = 1337): { world: World; gen: ReturnType<typeof generateVillage> } { const world = new World(seed); const gen = generateVillage(world); world.grid.recording = true; return { world, gen }; }
