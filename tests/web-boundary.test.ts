import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ALPHA_PROTOCOL as SERVER_ALPHA, CLOSE as SERVER_CLOSE, CLIENT_KINDS } from '../src/server/protocol';
import { REGION_PROTOCOL as SERVER_REGION } from '../src/bridge/streaming';
import { INTERACTION_SPEC } from '../src/sim/physical/prediction';
import { ALPHA_PROTOCOL, CLOSE, INTERACTION_SPEC_REVISION, REGION_PROTOCOL } from '../src/web/net/messages';

/**
 * The browser bundle's boundary. The web client is a presentation layer over the simulation:
 * it may borrow pure, browser-safe kernels (prediction, block queries, appearance tokens), but it
 * must never pull in the server, the gateway, persistence, Node built-ins, or anything that steps
 * the World. This walks the real static import graph from the entry point, so a stray import fails here
 * rather than in a user's browser.
 */
const root = resolve(__dirname, '..');
const entry = join(root, 'web', 'main.ts');

/** Runtime imports only: `import type` / `export type` are erased by the bundler and carry no code. */
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^'"\n;]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.json`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}
function graph(): { files: Set<string>; external: Map<string, string[]> } {
  const files = new Set<string>(), external = new Map<string, string[]>();
  const walk = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    if (file.endsWith('.json')) return;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      if (spec.startsWith('.')) {
        const target = resolveLocal(file, spec);
        if (!target) throw new Error(`unresolved import ${spec} in ${relative(root, file)}`);
        walk(target);
      } else external.set(spec, [...(external.get(spec) ?? []), relative(root, file)]);
    }
  };
  walk(entry);
  return { files, external };
}
const rel = (p: string) => relative(root, p).split(sep).join('/');

describe('browser bundle boundary', () => {
  const { files, external } = graph();
  const paths = [...files].map(rel);

  it('reaches the client and only a short list of simulation kernels', () => {
    expect(paths.filter(p => p.startsWith('src/web/')).length).toBeGreaterThan(40);
    const outside = paths.filter(p => !p.startsWith('src/web/') && p !== 'web/main.ts');
    // Every non-client module the browser may load, named. Adding one is a deliberate decision.
    const allowed = new Set([
      'src/sim/physical/prediction.ts', 'src/sim/physical/blocks.ts', 'src/sim/physical/combatRepertoire.json',
      'src/sim/physical/interactionSpec.json', 'src/sim/core/appearance.ts',
      // Pure expedition action/evidence reducer; no World stepping or persistence dependency.
      'src/sim/progression/tower.ts',
      'src/sim/progression/towerEncounters.ts',
      // Shared authored definitions only; no canonical cast resolver or World access.
      'src/sim/physical/arcana/catalogue.ts',
      // Unchanged seeded room grammar, with no World, grid, entity or persistence imports.
      'src/sim/world/interiors/maze.ts',
      // Pure capsule/support queries shared by authoritative movement and prediction.
      // The browser receives a bounded triangle window, never a World or save.
      'src/sim/physical/staticGeometry.ts',
      // Verified asset schema and connector transforms; no file I/O or simulation.
      'src/sim/world/assets/focused.ts',
      // World sphere (/?world): pure seeded planet geography, regions, surface motion, sky
      // clock, scatter and the realm chart. No World, entity, persistence or live RNG.
      'src/sim/world/planet/index.ts', 'src/sim/world/planet/planet.ts', 'src/sim/world/planet/regions.ts', 'src/sim/world/planet/motion.ts',
      'src/sim/world/planet/sky.ts', 'src/sim/world/planet/scatter.ts', 'src/sim/world/planet/chart.ts',
      'src/sim/world/planet/pagoda.ts', 'src/sim/world/planet/roads.ts', 'src/sim/world/planet/aether.ts',
      // Seeded deterministic RNG and realm addresses/names; no World access.
      'src/sim/core/rng.ts', 'src/sim/world/realms/layout.ts',
      // Library registry generated from the torn-veil-assets manifest (ids, hashes, bounds; no binaries).
      'src/sim/world/assets/library.ts', 'src/sim/world/assets/libraryCatalog.json', 'src/sim/world/assets/libraryCollision.ts', 'src/sim/world/assets/libraryCollision.json',
      // Focused town plan and verified static geometry catalog (pure transforms, no file I/O).
      'src/sim/world/assets/focusedLayouts.ts', 'src/sim/world/assets/focusedRuntime.ts', 'src/sim/world/assets/focusedCatalog.json', 'src/sim/world/assets/focusedTerrain.ts',
      // Tower floor specs: the canonical seeded plan grammar and pure warden-kit rules.
      'src/sim/world/interiors/floorSpec.ts', 'src/sim/world/interiors/layout.ts', 'src/sim/world/interiors/trialKitRules.ts',
    ]);
    const unexpected = outside.filter(p => !allowed.has(p));
    expect(unexpected, `unexpected modules in the browser graph:\n${unexpected.join('\n')}`).toEqual([]);
  });

  it('never imports the server, gateway, persistence or world-stepping code', () => {
    const forbidden = /^src\/(server|webgate|persist|bridge|foundry|tools|sim\/persist|sim\/core\/world)/;
    expect(paths.filter(p => forbidden.test(p))).toEqual([]);
  });

  it('imports no Node built-in and no server-side package', () => {
    const bad = [...external.keys()].filter(s => s.startsWith('node:') || ['fs', 'path', 'os', 'net', 'http', 'https', 'child_process', 'crypto', 'ws', 'express', 'better-sqlite3'].includes(s));
    expect(bad).toEqual([]);
    const known = [...external.keys()].filter(s => !s.startsWith('@babylonjs/') && s !== 'vite');
    expect(known, 'browser code depends on an unexpected package').toEqual([]);
  });

  it('does not step the World or load a save', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(file, 'utf8');
      if (/\bnew World\(|\.step\(\s*\)|\bloadSave\(|\bserializeWorld\(|\bcreateWorld\(/.test(text)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it('holds no credential: the browser code never reads a token or a profile', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.ts') || !rel(file).startsWith('src/web/')) continue;
      const text = readFileSync(file, 'utf8');
      if (/x-torn-veil-(?:token|account)|LOCALAPPDATA|process\.env|\.token\b\s*=/.test(text)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });
});

describe('protocol constants mirrored into the browser', () => {
  it('match the server exactly', () => {
    expect(ALPHA_PROTOCOL).toBe(SERVER_ALPHA);
    expect(REGION_PROTOCOL).toBe(SERVER_REGION);
    expect(INTERACTION_SPEC_REVISION).toBe((INTERACTION_SPEC as { revision: string }).revision);
    expect({ ...CLOSE }).toEqual({ ...SERVER_CLOSE });
  });
  it('the web client kind is a distinct kind from native and probe', () => {
    expect(CLIENT_KINDS.web).toBe('web');
    expect(new Set(Object.values(CLIENT_KINDS)).size).toBe(Object.keys(CLIENT_KINDS).length);
  });
});
