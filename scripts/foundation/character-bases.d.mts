export type Part = 'body' | 'pants' | 'boots' | 'head' | 'hair';
export type Parts = Record<'female' | 'male', Record<Part, string>>;
export interface PinnedFile { path: string; bytes: number; sha256: string }
export interface EmbeddedImage extends PinnedFile { uri: string }
export interface DerivedFile extends PinnedFile { transform: 'embed-external-images-v1'; source: PinnedFile; embedded: EmbeddedImage[]; data: Buffer }
export interface Pin { kind: 'torn-veil-character-base-pin'; version: 1; provenance: { attestation: string; audit: string; use: string; publish: false }; parts: Parts; files: PinnedFile[] }
export const CHARACTER_BASE_DIR: string, CHARACTER_BASE_URL_DIR: string, CHARACTER_BASE_PIN: string, CHARACTER_BASE_MANIFEST: string;
export const CHARACTER_BASE_DERIVED_DIR: string, CHARACTER_BASE_DERIVATION: 'embed-external-images-v1';
export const CHARACTER_BASE_PARTS: Parts;
export const CHARACTER_BASE_PROVENANCE: Pin['provenance'];
export function glbExternalUris(bytes: Buffer): string[];
export function resolveCharacterBaseUri(glbPath: string, uri: string): string;
export function deriveCharacterBaseGlb(path: string, bytes: Buffer, readPinned: (path: string) => Buffer): { bytes: Buffer; embedded: EmbeddedImage[] } | null;
export function planCharacterBases(sourceAssets: string, parts?: Parts): PinnedFile[];
export function characterBasePin(files: PinnedFile[]): Pin;
export function characterBaseRuntimeManifest(pin: Pin, derived?: DerivedFile[]): Omit<Pin, 'kind'> & { kind: 'torn-veil-private-character-bases'; derivations: Omit<DerivedFile, 'data'>[] };
export function assertPinMatches(plan: PinnedFile[], pin: Pin): void;
export function readCharacterBasePin(root: string): Pin | null;
export function stageCharacterBases(root: string, sourceAssets: string, options?: { record?: boolean }): { target: string; pin: Pin };
export function stagedCharacterBaseFiles(root: string): string[];
