import { generateProceduralWorld } from '../world/settlement';
import { World } from '../core/world';
import { WorldClock } from '../core/time';
import { generateVillage } from '../world/village';
import type { Person, Body, Item, Place, Faction, WorldEvent, Conflict, Field, HaulTask, ResourceNode, ConstructionProject, Request, Fire, Situation, WorkStint, Household, ChronicleEra } from '../core/types';
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
// v0.4: bumped 6 -> 7 for Embodied Economy canonical state — `Person.attributes` (strength/
// dexterity) and `Person.physiology` (energy/hydration/fatigue/sleepDebt/bodyHeat) cannot be
// re-derived from present state (they depend on this run's history of work/rest/meals), so
// they join the curated per-person save fields below. `World.requests` (the shared work-
// request/wage lifecycle) is new top-level canonical state. `Item.condition` (tool durability)
// and `ResourceNode.growthStage` (tree lifecycle) round-trip automatically — items and nodes
// are already whole-object-spread at both ends, so a new plain field needs no extra code here.
// v0.6: bumped 8 -> 9 for Knowledge, Memory, Skills & Intentional Action canonical state —
// `Person.skills` (learned proficiency, 0..1 per SkillId) depends on this run's accumulated
// practice and cannot be re-derived from present state. `KnowledgeItem.lastConfirmedAt` (new
// optional field) and the new `'service'` KnowledgeItem.kind / `Memory.type: 'purchase'|
// 'shortage'` values round-trip automatically — `knowledge`/`memories` are already
// whole-object-persisted per person, so a new optional field or a new string literal needs no
// extra code here, exactly as v0.5 noted for `Request.type: 'production'`. `Mind.intention` is
// NOT persisted — like `Goal` itself, it is a fresh, cheap-to-recompute candidate re-derived on
// the next real goal adoption (mind/agent.ts's `updateIntention`), not history that would be
// lost otherwise; immediately after a load it is briefly null until the next goal switch, which
// is disclosed rather than worked around with extra reconstruction code for a purely cosmetic
// Inspector gap.
// v0.5: bumped 7 -> 8 for Human Physiology / Autonomous Economy canonical state —
// `Person.species`/`physiologyTraits` (individual metabolic variation, fixed at generation time
// but not deterministically re-derivable once a future species-change mechanic could alter it —
// persisted explicitly rather than assumed), `Person.mind.commitment` (goal-commitment state:
// an active/suspended commitment depends on this run's history and cannot be re-derived from
// present state alone). `World.requests` gained a new `type: 'production'` variant — no schema
// change, already round-trips. Dynamic price state is NOT persisted: prices are recomputed on
// demand, purely as a function of current canonical stock (never accumulated history), so there
// is nothing to save (see world/pricing.ts).
// v0.7: bumped 9 -> 10 for `Person.physiology.wetness` — a new REQUIRED field on the
// already-whole-object-persisted `physiology` (unlike v0.6's purely optional additions, which
// needed no bump: `KnowledgeItem.lastConfirmedAt?`, the new `'service'`/`'affordance'` kinds, and
// `HaulTask.materialSellerId?` are all safely absent-by-default on an old save). `wetness` is
// NOT optional and `stepWetness`/`syncNeeds` do real arithmetic on it every physiology step
// (core/physiology.ts) — an old save's `physiology` object loaded as-is (`s.physiology ??
// p.physiology` in `deserialize` below) would leave it `undefined`, and `undefined` propagating
// through `clamp01(wetness + delta)` corrupts to `NaN` and then contaminates `fatigue`/
// `needs.comfort` too (the same class of bug v0.4 bumped 6 -> 7 to prevent for `Person.
// physiology` itself). Bumping forces `hasSave()`/`deserialize` to reject a pre-v0.7 save
// outright instead of silently loading corrupted physiology.
// v0.8: bumped 10 -> 11 for `World.fires` (v0.8 §C) — new top-level canonical state (whether a
// fire is lit and how much fuel remains cannot be reconstructed from present state alone),
// exactly the same class of addition `World.haulTasks`/`resourceNodes`/`constructionProjects`
// were at v0.3. An old save simply predates the concept (`data.fires ?? []` below defaults it
// to no fires, all unlit — safe, not corrupting, but still version-gated for consistency with
// every other top-level array this file persists).
// Player embodiment: bumped 11 -> 12 — the player's purchasing power moved from a carried
// `coins` Item to `Person.wealth` (one currency for every person). A version-11 save would
// resume with the Traveler's silver stranded in a prop nothing can spend; a fresh world is
// the honest option, exactly like every other semantic change to persisted meaning.
// v0.9 Social Causality: bumped 12 -> 13 for two new pieces of canonical state that cannot be
// reconstructed from present state — `World.situations` (whether an ongoing matter is still open
// and which canonical event settled it) and `Person.mind.concerns` (what each person is actually
// carrying about those matters, and how hard). Both depend entirely on this run's history: who
// learned what, when, and whether they have since heard it was dealt with. Loading a v12 save
// into a v0.9 world would produce a village where nothing is unresolved and no one is worried
// about anything, which is a silently wrong world rather than an old one.
// v0.10 Motivated Lives: bumped 13 -> 14 for two new pieces of per-person canonical state that
// cannot be reconstructed from present state — `Person.mind.pursuits` (what each person is
// currently trying to bring about, since when, how many attempts it has taken, and what steps it
// has already been through) and `Person.mind.obligations` (who owes whom, why, because of which
// canonical event, and whether it is still live). Both depend entirely on this run's history in
// exactly the way v0.9's `concerns` do: loading a v13 save into a v0.10 world would produce a
// village where nobody is in the middle of anything and nobody owes anyone — a silently wrong
// world rather than an old one. New optional `Goal.data.pursuitId` links and the new `provide`
// GoalType round-trip automatically (`goal` is whole-object-persisted); `Mind.intention` remains
// deliberately unpersisted, unchanged from v0.6.
// v0.10.1 Interaction & Simulation Coherence: bumped 14 -> 15 for `Person.mind.reports` — how far
// this person has got with telling the watch about each crime they know of (attempted, could not
// find anyone, told whom and when, backing off until). It is the same kind of state as `concerns`
// and `pursuits`: "I went to the guardhouse twice and he wasn't there" is a fact about this run's
// history that no fresh `think()` tick can recompute, and losing it on load would put every
// villager back to full urgency on every crime they remember — precisely the behaviour v0.10
// disclosed and this milestone exists to fix.
// v0.5 Adaptive Society + emergent combat foundation: bumped 15 -> 17 for `World.workStints`
// and localized functional body injuries. Both are state this run's history produced and no fresh
// tick can reconstruct: a village that had adapted into a stand-in workforce must not reload as
// one that never did, and a wounded body must not return uninjured. Earlier saves are not resumable.
// `World.workStints` records who has stepped in to work a
// productive place they are not the worker of, how many real batches they have got out of it,
// what their proficiency was when they began, and who (if anyone) had taught them. Like every
// bump above it is state this run's history produced and no fresh tick can recompute: the whole
// point of a stint is that it records something that HAPPENED. Note what does NOT need a bump —
// `Person.skills` gained a `milling` entry, but `skills` is already whole-object-persisted, and a
// v15 save simply has nobody with that skill, which is not wrong, merely a world where nobody had
// yet learned to mill. The version still moves because losing the stints would silently rewrite
// a village that had adapted into one that never did. The same version gate covers the injury
// overlay above so neither branch's canonical state can be silently discarded.
// Demographic continuity + year-scale substrate: generated people/bodies, lineage, households,
// pregnancy, materialized significance, Chronicle eras, and the demographic RNG stream.
// 18 -> 19: `Conflict.downed` (who a fight has already put on the ground, and who put them
// there) and the trades people have taken up in-run (`Person.workId`/`occupation` written by
// `mind/livelihood.ts`, and the `livelihood_taken_up` events behind them). Both are, like every
// bump above, state a run's history PRODUCED and no fresh tick can recompute. Losing the downing
// would restart fights that had already been settled by one; losing the livelihood record would
// silently rewrite a village that had staffed itself from its own children into one that never
// did. Conflicts and people are whole-object-persisted, so a v18 save would technically load —
// which is exactly why the gate has to be explicit rather than left to chance.
export const SAVE_VERSION = 20;

/**
 * Persistence strategy: the base world is regenerated deterministically from the seed (so voxels and
 * entity ids match), then the saved *state* is overlaid: minds, bodies, items, events, clock, weather,
 * and voxel modifications. Consequences survive the renderer restarting.
 */
export function serialize(world: World): string {
  // investigated is a Set in memory (v0.2.2 Phase 3: O(1) membership instead of an
  // ever-growing array's O(length) .includes() on every guard's every think() tick) — JSON has
  // no native Set, so it round-trips as a plain array here and is rebuilt into a Set on load.
  const persons = world.persons().map(p => ({
    ...p, tags: [...p.tags], parentIds: [...p.parentIds], bodies: [...p.bodies], inventory: [...p.inventory],
    relationships: structuredClone(p.relationships), memories: p.memories.map(m => ({ ...m, entities: [...m.entities], source: { ...m.source } })),
    knowledge: structuredClone(p.knowledge), desires: p.desires.map(d => ({ ...d })), schedule: p.schedule.map(s => ({ ...s })),
    mind: { ...p.mind, investigated: [...p.mind.investigated], plan: p.mind.plan.map(a => ({ ...a, data: a.data ? { ...a.data } : undefined })) },
  }));
  // v0.2.3: a subdued body must reload still subdued (unlike `pose`, which is reset). Persist the
  // physical-time timestamp; a downed pose is reconstructed from it on load.
  const bodies = world.bodies().map(b => ({ ...b, tags: [...b.tags], pos: { ...b.pos }, vel: { ...b.vel }, path: b.path?.map(v => ({ ...v })) ?? null, pathGoal: b.pathGoal ? { ...b.pathGoal } : null, sitAnchor: b.sitAnchor ? { ...b.sitAnchor } : null, pose: b.pose === 'dead' ? 'dead' : (b.subduedUntil > world.physicalTime ? 'downed' : 'stand') }));
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
  // v0.4: work requests are plain serializable records (ids, ticks, strings, numbers).
  const requests = world.requests.map(r => ({ ...r, payload: { ...r.payload } }));
  // v0.8: fires — plain serializable records (ids, ticks, strings, numbers, one Vec3 `pos`).
  const fires = world.fires.map(f => ({ ...f, pos: { ...f.pos } }));
  // v0.9: plain serializable records (ids, ticks, strings, numbers, one string array).
  const situations = world.situations.map(s => ({ ...s, eventIds: [...s.eventIds] }));
  // v0.5: plain serializable records (ids, ticks, strings, numbers).
  const workStints = world.workStints.map(s => ({ ...s }));
  const households = world.households().map(h => ({ ...h, tags: [...h.tags], memberIds: [...h.memberIds] }));
  const chronicleEras = world.chronicleEras.map(e => ({ ...e, people: [...e.people], sourceEventIds: [...e.sourceEventIds], causes: [...e.causes] }));
  const chronicleCompactedEventIds = [...world.chronicleCompactedEventIds];
  const chronicleEventAliases = [...world.chronicleEventAliases.entries()];
  const historicalSignificance = [...world.historicalSignificance.entries()];
  // v0.8 §P1 (independent audit §3.5): the actual PRNG stream position at save time, not just
  // the original generation seed — see `core/rng.ts`'s `RNG.state()` doc. Additive/optional (an
  // old save simply lacks these fields), so no SAVE_VERSION bump is needed — `deserialize` below
  // falls back to today's behavior (rewind to post-generation position) when absent.
  const rng = world.rng.state(); const weatherRng = world.weatherRng.state(); const demographicRng = world.demographicRng.state();
  return JSON.stringify({ version: SAVE_VERSION, seed: world.seed, physicalPlaces: world.settlementSites ? world.places() : undefined, settlements: world.settlements(), settlementSites: world.settlementSites, clock: world.clock.state(), physicalTime: world.physicalTime, weather: world.weather, counters: world.getCounters(), playerId: world.playerId, persons, bodies, items, places, factions, conflicts, fields, haulTasks, resourceNodes, constructionProjects, requests, fires, situations, workStints, households, chronicleEras, chronicleCompactedEventIds, chronicleEventAliases, historicalSignificance, diffs, doors, events, rng, weatherRng, demographicRng, savedAt: Date.now() });
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
    const world = new World(data.seed);
    const generated = data.settlementSites ? generateProceduralWorld(world, data.settlementSites) : undefined;
    const gen = generated ? { places: Object.fromEntries(generated.flatMap(s => Object.entries(s.places).map(([k, p]) => [s.spec.site.id + ':' + k, p]))), people: Object.fromEntries(generated.flatMap(s => Object.entries(s.people).map(([k, p]) => [s.spec.site.id + ':' + k, p]))) } : generateVillage(world);
    for (const s of data.settlements ?? []) { const existing = world.get(s.id); if (existing?.kind === 'settlement') Object.assign(existing, s); else world.add(s); }
    for (const p of data.physicalPlaces ?? []) { const existing = world.place(p.id); if (existing) Object.assign(existing, p); else world.add(p); }
    // overlay
    const genEvents = world.events; // history events regenerated; replace with saved log (which contains them)
    world.events = []; world.eventIndex.clear();
    for (const e of data.events) { world.events.push(e); world.eventIndex.set(e.id, e); }
    if (!world.events.length) { world.events = genEvents; for (const e of genEvents) world.eventIndex.set(e.id, e); }
    world.setCounters(data.counters); world.clock = new WorldClock(data.clock); world.physicalTime = data.physicalTime ?? 0; world.weather = data.weather; world.playerId = data.playerId;
    // v0.8 §P1 (independent audit §3.5): restore the ACTUAL PRNG stream position from the save,
    // not the fresh post-`generateVillage` position `new World`/`generateVillage` above just
    // left both RNGs at — without this, every load silently rewound `world.rng`/`world.weatherRng`
    // to identical replay points, so "random" outcomes right after a load repeated whatever
    // sequence generation itself produces, load after load. Absent on a pre-v0.8 save (no
    // `data.rng`), so old saves keep exactly today's (rewind) behavior rather than failing to load.
    if (typeof data.rng === 'number') world.rng.setState(data.rng);
    if (typeof data.weatherRng === 'number') world.weatherRng.setState(data.weatherRng);
    if (typeof data.demographicRng === 'number') world.demographicRng.setState(data.demographicRng);
    for (const s of data.persons) {
      const legacyMind = s.mind ?? { goal: s.goal ?? null, plan: [], decision: s.decision ?? null, commitment: s.commitment ?? null, concerns: s.concerns ?? [], obligations: s.obligations ?? [], pursuits: s.pursuits ?? [], reports: s.reports ?? {}, investigated: s.investigated ?? [] };
      const restored = { ...s, parentIds: [...(s.parentIds ?? [])], birthTick: s.birthTick ?? s.createdAt, lifeStage: s.lifeStage ?? 'adult', reproductiveRole: s.reproductiveRole ?? (s.gender === 'f' ? 'gestational' : 'fertilizing'), attributeAgeBasis: s.attributeAgeBasis ?? s.age, mind: { ...legacyMind, investigated: new Set(legacyMind.investigated ?? []), plan: [], intention: null } } as Person;
      const existing = world.person(s.id);
      if (existing) Object.assign(existing, restored); else world.add(restored);
    }
    for (const s of data.bodies) {
      const restored = { ...s, vel: { x: 0, y: 0, z: 0 }, path: null, pathGoal: null, sitAnchor: null } as Body;
      const existing = world.body(s.id);
      if (existing) Object.assign(existing, restored); else world.add(restored);
    }
    world.conflicts = (data.conflicts ?? []).map((c: Conflict) => ({ ...c }));
    if (data.fields?.length) { world.fields = data.fields.map((f: Field) => ({ ...f, plots: f.plots.map(p => ({ ...p })) })); }
    world.haulTasks = (data.haulTasks ?? []).map((t: HaulTask) => ({ ...t }));
    if (data.resourceNodes?.length) world.resourceNodes = data.resourceNodes.map((n: ResourceNode) => ({ ...n, pos: { ...n.pos }, blocks: n.blocks.map(b => ({ ...b })) }));
    if (data.constructionProjects?.length) world.constructionProjects = data.constructionProjects.map((p: ConstructionProject) => ({ ...p, required: p.required.map(r => ({ ...r })), contributions: { ...p.contributions }, siteBounds: { ...p.siteBounds } }));
    world.requests = (data.requests ?? []).map((r: Request) => ({ ...r, payload: { ...r.payload } }));
    // v0.8: same pattern as `resourceNodes`/`constructionProjects` above — fires are pre-
    // registered by `generateVillage` (just called), so an old, pre-v0.8 save with no `data.fires`
    // at all should keep the freshly-generated (unlit) ones rather than overwrite them with
    // nothing; a save that DOES have fire data (post-v0.8) is authoritative and replaces them.
    if (data.fires?.length) world.fires = data.fires.map((f: Fire) => ({ ...f, pos: { ...f.pos } }));
    world.situations = (data.situations ?? []).map((s: Situation) => ({ ...s, eventIds: [...s.eventIds] }));
    world.workStints = (data.workStints ?? []).map((s: WorkStint) => ({ ...s }));
    for (const s of data.households ?? []) {
      const restored = { ...s, memberIds: [...s.memberIds], tags: [...s.tags] } as Household;
      const existing = world.get<Household>(s.id);
      if (existing?.kind === 'household') Object.assign(existing, restored); else world.add(restored);
    }
    world.chronicleEras = (data.chronicleEras ?? []).map((e: ChronicleEra) => ({ ...e, anchorEventId: e.anchorEventId ?? e.sourceEventIds[0], people: [...e.people], sourceEventIds: [...e.sourceEventIds], causes: [...e.causes] }));
    world.chronicleCompactedEventIds = new Set(data.chronicleCompactedEventIds ?? []);
    world.chronicleEventAliases = new Map(data.chronicleEventAliases ?? world.chronicleEras.flatMap(era => era.sourceEventIds.map(id => [id, era.anchorEventId])));
    if (data.historicalSignificance) world.historicalSignificance = new Map(data.historicalSignificance);
    else world.rebuildHistoricalSignificance();

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
    world.rebuildLivingIndices();
    // Generated entity ids are part of the save schema. Refuse a malformed/incompatible
    // overlay rather than booting a world whose player has no physical manifestation.
    if (world.playerId !== null && (!world.person(world.playerId) || !world.primaryBody(world.playerId))) return null;
    return { world, gen };
  } catch (e) { console.warn('load failed', e); return null; }
}
export function newWorld(seed = 1337): { world: World; gen: ReturnType<typeof generateVillage> } { const world = new World(seed); const gen = generateVillage(world); world.grid.recording = true; return { world, gen }; }
