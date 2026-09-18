import { readFileSync } from 'node:fs';
import { EMPTY_CATALOGUE, parseCatalogue } from './catalogue';
import type { CatalogueProblem, CharacterCatalogue } from './catalogue';

/**
 * Load this machine's character catalogue.
 *
 * Absence is the normal case, not an error: CI has no catalogue, a fresh checkout has no
 * catalogue, and a machine without the licensed packs has no catalogue. All three get
 * `EMPTY_CATALOGUE` and a reason, and everything downstream keeps working with the base
 * presentation. The file is produced by `unreal/scripts/audit_character_assets.py`.
 */
export const DEFAULT_CATALOGUE_PATH = '.debug/character-foundry/catalogue.json';

export interface LoadedCatalogue {
  catalogue: CharacterCatalogue;
  path: string;
  /** False when the file was missing, unreadable or unusable — never a thrown error. */
  present: boolean;
  problems: CatalogueProblem[];
}

export function loadCatalogue(path = DEFAULT_CATALOGUE_PATH): LoadedCatalogue {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { catalogue: EMPTY_CATALOGUE, path, present: false, problems: [{ kind: 'rejected', detail: `no catalogue at ${path}; run unreal/scripts/audit_character_assets.py on a machine with the character packs installed` }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { catalogue: EMPTY_CATALOGUE, path, present: false, problems: [{ kind: 'rejected', detail: `catalogue at ${path} is not valid JSON: ${String(error)}` }] };
  }
  const { catalogue, problems } = parseCatalogue(parsed);
  return { catalogue, path, present: catalogue.entries.length > 0, problems };
}
