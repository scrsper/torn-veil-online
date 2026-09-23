import { ProbeClient } from './probeClient';

/**
 * Scripted protocol check against a running environment (rehearsals, smoke tests, soak players).
 *   node probe.mjs --port 7410 --account rehearsal --token <t> [--seconds 20]
 * Signs in (creating a character only if the account has none), walks with epoch-bound movement
 * commands, reads its own journal, asks for a durable save, then signs out and back in and checks
 * it resumed the same person. Prints one JSON object; exit code 0 only when every check passed.
 */
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const port = Number(arg('port')), account = arg('account')!, token = arg('token')!, host = arg('host') ?? '127.0.0.1', seconds = Number(arg('seconds') ?? 10);
const checks: Record<string, boolean> = {};
const detail: Record<string, unknown> = {};
let client = await ProbeClient.connect({ port, host, account, token, realtime: true });
if (client.closed?.code === 4404) client = await ProbeClient.connect({ port, host, account, token, realtime: true, character: 'new', name: 'Rehearsal Wayfarer' });
checks.signedIn = !client.closed && !!client.personId;
if (checks.signedIn) {
  const person = client.personId, start = { ...client.ownBody()!.pos };
  const until = Date.now() + seconds * 1000; let moveResults = 0, accepted = 0;
  while (Date.now() < until) {
    const r = await client.command({ type: 'move', x: 1, z: 0, sprint: false }); moveResults++; if (r.result === 'accepted') accepted++;
  }
  await new Promise(r => setTimeout(r, 300));
  const end = client.ownBody()?.pos;
  detail.moved = end ? Math.hypot(end.x - start.x, end.z - start.z) : null;
  checks.movementAccepted = accepted > 0 && accepted / moveResults > 0.5;
  checks.journalPresent = !!client.lastSnapshot?.journal;
  const saved = await client.intent({ type: 'save' });
  checks.durableSave = saved.result === 'saved' && Number.isInteger(saved.generation);
  detail.generation = saved.generation;
  await client.close();
  const again = await ProbeClient.connect({ port, host, account, token, realtime: true });
  checks.resumedSamePerson = again.personId === person;
  await again.close();
}
const passed = Object.values(checks).every(Boolean);
process.stdout.write(JSON.stringify({ passed, checks, detail }) + '\n');
process.exit(passed ? 0 : 1);
