// One systemic adventure through ordinary player controls, accelerated (Living Alpha acceptance B/C).
//   node --import tsx scripts/alpha/adventure-run.ts --seed 918271 --approach hunt|hush --days 12 --out .debug/adventure-hunt-918271
// Nothing is staged: the danger, the request, the animal and every reaction come from the world. The
// player learns of the problem only by asking people for work, prepares by ordinary purchase or a paid
// lesson, walks there, reads the animal's visible behaviour from the same projection the client
// receives, and acts through the same intents/commands. Consequences are measured afterwards.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BridgeSession } from '../../src/bridge/session';
import type { Person, Request, Vec3 } from '../../src/sim/core/types';
import { knowsVeil } from '../../src/sim/physical/veil';
import { PlayerBot } from './playerBot';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const seed = Number(arg('seed', '918271')), approach = arg('approach', 'hunt') as 'hunt' | 'hush', days = Number(arg('days', '12'));
const out = arg('out', `.debug/adventure-${approach}-${seed}`);
mkdirSync(out, { recursive: true });
const s = new BridgeSession(seed, { playable: true }), bot = new PlayerBot(s), w = s.world, p = bot.p;
const started = performance.now(), worldStart = w.now, DAY = 86400;
const log: Record<string, unknown>[] = [];
const note = (event: string, data: Record<string, unknown> = {}) => { const r = { event, day: +((w.now - worldStart) / DAY).toFixed(3), hour: +w.clock.hourF.toFixed(2), ...data }; log.push(r); console.log(JSON.stringify(r)); };
const finish = (outcome: string, extra: Record<string, unknown> = {}) => {
  const report = { seed, approach, outcome, ...extra, elapsedMinutes: +((performance.now() - started) / 60000).toFixed(1), log };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2)); writeFileSync(join(out, 'final.save.json'), s.save());
  console.log(JSON.stringify({ outcome, ...extra })); process.exit(0);
};
const home = w.settlements().sort((a, b) => bot.dist(a.location, bot.body.pos) - bot.dist(b.location, bot.body.pos))[0];
const placeOf = (type: string) => w.places().filter(pl => pl.type === type).sort((a, b) => bot.dist(a.inside, home.location) - bot.dist(b.inside, home.location))[0];
note('start', { person: p.id, wealth: p.wealth, settlement: home.name });

// 1. Discovery: ask people for work until someone speaks of a dangerous animal.
let request: Request | undefined, requester: Person | undefined;
const asked = new Map<string, number>();
while (!request && (w.now - worldStart) / DAY < days) {
  if (w.clock.hourF < 7 || w.clock.hourF > 20) { bot.offline(1800); continue; }
  const people = w.livingPersons().filter(q => q.id !== p.id && q.age > 16 && w.primaryBody(q.id)?.pose !== 'sleep'
    && bot.dist(w.positionOf(q.id)!, home.location) < 180 && w.now - (asked.get(q.id) ?? -1e12) > DAY / 2)
    .sort((a, b) => bot.dist(w.positionOf(a.id)!, bot.body.pos) - bot.dist(w.positionOf(b.id)!, bot.body.pos)).slice(0, 6);
  for (const q of people) {
    if (!bot.go(w.positionOf(q.id)!, 1.6, 240)) continue;
    bot.wait(0.6); asked.set(q.id, w.now);
    const r = bot.talk(q, l => l === 'Any work going?', true);
    const deal = r?.labels.find(l => l.startsWith('Deal with the '));
    if (deal) {
      const lines = bot.choose(l => l === deal);
      request = w.requests.find(x => x.type === 'protection' && x.acceptedBy === p.id && x.status === 'accepted');
      requester = q; note('discovered', { from: q.id, label: deal, lines, requestId: request?.id, cause: request?.cause });
    }
    bot.say({ type: 'dialogue_close' });
    if (request) break;
  }
  if (!request) {
    // Diagnostic only (never read by the player's choices): whether any opportunity exists yet.
    note('round', { asked: people.length, diagnosticOpenProtection: w.requests.filter(x => x.type === 'protection' && x.status === 'open').length,
      diagnosticBoarAttacks: w.events.filter(e => e.type === 'attack' && w.get(e.actor!)?.kind === 'creature').length });
    bot.offline(1800); // back to ordinary life for a while; the world keeps happening
  }
}
if (!request || !requester) finish('no_opportunity_found', { worldDays: (w.now - worldStart) / DAY });
const r = request!, asker = requester!;
const place = r.payload.placeId ? w.place(r.payload.placeId) : undefined;

// 2. Preparation.
if (approach === 'hunt') {
  const tavern = placeOf('tavern');
  for (let attempt = 0; attempt < 12 && !p.inventory.some(id => w.item(id)?.type === 'dagger'); attempt++) {
    bot.go(tavern.inside, 2, 400); bot.wait(1);
    const buy = bot.interactions().find(a => a.kind === 'buy' && a.id.includes(':') && w.item(a.id.split(':')[1])?.type === 'dagger');
    if (buy) { const res = bot.interact(buy.id); note('buy_blade', { result: res, label: buy.label, wealth: p.wealth }); }
    else bot.offline(1200);
  }
  if (!p.inventory.some(id => w.item(id)?.type === 'dagger')) note('unprepared', { reason: 'no blade bought' });
} else {
  const keeper = w.livingPersons().filter(q => knowsVeil(q) && q.id !== p.id).sort((a, b) => bot.dist(w.positionOf(a.id)!, bot.body.pos) - bot.dist(w.positionOf(b.id)!, bot.body.pos))[0];
  for (let attempt = 0; attempt < 8 && !knowsVeil(p) && keeper; attempt++) {
    if (w.primaryBody(keeper.id)?.pose === 'sleep') { bot.offline(1800); continue; }
    if (bot.go(w.positionOf(keeper.id)!, 1.6, 400)) { bot.wait(0.6); const res = bot.talk(keeper, l => l.startsWith('Teach me the hush')); note('lesson', { keeper: keeper.id, lines: res?.lines }); }
  }
  if (!knowsVeil(p)) note('unprepared', { reason: 'no lesson' });
}

// 3. Travel and search: the named place, then look around it with the player's own eyes.
const seen = () => (s.snapshot(false).wildlife?.bodies ?? []).filter(b => b.speciesId === 'woodland_boar' && !b.dead && b.ageClass === 'adult');
let target = seen()[0];
for (let sweep = 0; sweep < 40 && !target; sweep++) {
  // Where the requester said it was seen (a named place, or out in the open relative to a settlement).
  const centre: Vec3 = place?.inside ?? r.payload.seenAt ?? home.location;
  const a = sweep * 2.4, radius = 10 + (sweep % 5) * 8;
  bot.go({ x: centre.x + Math.cos(a) * radius, y: centre.y, z: centre.z + Math.sin(a) * radius }, 2, 200);
  bot.wait(2); target = seen()[0];
  if (sweep % 8 === 7) bot.offline(600);
}
if (!target) finish('animal_not_found', { requestId: r.id, place: place?.name });
note('found', { bodyId: target!.bodyId, creatureId: target!.creatureId, sameAsRequested: target!.creatureId === r.payload.creatureId, distance: +bot.dist(target!.pos, bot.body.pos).toFixed(1) });

// 4. Encounter.
const tb = w.body(target!.bodyId)!;
const view = () => (s.snapshot(false).wildlife?.bodies ?? []).find(b => b.bodyId === tb.id);
let outcome = 'unresolved';
if (approach === 'hunt') {
  let last = '', dodges = 0, strikes = 0;
  for (let t = 0; t < 240 * 60 && !tb.dead; t++) {
    const v = view(); const m = v?.defense ?? 'none';
    const d = { x: tb.pos.x - bot.body.pos.x, z: tb.pos.z - bot.body.pos.z }, l = Math.hypot(d.x, d.z) || 1, facing = Math.atan2(-d.x, -d.z);
    if (bot.body.pose === 'downed') { if (t % 600 === 0) note('downed', { health: bot.body.health }); bot.stepRealtime(); continue; }
    if (m !== last && m === 'strike' && v?.defenseAtViewer) { bot.command({ type: 'defend', kind: 'sidestep', side: dodges++ % 2 ? 1 : -1 }); }
    last = m;
    const idle = !bot.body.combatAction || bot.body.combatAction.phase === 'complete';
    if (idle && m !== 'strike' && m !== 'charge') {
      if (l > 1.4) bot.command({ type: 'move', x: d.x / l, z: d.z / l, sprint: true, facing });
      else { bot.command({ type: 'attack', trajectory: 'low', targetBodyId: tb.id }); strikes++; }
    } else if (idle && t % 6 === 0) bot.command({ type: 'move', x: 0, z: 0, sprint: false, facing });
    bot.stepRealtime();
  }
  note('fight', { killed: tb.dead, dodges, strikes, playerHealth: +bot.body.health.toFixed(1), injuries: bot.body.injuries ?? {} });
  if (tb.dead) {
    bot.go(tb.pos, 1.2, 120); bot.wait(0.5);
    const butcher = bot.interactions().find(a => a.id === `butcher:${tb.id}`);
    note('butcher', { result: butcher ? bot.interact(butcher.id) : 'no_option', meat: p.inventory.map(id => w.item(id)).filter(i => i?.type === 'meat').map(i => i!.name) });
  }
} else {
  let result = '';
  for (let attempt = 0; attempt < 40 && result !== 'calmed'; attempt++) {
    // Close in whenever the last try could not reach it: distance alone is not enough in the
    // woods, where a trunk between the two of you blocks the hush as surely as range does.
    const before = bot.dist(tb.pos, bot.body.pos);
    const walked = before > 8 || result === 'out_of_reach' ? bot.go(tb.pos, 4, 120) : true;
    result = bot.say({ type: 'hush', targetBodyId: tb.id });
    if (attempt < 8 || result === 'calmed') note('hush', { result, strain: p.veil?.strain, before: +before.toFixed(1), walked, after: +bot.dist(tb.pos, bot.body.pos).toFixed(1) });
    if (result === 'too_strained') bot.offline(1200); else bot.wait(7);
    if (bot.body.pose === 'downed') { note('downed', {}); bot.offline(600); }
  }
  outcome = result === 'calmed' ? 'animal_stilled' : 'hush_failed';
}

// 5. Return to the requester and claim.
const wealthBefore = p.wealth, askerBefore = asker.wealth, trustBefore = asker.relationships[p.id]?.trust ?? 0;
let claimLines: string[] = [];
for (let attempt = 0; attempt < 10 && r.status === 'accepted'; attempt++) {
  if (w.primaryBody(asker.id)?.pose === 'sleep' || w.clock.hourF < 7 || w.clock.hourF > 20) { bot.offline(1800); continue; }
  if (!bot.go(w.positionOf(asker.id)!, 1.6, 600)) { bot.offline(600); continue; }
  bot.wait(0.6);
  const res = bot.talk(asker, l => l.startsWith('About the '));
  if (res?.lines.length) { claimLines = res.lines; break; }
}
if (approach === 'hunt') outcome = r.status === 'completed' ? `paid_${r.payload.settledBy}` : tb.dead ? 'killed_unpaid' : 'failed';
else outcome = r.status === 'completed' ? `paid_${r.payload.settledBy}` : outcome === 'animal_stilled' ? 'stilled_unpaid' : outcome;

// 6. Consequences, knowledge and continuity.
const knowers = w.livingPersons().filter(q => q.id !== p.id && Object.values(q.knowledge).some(k => k.kind === 'event' && ((k.claim.type === 'kill' || k.claim.type === 'veil_hush') && k.claim.target === tb.ownerId)));
const farAway = w.livingPersons().filter(q => bot.dist(w.positionOf(q.id)!, home.location) > 2000);
const farKnowers = farAway.filter(q => knowers.includes(q));
const reloaded = new BridgeSession(seed, { playable: true, save: s.save() }).world;
const continuity = {
  request: reloaded.requests.find(x => x.id === r.id)?.status === r.status,
  wealth: reloaded.person(p.id)!.wealth === p.wealth,
  trust: (reloaded.person(asker.id)!.relationships[p.id]?.trust ?? 0) === (asker.relationships[p.id]?.trust ?? 0),
  animal: reloaded.body(tb.id)?.dead === tb.dead,
};
finish(outcome, {
  requestId: r.id, requester: asker.id, reward: r.reward, paid: r.paid ?? 0, settledBy: r.payload.settledBy ?? null, claimLines,
  conservation: { playerGain: p.wealth - wealthBefore, requesterLoss: askerBefore - asker.wealth },
  trust: { before: +trustBefore.toFixed(3), after: +(asker.relationships[p.id]?.trust ?? 0).toFixed(3) },
  animal: { dead: tb.dead, avoiding: !!(w.get<import('../../src/sim/core/types').Creature>(tb.ownerId)?.wildlife?.embodiments[tb.id]?.avoid) },
  knowledge: { knowers: knowers.length, farAway: farAway.length, farKnowers: farKnowers.length },
  continuity, worldDays: +((w.now - worldStart) / DAY).toFixed(3), physicalHours: +(w.physicalTime / 3600).toFixed(2),
});
