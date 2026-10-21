// Stage the starting town's runtime assets into a built dist (default dist-town/):
//  - the CC0 Poly Haven scans it uses (web/public/textures/world), each checked against
//    art/reference/web-rebirth/material-manifest.json, and the CC0 sky HDR (generated-texture-provenance.json);
//  - the torn-veil-assets GLBs it places (TV_ASSETS_DIR, default /workspace/torn-veil-assets-git),
//    each hash-checked against INTEGRATION_MANIFEST.json and the committed libraryCatalog provenance verdict,
//    plus world-assets/manifest.json for the browser loader (which re-hashes before use).
// Binaries go into the build output only, never into git.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(repo, process.argv[2] || 'dist-town'), assets = process.env.TV_ASSETS_DIR || '/workspace/torn-veil-assets-git';
const sha = async f => createHash('sha256').update(await readFile(f)).digest('hex');
const SURFACES = ['grass_ground', 'brown_mud', 'cobblestone_floor_08', 'plastered_wall', 'weathered_planks', 'roof_slates_02', 'reed_roof_04', 'rock_wall_08', 'bark_brown_02'];
const GLBS = ['tv_04_01_gatehouse', 'tv_08_01_village_lane', 'tv_37_01_market_square', 'tv_31_06_tavern', 'tv_42_01_courtyard_passage', 'tv_41_01_gate_segment', 'tv_10_01_watchpost', 'tv_44_01_dungeon_junction', 'tvn_biome_021', 'tvn_flora_001', 'tvn_flora_005'];
const materials = JSON.parse(await readFile(resolve(repo, 'art/reference/web-rebirth/material-manifest.json'), 'utf8'));
let bytes = 0;
for (const s of SURFACES) for (const slot of ['albedo', 'normal', 'arm']) {
  const rel = `textures/world/${s}-${slot}.jpg`, entry = materials.assets.find(a => a.path === rel);
  if (!entry) throw Error(`no material-manifest entry for ${rel}`);
  const src = resolve(repo, 'web/public', rel); if (await sha(src) !== entry.sha256) throw Error(`hash mismatch ${rel}`);
  await mkdir(dirname(resolve(out, rel)), { recursive: true }); await copyFile(src, resolve(out, rel)); bytes += entry.bytes;
}
const hdrProv = JSON.parse(await readFile(resolve(repo, 'art/reference/web-rebirth/generated-texture-provenance.json'), 'utf8'));
const hdrRel = 'textures/environment/kloppenheim_06_puresky_1k.hdr', hdrEntry = JSON.stringify(hdrProv).includes(hdrRel);
if (!hdrEntry) throw Error('sky HDR provenance missing');
await mkdir(resolve(out, 'textures/environment'), { recursive: true }); await copyFile(resolve(repo, 'web/public', hdrRel), resolve(out, hdrRel));
const manifest = JSON.parse(await readFile(resolve(assets, 'INTEGRATION_MANIFEST.json'), 'utf8'));
const catalog = JSON.parse(await readFile(resolve(repo, 'src/sim/world/assets/libraryCatalog.json'), 'utf8'));
const staged = [];
for (const id of GLBS) {
  const m = manifest.assets.find(a => a.id === id), c = catalog.assets.find(a => a.id === id);
  if (!m || !c || c.verdict !== 'use' || c.sha256 !== m.runtime.sha256) throw Error(`${id}: not approved in the catalog`);
  const src = resolve(assets, m.runtime.path); if (await sha(src) !== m.runtime.sha256) throw Error(`${id}: hash mismatch`);
  const dst = resolve(out, 'world-assets', m.runtime.path); await mkdir(dirname(dst), { recursive: true }); await copyFile(src, dst);
  staged.push({ id, path: m.runtime.path, sha256: m.runtime.sha256 }); bytes += m.runtime.bytes;
}
await writeFile(resolve(out, 'world-assets/manifest.json'), JSON.stringify({ version: 1, assets: staged }, null, 1));
// The town page is the site's front page.
await copyFile(resolve(out, 'town.html'), resolve(out, 'index.html'));
console.log(`staged ${SURFACES.length * 3} textures + HDR + ${staged.length} GLBs (${(bytes / 1e6).toFixed(1)} MB) into ${out}`);
