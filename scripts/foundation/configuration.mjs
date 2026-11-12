import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { isWithin } from './identity.mjs';

export function assertFoundationSavePath(root, save) {
  root = resolve(root); save = resolve(save);
  if (!['foundation-player', 'foundation-acceptance'].some(name => isWithin(resolve(root, '.debug', name), save)) || !save.endsWith('.json')) {
    throw Error('Foundation saves must be .json files inside this checkout\'s .debug/foundation-player or .debug/foundation-acceptance.');
  }
  // Refuse symlink/junction components, including a substituted .debug directory.
  const actualRoot = realpathSync(root);
  let current = root;
  for (const component of relative(root, save).split(sep)) {
    current = resolve(current, component);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink() || !isWithin(actualRoot, realpathSync(current))) throw Error('Foundation save path traverses a redirected directory or file: ' + current);
  }
  if (existsSync(save) && !lstatSync(save).isFile()) throw Error('Foundation save path is not a file.');
  for (const adjacent of [save + '.store', save + '.foundation.json']) {
    if (existsSync(adjacent) && lstatSync(adjacent).isSymbolicLink()) throw Error('Foundation save metadata must not be redirected.');
  }
  return save;
}

export function foundationSaveExists(save) {
  return existsSync(save) || (existsSync(save + '.store') && readdirSync(save + '.store').length > 0);
}

export function selectFoundationLaunch(root, env = process.env, args = process.argv.slice(2), runId = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8)) {
  for (const arg of args) if (!['--acceptance', '--continue', '--no-open', '--help'].includes(arg)) throw Error('Unknown foundation option: ' + arg);
  const acceptance = args.includes('--acceptance') || Boolean(env.TV_FOUNDATION_SAVE);
  const port = env.TV_FOUNDATION_PORT || '7541';
  if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw Error('TV_FOUNDATION_PORT must be an integer from 1024 to 65535.');
  if (!/^[\w.-]+$/.test(runId)) throw Error('Invalid acceptance run identifier.');
  const save = assertFoundationSavePath(root, env.TV_FOUNDATION_SAVE
    ? resolve(root, env.TV_FOUNDATION_SAVE)
    : resolve(root, '.debug', acceptance ? 'foundation-acceptance/' + runId : 'foundation-player', 'world.json'));
  if (env.TV_FOUNDATION_SAVE && !isWithin(resolve(root, '.debug/foundation-acceptance'), save)) throw Error('TV_FOUNDATION_SAVE may select only an isolated .debug/foundation-acceptance save.');
  const continuing = foundationSaveExists(save);
  if (args.includes('--continue') && !continuing) throw Error('Continue requested, but that foundation save does not exist. No world was created.');
  return { save, port: +port, acceptance, continuing, noOpen: args.includes('--no-open'), help: args.includes('--help') };
}

/** A source change must never silently upgrade even a fully checkpointed foundation save. */
export function validateFoundationSave(root, save, manifest, { create = false } = {}) {
  save = assertFoundationSavePath(root, save);
  const marker = save + '.foundation.json';
  const expected = { kind: 'torn-veil-foundation-save', version: 1, sourceSha256: manifest.sourceSha256, runtime: manifest.runtime };
  if (existsSync(marker)) {
    if (!lstatSync(marker).isFile()) throw Error('Invalid foundation save identity file.');
    const prior = JSON.parse(readFileSync(marker, 'utf8'));
    if (JSON.stringify(prior) !== JSON.stringify(expected)) throw Error('Foundation save belongs to different source/assets/runtime. Keep it unchanged; use its matching build or create a separate acceptance run.');
  } else {
    if (foundationSaveExists(save)) throw Error('Existing save has no foundation identity. Original retained; choose a new foundation path.');
    if (!create) throw Error('Foundation save identity is not initialized.');
    mkdirSync(dirname(save), { recursive: true });
    assertFoundationSavePath(root, save);
    writeFileSync(marker, JSON.stringify(expected) + '\n', { flag: 'wx' });
  }
  return { save, marker, continuing: foundationSaveExists(save) };
}

/** Launcher/build mutual exclusion. Never removes another or an abandoned owner's lock. */
export function acquireFoundationSession(root, mode) {
  const dir = resolve(root, '.debug'); mkdirSync(dir, { recursive: true });
  if (lstatSync(dir).isSymbolicLink()) throw Error('Foundation .debug directory must not be redirected.');
  const path = resolve(dir, 'foundation-session.lock');
  const value = JSON.stringify({ mode, pid: process.pid, id: randomUUID(), startedAt: new Date().toISOString() });
  try { writeFileSync(path, value, { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw Error('A foundation build/launcher owns .debug/foundation-session.lock. Gracefully stop its host before building or starting another; do not remove an active owner\'s lock.'); throw error; }
  return () => { if (existsSync(path) && readFileSync(path, 'utf8') === value) unlinkSync(path); };
}
