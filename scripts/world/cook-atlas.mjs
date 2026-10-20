/** Reproducible, offline Atlas catalog. Reads existing sources; never writes models.
 * Usage: node scripts/world/cook-atlas.mjs [--root <Atlas>] [--out <catalog.json>] [--check]
 * --check compares exact canonical bytes without changing the checked-in catalog. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const DENIED = /ncsoft|aion(?:[\s_-]*2)?|native[\s_-]*buffers?/i;
const SUPPORTED_EXTENSIONS = new Set(['KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_transmission',
  'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_emissive_strength',
  'KHR_materials_volume', 'KHR_texture_transform', 'KHR_mesh_quantization']);
const V = a => ({ x: a[0], y: a[1], z: a[2] });
const emptyBounds = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const extend = (b, p) => { for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], p[k]); b.max[k] = Math.max(b.max[k], p[k]); } };
const roundedBounds = b => ({ min: V(b.min.map(v => Math.floor(v * 1e5) / 1e5 || 0)), max: V(b.max.map(v => Math.ceil(v * 1e5) / 1e5 || 0)) });
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const multiply = (a, b) => Array.from({ length: 16 }, (_, n) => {
  const row = n % 4, col = Math.floor(n / 4); let sum = 0;
  for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
  return sum;
});
function transform(node) {
  if (node.matrix) {
    if (node.matrix.length !== 16 || !node.matrix.every(Number.isFinite)) throw Error('invalid-node-transform');
    return node.matrix;
  }
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], s = node.scale ?? [1, 1, 1], t = node.translation ?? [0, 0, 0];
  const m = [(1 - 2 * y * y - 2 * z * z) * s[0], (2 * x * y + 2 * z * w) * s[0], (2 * x * z - 2 * y * w) * s[0], 0,
    (2 * x * y - 2 * z * w) * s[1], (1 - 2 * x * x - 2 * z * z) * s[1], (2 * y * z + 2 * x * w) * s[1], 0,
    (2 * x * z + 2 * y * w) * s[2], (2 * y * z - 2 * x * w) * s[2], (1 - 2 * x * x - 2 * y * y) * s[2], 0, ...t, 1];
  if (m.length !== 16 || !m.every(Number.isFinite)) throw Error('invalid-node-transform');
  return m;
}
const point = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

/** Pure model inspection, exported for fixture tests. No network/decoder/external
 * resource is consulted. All bounds come from actual accessor vertices and the
 * active scene's full node transform chain, not source metadata dimensions. */
export function inspectGlb(bytes) {
  if (bytes.length < 28 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
    throw Error('invalid-glb-header');
  let json, bin;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw Error('invalid-glb-chunk');
    const size = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4); offset += 8;
    if (offset + size > bytes.length || size % 4) throw Error('invalid-glb-chunk');
    if (kind === 0x4e4f534a) { if (json) throw Error('duplicate-json-chunk'); json = JSON.parse(bytes.toString('utf8', offset, offset + size).trim()); }
    else if (kind === 0x004e4942) { if (bin) throw Error('duplicate-binary-chunk'); bin = bytes.subarray(offset, offset + size); }
    offset += size;
  }
  if (!json || json.asset?.version !== '2.0') throw Error('unsupported-gltf-version');
  const used = [...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])];
  function extensionNames(value) {
    if (!value || typeof value !== 'object') return;
    if (value.extensions && typeof value.extensions === 'object') used.push(...Object.keys(value.extensions));
    for (const nested of Object.values(value)) if (nested && typeof nested === 'object') extensionNames(nested);
  }
  extensionNames(json);
  if (used.some(e => /draco|meshopt|basisu|gpu_instancing/i.test(e))) throw Error('unsupported-compression-or-instancing');
  if ((json.extensionsRequired ?? []).some(e => !SUPPORTED_EXTENSIONS.has(e))) throw Error('unsupported-required-extension');
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some(x => x.uri && !/^data:[\w.+/-]+;base64,[a-zA-Z0-9+/=\s]+$/.test(x.uri)))
    throw Error('external-resource-uri');
  if (JSON.stringify(json).match(DENIED)) throw Error('excluded-source-metadata');
  const buffers = (json.buffers ?? []).map((b, i) => {
    const buffer = b.uri ? Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64') : i === 0 ? bin : undefined;
    if (!buffer || !Number.isSafeInteger(b.byteLength) || b.byteLength < 0 || b.byteLength > buffer.length) throw Error('invalid-buffer-range');
    return buffer.subarray(0, b.byteLength);
  });
  const positions = new Map();
  function readPositions(index) {
    if (positions.has(index)) return positions.get(index);
    const a = json.accessors?.[index], v = json.bufferViews?.[a?.bufferView];
    const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    if (!a || a.type !== 'VEC3' || a.sparse || !Number.isSafeInteger(a.count) || a.count < 1 || a.count > 5000000
      || !v || !sizes[a.componentType] || !buffers[v.buffer]) throw Error('unsupported-position-accessor');
    const size = sizes[a.componentType], stride = v.byteStride ?? size * 3, buffer = buffers[v.buffer];
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), end = start + (a.count - 1) * stride + size * 3;
    if (!Number.isSafeInteger(start) || start < 0 || stride < size * 3 || end > buffer.length
      || end > (v.byteOffset ?? 0) + v.byteLength) throw Error('invalid-accessor-range');
    const methods = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
    const norm = (v) => !a.normalized || a.componentType === 5126 ? v : a.componentType === 5120 ? Math.max(-1, v / 127)
      : a.componentType === 5121 ? v / 255 : a.componentType === 5122 ? Math.max(-1, v / 32767) : a.componentType === 5123 ? v / 65535 : v / 4294967295;
    const out = new Float64Array(a.count * 3);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) {
      const value = norm(buffer[methods[a.componentType]](start + i * stride + k * size));
      if (!Number.isFinite(value) || Math.abs(value) > 1e7) throw Error('invalid-vertex');
      out[i * 3 + k] = value;
    }
    positions.set(index, out); return out;
  }
  function checkIndices(index, vertexCount) {
    const a = json.accessors?.[index], v = json.bufferViews?.[a?.bufferView];
    const sizes = { 5121: 1, 5123: 2, 5125: 4 }, methods = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE' };
    if (!a || a.type !== 'SCALAR' || a.sparse || !sizes[a.componentType] || a.normalized
      || !Number.isSafeInteger(a.count) || a.count < 3 || !v || v.byteStride || !buffers[v.buffer]) throw Error('unsupported-index-accessor');
    const size = sizes[a.componentType], buffer = buffers[v.buffer], start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), end = start + a.count * size;
    if (!Number.isSafeInteger(start) || start < 0 || end > buffer.length || end > (v.byteOffset ?? 0) + v.byteLength) throw Error('invalid-index-range');
    for (let i = 0; i < a.count; i++) if (buffer[methods[a.componentType]](start + i * size) >= vertexCount) throw Error('index-outside-vertices');
    return a.count;
  }
  const nodes = json.nodes ?? [], roots = json.scenes?.[json.scene ?? 0]?.nodes
    ?? nodes.map((_, i) => i).filter(i => !nodes.some(n => n.children?.includes(i)));
  const total = emptyBounds(), boxes = [], nodeNames = [], visited = new Set(), materials = new Set(), meshes = new Set();
  let triangleCount = 0, primitiveCount = 0, animated = (json.animations?.length ?? 0) > 0 || (json.skins?.length ?? 0) > 0;
  function visit(index, parent, ancestry) {
    const node = nodes[index];
    if (!node || ancestry.has(index)) throw Error('invalid-node-hierarchy');
    if (visited.has(index)) throw Error('multiply-parented-node');
    visited.add(index); nodeNames.push(String(node.name ?? `node_${index}`));
    const world = multiply(parent, transform(node)), local = emptyBounds();
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh]; if (!mesh) throw Error('missing-mesh');
      meshes.add(node.mesh); if (mesh.weights || node.weights || node.skin !== undefined) animated = true;
      for (const primitive of mesh.primitives ?? []) {
        if (primitive.targets?.length) animated = true;
        const mode = primitive.mode ?? 4;
        if (![4, 5, 6].includes(mode)) throw Error('unsupported-primitive-mode');
        const verts = readPositions(primitive.attributes?.POSITION), count = primitive.indices === undefined ? verts.length / 3 : checkIndices(primitive.indices, verts.length / 3);
        if (!Number.isSafeInteger(count) || count < 3 || (mode === 4 && count % 3)) throw Error('invalid-triangle-indices');
        triangleCount += mode === 4 ? count / 3 : count - 2; primitiveCount++;
        if (primitive.material !== undefined) { if (!json.materials?.[primitive.material]) throw Error('missing-material'); materials.add(primitive.material); }
        for (let i = 0; i < verts.length; i += 3) {
          const p = point(world, [verts[i], verts[i + 1], verts[i + 2]]);
          if (p.some(v => !Number.isFinite(v) || Math.abs(v) > 1e7)) throw Error('invalid-world-vertex');
          extend(total, p); extend(local, p);
        }
      }
      if (Number.isFinite(local.min[0])) boxes.push(roundedBounds(local));
    }
    const next = new Set(ancestry); next.add(index);
    for (const child of node.children ?? []) visit(child, world, next);
  }
  for (const root of roots) visit(root, I, new Set());
  if (!triangleCount || !Number.isFinite(total.min[0])) throw Error('no-renderable-geometry');
  let textureBytes = 0;
  for (const image of json.images ?? []) {
    if (image.uri) textureBytes += Buffer.from(image.uri.slice(image.uri.indexOf(',') + 1), 'base64').length;
    else {
      const view = json.bufferViews?.[image.bufferView], buffer = view && buffers[view.buffer];
      if (!view || !buffer || (view.byteOffset ?? 0) + view.byteLength > buffer.length) throw Error('invalid-image-range');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw Error('unsupported-image-format');
      textureBytes += view.byteLength;
    }
  }
  const bounds = roundedBounds(total);
  return { triangleCount, nodeCount: visited.size, meshCount: meshes.size, primitiveCount, materialCount: materials.size,
    textureCount: json.textures?.length ?? 0, textureBytes, nodeNames, bounds, animated,
    footprintRadius: Math.ceil(Math.max(...[bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.z, bounds.max.z].map(z => Math.hypot(x, z)))) * 1e5) / 1e5,
    height: Math.ceil((bounds.max.y - bounds.min.y) * 1e5) / 1e5, groundOffset: -bounds.min.y || 0,
    proxy: boxes.length > 64 ? { kind: 'bounds', boxes: [bounds] } : { kind: 'boxes', boxes } };
}

function publicRelative(base, url) {
  if (typeof url !== 'string' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) throw Error('external-model-uri');
  const decoded = decodeURIComponent(url.split('?')[0]);
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) throw Error('unsafe-source-path');
  const rel = path.posix.normalize(path.posix.join(base, decoded.replace(/^\.?\//, '')));
  if (rel.startsWith('../') || path.isAbsolute(rel) || DENIED.test(rel)) throw Error('excluded-source-path');
  return rel;
}
function containedFile(root, relative) {
  const full = fs.realpathSync(path.join(root, relative)), rel = path.relative(fs.realpathSync(root), full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('source-outside-atlas');
  return full;
}
const readJSON = p => JSON.parse(p.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(p)) : fs.readFileSync(p, 'utf8'));
function roles(source, row, rel) {
  if (source === 'mobs' || row.category === 'fauna' || row.category === 'ontology'
    || /\/(?:rigged|people(?:_flat)?|models)\//.test(rel) && source === 'local') return 'mob-draft';
  if (source === 'architecture') return 'scene';
  if (source === 'nature' || source === 'rebuild' && /^(?:tvn_|flora|nature)/.test(row.source_id ?? row.id)) return 'nature';
  if (/\/components\//.test(rel)) return /(?:altar|brazier|banner|lantern|sarcophagus|ossuary|rubble|bookshelf|desk|barrel|crate)/.test(rel) ? 'prop' : 'module';
  if (/\/(?:exports|integration-slice-12\/models)\//.test(rel)) return /^tvn_/i.test(path.basename(rel)) ? 'nature' : 'scene';
  if (source === 'rebuild') return /^(?:tv_|spaces)/.test(row.source_id ?? row.id) ? 'scene' : 'prop';
  return 'prop';
}
function tagsAndBiomes(source, row, role, rel) {
  const tags = new Set([...(row.tags ?? []), row.category, row.family, role, ...(source === 'rebuild' ? ['draft'] : [])].filter(x => typeof x === 'string' && x.length));
  const biomes = new Set([...(row.biomes ?? []), row.biome].filter(x => typeof x === 'string' && x.length));
  const match = [...tags, ...biomes, row.name ?? '', rel].join(' ').toLowerCase();
  if (/desert|dryland|dry_|savanna/.test(match)) biomes.add('desert');
  if (/frost|snow|ice|glaci/.test(match)) biomes.add('glacial');
  if (/lava|volcan|basalt|ash/.test(match)) biomes.add('volcanic');
  if (/marine|coast|water|marsh|wetland|mangrove/.test(match)) biomes.add('oceanic');
  if (/wood|forest|grass|meadow|temperate|flora|garden|fungal/.test(match)) biomes.add('temperate');
  tags.add(role === 'nature' ? 'wilderness' : role === 'scene' ? 'settlement' : 'decoration');
  if (/tower|dungeon|crypt|ossuary|altar|sarcophagus|brazier|lantern|bookshelf|desk|barrel|crate|banner/.test(match)) tags.add('tower');
  return { tags: [...tags].sort(), biomes: [...biomes].sort() };
}

/** Takes catalog rows in source-priority order; exact payload duplicates never
 * expand placement frequency. The first canonical reference owns that hash. */
export function deduplicateAssets(assets) {
  const seen = new Map(), unique = [], excluded = [];
  for (const asset of assets) {
    const prior = seen.get(asset.contentHash);
    if (prior) excluded.push({ id: asset.id, name: asset.name, source: asset.source, sourceId: asset.sourceId,
      role: 'duplicate', reason: 'duplicate-decoded-payload', path: asset.path, duplicateOf: prior.id });
    else { seen.set(asset.contentHash, asset); unique.push(asset); }
  }
  return { assets: unique, excluded };
}
export function cookAtlas(atlasRoot) {
  const root = path.join(atlasRoot, 'public');
  const architecture = JSON.parse(fs.readFileSync(path.join(root, 'catalog.js'), 'utf8').replace(/^export const catalog\s*=\s*/, '').trim().replace(/;$/, ''));
  const inputs = [
    ...architecture.spaces.map(row => ({ source: 'architecture', base: '', row })),
    ...readJSON(path.join(root, 'assets/nature/catalog.json')).entries.map(row => ({ source: 'nature', base: 'assets/nature', row })),
    ...readJSON(path.join(root, 'assets/mobs/catalog.json')).entries.map(row => ({ source: 'mobs', base: 'assets/mobs', row })),
    ...readJSON(path.join(root, 'assets/rebuilds/catalog.json.gz')).entries.map(row => ({ source: 'rebuild', base: 'assets/rebuilds', row })),
    ...readJSON(path.join(root, 'catalog.json')).entries.map(row => ({ source: 'local', base: '', row })),
  ];
  const candidates = [], excluded = [];
  for (const { source, base, row } of inputs) {
    const sourceId = row.id, id = `atlas:${source}:${sourceId}`, name = row.name ?? sourceId;
    let rel, role = 'still-only';
    try {
      if (DENIED.test(JSON.stringify(row))) throw Error('excluded-source-metadata');
      if (!row.model && row.kind !== 'model') {
        excluded.push({ id, name, source, sourceId, role: row.kind === 'source' ? 'source-only' : 'still-only',
          reason: row.kind === 'source' ? 'non-runtime-source-format' : 'no-interactive-model' }); continue;
      }
      rel = publicRelative(base, row.model ?? row.url); role = roles(source, row, rel);
      const transportBytes = fs.readFileSync(containedFile(root, rel));
      const bytes = rel.endsWith('.gz') ? zlib.gunzipSync(transportBytes, { maxOutputLength: 128 * 1024 * 1024 }) : transportBytes;
      const contentHash = sha256(bytes), expected = row.sha256_glb ?? row.model_transport?.decoded_sha256 ?? (source === 'local' ? row.sha256 : undefined);
      if (expected && contentHash !== expected) throw Error('decoded-hash-mismatch');
      if (row.model_transport?.sha256 && sha256(transportBytes) !== row.model_transport.sha256) throw Error('transport-hash-mismatch');
      const info = inspectGlb(bytes), reasons = [];
      if (role === 'mob-draft') reasons.push('static-fauna-or-character-draft-not-a-living-entity');
      if (info.animated) reasons.push('rigged-or-animated-model-needs-character-pipeline');
      if (info.triangleCount > 300000 || info.primitiveCount > 512 || bytes.length > 32 * 1024 * 1024) reasons.push('exceeds-static-asset-budget');
      if (info.height > 250 || info.footprintRadius > 500 || info.height < .00001) reasons.push('unsupported-physical-extents');
      const { animated, ...metrics } = info;
      const sourceProvenance = typeof row.provenance === 'string' ? row.provenance : row.provenance?.method
        ?? (source === 'architecture' ? 'Existing Torn Veil Atlas original architecture catalog'
          : source === 'local' ? `Existing Atlas local collection: ${row.collection}` : 'Existing saved Torn Veil Atlas rebuild snapshot');
      candidates.push({ id, name, source, sourceId, sourceProvenance,
        readiness: row.readiness ?? row.status ?? 'Static model compatibility measured; controller/art approval not implied',
        role, eligible: reasons.length === 0, exclusions: reasons,
        ...tagsAndBiomes(source, row, role, rel), path: rel, contentHash, byteLength: bytes.length,
        ...(rel.endsWith('.gz') ? { transport: { encoding: 'gzip', contentHash: sha256(transportBytes), byteLength: transportBytes.length } } : {}),
        ...metrics });
    } catch (error) {
      const reason = error.code === 'ENOENT' ? 'missing-source-file' : error.message;
      excluded.push({ id, name, source, sourceId, role, reason, ...(rel ? { path: rel } : {}) });
    }
  }
  const unique = deduplicateAssets(candidates); excluded.push(...unique.excluded);
  const assets = unique.assets.sort((a, b) => a.id.localeCompare(b.id, 'en')), bySource = {}, byRole = {}, exclusions = {};
  for (const a of assets) { bySource[a.source] = (bySource[a.source] ?? 0) + 1; byRole[a.role] = (byRole[a.role] ?? 0) + 1;
    for (const reason of a.exclusions) exclusions[reason] = (exclusions[reason] ?? 0) + 1; }
  for (const a of excluded) exclusions[a.reason] = (exclusions[a.reason] ?? 0) + 1;
  const body = { version: 1, coordinateSystem: 'Y-up metres; native scale 1', assets, excluded: excluded.sort((a, b) => a.id.localeCompare(b.id, 'en')),
    summary: { sourceEntries: inputs.length, uniqueModels: assets.length, compatibleModels: assets.filter(a => a.eligible).length, bySource, byRole, exclusions } };
  return { version: 1, revision: sha256(JSON.stringify(body)), ...body };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const root = option('--root') ?? process.env.TV_ATLAS_ROOT ?? path.join(os.homedir(), 'TornVeilAtlas');
  const out = path.resolve(option('--out') ?? 'src/sim/world/atlas/catalog.json');
  const catalog = cookAtlas(root), raw = JSON.stringify(catalog) + '\n';
  if (args.includes('--check')) {
    if (fs.readFileSync(out, 'utf8') !== raw) throw Error('Atlas catalog differs; recook intentionally after reviewing source changes');
  } else { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, raw); }
  console.log(JSON.stringify({ revision: catalog.revision, ...catalog.summary }, null, 2));
}
