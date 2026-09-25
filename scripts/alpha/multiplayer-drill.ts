// Real service, ordinary accounts and protocol actions. No world fixtures or UI acceptance.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AccountRegistry } from '../../src/server/accounts';
import { ProbeClient } from '../../src/server/probeClient';
import { CLOSE } from '../../src/server/protocol';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
assert(arg('root') && arg('out') && arg('prefix'), '--root, --out and --prefix required');
const root = resolve(arg('root')!), out = resolve(arg('out')!), prefix = arg('prefix')!;
const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
assert(['dev', 'staging'].includes(config.env), 'Only isolated dev/staging environments');
assert(!existsSync(out), 'New evidence directory required');
assert(/^[a-z][a-z0-9-]{1,24}$/.test(prefix), 'Bounded account prefix required');
mkdirSync(out, { recursive: true });
const started = Date.now(), clients: ProbeClient[] = [];
const evidence: Record<string, any> = { kind: 'real-process protocol acceptance; no native UI or physical-input claim', checks: {}, startedAt: new Date().toISOString() };
const record = () => writeFileSync(join(out, 'report.json'), JSON.stringify(evidence, null, 2));
const check = (name: string, value: boolean) => { evidence.checks[name] = value; record(); assert(value, name); console.log(name); };
const accounts = new AccountRegistry(join(root, 'credentials', 'accounts.json'));
const reuse = process.argv.includes('--reuse');
const credentialPath = join(root, 'credentials', `${prefix}-probe.json`);
const credentials: { account: string; token: string }[] = reuse ? JSON.parse(readFileSync(credentialPath, 'utf8')) : ['a', 'b'].map(suffix => {
  const account = `${prefix}-${suffix}`;
  return { account, token: accounts.add(account, `Multiplayer ${suffix}`) };
});
assert(credentials.length === 2 && credentials.every((c, i) => c.account === `${prefix}-${i === 0 ? 'a' : 'b'}` && typeof c.token === 'string'), 'Exact isolated probe accounts required');
// Secrets stay beside this disposable service's other credentials, outside the checkout.
if (!reuse) writeFileSync(credentialPath, JSON.stringify(credentials), { flag: 'wx' });
const connect = async (index: number, character = 'auto') => {
  const c = await ProbeClient.connect({ port: config.port, ...credentials[index], character, name: index === 0 ? 'Aster Vale' : 'Bram Reed', realtime: true });
  clients.push(c); return c;
};
const fresh = (c: ProbeClient) => c.next(m => m.type === 'snapshot');
try {
  let a = await connect(0, reuse ? 'auto' : 'new'), b = await connect(1, reuse ? 'auto' : 'new');
  evidence.initialConnections = [a.closed, b.closed];
  check('distinctOrdinaryPeople', !!a.personId && !!b.personId && a.personId !== b.personId && !a.closed && !b.closed);
  evidence.people = [a.personId, b.personId]; evidence.worldId = a.hello?.worldId;
  await Promise.all([fresh(a), fresh(b)]);
  const privateOwners = (c: ProbeClient) => c.lastSnapshot!.bodies.filter((body: any) => 'inventory' in body || 'needs' in body || 'wealth' in body).map((body: any) => body.entityId);
  check('privateStateOnlyForOwnPerson', JSON.stringify(privateOwners(a)) === JSON.stringify([a.personId]) && JSON.stringify(privateOwners(b)) === JSON.stringify([b.personId]));
  check('developerInspectionForbidden', (await a.intent({ type: 'debug_inspect', personId: b.personId })).result === 'forbidden');
  const denied = await connect(1, a.personId);
  check('otherAccountCannotOwnPerson', denied.closed?.code === CLOSE.forbidden);
  const old = a, binding = a.hello!.interaction;
  a = await connect(0);
  check('oldConnectionFenced', (await old.waitClosed()).code === CLOSE.superseded && a.personId === old.personId);
  const stale = a.next(m => m.type === 'command_receipt' && m.commandId === 'stale-contest');
  a.sendRaw({ version: 2, type: 'command', ...binding, sequence: 1, commandId: 'stale-contest', clientTimeMs: 0, command: { type: 'attack' } });
  const rejected = await stale;
  check('staleEpochRejected', rejected.status === 'rejected' && rejected.result === 'binding_mismatch');
  await b.close(); b = await connect(1);
  check('reconnectPreservesPeople', a.personId === evidence.people[0] && b.personId === evidence.people[1]);
  // Travelers start empty-handed. Acquire the contested item through an actual
  // offered trade, spending ordinary starting money; never spawn a test object.
  const conversations: unknown[] = []; evidence.acquisition = conversations;
  const visited = new Set<string>([a.personId, b.personId]);
  while (!a.ownBody()!.inventory.length && visited.size < 64 && Date.now() - started < 240_000) {
    const here = a.ownBody()!.pos;
    const visible = a.lastSnapshot!.knowledge.people.filter((p: any) => !visited.has(p.entityId))
      .sort((p: any, q: any) => Math.hypot(p.pos.x - here.x, p.pos.z - here.z) - Math.hypot(q.pos.x - here.x, q.pos.z - here.z));
    const person = visible[0]; if (!person) break;
    visited.add(person.entityId);
    // A realtime movement command advances one 60 Hz interaction tick. Waiting for
    // a 10 Hz scene snapshot after every command unintentionally ran at one sixth
    // walking speed. Receipts pace the commands; the latest observed position is
    // refreshed independently by ProbeClient's ordinary snapshot subscription.
    for (let i = 0; i < 1200 && Date.now() - started < 240_000; ++i) {
      const target = a.lastSnapshot!.knowledge.people.find((p: any) => p.bodyId === person.bodyId);
      if (!target) break;
      const pos = a.ownBody()!.pos, dx = target.pos.x - pos.x, dz = target.pos.z - pos.z, distance = Math.hypot(dx, dz);
      if (distance < 2) break;
      await a.command({ type: 'move', x: dx / distance, z: dz / distance, sprint: false });
    }
    await a.command({ type: 'move', x: 0, z: 0, sprint: false });
    if ((await a.intent({ type: 'talk', targetBodyId: person.bodyId })).result !== 'accepted') continue;
    await fresh(a);
    conversations.push({ speaker: person.entityId, dialogue: a.lastSnapshot!.dialogue });
    const trade = a.lastSnapshot!.dialogue?.options.find((o: any) => o.label === 'Trade');
    if (trade) {
      await a.intent({ type: 'dialogue_option', optionId: trade.id }); await fresh(a);
      const buy = a.lastSnapshot!.dialogue?.options.find((o: any) => /^Buy /.test(o.label));
      if (buy) { await a.intent({ type: 'dialogue_option', optionId: buy.id }); await fresh(a); }
    }
    await a.intent({ type: 'dialogue_close' });
  }
  check('ordinaryTradeAcquiredItem', a.ownBody()!.inventory.length > 0);
  // Creation puts both people in the public square. A short approach uses only the
  // other client's observed position; collision and movement remain authoritative.
  for (let i = 0; i < 3600 && Date.now() - started < 300_000; ++i) {
    const pa = a.ownBody()!.pos, pb = b.ownBody()!.pos;
    const dx = pa.x - pb.x, dz = pa.z - pb.z, distance = Math.hypot(dx, dz);
    if (distance < .9) break;
    await b.command({ type: 'move', x: dx / distance, z: dz / distance, sprint: false });
  }
  await b.command({ type: 'move', x: 0, z: 0, sprint: false });
  const drop = a.lastSnapshot!.interactions.find((i: any) => i.kind === 'drop');
  assert(drop, 'Purchased item must be ordinarily droppable');
  const itemId = drop.id.slice('drop:'.length);
  check('ordinaryItemDropped', (await a.command({ type: 'interact', interactionId: drop.id })).result === 'accepted');
  await Promise.all([fresh(a), fresh(b)]);
  const offer = (c: ProbeClient) => c.lastSnapshot!.interactions.find((i: any) => i.id.endsWith(`:${itemId}`) && ['take', 'steal', 'recover'].includes(i.kind));
  const aa = offer(a), ba = offer(b);
  evidence.contest = { itemId, offers: [aa, ba] };
  assert(aa && ba, 'Both people must have a currently valid request for the same physical item');
  const receipts = await Promise.all([a.command({ type: 'interact', interactionId: aa.id }), b.command({ type: 'interact', interactionId: ba.id })]);
  evidence.contest.receipts = receipts;
  check('exactlyOneContestedWinner', receipts.filter(r => r.result === 'accepted').length === 1);
  await Promise.all([fresh(a), fresh(b)]);
  const count = (c: ProbeClient) => c.ownBody()!.inventory.filter((i: any) => i.id === itemId).length;
  check('oneObservedItemHolder', count(a) + count(b) === 1);
  const savedA = a.ownBody()!.inventory, savedB = b.ownBody()!.inventory;
  check('saveAcknowledged', (await a.intent({ type: 'save' })).result === 'saved');
  await a.close();
  a = await connect(0);
  await b.close(); b = await connect(1);
  check('reconnectPreservesPeopleAndPossessions', b.personId === evidence.people[1]
    && JSON.stringify(a.ownBody()!.inventory) === JSON.stringify(savedA)
    && JSON.stringify(b.ownBody()!.inventory) === JSON.stringify(savedB));
  evidence.passed = true;
} catch (error) { evidence.passed = false; evidence.error = String(error); process.exitCode = 1; }
finally {
  for (const c of clients) await c.close().catch(() => c.socket.terminate());
  evidence.elapsedSeconds = (Date.now() - started) / 1000; record();
  console.log(JSON.stringify({ passed: evidence.passed, report: join(out, 'report.json') }));
}
