/** Deterministic, browser-safe expedition rules. No renderer, clock, storage or random source.
 * A Tower expedition is a scoped capability history. It does not grant an ordinary world's
 * Person an ontological breakthrough: those remain governed by core/advancement.ts.
 * The client submits observed encounter actions; this module owns their bounded credit,
 * completion receipts, level, rank and class assessment. Preview floors cannot earn a rank.
 */
export type Style = 'fists' | 'blade' | 'heavy' | 'axe' | 'bow';
export type Element = 'flame' | 'frost' | 'storm' | 'swift' | 'iron' | 'shadow' | 'verdance' | 'water' | 'gravity' | 'time';
export const STYLES: Style[] = ['fists', 'blade', 'heavy', 'axe', 'bow'];
export const ELEMENTS: Element[] = ['flame', 'frost', 'storm', 'swift', 'iron', 'shadow', 'verdance', 'water', 'gravity', 'time'];
export const TIERS = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond', 'God'] as const;
export type Tier = typeof TIERS[number];
export interface FloorEvidence { floor: number; seconds: number; enemies: number; boss: boolean; mastery: number; unarmed: boolean; experience: number }
export interface EncounterTarget { id: string; hp: number; kind: string; boss: boolean }
interface TargetEvidence extends EncounterTarget { credited: number; defeated: boolean }
export interface TowerJourney {
  version: 1; seed: number; preview: boolean; legacyFloors: number; legacyExperience: number; skillPractice: Record<string, number>;
  cleared: FloorEvidence[];
  /** Optional for checkpoints created before bounded loot receipts were added. */
  rewards?: { floor: number; id: string }[];
  current: { floor: number; seconds: number; damage: number; weaponUsed: boolean; casts: number; targets: TargetEvidence[] } | null;
}
export interface CapabilitySheet {
  style: Record<Style, number>; affinity: Record<Element, number>;
  vitality: number; might: number; agility: number; forms: string[]; manaControl: number;
  history: { kills: number; bosses: number; floors: number; tomes: number; boons: number; nearDeaths: number; noWeaponFloors: number };
  /** Optional only for additive migration of v1 checkpoints. */
  journey?: TowerJourney;
}
export function newSheet(): CapabilitySheet {
  return { style: { fists: 0, blade: 0, heavy: 0, axe: 0, bow: 0 },
    affinity: { flame: 0, frost: 0, storm: 0, swift: 0, iron: 0, shadow: 0, verdance: 0, water: 0, gravity: 0, time: 0 },
    vitality: 0, might: 0, agility: 0, forms: [], manaControl: 0,
    history: { kills: 0, bosses: 0, floors: 0, tomes: 0, boons: 0, nearDeaths: 0, noWeaponFloors: 0 } };
}
export const rank = (p: number) => Math.min(10, Math.floor(Math.sqrt(Math.max(0, p) / 12)));
export function startJourney(s: CapabilitySheet, seed: number, preview = false, legacyFloors = 0): void {
  s.journey = { version: 1, seed, preview, legacyFloors: Math.min(99, Math.max(0, legacyFloors)), legacyExperience: 0, skillPractice: {}, cleared: [], rewards: [], current: null };
}
export function beginFloor(s: CapabilitySheet, floor: number, targets: EncounterTarget[]): boolean {
  const j = s.journey;
  if (!j || !Number.isInteger(floor) || floor < 1 || floor > 100 || targets.length > 100 || new Set(targets.map(t => t.id)).size !== targets.length
    || targets.some(t => !t.id || !Number.isFinite(t.hp) || t.hp <= 0)) return false;
  if (!j.preview && floor !== j.legacyFloors + j.cleared.length + 1) return false;
  // Never reset a live floor to refresh its practice budget.
  if (j.current?.floor === floor) return false;
  j.current = { floor, seconds: 0, damage: 0, weaponUsed: false, casts: 0, targets: targets.map(t => ({ ...t, credited: 0, defeated: false })) };
  return true;
}
/** Rebind ephemeral actor ids only at a validated floor-start checkpoint; never reset paid practice. */
export function restoreFloor(s: CapabilitySheet, floor: number, targets: EncounterTarget[]): boolean {
  const c = s.journey?.current;
  if (c && (c.floor !== floor || c.seconds !== 0 || c.damage !== 0 || c.casts !== 0 || c.targets.some(t => t.credited !== 0 || t.defeated))) return false;
  if (!s.journey) return false;
  s.journey.current = null; return beginFloor(s, floor, targets);
}
export type PracticeAction =
  | { kind: 'hit'; target: string; damage: number; style: Style }
  | { kind: 'kill'; target: string; style: Style }
  | { kind: 'cast'; elements: Element[]; mana: boolean; skill?: string }
  | { kind: 'hurt'; fraction: number }
  | { kind: 'time'; seconds: number };
export function practice(s: CapabilitySheet, action: PracticeAction): boolean {
  const c = s.journey?.current;
  if (!c || s.journey!.preview) return false;
  if (action.kind === 'time') { if (!Number.isFinite(action.seconds) || action.seconds <= 0 || action.seconds > .25) return false; c.seconds += action.seconds; return true; }
  if (action.kind === 'hurt') { if (!Number.isFinite(action.fraction) || action.fraction <= 0) return false; c.damage += Math.min(2, action.fraction); return true; }
  if (action.kind === 'cast') {
    // Practice only in an unresolved encounter, with a finite per-floor budget. Idle casting cannot buy a tier.
    if (c.casts >= 24 || c.targets.every(t => t.defeated)) return false;
    c.casts++; if (action.mana) s.manaControl += .0125;
    if (action.skill && action.skill.length <= 120 && !['__proto__', 'constructor', 'prototype'].includes(action.skill)) {
      const ledger = s.journey!.skillPractice;
      if (Object.hasOwn(ledger, action.skill) || Object.keys(ledger).length < 200) ledger[action.skill] = (ledger[action.skill] ?? 0) + 1;
    }
    for (const e of new Set(action.elements)) if (ELEMENTS.includes(e)) s.affinity[e] += .005;
    return true;
  }
  const t = c.targets.find(t => t.id === action.target);
  if (!t || t.defeated || !STYLES.includes(action.style)) return false;
  if (action.style !== 'fists') c.weaponUsed = true;
  if (action.kind === 'hit') {
    if (!Number.isFinite(action.damage) || action.damage <= 0) return false;
    const paid = Math.min(action.damage, Math.max(0, t.hp - t.credited));
    t.credited += paid; s.style[action.style] += paid / t.hp * 3;
    return paid > 0;
  }
  t.defeated = true; s.history.kills++; if (t.boss) s.history.bosses++;
  s.style[action.style] += 1;
  return true;
}
export function finishFloor(s: CapabilitySheet, floor: number): FloorEvidence | null {
  const j = s.journey, c = j?.current;
  if (!j || j.preview || !c || c.floor !== floor || c.targets.some(t => !t.defeated) || !c.targets.length
    || floor !== j.legacyFloors + j.cleared.length + 1) return null;
  // Ten-floor trial has its own verified completion action in the adapter, rather than a fake kill.
  const mastery = Math.max(0, 1 - c.damage / 1.5);
  const e: FloorEvidence = { floor, seconds: c.seconds, enemies: c.targets.length, boss: c.targets.some(t => t.boss), mastery,
    unarmed: !c.weaponUsed, experience: 100 + floor * 2 + c.targets.length * 8 + Math.round(mastery * 20) };
  j.cleared.push(e); j.current = null; s.history.floors++; if (e.unarmed) s.history.noWeaponFloors++;
  return e;
}
/** Floor 10's scripted trial pays exactly one receipt, only on its completed callback. */
export function finishTrial(s: CapabilitySheet): FloorEvidence | null {
  const c = s.journey?.current;
  if (!c || c.floor !== 10 || c.targets.length) return null;
  c.targets.push({ id: 'trial:10', hp: 1, kind: 'trial', boss: true, credited: 1, defeated: true });
  return finishFloor(s, 10);
}
export type TowerReward =
  | { kind: 'tome'; element: Element }
  | { kind: 'form'; form: string }
  | { kind: 'essence'; element?: Element; duplicate: boolean }
  | { kind: 'boon'; element?: Element; amount: 0 | 1 | 2 }
  | { kind: 'trial'; element?: Element; forms: string[] };
const FORMS = ['bolt', 'nova', 'wave', 'field', 'lance', 'weave', 'ward', 'step'];
/** Canonical capability effects of actual loot/choices. Stable receipt ids prevent duplicate credit.
 * Preview rewards remain confined to the demonstration sheet, which cannot earn advancement.
 */
export function reward(s: CapabilitySheet, floor: number, id: string, action: TowerReward): boolean {
  const j = s.journey;
  if (!j || !id || id.length > 120 || (!(j.preview && floor === 0) && (j.current?.floor ?? j.cleared.at(-1)?.floor) !== floor)) return false;
  const receipts = j.rewards ?? [];
  if (receipts.some(r => r.floor === floor && r.id === id) || receipts.filter(r => r.floor === floor).length >= 40) return false;
  if (action.kind === 'trial' && floor !== 10 || action.kind === 'boon' && floor % 10 !== 0) return false;
  if ('element' in action && action.element !== undefined && !ELEMENTS.includes(action.element)) return false;
  const forms = action.kind === 'form' ? [action.form] : action.kind === 'trial' ? action.forms : [];
  if (forms.length > 2 || forms.some(f => !FORMS.includes(f))) return false;
  if (action.kind === 'boon' && ![0, 1, 2].includes(action.amount)) return false;
  j.rewards = receipts; receipts.push({ floor, id });
  if (action.kind === 'tome') { s.affinity[action.element] += 1; s.history.tomes++; }
  if (action.kind === 'essence' && action.element) s.affinity[action.element] += action.duplicate ? .5 : 1;
  if (action.kind === 'boon') { s.history.boons++; if (action.element) s.affinity[action.element] += action.amount; }
  if (action.kind === 'trial' && action.element) s.affinity[action.element] += 1;
  for (const form of forms) {
    if (!s.forms.includes(form)) s.forms.push(form);
    else s.manaControl += action.kind === 'trial' ? 1 : .5;
  }
  return true;
}
export function levelOf(s: CapabilitySheet): { level: number; xp: number; nextXp: number } {
  let xp = (s.journey?.legacyExperience ?? 0) + (s.journey?.cleared ?? []).reduce((n, f) => n + f.experience, 0), level = 1;
  let nextXp = 220;
  while (xp >= nextXp && level < 100) { xp -= nextXp; level++; nextXp = Math.round(220 * Math.pow(level, .8)); }
  return { level, xp, nextXp };
}
export function advancement(s: CapabilitySheet): { tier: Tier; progress: number; reason: string } {
  const j = s.journey;
  if (!j || j.preview) return { tier: 'Normal', progress: 0, reason: 'Begin a fresh expedition to earn advancement.' };
  const n = j.legacyFloors + j.cleared.length, mean = (rows: FloorEvidence[]) => rows.reduce((n, f) => n + f.mastery, 0) / Math.max(1, rows.length);
  const mastery = mean(j.cleared), bosses = j.cleared.filter(f => f.boss);
  const gold = n === 100 && j.legacyFloors === 0 && mastery >= .94 && mean(bosses) >= .9 && Math.max(...Object.values(s.style).map(rank)) >= 8;
  const tier: Tier = gold ? 'Gold' : n >= 65 ? 'Silver' : n >= 30 ? 'Bronze' : n >= 10 ? 'Iron' : 'Normal';
  const progress = tier === 'Silver' ? Math.min(.99, .7 + (n - 65) / 35 * .18 + mastery * .12) : tier === 'Gold' ? 1 : n / (n < 10 ? 10 : n < 30 ? 30 : 65);
  return { tier, progress, reason: tier === 'Silver' ? `Gold: complete the ascent, sustain 94% mastery (now ${Math.round(mastery * 100)}%), 90% boss mastery, and style rank 8. No repeat-floor credit.` : `${n}/100 floors proven. Growth follows completed encounters.` };
}
export const tierOf = (s: CapabilitySheet, _legacyLevel?: number): Tier => advancement(s).tier;
/** Stable, detached projection for the combined-game host. This describes an expedition;
 * callers must not treat a browser snapshot as authority to mutate a canonical World Person.
 */
export function towerSummary(s: CapabilitySheet) {
  const j = s.journey, a = advancement(s), c = emergentClass(s);
  return { version: 1 as const, seed: j?.seed ?? null, preview: !j || j.preview, legacy: (j?.legacyFloors ?? 0) > 0,
    completedFloors: (j?.legacyFloors ?? 0) + (j?.cleared.length ?? 0), fullClear: !j?.preview && (j?.legacyFloors ?? 0) + (j?.cleared.length ?? 0) === 100,
    ...levelOf(s), tier: a.tier, progress: a.progress, reason: a.reason, class: c ? { id: c.id, name: c.name, pattern: c.pattern } : null,
    activeSeconds: (j?.cleared.reduce((n, f) => n + f.seconds, 0) ?? 0) + (j?.current?.seconds ?? 0) };
}
export type TowerSummary = ReturnType<typeof towerSummary>;
export interface EmergedClass { id: string; name: string; pattern: string; boon: { stat: 'damage' | 'speed' | 'vitality' | 'affinity'; amount: number; element?: Element }; tier: Tier }
const STYLE_WORDS: Record<Style, [string, string]> = { fists: ['fist', 'Brawler'], blade: ['brand', 'Blademaster'], heavy: ['breaker', 'Warden'], axe: ['cleaver', 'Reaver'], bow: ['shot', 'Ranger'] };
const ELEMENT_WORDS: Record<Element, string> = { flame: 'Flame', frost: 'Rime', storm: 'Storm', swift: 'Gale', iron: 'Iron', shadow: 'Shade', verdance: 'Thorn', water: 'Tide', gravity: 'Grave', time: 'Chrono' };
export function emergentClass(s: CapabilitySheet, _legacyLevel?: number): EmergedClass | null {
  if (!s.journey || s.journey.preview || s.history.floors < 6) return null;
  const tier = tierOf(s), [style, points] = (Object.entries(s.style) as [Style, number][]).sort((a, b) => b[1] - a[1])[0], r = rank(points);
  if (r < 2) return null;
  if (style === 'fists' && r >= 4 && s.history.noWeaponFloors >= 12 && Object.entries(s.style).every(([k, v]) => k === 'fists' || rank(v) < 2))
    return { id: 'fists+ascetic', name: 'Iron Ascetic', pattern: 'unarmed mastery sustained through 12 floors', boon: { stat: 'damage', amount: .2 }, tier };
  const [element, value] = (Object.entries(s.affinity) as [Element, number][]).sort((a, b) => b[1] - a[1])[0];
  if (s.history.floors >= 18 && value >= 3) return { id: `${style}+${element}`, name: ELEMENT_WORDS[element] + STYLE_WORDS[style][0], pattern: `${style} ${r}, ${element} affinity ${value.toFixed(1)}, sustained history`, boon: { stat: 'affinity', amount: 1, element }, tier };
  return { id: style, name: STYLE_WORDS[style][1], pattern: `${style} rank ${r}, six proven floors`, boon: { stat: style === 'heavy' ? 'vitality' : style === 'bow' || style === 'fists' ? 'speed' : 'damage', amount: .1 }, tier };
}

/** Existing floor-start saves gain this field additively. Never infer past mastery from old XP. */
export function migrateJourney(s: CapabilitySheet, seed: number, floor: number, level = 1, xp = 0): boolean {
  if (s.journey) return false;
  startJourney(s, seed, false, Math.max(0, floor - 1));
  s.journey!.legacyExperience = Math.max(0, xp);
  for (let n = 1; n < Math.min(100, level); n++) s.journey!.legacyExperience += Math.round(220 * Math.pow(n, .8));
  return true;
}
export function validJourney(x: unknown): x is TowerJourney {
  if (!x || typeof x !== 'object') return false;
  const j = x as TowerJourney, finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (j.version !== 1 || !Number.isInteger(j.seed) || typeof j.preview !== 'boolean' || !finite(j.legacyExperience) || !j.skillPractice || typeof j.skillPractice !== 'object' || Array.isArray(j.skillPractice) || Object.keys(j.skillPractice).length > 200 || !Object.values(j.skillPractice).every(finite) || !Number.isInteger(j.legacyFloors) || j.legacyFloors < 0 || j.legacyFloors > 99 || !Array.isArray(j.cleared) || j.cleared.length + j.legacyFloors > 100) return false;
  if (j.cleared.some((f, i) => !f || f.floor !== j.legacyFloors + i + 1 || !finite(f.seconds) || !finite(f.enemies) || !finite(f.experience) || !finite(f.mastery) || f.mastery > 1 || typeof f.boss !== 'boolean' || typeof f.unarmed !== 'boolean')) return false;
  if (j.rewards !== undefined && (!Array.isArray(j.rewards) || j.rewards.length > 4040 || j.rewards.some(r => !r || !Number.isInteger(r.floor) || r.floor < (j.preview ? 0 : 1) || r.floor > 100 || typeof r.id !== 'string' || !r.id || r.id.length > 120) || new Set(j.rewards.map(r => `${r.floor}:${r.id}`)).size !== j.rewards.length)) return false;
  const c = j.current;
  return c === null || !!c && Number.isInteger(c.floor) && c.floor >= 1 && c.floor <= 100 && [c.seconds, c.damage, c.casts].every(finite) && typeof c.weaponUsed === 'boolean' && Array.isArray(c.targets) && c.targets.length <= 100 && new Set(c.targets.map(t => t.id)).size === c.targets.length && c.targets.every(t => typeof t.id === 'string' && typeof t.kind === 'string' && typeof t.boss === 'boolean' && typeof t.defeated === 'boolean' && finite(t.hp) && t.hp > 0 && finite(t.credited) && t.credited <= t.hp);
}
