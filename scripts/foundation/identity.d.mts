export interface FoundationFile { path: string; bytes: number; sha256: string }
export interface FoundationRuntime { versions: Record<string, string>; platform: string; arch: string }
export interface FoundationIdentity { sourceSha256: string; files: FoundationFile[]; runtime: FoundationRuntime }
export interface FoundationBuild extends FoundationIdentity { kind: 'torn-veil-foundation'; version: 1; outputs: FoundationFile[]; builtAt: string; entry: string; publicAllowlist: readonly string[] }
export const FOUNDATION_BUILD_KIND: 'torn-veil-foundation';
export const FOUNDATION_MANIFEST: string;
export const FOUNDATION_PUBLIC_ALLOWLIST: readonly string[];
export function foundationRuntimeIdentity(): FoundationRuntime;
export function foundationPublicFiles(root: string): string[];
export function foundationSourceIdentity(root: string): FoundationIdentity;
export function foundationOutputIdentity(buildRoot: string): FoundationFile[];
export function verifyFoundationBuild(root: string, buildRoot?: string): FoundationBuild;
export function isWithin(parent: string, candidate: string): boolean;
