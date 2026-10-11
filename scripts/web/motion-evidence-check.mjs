/** Read-only verification of a completed motion capture. Does not fabricate new frames,
 * change the raw result, or treat the review partners as autonomous encounter evidence. */
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const directory = process.argv[2];
assert.ok(directory, 'Usage: node scripts/web/motion-evidence-check.mjs <completed-after-capture-directory>');
const source = resolve(directory, 'result.json'), raw = readFileSync(source), r = JSON.parse(raw);
const checks = [], check = (label, condition) => { assert.ok(condition, label); checks.push(label); };
const phase = name => r.phases.find(p => p.name === name);
const hero = name => phase(name)?.bodies.find(b => b.id === 'b_1');
const partner = name => phase(name)?.bodies.find(b => b.id === 'b_2');
check('Completed capture has no reported browser errors', r.result === 'passed' && r.errors.length === 0);
check('Existing mocap and six canonical bodies were rendered', r.observation.mocap && r.observation.people === 6);
check('Ordinary bound commands reached the host', r.observation.commands.some(c => c.status === 'applied'));
check('Walking changed the canonical body position', Math.abs(hero('02-stop').pos.z - hero('01-idle').pos.z) > 1);
check('Combination selected a canonical cross and accepted four strike inputs', hero('05-combination').action.moveId === 'cross' && hero('06-recovery').attackSeq >= 4);
check('Contact displaced the struck partner', partner('06-recovery').hitSeq > 0 && partner('06-recovery').pos.z < partner('01-idle').pos.z - .1);
check('Directional dodge entered its active phase and moved the body', hero('07-dodge').action.kind === 'sidestep' && hero('07-dodge').action.phase === 'active' && hero('07-dodge').pos.x < hero('06-recovery').pos.x - .15);
check('Walking resumed after the retained completed dodge', hero('08-after-dodge').action.phase === 'complete' && hero('08-after-dodge').pos.x > hero('07-dodge').pos.x + .2);
check('Incoming contact damaged and displaced the player', hero('09-receive-hit').hitSeq > 0 && hero('09-receive-hit').pos.z > 24.05);
check('All five visible review opponents eventually attempted attacks', phase('11-crowd-recovery').bodies.filter(b => b.id !== 'b_1' && b.attackSeq > 0).length === 5);
const video = resolve(directory, `${r.label}-gameplay.webm`);
check('Actual captured video exists and is nonempty', statSync(video).size > 100000);
const result = { result: 'passed', rawResult: source, sha256: createHash('sha256').update(raw).digest('hex'),
  video, videoSha256: createHash('sha256').update(readFileSync(video)).digest('hex'), checks,
  limits: 'Checks inspect recorded canonical projections, not visual quality, autonomous NPC behavior, GPU performance or sword/shield coverage.' };
writeFileSync(resolve(directory, 'evidence-check.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
