/** Presentation adapter: all capability, class and rank rules live in src/sim/progression/tower. */
import type { Tier, EmergedClass } from '../../../sim/progression/tower';
export { ELEMENTS, TIERS, rank, newSheet, tierOf, emergentClass } from '../../../sim/progression/tower';
export type { Style, Element, Tier, CapabilitySheet, EmergedClass } from '../../../sim/progression/tower';
export const TIER_COLOR: Record<Tier, string> = { Normal: '#c8c8c8', Iron: '#8f98a3', Bronze: '#c8874a', Silver: '#dfe6ee', Gold: '#ffd45c', Diamond: '#8fe8ff', God: '#ff9cf2' };

// ---- Codex: every discovered class, kept across runs (localStorage) and exportable as JSON ----
export interface CodexEntry extends EmergedClass { firstSeen: string; floor: number; seed: number; times: number; receipts?: string[] }
const KEY = 'tv.tower.codex.v1';
export function loadCodex(): CodexEntry[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } }
export function recordClass(c: EmergedClass, floor: number, seed: number, receipt?: string): { entry: CodexEntry; isNew: boolean } {
  const codex = loadCodex();
  let entry = codex.find(e => e.id === c.id); const isNew = !entry;
  if (!entry) { entry = { ...c, firstSeen: new Date().toISOString(), floor, seed, times: 0 }; codex.push(entry); }
  if (receipt && entry.receipts?.includes(receipt)) return { entry, isNew: false };
  entry.times++; if (receipt) (entry.receipts ??= []).push(receipt);
  try { localStorage.setItem(KEY, JSON.stringify(codex)); } catch { /* private mode: codex lives for the session */ }
  return { entry, isNew };
}
