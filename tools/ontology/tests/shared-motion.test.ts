import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  fail: false,
  mocap: true,
  instances: [] as { disposed: boolean; clips: Map<string, unknown> }[],
}));

vi.mock('../../../src/web/arena/assets', () => ({
  ArenaAssets: class {
    used: Set<string> | null = null;
    mocap = state.mocap;
    clips = new Map<string, unknown>([['walk', {}]]);
    disposed = false;
    constructor(_scene: unknown, _options: unknown) { state.instances.push(this); }
    async load(_kinds: string[], _progress: (text: string) => void) { if (state.fail) throw new Error('shared asset load failed'); }
    async loadHumans(_looks: string[], _progress: (text: string) => void) { if (state.fail) throw new Error('human asset load failed'); }
    dispose() { this.disposed = true; }
  },
}));

vi.mock('../../../src/web/arena/retarget', () => ({
  instantiateClips: vi.fn(() => new Map([['walk', { name: 'walk' }]])),
}));

import { attachSharedMotion } from '../src/rendering/sharedMotion';

type Target = { skeletons: { bones: { name: string; getTransformNode: () => object }[] }[]; animationGroups: unknown[] };
function target(): Target {
  return {
    skeletons: [{ bones: [{ name: 'pelvis', getTransformNode: () => ({}) }] }],
    animationGroups: [] as unknown[],
  };
}

describe('shared ontology motion lifecycle', () => {
  beforeEach(() => { state.fail = false; state.mocap = true; state.instances.length = 0; });

  it('disposes loaded assets when the request becomes stale', async () => {
    const result = await attachSharedMotion(target() as never, {} as never, () => false);
    expect(result).toEqual([]);
    expect(state.instances).toHaveLength(1);
    expect(state.instances[0].disposed).toBe(true);
  });

  it('disposes partially loaded assets when loading fails', async () => {
    state.fail = true;
    await expect(attachSharedMotion(target() as never, {} as never, () => true)).rejects.toThrow('shared asset load failed');
    expect(state.instances[0].disposed).toBe(true);
  });

  it('retains provenance metadata after disposing successful loader assets', async () => {
    state.mocap = false;
    const loaded = target();
    const result = await attachSharedMotion(loaded as never, {} as never, () => true);
    expect(result[0].source).toBe('Tracked KayKit fallback');
    expect(result[0].contract).toContain('ArenaAssets');
    expect(loaded.animationGroups).toHaveLength(1);
    expect(state.instances[0].disposed).toBe(true);
  });
});
