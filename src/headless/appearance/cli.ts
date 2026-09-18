import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { newWorld } from '../../sim/persist/save';
import { appearanceRows, appearanceSheetSvg, summarize } from './sheet';

/**
 * `npm run appearance:sheet -- [seed] [out.svg] [limit]`
 *
 * Generates a world and writes a contact sheet of its people straight from canonical appearance,
 * so the character pipeline can be reviewed without an Unreal editor. Deterministic: the same seed
 * always produces byte-identical output.
 */
const seed = Number(process.argv[2] ?? 1337);
const out = process.argv[3] ?? '.debug/appearance/contact-sheet.svg';
const limit = Number(process.argv[4] ?? 40);

const { world } = newWorld(seed);
const rows = appearanceRows(world, limit);
const summary = summarize(appearanceRows(world, Number.MAX_SAFE_INTEGER));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, appearanceSheetSvg(rows, `Torn Veil — canonical appearance, seed ${seed}`));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nwrote ${out} (${rows.length} of ${summary.people} people)`);
