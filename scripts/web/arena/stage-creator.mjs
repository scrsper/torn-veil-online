// Stage the ontology creator's current Human family bodies for the arena / Tower (npm run web:creator).
// Selection: tools/ontology/ontology/morphology/human-family.json variants -> tools/ontology/assets/registry.json.
// Each body is copied byte-for-byte (originals are never modified) into the gitignored web/public/arena/creator/,
// its SHA256 is checked against the provenance registry, and creator.json records what was staged and from where.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), onto = join(repo, 'tools/ontology');
const family = JSON.parse(readFileSync(join(onto, 'ontology/morphology/human-family.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(onto, 'assets/registry.json'), 'utf8'));
const provenance = JSON.parse(readFileSync(join(onto, 'assets/provenance/registry.json'), 'utf8'));
const out = join(repo, 'web/public/arena/creator'); mkdirSync(out, { recursive: true });
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const staged = [];
for (const v of family.variants) {
  const a = registry.find(r => r.id === v.assetId); if (!a) throw new Error(`registry has no ${v.assetId}`);
  const p = provenance.find(r => r.id === a.provenanceId); if (!p?.sha256) throw new Error(`no provenance hash for ${a.id}`);
  const src = join(onto, a.sourcePath), got = sha(src);
  if (got !== p.sha256) throw new Error(`${a.id}: source ${got} != provenance ${p.sha256}`);
  const dst = join(out, `${a.id}.glb`); copyFileSync(src, dst);
  if (sha(dst) !== p.sha256) throw new Error(`${a.id}: staged copy hash mismatch`);
  staged.push({ id: a.id, variant: v.id, sex: v.sex, nativeHeightM: a.nativeHeightM, rigImplementation: family.rigImplementation, status: a.status, sha256: p.sha256,
    source: `tools/ontology/${a.sourcePath}`, provenanceId: a.provenanceId, license: p.license, limitations: a.limitations });
  console.log(`staged ${a.id} (${v.id}) sha256 ${p.sha256}`);
}
writeFileSync(join(out, 'creator.json'), JSON.stringify({ family: family.id, familyVersion: family.version, familyStatus: family.status, stagedAt: new Date().toISOString(), bodies: staged }, null, 1));
