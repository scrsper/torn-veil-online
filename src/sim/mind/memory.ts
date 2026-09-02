import type { Person, Memory, Source, EntityId, EventId } from '../core/types';
import { World } from '../core/world';

const MAX_MEMORIES = 60;

export function remember(world: World, p: Person, m: { type: string; summary: string; eventId?: EventId; entities?: EntityId[]; significance: number; valence?: number; source: Source; placeId?: EntityId; tick?: number }, quiet = false): Memory {
  const mem: Memory = { id: world.nextId('m'), tick: m.tick ?? world.now, type: m.type, summary: m.summary, eventId: m.eventId, entities: m.entities ?? [], significance: Math.min(1, m.significance), valence: m.valence ?? 0, source: m.source, placeId: m.placeId, recalled: 0 };
  // avoid exact duplicates of the same event by the same source type
  if (m.eventId) { const dup = p.memories.find(x => x.eventId === m.eventId && x.source.type === m.source.type); if (dup) { dup.significance = Math.max(dup.significance, mem.significance); return dup; } }
  p.memories.push(mem);
  if (p.memories.length > MAX_MEMORIES) {
    // forget the least significant, oldest memories first (significance decays with age)
    const now = world.now;
    p.memories.sort((a, b) => score(b, now) - score(a, now));
    p.memories.length = MAX_MEMORIES;
  }
  if (!quiet && mem.significance >= 0.15) world.emit('memory_formed', { actor: p.id, causes: m.eventId ? [m.eventId] : [], significance: Math.min(0.5, mem.significance * 0.6), data: { memoryId: mem.id, source: m.source.type, from: m.source.from }, summary: `${p.name} remembers: ${m.summary}` });
  return mem;
}
function score(m: Memory, now: number): number { const ageDays = (now - m.tick) / 86400; return m.significance * (1 + m.recalled * 0.2) - ageDays * 0.01; }
export function recentMemories(p: Person, n = 8): Memory[] { return [...p.memories].sort((a, b) => b.tick - a.tick).slice(0, n); }
export function significantMemories(p: Person, n = 8): Memory[] { return [...p.memories].sort((a, b) => b.significance - a.significance).slice(0, n); }
export function memoriesAbout(p: Person, other: EntityId): Memory[] { return p.memories.filter(m => m.entities.includes(other)).sort((a, b) => b.significance - a.significance); }
