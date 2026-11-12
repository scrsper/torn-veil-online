import { resolve } from 'node:path';
import { acquireFoundationSession } from './configuration.mjs';
import { CHARACTER_BASE_DIR, stageCharacterBases } from './character-bases.mjs';

// node scripts/foundation/stage-character-bases.mjs --source <studio>/public/assets [--record]
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2), at = args.indexOf('--source');
for (const arg of args) if (!['--source', '--record'].includes(arg) && arg !== args[at + 1]) throw Error('Unknown option: ' + arg);
if (at < 0 || !args[at + 1]) throw Error('Usage: node scripts/foundation/stage-character-bases.mjs --source <veil-media-studio>/public/assets [--record]');
const release = acquireFoundationSession(root, 'stage-character-bases');
try {
  const { pin } = stageCharacterBases(root, resolve(args[at + 1]), { record: args.includes('--record') });
  const bytes = pin.files.reduce((sum, file) => sum + file.bytes, 0);
  console.log(`Staged ${pin.files.length} pinned files (${bytes} bytes) into ${CHARACTER_BASE_DIR}.\nProvenance: ${pin.provenance.attestation} (${pin.provenance.audit}). Private local foundation use only.\nRebuild with node scripts/foundation/build.mjs; existing saves keep their old build identity.`);
} finally { release(); }
