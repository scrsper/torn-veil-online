import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const humanMotionSource = JSON.parse(readFileSync(join(root, 'src/web/presentation/motionSources.json'), 'utf8')).ual;
const hash = data => createHash('sha256').update(data).digest('hex');

/** Copy the audited CC0 library byte-for-byte; never replace a different local file. */
export function stageHumanMotion({ output = join(root, 'web/public/arena'), sources, manifest = humanMotionSource } = {}) {
  const target = join(output, manifest.file);
  const candidates = sources ?? [
    process.env.TV_HUMAN_MOTION,
    process.env.TV_REALMS_ASSETS && join(process.env.TV_REALMS_ASSETS, 'arena', manifest.file),
    join(root, 'tools/ontology/public/assets/library/quaternius-ual/model.glb'),
    join(root, '../torn-veil/web/public/arena', manifest.file),
    join(root, '../torn-veil-build/vrm-characters/public/assets/anim/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb'),
  ].filter(Boolean);
  const valid = data => data.length === manifest.bytes && hash(data) === manifest.sha256;
  if (existsSync(target)) {
    if (!valid(readFileSync(target))) throw Error(`Existing ${target} differs from the audited CC0 motion. Original retained; review before replacing it.`);
  } else {
    const source = candidates.find(path => existsSync(path) && valid(readFileSync(path)));
    if (!source) throw Error('Audited CC0 human motion is missing. Restore tools/ontology/public/assets/library/quaternius-ual/model.glb or set TV_HUMAN_MOTION to the existing UAL1_Standard.glb; see docs/CHARACTER_MOTION.md.');
    const data = readFileSync(source);
    if (!valid(data)) throw Error('Human motion source changed during staging.');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data, { flag: 'wx' });
  }
  const receipt = { id: manifest.id, file: manifest.file, sha256: manifest.sha256, bytes: manifest.bytes,
    license: manifest.license, url: manifest.url };
  writeFileSync(join(dirname(target), 'provenance.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log('Verified shared human motion', stageHumanMotion());
}
