import { createHash } from 'node:crypto';
import { createWriteStream, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const get = name => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1]; };
const worktreeArg = get('--worktree');
const label = get('--label');
const outputArg = get('--output');
const profile = argv.includes('--profile');
const samples = Number(get('--samples') ?? (profile ? 1 : 3));
if (argv.includes('--help')) {
  console.log('Usage: node runner.mjs --worktree PATH --label LABEL --samples N [--profile] --output PATH');
  process.exit(0);
}
if (!worktreeArg || !label || !outputArg) throw Error('Required: --worktree PATH, --label LABEL, --output PATH');
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) throw Error('--label must contain only letters, numbers, dot, underscore, or hyphen');
if (!Number.isInteger(samples) || samples < 1) throw Error('--samples must be a positive integer');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = resolve(worktreeArg);
const output = resolve(outputArg);
const outputDir = output.endsWith('.json') ? dirname(output) : output;
mkdirSync(outputDir, { recursive: true });
const templateDir = join(root, 'scripts', 'food-performance');
const debugDir = join(target, '.debug', 'food-performance');
mkdirSync(debugDir, { recursive: true });
for (const file of ['setup.ts', 'profiler.ts', 'instrumentation.ts', 'config.ts']) copyFileSync(join(templateDir, file), join(debugDir, file));

function git(args) { return execFileSync('git', ['-C', target, ...args], { encoding: 'utf8' }).trim(); }
const head = git(['rev-parse', 'HEAD']);
const status = git(['status', '--porcelain=v1']);
const diffHash = createHash('sha256').update(`${git(['diff', 'HEAD'])}\n${git(['diff', '--cached', 'HEAD'])}`).digest('hex');
// Include new source files too: HEAD plus a tracked diff alone cannot identify an uncommitted run.
const sourceHash = createHash('sha256');
for (const file of [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src', 'tests', 'vite.config.ts', 'package-lock.json']).split('\n'))].sort()) {
  sourceHash.update(file + '\0'); sourceHash.update(existsSync(join(target, file)) ? readFileSync(join(target, file)) : '<deleted>');
}
const revision = { head, status, diffHash, sourceDigest: sourceHash.digest('hex') };
const workloads = [
  { label: 'abundance', selector: 'food abundance keeps' },
  { label: 'scarcity', selector: 'food scarcity \\(stored' },
];
const records = [];

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function run(workload, round) {
  return new Promise(resolveRun => {
    const name = `${label}-${workload.label}-${round}`;
    const reportPath = join(outputDir, `${name}.json`);
    const testPath = join(outputDir, `${name}.vitest.json`);
    const logPath = join(outputDir, `${name}.log`);
    if ([reportPath, testPath, logPath].some(existsSync)) throw Error(`${name}: output already exists; choose a fresh label/directory`);
    const env = { ...process.env, FOOD_PERF_OUTPUT: reportPath, FOOD_PERF_REVISION: label, FOOD_PERF_HEAD: head, FOOD_PERF_REPLAY: '1' };
    if (profile) { env.FOOD_PERF_INSTRUMENT = '1'; env.FOOD_PERF_PROFILE = '1'; }
    else { delete env.FOOD_PERF_INSTRUMENT; delete env.FOOD_PERF_PROFILE; }
    console.log(`START ${name}`);
    const began = performance.now();
    const child = spawn(process.execPath, [join(target, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/stress-benchmarks.test.ts', '--config', '.debug/food-performance/config.ts', '-t', workload.selector, '--reporter=default', '--reporter=json', `--outputFile=${testPath}`], { cwd: target, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = createWriteStream(logPath);
    child.stdout.pipe(log); child.stderr.pipe(log);
    child.once('error', error => { const result = { ...revision, name, round, workload: workload.label, status: 'runner-error', error: error.message, exitCode: null }; console.log(JSON.stringify({ name, status: result.status, exitCode: null })); resolveRun(result); });
    child.once('close', code => {
      log.end();
      const report = readJson(reportPath);
      const test = readJson(testPath);
      const assertions = test?.testResults?.flatMap(file => file.assertionResults ?? []).filter(item => !['pending', 'skipped'].includes(item.status)) ?? [];
      const actualOne = assertions.length === 1;
      const reportValid = !!report?.digest;
      const result = {
        ...revision, name, round, workload: workload.label, exitCode: code,
        status: code === 0 && actualOne && assertions[0]?.status === 'passed' && reportValid ? 'passed' : 'failed',
        validation: { actualTestCount: assertions.length, exactlyOneActualTest: actualOne, reportPresent: !!report, reportValid },
        assertion: assertions[0] ? { title: assertions[0].title, status: assertions[0].status, failureMessages: assertions[0].failureMessages } : null,
        processWallSeconds: (performance.now() - began) / 1000,
        report,
      };
      console.log(JSON.stringify({ name, status: result.status, exitCode: code, actualTests: assertions.length, report: reportValid }));
      resolveRun(result);
    });
  });
}
for (let round = 1; round <= samples; round++) {
  for (const workload of workloads) {
    records.push(await run(workload, round));
    const partial = { capturedAt: new Date().toISOString(), label, worktree: target, node: process.version, platform: process.platform, release: os.release(), cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, totalMemoryGB: os.totalmem() / 2 ** 30, profile, samples: records };
    writeFileSync(output.endsWith('.json') ? output : join(outputDir, `${label}-${profile ? 'profile' : 'timing'}-samples.json`), JSON.stringify(partial, null, 2));
  }
}
process.exitCode = records.every(record => record.status === 'passed') ? 0 : 1;
