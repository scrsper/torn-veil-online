import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ALPHA_PROTOCOL } from './protocol';
import { SAVE_VERSION } from '../sim/persist/save';
import { GENERATOR_VERSION } from './fingerprint';

export type AlphaEnv = 'dev' | 'staging' | 'live';
/**
 * Per-environment configuration. Environments are separated by root directory (state, logs,
 * credentials), backup directory, port and credentials; they share no files. Nothing lives in a
 * source checkout or a release directory, so rebuilding or switching branches cannot touch a world.
 */
export interface AlphaConfig {
  env: AlphaEnv;
  port: number;
  /** Interfaces to listen on. Never 0.0.0.0: loopback plus, optionally, the Tailscale address. */
  bind: string[];
  root: string;
  stateDir: string; logDir: string; credentialsDir: string; backupDir: string;
  seed: number;
  /** Create a brand-new world only when the state directory has never held one. */
  createWorldIfMissing: boolean;
  checkpointSeconds: number;
  backupMinutes: number;
  disconnectGraceSeconds: number;
  maxConnections: number;
  characterCatalogue: string | null;
}

export function loadConfig(path: string): AlphaConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AlphaConfig>;
  const root = raw.root ? resolve(raw.root) : dirname(resolve(path));
  const at = (p: string | undefined, fallback: string) => p ? (isAbsolute(p) ? p : join(root, p)) : join(root, fallback);
  const env = raw.env;
  if (env !== 'dev' && env !== 'staging' && env !== 'live') throw new Error(`config.env must be dev, staging or live`);
  const bind = raw.bind ?? ['127.0.0.1'];
  if (!bind.length || bind.some(a => a === '0.0.0.0' || a === '::' || a === '')) throw new Error('Refusing to bind a wildcard address; list explicit interfaces');
  return {
    env, port: raw.port ?? (env === 'live' ? 7400 : env === 'staging' ? 7410 : 7420), bind, root,
    stateDir: at(raw.stateDir, 'state'), logDir: at(raw.logDir, 'logs'), credentialsDir: at(raw.credentialsDir, 'credentials'),
    backupDir: at(raw.backupDir, 'backups'),
    seed: raw.seed ?? 918271,
    createWorldIfMissing: raw.createWorldIfMissing ?? false,
    checkpointSeconds: Math.max(10, raw.checkpointSeconds ?? 60),
    backupMinutes: Math.max(5, raw.backupMinutes ?? 60),
    disconnectGraceSeconds: Math.max(0, raw.disconnectGraceSeconds ?? 120),
    maxConnections: Math.max(1, Math.min(64, raw.maxConnections ?? 8)),
    characterCatalogue: raw.characterCatalogue ? at(raw.characterCatalogue, '') : null,
  };
}

export interface ReleaseIdentity {
  version: string; revision: string; dirty: boolean; builtAtIso: string;
  protocol: number; saveSchema: number; generatorVersion: string; node: string;
}
/** The identity of the running build: `release.json` beside a bundled release, or the git
 * checkout for a development run (marked dirty when the tree has uncommitted changes). */
export function loadRelease(entry: string): ReleaseIdentity {
  const file = join(dirname(entry), 'release.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  let revision = 'unknown', dirty = true;
  try { revision = execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0; } catch { /* not a checkout */ }
  return { version: `dev-${revision}${dirty ? '-dirty' : ''}`, revision, dirty, builtAtIso: new Date().toISOString(), protocol: ALPHA_PROTOCOL, saveSchema: SAVE_VERSION, generatorVersion: GENERATOR_VERSION, node: process.version };
}
