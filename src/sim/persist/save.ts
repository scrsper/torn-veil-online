import { World } from '../core/world';
import { WorldClock } from '../core/time';
import { generateVillage } from '../world/village';
import type { Person, Body, Item, Place } from '../core/types';

const KEY = 'infinite-rpg-save-v1';
export const SAVE_VERSION = 1;

/**
 * Persistence strategy: the base world is regenerated deterministically from the seed (so voxels and
 * entity ids match), then the saved *state* is overlaid: minds, bodies, items, events, clock, weather,
 * and voxel modifications. Consequences survive the renderer restarting.
 */
export function serialize(world: World): string {
  const persons = world.persons().map(p => ({ id: p.id, needs: p.needs, emotions: p.emotions, relationships: p.relationships, memories: p.memories, knowledge: p.knowledge, inventory: p.inventory, wealth: p.wealth, alive: p.alive, desires: p.desires, deathTick: p.deathTick, goal: p.mind.goal, investigated: p.mind.investigated, decision: p.mind.decision, timeRate: p.timeRate }));
  const bodies = world.bodies().map(b => ({ id: b.id, pos: b.pos, yaw: b.yaw, health: b.health, maxHealth: b.maxHealth, dead: b.dead, pose: b.pose === 'dead' ? 'dead' : 'stand', present: b.present }));
  const items = world.items().map(i => ({ id: i.id, ownerId: i.ownerId, holderId: i.holderId, pos: i.pos, placeId: i.placeId, provenance: i.provenance, quantity: i.quantity, name: i.name }));
  const places = world.places().map(p => ({ id: p.id, ownerId: p.ownerId, anchors: p.anchors.map(a => a.ownerId ?? null) }));
  const diffs = [...world.grid.diffs.entries()];
  const events = world.events.filter(e => e.category !== 'cognition' || e.significance >= 0.3 || world.events.length - world.events.indexOf(e) < 1500);
  return JSON.stringify({ version: SAVE_VERSION, seed: world.seed, clock: world.clock.state(), physicalTime: world.physicalTime, weather: world.weather, counters: world.getCounters(), playerId: world.playerId, persons, bodies, items, places, diffs, events, savedAt: Date.now() });
}

export function save(world: World): boolean { try { localStorage.setItem(KEY, serialize(world)); return true; } catch (e) { console.warn('save failed', e); return false; } }
export function hasSave(): boolean { try { return !!localStorage.getItem(KEY); } catch { return false; } }
export function clearSave(): void { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function load(): { world: World; gen: ReturnType<typeof generateVillage> } | null {
  let raw: string | null = null; try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
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
    for (const s of data.items) { const i = world.item(s.id); if (!i) continue; i.ownerId = s.ownerId; i.holderId = s.holderId; i.pos = s.pos; i.placeId = s.placeId; i.provenance = s.provenance; i.quantity = s.quantity; i.name = s.name; }
    for (const s of data.places) { const p = world.place(s.id); if (!p) continue; p.ownerId = s.ownerId; s.anchors.forEach((o: string | null, i: number) => { if (p.anchors[i]) p.anchors[i].ownerId = o ?? undefined; }); }
    if (data.diffs?.length) { world.grid.recording = false; world.grid.applyDiffs(data.diffs); world.grid.initCaches(); world.nav.rebuildAll(); world.grid.dirtyChunks.clear(); }
    world.grid.recording = true;
    return { world, gen };
  } catch (e) { console.warn('load failed', e); return null; }
}
export function newWorld(seed = 1337): { world: World; gen: ReturnType<typeof generateVillage> } { const world = new World(seed); const gen = generateVillage(world); world.grid.recording = true; return { world, gen }; }
