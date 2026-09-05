#!/usr/bin/env node
/**
 * Runtime-generated recovery-chain probe (independent audit, second pass).
 *
 * PR #12 adds authorized recovery + real reward payment, and validates it with:
 *   - `tests/browser/specs/recover-item.spec.ts` — authors the ring AND the desire in
 *     page.evaluate, then teleports the player straight to `ring.pos`;
 *   - WorldLab's `recover-item` scenario — authors the ring, the desire, AND seeds
 *     `loc:<ringId>` knowledge directly into a chosen witness.
 *
 * Neither exercises a recovery desire the SIMULATION itself generated, and neither requires the
 * location to be discoverable in-world. This probe asks the two questions those cannot:
 *
 *   Q1. Does the simulation generate `recover_item` desires on its own? (strategic()'s
 *       `item_missing` inference, agent.ts; and confront()'s theft branch.)
 *   Q2. When it does, can ANYONE — NPC or player — ever learn where that item is?
 *       i.e. does any runtime path write `loc:<itemId>` knowledge?
 *
 * Usage: npx tsx tools/audit/recovery-chain-probe.ts --days 20 --seeds 918271,1337
 */
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { SECONDS_PER_DAY } from '../../src/sim/core/time';

function run(seed: number, days: number) {
  const world = new World(seed);
  generateVillage(world);
  // Record which recover_item desires existed at generation time, so anything appearing later
  // is unambiguously runtime-generated.
  const authored = new Set<string>();
  for (const p of world.persons()) for (const d of p.desires) if (d.type === 'recover_item' && d.targetId) authored.add(`${p.id}:${d.targetId}`);
  const authoredLocKeys = new Set<string>();
  for (const p of world.persons()) for (const k of Object.keys(p.knowledge)) if (k.startsWith('loc:')) authoredLocKeys.add(`${p.id}:${k}`);

  const sim = new Simulation(world);
  const start = world.now;
  const total = days * SECONDS_PER_DAY;
  const substep = 0.15;
  while (world.now - start < total) {
    const remaining = total - (world.now - start);
    const dt = remaining < substep * world.clock.timeScale ? Math.max(remaining / world.clock.timeScale, 0.001) : substep;
    const wdt = world.clock.advance(dt);
    world.physicalTime += dt;
    sim.step(dt, wdt);
    sim.flushSpeech();
  }

  // Q1: runtime-generated recover_item desires
  const generated: { owner: string; ownerName: string; itemId: string; itemName: string; reward: number; fulfilled: boolean }[] = [];
  for (const p of world.persons()) {
    for (const d of p.desires) {
      if (d.type !== 'recover_item' || !d.targetId) continue;
      if (authored.has(`${p.id}:${d.targetId}`)) continue;
      generated.push({ owner: p.id, ownerName: p.name, itemId: d.targetId, itemName: world.nameOf(d.targetId), reward: d.reward ?? 0, fulfilled: !!d.fulfilled });
    }
  }

  // Q2: every `loc:` knowledge key in the world, split into (a) about a PERSON/body, (b) about
  // an ITEM. Only (b) can ever answer "where is the thing I want back?".
  let locAboutPerson = 0, locAboutItem = 0, locAboutItemRuntime = 0;
  const itemLocHolders: string[] = [];
  for (const p of world.persons()) {
    for (const [key, k] of Object.entries(p.knowledge)) {
      if (!key.startsWith('loc:')) continue;
      const targetId = key.slice(4);
      const target = world.get(targetId);
      if (target?.kind === 'item') {
        locAboutItem++;
        if (!authoredLocKeys.has(`${p.id}:${key}`)) { locAboutItemRuntime++; itemLocHolders.push(`${p.name} knows where ${world.nameOf(targetId)} is (${k.source.type})`); }
        else itemLocHolders.push(`[generation-seeded] ${p.name} knows where ${world.nameOf(targetId)} is (${k.source.type})`);
      } else locAboutPerson++;
    }
  }

  // Can the owner of a generated desire act on it? think() gates `recover_item` on
  // p.knowledge['loc:'+targetId]. Check directly.
  const actionable = generated.filter(g => !!world.person(g.owner)?.knowledge[`loc:${g.itemId}`]);
  // Could a player learn it? `wanted:` is granted by dialogue; `aboutItem` then reads the NPC's
  // own `loc:` knowledge. So a player can only ever learn a location some NPC already holds.
  const anyNpcKnowsLocationOfAGeneratedTarget = generated.filter(g =>
    world.persons().some(p => p.alive && !!p.knowledge[`loc:${g.itemId}`]));

  const events = {
    item_missing: world.runTally.item_missing ?? 0,
    theft: world.runTally.theft ?? 0,
    recovered: world.events.filter(e => e.type === 'recovered').length,
    returned_item: world.events.filter(e => e.type === 'returned_item').length,
    reward_paid: world.events.filter(e => e.type === 'reward_paid').length,
  };
  return { world, generated, actionable, anyNpcKnowsLocationOfAGeneratedTarget, locAboutPerson, locAboutItem, locAboutItemRuntime, itemLocHolders, events };
}

const argv = process.argv.slice(2);
const get = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const days = Number(get('--days', '20'));
const seeds = get('--seeds', '918271').split(',').map(Number);

for (const seed of seeds) {
  const t0 = Date.now();
  const r = run(seed, days);
  console.log(`\n######## recovery chain · seed ${seed} · ${days} world-days · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`Q1 runtime-generated recover_item desires: ${r.generated.length}`);
  for (const g of r.generated) console.log(`     ${g.ownerName} wants "${g.itemName}" back (reward ${g.reward}, fulfilled=${g.fulfilled})`);
  console.log(`Q2 loc: knowledge in the world — about people/bodies: ${r.locAboutPerson}; about ITEMS: ${r.locAboutItem} (of which created at RUNTIME: ${r.locAboutItemRuntime})`);
  for (const s of r.itemLocHolders) console.log(`     ${s}`);
  console.log(`  generated desires whose OWNER can act (has loc: knowledge): ${r.actionable.length}/${r.generated.length}`);
  console.log(`  generated desires ANY npc could tell a player the location of: ${r.anyNpcKnowsLocationOfAGeneratedTarget.length}/${r.generated.length}`);
  console.log(`  events: item_missing=${r.events.item_missing} theft=${r.events.theft} recovered=${r.events.recovered} returned_item=${r.events.returned_item} reward_paid=${r.events.reward_paid}`);
}
