import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';

/** Private, ignored and never published. The foundation build copies it only into its local bundle. */
export const CHARACTER_BASE_DIR = '.private-assets/character-bases';
/** URL directory inside dist-foundation; outside FOUNDATION_PUBLIC_ALLOWLIST and web/public. */
export const CHARACTER_BASE_URL_DIR = 'private-character-bases';
export const CHARACTER_BASE_PIN = 'scripts/foundation/character-bases.pin.json';
export const CHARACTER_BASE_MANIFEST = 'manifest.json';
const MARKERS = ['.gitignore', CHARACTER_BASE_MANIFEST];

/** Covered studio contract: BaseBody + BasePants + BaseBoots + Head + Hair. OriginalSkin is the
 * unclothed preview branch and Underwear/SkinFull are preview layers; none is an NPC base. */
export const CHARACTER_BASE_PARTS = Object.freeze({
  female: Object.freeze({ body: 'Veil_Female_BaseBody.glb', pants: 'Veil_Female_BasePants.glb', boots: 'Veil_Female_BaseBoots.glb', head: 'Veil_Female_Head_039.glb', hair: 'hair/Veil_Female_Hair_001.glb' }),
  male: Object.freeze({ body: 'Veil_Male_BaseBody.glb', pants: 'Veil_Male_BasePants.glb', boots: 'Veil_Male_BaseBoots.glb', head: 'Veil_Male_Head_005.glb', hair: 'hair/Veil_Male_Hair_001.glb' }),
});
const EXCLUDED = /OriginalSkin|Underwear|SkinFull/i;

/** Recorded as stated by Jacob; this is not an independent licence audit. */
export const CHARACTER_BASE_PROVENANCE = Object.freeze({
  attestation: 'user-attested-original-work',
  attestedBy: 'Jacob', attestedOn: '2026-10-22',
  statement: 'Original work from another computer I work on',
  audit: 'Authorship and licence history not independently audited',
  use: 'private-local-foundation-only', publish: false,
  sourceRepository: 'scrsper/veil-media-studio', sourceCommit: 'd05e112e5a6d646301cb6472ee5caefef95cf8a0',
});

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** External image/buffer URIs referenced by one GLB's JSON chunk. */
function glbJson(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
    || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a
    || bytes.readUInt32LE(12) % 4 || 20 + bytes.readUInt32LE(12) > bytes.length) throw Error('Not a supported binary glTF file');
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}
export function glbExternalUris(bytes) {
  const json = glbJson(bytes);
  return [...json.images ?? [], ...json.buffers ?? []].map(entry => entry.uri).filter(uri => typeof uri === 'string' && !uri.startsWith('data:'));
}

/** A relative glTF URI resolved to a path inside the assets root, or an error. Schemes, drive letters,
 * absolute/network paths, backslashes, queries and escapes after normalization are all rejected. */
export function resolveCharacterBaseUri(glbPath, uri) {
  assertRelativePath(glbPath);
  let decoded;
  try { decoded = decodeURIComponent(uri); } catch { throw Error('Dependency URI is malformed: ' + uri); }
  const segments = decoded.split('/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('/') || /[\\?#\0]/.test(decoded)
    || segments.some(s => !/^(?:\.\.?|[\w .()+-]+)$/.test(s))) throw Error('Dependency escapes the source assets: ' + uri);
  const target = posix.normalize(posix.join(posix.dirname(glbPath), decoded));
  if (target.startsWith('../') || target === '..' || target === '.' || posix.isAbsolute(target)) throw Error('Dependency escapes the source assets: ' + uri);
  assertRelativePath(target);
  return target;
}

function assertRelativePath(path) {
  if (typeof path !== 'string' || !path.split('/').every(s => /^[\w .()+-]+$/.test(s)
    && s !== '.' && s !== '..' && !/[. ]$/.test(s) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s))) {
    throw Error('Dependency escapes the source assets or has an unsafe path: ' + path);
  }
}

/** Check every existing component before reads or writes, including junctions and the root. */
function containedPath(root, path) {
  assertRelativePath(path);
  root = resolve(root);
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw Error('Character base root must not be redirected: ' + root);
  const actualRoot = realpathSync(root);
  let current = root;
  for (const component of path.split('/')) {
    current = resolve(current, component);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (!info) continue;
    if (info.isSymbolicLink() || !realpathSync(current).startsWith(actualRoot + sep)) {
      throw Error('Character base path must not be redirected: ' + path);
    }
  }
  return current;
}

/** Babylon's glTF loader (validation stays enabled) rejects any image URI containing '..'. */
const loaderSafeUri = uri => !uri.includes('..');
/** Derived runtime copies live here; the pinned source copies stay byte-identical beside them. */
export const CHARACTER_BASE_DERIVED_DIR = 'derived';
export const CHARACTER_BASE_DERIVATION = 'embed-external-images-v1';
const IMAGE_TYPES = { '.png': ['image/png', '89504e470d0a1a0a'], '.jpg': ['image/jpeg', 'ffd8ff'], '.jpeg': ['image/jpeg', 'ffd8ff'] };

/**
 * A pinned GLB whose images the loader would reject becomes a self-contained runtime GLB: every
 * external image is appended to the binary chunk as a bufferView. Geometry, skins, materials and
 * extras are untouched. Images come only from `readPinned` (verified pinned bytes). null = serve the source.
 */
export function deriveCharacterBaseGlb(path, bytes, readPinned) {
  const json = glbJson(bytes);
  // Validate every resource, even in parts that need no transformation.
  for (const uri of glbExternalUris(bytes)) readPinned(resolveCharacterBaseUri(path, uri));
  if (!(json.images ?? []).some(image => typeof image.uri === 'string' && !image.uri.startsWith('data:') && !loaderSafeUri(image.uri))) return null;
  const jsonLength = bytes.readUInt32LE(12), binAt = 20 + jsonLength;
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Unsupported binary glTF header: ' + path);
  let bin = Buffer.alloc(0);
  if (binAt < bytes.length) {
    if (binAt + 8 > bytes.length || bytes.readUInt32LE(binAt + 4) !== 0x004e4942 || binAt + 8 + bytes.readUInt32LE(binAt) !== bytes.length) throw Error('Unsupported binary glTF chunks: ' + path);
    bin = bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt));
  }
  json.buffers ??= [];
  if (json.buffers.length > 1 || json.buffers.some(buffer => buffer.uri !== undefined)) throw Error('External glTF buffers are not supported: ' + path);
  if (!json.buffers.length) json.buffers.push({ byteLength: 0 });
  if (!Number.isSafeInteger(json.buffers[0].byteLength) || json.buffers[0].byteLength < 0
    || json.buffers[0].byteLength > bin.length || bin.length - json.buffers[0].byteLength > 3) throw Error('Invalid binary glTF buffer length: ' + path);
  bin = bin.subarray(0, json.buffers[0].byteLength);
  json.bufferViews ??= [];
  const chunks = [bin], embedded = [];
  let length = bin.length;
  for (const image of json.images) {
    if (typeof image.uri !== 'string' || image.uri.startsWith('data:')) continue;
    const target = resolveCharacterBaseUri(path, image.uri), type = IMAGE_TYPES[posix.extname(target).toLowerCase()];
    const data = readPinned(target);
    if (!type || data.subarray(0, type[1].length / 2).toString('hex') !== type[1]) throw Error('Unsupported or mislabelled character base image: ' + target);
    const pad = (4 - length % 4) % 4;
    chunks.push(Buffer.alloc(pad), data); length += pad;
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
    length += data.length;
    embedded.push({ uri: image.uri, path: target, bytes: data.length, sha256: sha(data) });
    delete image.uri; image.bufferView = json.bufferViews.length - 1; image.mimeType = type[0];
  }
  json.buffers[0].byteLength = length;
  const text = Buffer.from(JSON.stringify(json), 'utf8'), jsonChunk = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const binChunk = Buffer.concat([...chunks, Buffer.alloc((4 - length % 4) % 4)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + jsonChunk.length + 8 + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const output = Buffer.concat([header, jsonChunk, binHeader, binChunk]);
  if (glbExternalUris(output).length) throw Error('Derived character base still has external resources: ' + path);
  return { bytes: output, embedded };
}

/** Deterministic runtime derivations of the pinned source copies under `dir`. */
function deriveCharacterBases(dir, pin) {
  const pinned = new Map(pin.files.map(file => [file.path, file]));
  const readPinned = path => {
    const file = pinned.get(path); if (!file) throw Error('Character base image is not pinned: ' + path);
    const bytes = readFileSync(containedPath(dir, path));
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw Error('Staged character base changed: ' + path);
    return bytes;
  };
  const derived = [];
  for (const path of [...new Set(Object.values(pin.parts).flatMap(Object.values))].sort()) {
    const result = deriveCharacterBaseGlb(path, readPinned(path), readPinned);
    if (!result) continue;
    const file = pinned.get(path);
    derived.push({ path: CHARACTER_BASE_DERIVED_DIR + '/' + path, bytes: result.bytes.length, sha256: sha(result.bytes), transform: CHARACTER_BASE_DERIVATION,
      source: { path, bytes: file.bytes, sha256: file.sha256 }, embedded: result.embedded, data: result.bytes });
  }
  return derived;
}

/** Exact files the covered parts need, resolved inside the source assets root. */
export function planCharacterBases(sourceAssets, parts = CHARACTER_BASE_PARTS) {
  const paths = new Set();
  for (const sex of Object.values(parts)) for (const path of Object.values(sex)) {
    if (EXCLUDED.test(path)) throw Error('Preview-only source is not a character base: ' + path);
    paths.add(path);
    const glb = readFileSync(containedPath(sourceAssets, path));
    // Hair preview maps are a glTF fallback; the runtime interprets the source DIRO mask.
    for (const material of glbJson(glb).materials ?? []) {
      const diro = material.extras?.textures?.DIRO;
      if (!diro) continue;
      if (diro !== 'T_Hair_03_DIRO') throw Error('Unsupported character hair mask: ' + diro);
      paths.add(resolveCharacterBaseUri('auxiliary.glb', 'textures/' + diro + '.png'));
    }
    for (const uri of glbExternalUris(glb)) {
      paths.add(resolveCharacterBaseUri(path, uri));
    }
  }
  return [...paths].sort().map(path => {
    const file = containedPath(sourceAssets, path);
    if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw Error('Character base input must be an ordinary file: ' + path);
    const bytes = readFileSync(file);
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  });
}

export function characterBasePin(files) {
  return { kind: 'torn-veil-character-base-pin', version: 1, provenance: CHARACTER_BASE_PROVENANCE, parts: CHARACTER_BASE_PARTS, files };
}

/** Browser manifest. The host's foundation fingerprint covers these exact bytes. */
export function characterBaseRuntimeManifest(pin, derived = []) {
  const replacement = new Map(derived.map(file => [file.source.path, file.path]));
  return { kind: 'torn-veil-private-character-bases', version: 1, provenance: pin.provenance,
    parts: Object.fromEntries(Object.entries(pin.parts).map(([sex, parts]) => [sex,
      Object.fromEntries(Object.entries(parts).map(([part, path]) => [part, replacement.get(path) ?? path]))])),
    files: [...pin.files, ...derived].map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
    derivations: derived.map(({ data, ...receipt }) => receipt) };
}

export function assertPinMatches(plan, pin) {
  if (pin?.kind !== 'torn-veil-character-base-pin' || pin.version !== 1) throw Error('Unsupported character base pin.');
  if (JSON.stringify(pin.parts) !== JSON.stringify(CHARACTER_BASE_PARTS)) throw Error('Character base pin parts differ from the covered contract.');
  if (JSON.stringify(plan) !== JSON.stringify(pin.files)) {
    const pinned = new Map(pin.files.map(file => [file.path, file]));
    const changed = plan.filter(file => JSON.stringify(pinned.get(file.path)) !== JSON.stringify(file)).map(file => file.path);
    throw Error('Character base source differs from the tracked pin: ' + (changed.join(', ') || 'file set changed'));
  }
}

export function readCharacterBasePin(root) {
  const path = resolve(root, CHARACTER_BASE_PIN);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/** Copy pinned bytes read-only from the source. `record` creates the tracked pin once; it never rewrites one. */
export function stageCharacterBases(root, sourceAssets, { record = false } = {}) {
  const plan = planCharacterBases(sourceAssets);
  let pin = readCharacterBasePin(root);
  if (!pin) {
    if (!record) throw Error('No tracked character base pin. Review the source, then rerun with --record.');
    pin = characterBasePin(plan);
    writeFileSync(resolve(root, CHARACTER_BASE_PIN), JSON.stringify(pin, null, 1) + '\n', { flag: 'wx' });
  }
  assertPinMatches(plan, pin);
  // Check all source and destination ancestors before creating or overwriting any staged asset.
  for (const path of [...pin.files.map(file => file.path), ...MARKERS,
    ...Object.values(pin.parts).flatMap(Object.values).map(path => CHARACTER_BASE_DERIVED_DIR + '/' + path)]) {
    containedPath(root, CHARACTER_BASE_DIR + '/' + path);
  }
  const target = resolve(root, CHARACTER_BASE_DIR);
  for (let current = root, parts = CHARACTER_BASE_DIR.split('/'), i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error('Character base staging must not be redirected: ' + current);
  }
  mkdirSync(target, { recursive: true });
  writeFileSync(resolve(target, '.gitignore'), '*\n');
  for (const file of pin.files) {
    const destination = containedPath(target, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(containedPath(sourceAssets, file.path), destination);
    const copied = readFileSync(destination);
    if (copied.length !== file.bytes || sha(copied) !== file.sha256) throw Error('Staged copy differs from pin: ' + file.path);
  }
  const derived = deriveCharacterBases(target, pin);
  for (const file of derived) {
    const destination = containedPath(target, file.path);
    mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, file.data);
  }
  writeFileSync(resolve(target, CHARACTER_BASE_MANIFEST), JSON.stringify(characterBaseRuntimeManifest(pin, derived), null, 1) + '\n');
  stagedCharacterBaseFiles(root);
  return { target, pin };
}

/** Staged files (relative to CHARACTER_BASE_DIR), verified exactly against the tracked pin. Absent = []. */
export function stagedCharacterBaseFiles(root) {
  const dir = resolve(root, CHARACTER_BASE_DIR);
  if (!existsSync(dir)) return [];
  containedPath(root, CHARACTER_BASE_DIR);
  const pin = readCharacterBasePin(root);
  if (!pin) throw Error(CHARACTER_BASE_DIR + ' exists without a tracked pin. Remove the private staging or restore ' + CHARACTER_BASE_PIN + '.');
  const found = [];
  const visit = relative => {
    const absolute = join(dir, relative), info = lstatSync(absolute);
    if (info.isSymbolicLink()) throw Error('Character base staging must contain ordinary files: ' + relative);
    if (info.isDirectory()) for (const name of readdirSync(absolute).sort()) visit(relative ? join(relative, name) : name);
    else if (info.isFile()) found.push(relative.split(sep).join('/'));
    else throw Error('Unsupported character base staging entry: ' + relative);
  };
  visit('');
  for (const file of pin.files) {
    const bytes = readFileSync(containedPath(dir, file.path));
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw Error('Staged character base changed: ' + file.path);
  }
  assertPinMatches(planCharacterBases(dir), pin);
  const derived = deriveCharacterBases(dir, pin);
  const expected = [...pin.files.map(file => file.path), ...derived.map(file => file.path), ...MARKERS].sort();
  if (JSON.stringify(found.sort()) !== JSON.stringify(expected)) throw Error('Character base staging is incomplete or has unpinned files. Rerun scripts/foundation/stage-character-bases.mjs.');
  for (const file of derived) {
    const bytes = readFileSync(containedPath(dir, file.path));
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw Error('Derived character base changed: ' + file.path);
  }
  if (readFileSync(resolve(dir, CHARACTER_BASE_MANIFEST), 'utf8') !== JSON.stringify(characterBaseRuntimeManifest(pin, derived), null, 1) + '\n') throw Error('Character base runtime manifest differs from the pin and derivation.');
  return [...pin.files.map(file => file.path), ...derived.map(file => file.path), CHARACTER_BASE_MANIFEST].sort();
}
