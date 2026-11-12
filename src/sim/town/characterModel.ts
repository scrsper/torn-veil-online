import { RUN, WALK } from './movement';

/** Town character models: the staging/loading contract for owner-provided rigged GLBs (pure).
 * A model is cosmetic only. The town simulation owns the player's root position, yaw and collision
 * radius; a loaded rig rides under that root and plays idle/walk/run from the simulated speed.
 * Every entry pins an exact source path, byte size and sha256 plus licence and attribution; studio
 * characters additionally pin the exact scrsper/veil-character-studio commit. Test fixtures are
 * labelled as such and must never be presented as studio characters. */
export const STUDIO_REPO = 'scrsper/veil-character-studio';
export const LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'MIT', 'owner-authorized'] as const;
export type CharacterKind = 'studio-character' | 'test-fixture';
export interface CharacterEntry {
  id: string; kind: CharacterKind; label: string;
  /** Where the bytes come from: repo slug, pinned commit (required for studio characters), path inside it. */
  source: { repo: string; commit: string | null; path: string };
  /** Staged file name, always `<id>.glb`. */
  file: string; sha256: string; bytes: number;
  license: string;
  attribution: { text: string; companion?: { path: string; sha256: string } };
  /** `local-only` models may be staged for local play but never into a distributable build. */
  redistribution: 'permitted' | 'local-only';
  /** Standing height in metres, and the yaw that turns the model to face +z. Optional natural clip speeds (m/s). */
  fit: { height: number; yaw: number; walkSpeed?: number; runSpeed?: number };
  clips: { idle: string; walk?: string; run?: string };
  /** Source features the town does not reproduce (springs, expressions, MToon…), shown in status. */
  unsupported?: string[];
}
export interface CharacterManifest { version: 1; default: string | null; characters: CharacterEntry[] }

const HEX64 = /^[0-9a-f]{64}$/, HEX40 = /^[0-9a-f]{40}$/, ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** Material the project has excluded (no Aion/NCSoft-derived assets). */
const EXCLUDED = /\b(aion|ncsoft)\b/i;
/** A contained relative path: forward slashes, no drive, root, empty or dot segments. */
export function safeRelPath(p: unknown): boolean {
  return typeof p === 'string' && p.length > 0 && p.length < 400 && !p.includes('\\') && !p.startsWith('/') && !/^[A-Za-z]:/.test(p)
    && p.split('/').every(s => s !== '' && s !== '.' && s !== '..');
}
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function entryErrors(e: Partial<CharacterEntry> | null | undefined, at: string): string[] {
  const err: string[] = [], bad = (m: string) => err.push(`${at}: ${m}`);
  if (!e || typeof e !== 'object') return [`${at}: not an object`];
  if (!str(e.id) || !ID.test(e.id)) bad('id must be lower-case kebab');
  if (e.kind !== 'studio-character' && e.kind !== 'test-fixture') bad('kind must be studio-character or test-fixture');
  if (!str(e.label)) bad('label required');
  const s = e.source;
  if (!s || !str(s.repo)) bad('source.repo required');
  if (!s || !safeRelPath(s.path) || !/\.glb$/i.test(s.path)) bad('source.path must be a contained relative .glb path');
  if (e.file !== `${e.id}.glb`) bad('file must be exactly <id>.glb');
  if (!str(e.sha256) || !HEX64.test(e.sha256)) bad('sha256 must be 64 lower-case hex');
  if (!num(e.bytes, 1024, 512e6) || !Number.isInteger(e.bytes)) bad('bytes must be the exact file size');
  if (!LICENSES.includes(e.license as never)) bad(`license must be one of ${LICENSES.join(', ')}`);
  if (!e.attribution || !str(e.attribution.text)) bad('attribution text required');
  const c = e.attribution?.companion;
  if (c && (!safeRelPath(c.path) || !str(c.sha256) || !HEX64.test(c.sha256))) bad('attribution companion needs a contained path and sha256');
  if (e.redistribution !== 'permitted' && e.redistribution !== 'local-only') bad('redistribution must be permitted or local-only');
  if (!e.fit || !num(e.fit.height, .5, 3)) bad('fit.height must be 0.5–3 m');
  if (e.fit && !num(e.fit.yaw, -7, 7)) bad('fit.yaw must be radians');
  if (!e.clips || !str(e.clips.idle)) bad('clips.idle required');
  for (const k of ['walk', 'run'] as const) if (e.clips && e.clips[k] !== undefined && !str(e.clips[k])) bad(`clips.${k} must be a clip name`);
  if (e.kind === 'studio-character') {
    if (s?.repo !== STUDIO_REPO) bad(`studio characters must come from repo ${STUDIO_REPO}`);
    if (!str(s?.commit) || !HEX40.test(s.commit)) bad('studio characters must pin the full 40-hex source commit');
    if (str(e.id) && e.id.startsWith('fixture-')) bad('studio characters must not use the fixture- prefix');
  }
  if (e.kind === 'test-fixture') {
    if (!str(e.id) || !e.id.startsWith('fixture-')) bad('test fixtures must use the fixture- id prefix');
    if (!str(e.label) || !/test fixture/i.test(e.label)) bad('test fixture labels must say "test fixture"');
  }
  if ([e.label, s?.path, s?.repo, e.attribution?.text, c?.path].some(v => typeof v === 'string' && EXCLUDED.test(v))) bad('source is on the excluded list');
  return err;
}
/** Validate a staged manifest or the committed catalog. Never throws. */
export function validateManifest(m: unknown): { ok: boolean; errors: string[]; manifest?: CharacterManifest } {
  const errors: string[] = [], o = m as Partial<CharacterManifest> | null;
  if (!o || typeof o !== 'object') return { ok: false, errors: ['manifest: not an object'] };
  if (o.version !== 1) errors.push('manifest: version must be 1');
  if (!Array.isArray(o.characters)) return { ok: false, errors: [...errors, 'manifest: characters must be an array'] };
  const seen = new Set<string>();
  o.characters.forEach((e, i) => {
    errors.push(...entryErrors(e, `characters[${i}]${e && typeof e.id === 'string' ? ` (${e.id})` : ''}`));
    if (e && seen.has(e.id)) errors.push(`characters[${i}]: duplicate id ${e.id}`); seen.add(e?.id);
  });
  if (o.default !== null && (typeof o.default !== 'string' || !seen.has(o.default))) errors.push('manifest: default must be null or a listed id');
  return errors.length ? { ok: false, errors } : { ok: true, errors, manifest: o as CharacterManifest };
}
/** Whether an entry may be staged into a local dev tree or a distributable build. */
export const stageAllowed = (e: CharacterEntry, target: 'local' | 'dist') => target === 'local' || e.redistribution === 'permitted';
/** Compare fetched/read bytes with the pin; null when they match. */
export function checkBytes(e: CharacterEntry, length: number, sha256: string): string | null {
  if (length !== e.bytes) return `${e.id}: size ${length} ≠ pinned ${e.bytes}`;
  if (sha256 !== e.sha256) return `${e.id}: hash ${sha256.slice(0, 12)}… ≠ pinned ${e.sha256.slice(0, 12)}…`;
  return null;
}
/** Which character to show: `?character=` wins, then the manifest default. Unknown ids fail loudly, never guess. */
export function resolveRequest(param: string | null, m: CharacterManifest | null): { id: string | null; reason?: string; failed?: true } {
  if (param === 'none') return { id: null, reason: 'capsule requested (?character=none)' };
  if (!m) return { id: null, reason: 'no character manifest staged' };
  if (param) return m.characters.some(c => c.id === param) ? { id: param } : { id: null, reason: `character "${param}" is not staged`, failed: true };
  return m.default ? { id: m.default } : { id: null, reason: 'no default character' };
}
/** Below this simulated speed the figure stands. */
const MOVING = .6;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Clip weights (summing to 1) and playback rates for the simulated ground speed. Missing run → faster walk;
 * missing walk → idle only. */
export function locomotionWeights(speed: number, clips: CharacterEntry['clips'], fit: Partial<CharacterEntry['fit']> = {}) {
  const walkSpeed = fit.walkSpeed ?? WALK, runSpeed = fit.runSpeed ?? RUN;
  if (!clips.walk) return { idle: 1, walk: 0, run: 0, walkRate: 1, runRate: 1 };
  const move = clamp01(speed / MOVING), toRun = clips.run ? clamp01((speed - WALK) / (RUN - WALK)) : 0;
  return {
    idle: 1 - move, walk: move * (1 - toRun), run: move * toRun,
    walkRate: Math.max(.5, Math.min(clips.run ? 1.6 : 2.2, speed / walkSpeed || 1)),
    runRate: Math.max(.6, Math.min(1.6, speed / runSpeed || 1)),
  };
}
/** Uniform scale to the target standing height, and the lift that puts the lowest vertex on the floor. */
export function fitTransform(bounds: { minY: number; maxY: number }, height: number): { scale: number; offsetY: number } {
  const h = bounds.maxY - bounds.minY;
  if (!Number.isFinite(h) || h <= 0) throw Error('degenerate model bounds');
  const scale = height / h;
  if (scale < .01 || scale > 100) throw Error(`implausible model scale ${scale.toFixed(4)} (bounds ${h.toFixed(4)} units)`);
  return { scale, offsetY: -bounds.minY * scale };
}
