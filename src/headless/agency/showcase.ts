import { createKernelLab, advanceKernelLab } from '../kernel/lab';
import { makeBody, makeItem, makePerson } from '../../sim/world/factory';
import { createComponent, acquireComponent, contributeAssemblyLabor, installComponent, connect, startAssembly } from '../../sim/kernel/mechanics';
import { GameSim, type PersonIntent } from '../../sim/runtime/gameSim';
import { knownName, socialBeliefs } from '../../sim/mind/people';
import { isExternallyControlled } from '../../sim/runtime/controllers';
import { serialize, deserialize } from '../../sim/persist/save';
import { Simulation } from '../../sim/mind/agent';
import type { Method } from '../../sim/kernel/types';

/** Disclosed short scenario: existing damaged hardware, primitive education, spare parts,
 * workshop permission and quiet needs. No character is given a repair goal or successful plan. */
export function agencyWorkshop(seed = 741) {
  const lab = createKernelLab(seed, 'water'), { world: w, inventor: a, recipient: b, place } = lab;
  delete a.knowledge['workshop-need']; delete b.knowledge['workshop-need'];
  a.name = 'Orla Reed'; b.name = 'Bren Vale'; a.schedule = []; b.schedule = [];
  a.traits.curiosity = 0.98; a.traits.loyalty = 0.8; a.traits.sociability = 0.1;
  a.attributes.perception = 16; a.attributes.intellect = 8; a.attributes.will = 16; a.attributes.dexterity = 16; a.skills.crafting = 0.95;
  a.needs.social = 0; a.mind.lastSpokeAt = w.physicalTime;
  b.traits.curiosity = 0.02; b.traits.sociability = 0.95; b.needs.social = 0.9; b.attributes.perception = 2;
  b.attributes.intellect = 16; b.skills.crafting = 0.05;
  const c = makePerson(w, { name: 'Cora Moss', age: 31, gender: 'f', occupation: 'villager', home: place.id, traits: { curiosity: 0.1, courage: 0.1, sociability: 0.7 }, appearance: {}, bio: 'A visitor at the workshop.' });
  c.bodies.push(makeBody(w, c.id, { ...place.inside, x: place.inside.x - 1 }).id); c.needs.social = 0.8;
  for (const p of [a, b, c]) { p.mind.thinkInterval = 0.25; p.mind.lastSpokeAt = w.physicalTime; }
  place.ownerId = a.id; place.workers = [a.id, b.id]; a.workId = b.workId = place.id;
  const q = (s: string) => `${w.kernel.ruleset.id}/${s}`;
  const method: Method = { ruleset: w.kernel.ruleset.id, definitions: ['intake', 'rotor', 'belt', 'impeller'].map(q), connections: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }], effect: 'transfer:liquid' };
  const energy = w.kernel.energy.find(e => e.ownerId === a.id)!, tanks = w.kernel.reservoirs.filter(t => t.ownerId === a.id);
  const assembly = startAssembly(w, a, method, { energyId: energy.id, inputId: tanks[0].id, outputId: tanks[1].id, placeId: place.id }, place.inside)!;
  for (const definition of method.definitions) {
    const part = w.kernel.components.find(c => c.ownerId === a.id && c.definition === definition)!;
    acquireComponent(w, a, part.id); const cost = w.kernel.ruleset.components.find(d => d.id === definition)!.installSeconds;
    contributeAssemblyLabor(w, a, assembly, `install:${assembly.parts.length}`, cost, cost); installComponent(w, a, assembly, part.id);
  }
  for (const edge of method.connections) { contributeAssemblyLabor(w, a, assembly, `join:${edge.from}:${edge.to}`, 0.5, 0.5); connect(w, a, assembly, edge.from, edge.to); }
  w.kernel.components.find(c => c.id === assembly.parts[2])!.condition = 0;
  createComponent(w, q('belt'), a.id, assembly.pos);
  makeItem(w, 'hammer', 'workshop hammer', { owner: a.id, holder: a.id });
  const game = new GameSim(lab.sim), avatar = w.person(game.spawn('local', 'Elin Brook', { ...place.inside, z: place.inside.z + 1 }))!;
  avatar.workId = place.id; place.workers.push(avatar.id);
  return { ...lab, a, b, c, avatar, game, assembly };
}
function stateDigest(w: ReturnType<typeof agencyWorkshop>['world']) {
  const state = JSON.parse(serialize(w)); delete state.savedAt;
  const sorted = (x: any): any => Array.isArray(x) ? x.map(sorted) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sorted(x[k])])) : x;
  return JSON.stringify(sorted(state));
}
export function runAgencyShowcase(seed = 741) {
  const scene = agencyWorkshop(seed), { world: w, sim, a, b, c, avatar, game, assembly } = scene;
  advanceKernelLab(w, sim, 0.4);
  const firstEncounter = { npcNameForAvatar: knownName(c, avatar.id), avatarNameForNPC: knownName(avatar, a.id),
    personHasControlField: 'controlled' in avatar, playerVisible: game.perceive('local') };
  advanceKernelLab(w, sim, 30);
  const npcDecisions = [a, b, c].map(p => ({ id: p.id, name: p.name, choices: w.events.filter(e => e.type === 'goal_changed' && e.actor === p.id).map(e => e.data.to) }));
  // These are human-supplied high-level intentions. The same action handlers pay the costs.
  const attempt = (intent: PersonIntent, seconds: number) => { game.intend('local', intent); advanceKernelLab(w, sim, seconds); };
  attempt({ kind: 'introduce', target: a.id }, 0.3);
  return finishShowcase(scene, firstEncounter, npcDecisions, attempt);
}
import { DialogueSystem } from '../../sim/mind/dialogue';
function finishShowcase(scene: ReturnType<typeof agencyWorkshop>, firstEncounter: unknown, npcDecisions: unknown, attempt: (intent: PersonIntent, seconds: number) => void) {
  const { world: w, sim, a, b, c, avatar, game, assembly } = scene;
  new DialogueSystem(w, sim).start(a, avatar).options.find(o => o.label === 'Who are you?')!.next();
  attempt({ kind: 'inspect', assemblyId: assembly.id }, 2.5);
  attempt({ kind: 'reverse_engineer', assemblyId: assembly.id }, 8);
  attempt({ kind: 'test', assemblyId: assembly.id }, 1.5);
  const saved = serialize(w), loaded = deserialize(saved)!.world; const resumed = new Simulation(loaded);
  advanceKernelLab(w, sim, 3); advanceKernelLab(loaded, resumed, 3);
  const original = JSON.parse(stateDigest(w)), restored = JSON.parse(stateDigest(loaded));
  const replayDifferences: string[] = [];
  const compare = (a: any, b: any, path = '') => {
    if (replayDifferences.length >= 12 || JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') { for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], path + '.' + key); }
    else replayDifferences.push(path + ': ' + JSON.stringify(a) + ' / ' + JSON.stringify(b));
  };
  compare(original, restored);
  const replayMatches = replayDifferences.length === 0;
  return { seed: scene.seed, firstEncounter, npcDecisions, replayMatches, replayDifferences,
    canonical: { assembly: { id: assembly.id, parts: assembly.parts.map(id => ({ id, condition: w.kernel.components.find(c => c.id === id)!.condition })), output: assembly.outputQuantity, laborSeconds: assembly.laborSeconds, history: assembly.history },
      people: [a, b, c, avatar].map(p => ({ id: p.id, name: p.name, currentGoal: p.mind.goal?.type ?? null, hasEngineControl: isExternallyControlled(p) })) },
    privateBeliefs: [a, b, c].map(p => ({ id: p.id, name: p.name, identities: Object.values(p.knowledge).filter(k => k.claim.identity), social: socialBeliefs(p), mechanical: Object.values(p.knowledge).filter(k => k.key.startsWith('mechanical-') || k.claim.inferredMethod) })),
    playerVisible: game.perceive('local'),
    causalEvents: w.events.filter(e => ['mechanism_observed', 'mechanism_inspected', 'mechanism_hypothesized', 'goal_changed', 'mechanism_intended', 'mechanism_worked', 'mechanism_trial', 'mechanism_abandoned', 'social_inferred', 'introduction'].includes(e.type)
      && [a.id, b.id, c.id, avatar.id].includes(e.actor ?? '')).map(e => ({ id: e.id, type: e.type, actor: e.actor, causes: e.causes, data: e.data })),
  };
}

