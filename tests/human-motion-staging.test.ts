import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageHumanMotion } from '../scripts/web/stage-human-motion.mjs';

describe('shared CC0 human motion staging', () => {
  it('copies exactly verified bytes, is idempotent, and refuses to overwrite a different local asset', () => {
    const root = mkdtempSync(join(tmpdir(), 'tv-human-motion-'));
    try {
      const data = Buffer.from('test source'), source = join(root, 'source.glb'), output = join(root, 'out');
      const manifest = { id: 'fixture', file: 'motion.glb', bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'), license: 'CC0-1.0', url: 'https://quaternius.com' };
      writeFileSync(source, data);
      const receipt = stageHumanMotion({ output, sources: [source], manifest });
      expect(readFileSync(join(output, manifest.file))).toEqual(data);
      expect(stageHumanMotion({ output, sources: [], manifest })).toEqual(receipt);
      writeFileSync(join(output, manifest.file), 'user asset');
      expect(() => stageHumanMotion({ output, sources: [source], manifest })).toThrow('Original retained');
      expect(readFileSync(join(output, manifest.file), 'utf8')).toBe('user asset');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('fails clearly when the source revision is absent or wrong', () => {
    const root = mkdtempSync(join(tmpdir(), 'tv-human-motion-'));
    try {
      const source = join(root, 'other.glb'); writeFileSync(source, 'unreviewed');
      expect(() => stageHumanMotion({ output: join(root, 'out'), sources: [source] })).toThrow('TV_HUMAN_MOTION');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
