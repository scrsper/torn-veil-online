import type { FoundationBuild } from './identity.mjs';
export interface FoundationLaunch { save: string; port: number; acceptance: boolean; continuing: boolean; noOpen: boolean; help: boolean }
export function assertFoundationSavePath(root: string, save: string): string;
export function foundationSaveExists(save: string): boolean;
export function selectFoundationLaunch(root: string, env?: Record<string, string | undefined>, args?: string[], runId?: string): FoundationLaunch;
export function validateFoundationSave(root: string, save: string, manifest: Pick<FoundationBuild, 'sourceSha256' | 'runtime'>, options?: { create?: boolean }): { save: string; marker: string; continuing: boolean };
export function acquireFoundationSession(root: string, mode: string): () => void;
