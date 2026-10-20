// Reads the torn-veil-assets library (TV_ASSETS_DIR, default /workspace/torn-veil-assets) and writes
// a compact, committed catalog (ids, hashes, bounds, ports, provenance verdicts; no binaries).
// With --stage, hash-verified GLBs are copied to web/public/world-assets/ (git-ignored).
import { readFile, writeFile, mkdir, copyFile, stat, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const root = process.env.TV_ASSETS_DIR || '/workspace/torn-veil-assets';
const stage = process.argv.includes('--stage');
// Hard provenance rule: skip anything tied to NCSoft/Aion, source-game extraction, native
// buffer recovery or the Bip001 rig pipeline. Text match over the manifest entry and metadata.
const DENY = [/ncsoft/i, /\baion\b/i, /source[-_ ]game/i, /native[-_ ]buffer[-_ ]recovery/i, /bip001/i];
// Hashes of files that must never be integrated (e.g. Codex character-studio files). Empty: the
// studio is not read, per the run rule; entries can be added by someone allowed to inspect it.
const DENY_HASHES = new Set((process.env.TV_DENY_SHA256 || '').split(',').filter(Boolean).map(s => s.toLowerCase()));
const manifest = JSON.parse(await readFile(resolve(root, 'INTEGRATION_MANIFEST.json'), 'utf8'));
const sums = new Map((await readFile(resolve(root, 'SHA256SUMS'), 'utf8')).split('\n').filter(Boolean).map(l => { const [h, p] = l.trim().split(/\s+/); return [p.replace(/^\*/, ''), h]; }));
const out = [];
for (const a of manifest.assets) {
  const metaPath = `metadata/${a.id}.json`;
  let meta = null; try { meta = JSON.parse(await readFile(resolve(root, metaPath), 'utf8')); } catch {}
  const text = JSON.stringify(a) + JSON.stringify(meta ?? {});
  const reasons = DENY.filter(r => r.test(text)).map(r => `matches ${r}`);
  if (DENY_HASHES.has(a.runtime.sha256.toLowerCase())) reasons.push('hash shared with a denied file set');
  if (sums.get(a.runtime.path) && sums.get(a.runtime.path) !== a.runtime.sha256) reasons.push('SHA256SUMS disagrees with manifest');
  if (meta?.rigged_animated_approved) reasons.push('rigged asset (characters are paused)');
  let present = false;
  try { const s = await stat(resolve(root, a.runtime.path)); if (s.size === a.runtime.bytes) { const h = createHash('sha256').update(await readFile(resolve(root, a.runtime.path))).digest('hex'); present = h === a.runtime.sha256; if (!present) reasons.push('binary present but hash differs'); } } catch {}
  const ports = (a.ports?.ports_gltf_yup_json ?? []).map(p => ({ id: p.id, kind: p.kind, position: p.position, outward: p.outward, width: p.width_m ?? p.clear_width_m ?? 0 }));
  out.push({ id: a.id, name: a.name, family: a.family, path: a.runtime.path, sha256: a.runtime.sha256, bytes: a.runtime.bytes,
    bounds: { min: a.bounds_gltf_yup_m.min, max: a.bounds_gltf_yup_m.max }, triangles: a.triangle_instances, ports,
    provenance: { libraryFileId: a.provenance.library_file_id, archive: a.provenance.file_name, notice: a.provenance.notice },
    verdict: reasons.length ? 'skip' : 'use', reasons });
  if (stage && present && !reasons.length) { const dst = resolve(repo, 'web/public/world-assets', a.runtime.path); await mkdir(dirname(dst), { recursive: true }); await copyFile(resolve(root, a.runtime.path), dst); }
}
const catalog = { version: 1, source: 'scrsper/torn-veil-assets INTEGRATION_MANIFEST.json', manifestCreated: manifest.created_utc,
  coordinate: { units: 'metres', up: 'Y' }, assets: out };
await writeFile(resolve(repo, 'src/sim/world/assets/libraryCatalog.json'), JSON.stringify(catalog, null, 1) + '\n');
if (stage) { await mkdir(resolve(repo, 'web/public/world-assets'), { recursive: true }); await writeFile(resolve(repo, 'web/public/world-assets/manifest.json'), JSON.stringify({ version: 1, assets: out.filter(a => a.verdict === 'use').map(({ id, path, sha256 }) => ({ id, path, sha256 })) }, null, 1)); }
console.log(out.map(a => `${a.id}\t${a.verdict}\t${a.reasons.join('; ')}`).join('\n'));
