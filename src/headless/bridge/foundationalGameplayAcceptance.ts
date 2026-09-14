/** Objective end-to-end acceptance for the existing foundational presentation slice.
 * This is a test driver, not gameplay authority: travel and interactions enter through the
 * same BridgeSession intent adapters as Unreal, and every asserted result is canonical state or
 * an observer-scoped bridge projection. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { BridgeSession } from '../../bridge/session';
import { RegionStream } from '../../bridge/regions';
import { wildlifeProjection } from '../../bridge/wildlife';
import { naturalDeath } from '../../sim/ecology/animals';
import { handInteractions, openContainerProjection } from '../../sim/physical/hand';
import type { Creature, Item, Vec3 } from '../../sim/core/types';

type Sample = { ms: number; bytes?: number };
type Json = Record<string, unknown>;
const EVIDENCE = 'docs/evidence/foundational-gameplay/automated-journey.json';
const SAVE = '.debug/foundational-gameplay-acceptance.save.json';

function requireFact<T>(value: T | null | undefined | false, message: string): T {
  if (value === null || value === undefined || value === false) throw new Error(message);
  return value as T;
}
function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function summary(samples: Sample[]) {
  const values = samples.map(sample => sample.ms).sort((a, b) => a - b);
  const at = (portion: number) => values[Math.min(values.length - 1, Math.floor(values.length * portion))] ?? 0;
  return { samples: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), p95Ms: at(.95), maxMs: values.at(-1) ?? 0,
    ...(samples.some(sample => sample.bytes !== undefined) ? { minBytes: Math.min(...samples.map(sample => sample.bytes ?? Infinity)), maxBytes: Math.max(...samples.map(sample => sample.bytes ?? 0)) } : {}) };
}
function locationCount(item: Item, inventories: ReadonlySet<string>): number {
  return Number(!!item.holderId || inventories.has(item.id)) + Number(!!item.containerId) + Number(!!item.pos);
}
function uniqueCanonicalState(session: BridgeSession) {
  const world = session.world;
  const itemIds = world.items().map(item => item.id), resourceIds = world.resourceNodes.map(node => node.id);
  requireFact(new Set(itemIds).size === itemIds.length, 'duplicate canonical item identity');
  requireFact(new Set(resourceIds).size === resourceIds.length, 'duplicate canonical resource identity');
  const inventories = new Set(world.persons().flatMap(person => person.inventory));
  for (const item of world.items()) requireFact(locationCount(item, inventories) <= 1, `duplicate canonical item location ${item.id}`);
  return { itemIds: itemIds.sort(), resourceIds: resourceIds.sort(), resources: world.resourceNodes.map(node => [node.id, node.state, node.remaining]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
}

export function runFoundationalGameplayAcceptance(seed = 918271): Json {
  const started = performance.now(), session = new BridgeSession(seed, { playable: true });
  const world = session.world, player = requireFact(world.person(world.playerId), 'ordinary player missing'), body = requireFact(world.primaryBody(player.id), 'player body missing');
  const initialPlayerId = player.id, initialBodyId = body.id, stream = new RegionStream();
  const snapshotSamples: Sample[] = [], containerSamples: Sample[] = [], regionSamples: Sample[] = [];
  let sequence = 0, movementSteps = 0, regionFrames = 0, dynamicFrames = 0;
  const stages: Json[] = [];
  const snapshot = (stage: string) => {
    const before = performance.now(), value = session.snapshot(), wire = JSON.stringify(value), ms = performance.now() - before;
    snapshotSamples.push({ ms, bytes: Buffer.byteLength(wire) });
    stages.push({ stage, tick: value.tick, player: { ...body.pos }, inventory: value.bodies.find(candidate => candidate.bodyId === body.id)?.inventory?.map((item: { id: string }) => item.id) ?? [], wildlife: value.wildlife.bodies.map(candidate => ({ bodyId: candidate.bodyId, creatureId: candidate.creatureId, activity: candidate.activity, dead: candidate.dead })) });
    return value;
  };
  const act = (type: string, extra: Json = {}) => {
    const result = session.intent({ version: 1, sequence: ++sequence, type, ...extra }).result;
    requireFact(result === 'accepted', `${type} rejected: ${result}`); return result;
  };
  const updateRegions = () => {
    const before = performance.now(), frame = stream.frame(world), ms = performance.now() - before;
    regionSamples.push({ ms }); regionFrames++; if (frame?.dynamic) dynamicFrames++;
  };
  const moveTick = (toward: Vec3) => {
    const dx = toward.x - body.pos.x, dz = toward.z - body.pos.z, length = Math.max(1e-9, Math.hypot(dx, dz));
    act('move', { x: dx / length, z: dz / length, sprint: false }); session.step(.05); movementSteps++;
    if (movementSteps % 2 === 0) updateRegions();
  };
  const moveAlong = (path: Vec3[], stop: () => boolean) => {
    for (const point of path) for (let attempts = 0; distance(body.pos, point) > .18 && !stop(); attempts++) {
      requireFact(attempts < 800, `canonical movement stuck toward ${JSON.stringify(point)}`); moveTick(point);
    }
  };

  uniqueCanonicalState(session);
  snapshot('settlement_spawn');
  const loose = requireFact(world.items().find(item => item.name === 'Weathered lantern' && item.pos), 'loose acceptance item missing');
  const chest = requireFact(world.containers().find(container => container.name === 'Traveler chest'), 'physical acceptance container missing');
  const pickup = requireFact(handInteractions(session.sim, player).find(interaction => interaction.id.endsWith(`:${loose.id}`) && ['take', 'recover'].includes(interaction.kind)), 'canonical pickup unavailable');
  act('interact', { interactionId: pickup.id });
  requireFact(player.inventory.includes(loose.id) && loose.holderId === player.id && loose.containerId === null && loose.pos === null, 'pickup did not update canonical inventory/location');
  requireFact(snapshot('canonical_pickup').bodies.find(candidate => candidate.bodyId === body.id)?.inventory?.some((item: { id: string }) => item.id === loose.id), 'inventory projection missed picked item');

  const open = requireFact(handInteractions(session.sim, player).find(interaction => interaction.id === `open:${chest.id}`), 'container open unavailable');
  act('interact', { interactionId: open.id }); requireFact(chest.open, 'container did not open canonically');
  for (let index = 0; index < 250; index++) { const before = performance.now(); openContainerProjection(session.sim, player); containerSamples.push({ ms: performance.now() - before }); }
  act('container_transfer', { containerId: chest.id, itemId: loose.id, direction: 'into' });
  requireFact(loose.containerId === chest.id && chest.itemIds.includes(loose.id) && !player.inventory.includes(loose.id), 'transfer into container did not change canonical location');
  snapshot('container_transfer_in');
  act('container_transfer', { containerId: chest.id, itemId: loose.id, direction: 'out' });
  requireFact(loose.holderId === player.id && loose.containerId === null && player.inventory.includes(loose.id) && !chest.itemIds.includes(loose.id), 'transfer out did not restore canonical inventory');
  snapshot('container_transfer_out');

  updateRegions();
  const deer = requireFact(world.creatures().filter(creature => creature.species === 'roe_deer').sort((a, b) => distance(world.body(a.bodies[0])!.pos, body.pos) - distance(world.body(b.bodies[0])!.pos, body.pos))[0], 'roe deer missing');
  const deerBody = requireFact(world.body(deer.bodies[0]), 'roe deer body missing'), deerState = requireFact(deer.wildlife?.embodiments[deerBody.id], 'roe deer embodiment missing');
  const activityBefore = deerState.activity, path = requireFact(world.nav.findPath(body.pos, deerBody.pos), 'no canonical settlement-to-wilderness route');
  let observed = session.snapshot().wildlife.bodies.find(candidate => candidate.bodyId === deerBody.id);
  moveAlong(path, () => {
    observed = session.snapshot().wildlife.bodies.find(candidate => candidate.bodyId === deerBody.id); return !!observed;
  });
  observed = requireFact(observed ?? session.snapshot().wildlife.bodies.find(candidate => candidate.bodyId === deerBody.id), 'canonical roe deer never became observer-visible');
  requireFact(observed.creatureId === deer.id, 'wildlife body/creature identity projection mismatch');
  for (let tick = 0; tick < 80 && deerState.activity !== 'flee'; tick++) { act('move', { x: 0, z: 0, sprint: false }); session.step(.05); }
  const fleeing = requireFact(session.snapshot().wildlife.bodies.find(candidate => candidate.bodyId === deerBody.id), 'deer left projection before canonical reaction was observed');
  requireFact(deerState.activity === 'flee' && fleeing.activity === 'flee' && activityBefore !== deerState.activity, 'projected activity did not follow canonical threat response');
  stages.push({ stage: 'wilderness_deer', player: { ...body.pos }, bodyId: deerBody.id, creatureId: deer.id, canonicalActivityBefore: activityBefore, canonicalActivityAfter: deerState.activity, projectedActivity: fleeing.activity });

  // The observed founder is an explicit acceptance witness for corpse-versus-withdrawal
  // semantics. Use the canonical death adapter, then withdraw only its presentation residency.
  const deathCreature = deer, deathBody = deerBody, deathState = deerState;
  naturalDeath(world, deathCreature, deathBody, deathState, 'old_age', world.now);
  const deadRow = requireFact(wildlifeProjection(world, body).bodies.find(row => row.bodyId === deathBody.id), 'present corpse missing from projection');
  requireFact(deadRow.dead && deadRow.present && deadRow.activity === 'dead', 'corpse projection not distinct');
  deathBody.present = false;
  requireFact(!wildlifeProjection(world, body).bodies.some(row => row.bodyId === deathBody.id) && world.body(deathBody.id) === deathBody, 'withdrawal incorrectly became death/destruction');
  deathBody.present = true;
  stages.push({ stage: 'wildlife_death_absence', bodyId: deathBody.id, creatureId: deathCreature.id, deadProjected: true, absentProjected: true, canonicalIdentityRetained: true });

  const beforeSave = uniqueCanonicalState(session), canonicalBefore = { worldTime: world.now, physicalTime: world.physicalTime, playerId: player.id,
    item: { id: loose.id, ownerId: loose.ownerId, holderId: loose.holderId, containerId: loose.containerId, pos: loose.pos },
    container: { id: chest.id, open: chest.open, itemIds: [...chest.itemIds] },
    wildlife: world.creatures().filter(creature => creature.species === 'roe_deer').map(creature => ({ id: creature.id, bodies: [...creature.bodies] })).sort((a, b) => a.id.localeCompare(b.id)) };
  const saveStarted = performance.now(), raw = session.save(), saveMs = performance.now() - saveStarted;
  mkdirSync('.debug', { recursive: true }); writeFileSync(SAVE, raw);
  const loadStarted = performance.now(), reloaded = new BridgeSession(0, { save: raw }), loadMs = performance.now() - loadStarted, restored = reloaded.world;
  const afterSave = uniqueCanonicalState(reloaded), restoredItem = requireFact(restored.item(loose.id), 'item missing after reload'), restoredChest = requireFact(restored.container(chest.id), 'container missing after reload');
  requireFact(restored.playerId === initialPlayerId && restored.primaryBody(initialPlayerId)?.id === initialBodyId, 'player identity changed on reload');
  requireFact(JSON.stringify({ id: restoredItem.id, ownerId: restoredItem.ownerId, holderId: restoredItem.holderId, containerId: restoredItem.containerId, pos: restoredItem.pos }) === JSON.stringify(canonicalBefore.item), 'item ownership/location changed on reload');
  requireFact(restoredChest.open === chest.open && JSON.stringify(restoredChest.itemIds) === JSON.stringify(chest.itemIds), 'container state/content changed on reload');
  requireFact(JSON.stringify(afterSave) === JSON.stringify(beforeSave), 'items/resources duplicated or changed across reload');
  requireFact(restored.get<Creature>(deer.id)?.bodies.includes(deerBody.id) && restored.body(deerBody.id), 'observed wildlife identity changed on reload');
  const restoredCorpse = requireFact(restored.body(deathBody.id), 'wildlife corpse identity missing after reload');
  requireFact(restoredCorpse.dead && restoredCorpse.present, 'wildlife death/presence state changed on reload');
  const restoredViewer = requireFact(restored.primaryBody(restored.playerId!), 'reloaded viewer missing');
  requireFact(wildlifeProjection(restored, restoredViewer).bodies.some(row => row.bodyId === deathBody.id && row.dead), 'reloaded corpse not projected as death');
  const canonicalAfter = { worldTime: restored.now, physicalTime: restored.physicalTime, playerId: restored.playerId,
    item: { id: restoredItem.id, ownerId: restoredItem.ownerId, holderId: restoredItem.holderId, containerId: restoredItem.containerId, pos: restoredItem.pos },
    container: { id: restoredChest.id, open: restoredChest.open, itemIds: [...restoredChest.itemIds] },
    wildlife: restored.creatures().filter(creature => creature.species === 'roe_deer').map(creature => ({ id: creature.id, bodies: [...creature.bodies] })).sort((a, b) => a.id.localeCompare(b.id)) };
  requireFact(JSON.stringify(canonicalAfter) === JSON.stringify(canonicalBefore), 'selected canonical world state changed on reload');
  stages.push({ stage: 'post_reload', playerId: restored.playerId, bodyId: restoredViewer.id, item: canonicalAfter.item, container: canonicalAfter.container,
    wildlifeBodyId: restoredCorpse.id, wildlifeCreatureId: deer.id, dead: restoredCorpse.dead, canonicalStateEqual: true });
  snapshotSamples.push(...Array.from({ length: 100 }, () => { const before = performance.now(), bytes = Buffer.byteLength(JSON.stringify(reloaded.snapshot())); return { ms: performance.now() - before, bytes }; }));

  const elapsedPhysical = world.physicalTime;
  const initialRegionMs = regionSamples[0]?.ms ?? 0, steadyRegionSamples = regionSamples.slice(1);
  const report = { passed: true, seed, player: { personId: initialPlayerId, bodyId: initialBodyId }, itemId: loose.id, containerId: chest.id,
    wildlife: { observedBodyId: deerBody.id, observedCreatureId: deer.id, persistedIds: canonicalAfter.wildlife, corpseBodyId: deathBody.id, corpseCreatureId: deathCreature.id },
    stages, persistence: { saveBytes: Buffer.byteLength(raw), saveMs, loadMs, canonicalStateEqual: true, uniqueItemCount: beforeSave.itemIds.length, uniqueResourceCount: beforeSave.resourceIds.length },
    profile: { snapshot: summary(snapshotSamples), containerProjection: summary(containerSamples), regionFrame: { initialMaterializationMs: initialRegionMs, steady: summary(steadyRegionSamples) },
      regionUpdates: { sampledFrames: regionFrames, dynamicFrames, simulatedSeconds: elapsedPhysical, sampledFramesPerSecond: regionFrames / Math.max(.001, elapsedPhysical), dynamicUpdatesPerSecond: dynamicFrames / Math.max(.001, elapsedPhysical) },
      wildlifeActorsNearPlayer: wildlifeProjection(world, body).bodies.length,
      nativePresentationTick: 'measured by PIE actor diagnostics evidence, not this headless process' },
    pathologicalBehavior: [], observations: ['Headless first-region materialization is synchronous; the native transport applies the same regions progressively.'], elapsedWallMs: performance.now() - started, acceptanceSave: SAVE };
  mkdirSync('docs/evidence/foundational-gameplay', { recursive: true }); writeFileSync(EVIDENCE, JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/foundationalGameplayAcceptance.ts')) {
  const report = runFoundationalGameplayAcceptance(Number(process.argv[2] ?? 918271));
  console.log(JSON.stringify({ passed: report.passed, evidence: EVIDENCE, save: SAVE, elapsedWallMs: report.elapsedWallMs }, null, 2));
}
