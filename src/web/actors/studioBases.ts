import '@babylonjs/loaders/glTF';
import { SceneLoader, type AssetContainer, type Scene } from '@babylonjs/core';
import { STUDIO_PARTS, STUDIO_REQUIRED_BONES, adaptStudioMaterials, composeStudioRig, type StudioPart, type StudioRig, type StudioSex } from './studioBaseRig';

/** Served only by a local foundation bundle built with staged, pinned private bases. */
export const STUDIO_BASE_URL = './private-character-bases/';
export const studioRigKey = (sex: StudioSex) => `studio:${sex}`;

export interface StudioBaseManifest {
  kind: 'torn-veil-private-character-bases'; version: 1;
  provenance: { attestation: string; audit: string; use: string; publish: false; [k: string]: unknown };
  parts: Record<StudioSex, Record<StudioPart, string>>;
  files: { path: string; bytes: number; sha256: string }[];
  derivations?: {
    path: string; bytes: number; sha256: string; transform: 'embed-external-images-v1';
    source: { path: string; bytes: number; sha256: string };
    embedded: { uri: string; path: string; bytes: number; sha256: string }[];
  }[];
}

/** Fail closed: an unexpected manifest means the credited fallback, never a guessed layout. */
export function parseStudioManifest(value: unknown): { ok: true; manifest: StudioBaseManifest } | { ok: false; reason: string } {
  const m = value as StudioBaseManifest | null;
  if (!m || m.kind !== 'torn-veil-private-character-bases' || m.version !== 1) return { ok: false, reason: 'unsupported-manifest' };
  if (m.provenance?.publish !== false || m.provenance?.use !== 'private-local-foundation-only') return { ok: false, reason: 'provenance-not-private-local' };
  const safePath = (p: unknown): p is string => typeof p === 'string' && /^[\w.-]+(?:\/[\w.-]+)*$/.test(p) && !p.split('/').some(s => s.endsWith('.'));
  if (!Array.isArray(m.files) || m.files.some(f => !f || !safePath(f.path) || !Number.isSafeInteger(f.bytes) || f.bytes <= 0 || !/^[a-f0-9]{64}$/.test(f.sha256))) return { ok: false, reason: 'invalid-file-pin' };
  const files = new Set(m.files.map(f => f.path));
  if (files.size !== m.files.length) return { ok: false, reason: 'duplicate-file-pin' };
  const matchesPin = (f: StudioBaseManifest['files'][number] | null | undefined) => !!f && m.files.some(p => p.path === f.path && p.bytes === f.bytes && p.sha256 === f.sha256);
  if (m.derivations !== undefined && (!Array.isArray(m.derivations) || m.derivations.some(d => !d
    || d.transform !== 'embed-external-images-v1' || !matchesPin(d) || !matchesPin(d.source)
    || d.path !== 'derived/' + d.source.path || !Array.isArray(d.embedded) || !d.embedded.length
    || d.embedded.some(image => !matchesPin(image) || typeof image.uri !== 'string')))) return { ok: false, reason: 'invalid-derivation' };
  const derived = new Set((m.derivations ?? []).map(d => d.path));
  if (derived.size !== (m.derivations ?? []).length || m.files.some(f => f.path.startsWith('derived/') && !derived.has(f.path))) return { ok: false, reason: 'unrecorded-derivation' };
  for (const sex of ['female', 'male'] as const) for (const part of STUDIO_PARTS) {
    const path = m.parts?.[sex]?.[part];
    if (typeof path !== 'string' || !path.endsWith('.glb') || path.includes('..') || /^[/\\]|:/.test(path)) return { ok: false, reason: `invalid-part:${sex}.${part}` };
    if (/OriginalSkin|Underwear|SkinFull/i.test(path)) return { ok: false, reason: `preview-only-part:${sex}.${part}` };
    if (!files.has(path)) return { ok: false, reason: `unpinned-part:${sex}.${part}` };
  }
  return { ok: true, manifest: m };
}

export interface StudioBaseStatus { available: StudioSex[]; reason: string; provenance: StudioBaseManifest['provenance'] | null; materials: Partial<Record<StudioSex, Record<string, number>>> }

export class StudioCharacterBases {
  readonly status: StudioBaseStatus = { available: [], reason: 'not-loaded', provenance: null, materials: {} };
  private parts = new Map<StudioSex, { part: StudioPart; container: AssetContainer }[]>();
  private serial = 0;
  constructor(private readonly scene: Scene, private readonly base = STUDIO_BASE_URL) {}

  async load(progress: (text: string) => void = () => {}): Promise<StudioBaseStatus> {
    let manifest: StudioBaseManifest;
    try {
      const response = await fetch(this.base + 'manifest.json', { cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) { this.status.reason = 'studio-bases-not-staged'; return this.status; }
      const parsed = parseStudioManifest(await response.json());
      if (!parsed.ok) { this.status.reason = parsed.reason; return this.status; }
      manifest = parsed.manifest;
    } catch (error) { this.status.reason = 'studio-manifest-unreadable:' + String(error).slice(0, 120); return this.status; }
    this.status.provenance = manifest.provenance;
    for (const sex of ['female', 'male'] as const) {
      progress(`Loading ${sex} character base`);
      const loaded: { part: StudioPart; container: AssetContainer }[] = [];
      try {
        // Sequential parts bound peak decoding. Manifest selects verified derived hair GLBs;
        // other parts retain their pinned source-relative textures. Loader validation stays on.
        for (const part of STUDIO_PARTS) {
          const path = manifest.parts[sex][part], slash = path.lastIndexOf('/');
          const container = await SceneLoader.LoadAssetContainerAsync(this.base + path.slice(0, slash + 1), path.slice(slash + 1), this.scene);
          loaded.push({ part, container });
        }
        const probe = composeStudioRig(this.scene, `studio-probe-${sex}`, loaded);
        try {
          const missing = STUDIO_REQUIRED_BONES.filter(b => !probe.nodes.has(b));
          if (missing.length) throw Error('Missing required bones: ' + missing.join(', '));
        } finally { probe.dispose(); }
        const counts: Record<string, number> = {};
        for (const { container } of loaded) for (const [k, v] of Object.entries(await adaptStudioMaterials(container, this.base + 'textures/'))) counts[k] = (counts[k] ?? 0) + v;
        this.status.materials[sex] = counts; this.parts.set(sex, loaded); this.status.available.push(sex);
      } catch (error) {
        for (const { container } of loaded) container.dispose();
        console.warn('[characters] studio base unavailable', sex, error);
        this.status.reason = `studio-${sex}-load-failed:` + String(error).slice(0, 160);
      }
    }
    if (this.status.available.length === 2) this.status.reason = 'loaded';
    return this.status;
  }
  has(sex: StudioSex | null | undefined): sex is StudioSex { return !!sex && this.parts.has(sex); }
  dispose(): void {
    for (const parts of this.parts.values()) for (const { container } of parts) container.dispose();
    this.parts.clear(); this.status.available = []; this.status.reason = 'disposed';
  }
  /** A new independent clothed instance (own nodes, skeletons, morph managers). */
  rig(sex: StudioSex, tag = `studio-${sex}-${this.serial++}`): StudioRig {
    const parts = this.parts.get(sex); if (!parts) throw Error(`Studio ${sex} base is not loaded`);
    return composeStudioRig(this.scene, tag, parts);
  }
}
