import type { WeaponId } from '../combat';
import type { Element, Style } from './capability';
import { BOOKS, ESSENCES, FOE_ESSENCE, SCROLLS, cloneSkill, type Essence, type SkillDef } from './skills';
import { ALL_ELEMENTS, ALL_FORMS, ELEMENT_INFO, FORMS, POTIONS, type Form, type PotionKind } from '../magic';

/**
 * Tower loot, Diablo-style: every weapon, armour and charm rolls a rarity, random affixes scaled by the
 * floor, and (legendary up) a named power that changes how you fight. Rares get generated names.
 * Weapons are the user's Torn Veil Arsenal meshes; each fights with a moveset and trains a style.
 * Essences, skill books and scrolls are the skill economy (skills.ts).
 */
export const RARITY = ['Common', 'Magic', 'Rare', 'Legendary', 'Mythic'] as const;
export const RARITY_COLOR = ['#e8e8e8', '#5aa8ff', '#ffd45c', '#ff8c2e', '#ff5ad1'];

export type Stat = 'dmg' | 'atk' | 'move' | 'life' | 'leech' | 'crit' | 'cdr' | 'armor' | 'thorns' | 'flask' | `aff:${Element}`;
export interface Affix { stat: Stat; value: number }
export type Power = 'pyre' | 'thunder' | 'thirst' | 'echo' | 'winter' | 'bulwark' | 'reaper' | 'avalanche';
export const POWERS: Record<Power, { name: string; text: string }> = {
  pyre: { name: 'Funeral Pyre', text: 'Foes you kill burst into flame' },
  thunder: { name: 'Thunderhead', text: 'Every 6th blow calls chain lightning' },
  thirst: { name: 'Red Thirst', text: 'Kills restore 5% of your life' },
  echo: { name: 'Echoing Rune', text: 'Skills have a 30% chance not to go on cooldown' },
  winter: { name: "Winter's Teeth", text: 'Blows against chilled foes always crit' },
  bulwark: { name: 'Bulwark of Ages', text: 'A parry raises a ward' },
  reaper: { name: 'Reaper’s Due', text: 'Kills shorten every cooldown by 1 second' },
  avalanche: { name: 'Avalanche', text: 'Heavy blows send out a shockwave' },
};

interface Base { item: number; rarity: number; affixes: Affix[]; power?: Power; score: number }
export type Item =
  | ({ kind: 'weapon'; id: string; name: string; base: string; slot: WeaponId; mesh: string; hand: 'r' | 'l'; style: Style; element?: Element } & Base)
  | ({ kind: 'armor'; id: string; name: string; base: string; reduction: number } & Base)
  | ({ kind: 'charm'; id: string; name: string; base: string } & Base)
  | { kind: 'book'; id: string; name: string; element: Element; skill: SkillDef }
  | { kind: 'scroll'; id: string; name: string; skill: SkillDef }
  | { kind: 'essence'; id: string; name: string; essence: Essence }
  | { kind: 'potion'; id: string; name: string; heal: number }
  /** Magic: a treatise teaches a form; a runestone imbues the drawn weapon for good; elixirs go on the belt (V). */
  | { kind: 'treatise'; id: string; name: string; form: Form }
  | { kind: 'rune'; id: string; name: string; element: Element }
  | { kind: 'elixir'; id: string; name: string; potion: PotionKind; element?: Element };
export type Gear = Extract<Item, { kind: 'weapon' | 'armor' | 'charm' }>;

const W = (id: string, name: string, slot: WeaponId, mesh: string, style: Style, hand: 'r' | 'l' = 'r') => ({ id, name, slot, mesh: `W_${mesh}`, style, hand });
export const WEAPON_BASES = [
  W('oathbreaker', 'Oathbreaker', 'greatsword', 'oathbreaker', 'heavy'),
  W('execution-standard', 'Execution Standard', 'greatsword', 'execution-standard', 'heavy'),
  W('bell-of-ruin', 'Bell of Ruin', 'greatsword', 'bell-of-ruin', 'heavy'),
  W('veilguard', 'Veilguard', 'axe', 'veilguard', 'blade'),
  W('crimson-duel', 'Crimson Duel', 'axe', 'crimson-duel', 'blade'),
  W('serpent-tooth', 'Serpent Tooth', 'axe', 'serpent-tooth', 'blade'),
  W('widow-cleaver', 'Widow Cleaver', 'axe', 'widow-cleaver', 'axe'),
  W('ashwood-sentinel', 'Ashwood Sentinel', 'bow', 'ashwood-sentinel', 'bow', 'l'),
  W('briar-whisper', 'Briar Whisper', 'bow', 'briar-whisper', 'bow', 'l'),
];
/** Every arsenal mesh the tower may need loaded. */
export const ARSENAL_KEYS = [...new Set(WEAPON_BASES.map(w => w.mesh.slice(2))), 'night-thorn', 'elderroot', 'codex-of-the-veil'];

export const ELEMENT_COLOR: Record<Element, string> = { flame: '#ff7a2e', frost: '#8fdcff', storm: '#b9a4ff', swift: '#c8ffe0', iron: '#c9a77a', shadow: '#9a6ad0', verdance: '#7fd36b', water: '#4aa8ff', gravity: '#7a5cff', time: '#ffd76a' };
const ARMORS = ['Padded Jerkin', 'Leather Brigandine', 'Riveted Hauberk', 'Lamellar Coat', 'Wardplate'];
const CHARMS = ['Bone Charm', 'Iron Ring', 'Amber Amulet', 'Saint’s Knuckle', 'Veil Locket'];

// Affix ranges per unit of item level; the floor sets item level.
const AFFIX: Record<string, { lo: number; hi: number; word: [string, string]; fmt: (v: number) => string }> = {
  dmg: { lo: .04, hi: .09, word: ['Cruel', 'of Slaughter'], fmt: v => `+${pct(v)} damage` },
  atk: { lo: .03, hi: .06, word: ['Quick', 'of Haste'], fmt: v => `+${pct(v)} attack speed` },
  move: { lo: .03, hi: .05, word: ['Fleet', 'of the Hare'], fmt: v => `+${pct(v)} movement` },
  life: { lo: .04, hi: .08, word: ['Stout', 'of the Bear'], fmt: v => `+${pct(v)} maximum life` },
  leech: { lo: .006, hi: .014, word: ['Thirsting', 'of the Leech'], fmt: v => `${pct(v, 1)} life per hit` },
  crit: { lo: .015, hi: .035, word: ['Keen', 'of Precision'], fmt: v => `+${pct(v, 1)} critical chance` },
  cdr: { lo: .025, hi: .05, word: ['Arcane', 'of Recall'], fmt: v => `${pct(v)} cooldown reduction` },
  armor: { lo: .02, hi: .04, word: ['Plated', 'of Warding'], fmt: v => `${pct(v)} damage taken reduced` },
  thorns: { lo: .04, hi: .09, word: ['Barbed', 'of Thorns'], fmt: v => `${pct(v)} damage reflected` },
  flask: { lo: 1, hi: 1, word: ['Brewer’s', 'of Plenty'], fmt: () => '+1 flask charge' },
};
const ELEMENT_WORD: Record<Element, [string, string]> = { flame: ['Smouldering', 'of Embers'], frost: ['Rimed', 'of Winter'], storm: ['Thundering', 'of Storms'], swift: ['Galeborn', 'of Wind'], iron: ['Ironbound', 'of the Anvil'], shadow: ['Gloaming', 'of Night'], verdance: ['Verdant', 'of Spring'], water: ['Tidal', 'of the Deep'], gravity: ['Heavy', 'of the Abyss'], time: ['Timeless', 'of Ages'] };
const CAP: Partial<Record<string, number>> = { crit: .5, cdr: .45, armor: .5, leech: .08 };
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

/** Generated names for rares (Diablo's two-word names), and legendary uniques. */
const RARE_A = ['Grim', 'Doom', 'Storm', 'Blood', 'Ghoul', 'Rune', 'Wraith', 'Bone', 'Dread', 'Hate', 'Gale', 'Grave', 'Viper', 'Raven', 'Shadow', 'Ash', 'Iron', 'Soul'];
const RARE_B: Record<string, string[]> = {
  weapon: ['Bite', 'Song', 'Edge', 'Fang', 'Scalpel', 'Reaver', 'Call', 'Thirst', 'Mangler', 'Spike'],
  armor: ['Shell', 'Hide', 'Carapace', 'Coat', 'Mantle', 'Wrap', 'Guard'],
  charm: ['Eye', 'Heart', 'Coil', 'Knot', 'Star', 'Loop', 'Mark'],
};

export const affixText = (a: Affix): string => a.stat.startsWith('aff:') ? `+${a.value} ${a.stat.slice(4)} affinity` : AFFIX[a.stat].fmt(a.value);
export const describe = (it: Gear): string => [...it.affixes.map(affixText), ...(it.power ? [`★ ${POWERS[it.power].name}: ${POWERS[it.power].text}`] : [])].join(' · ');

let serial = 0;
/** Rarity roll: deeper floors and better sources shift the odds up (Diablo's magic find). */
export function rollRarity(floor: number, rnd: () => number, bonus = 0): number {
  const r = rnd() - floor * .003 - bonus * .05;
  // Mythics only from floor 25; below that the roll caps at legendary.
  return r < .008 ? (floor >= 25 ? 4 : 3) : r < .045 ? 3 : r < .22 ? 2 : r < .55 ? 1 : 0;
}

function rollAffixes(n: number, ilvl: number, rnd: () => number, slot: 'weapon' | 'armor' | 'charm'): Affix[] {
  const pool = slot === 'weapon' ? ['dmg', 'dmg', 'atk', 'crit', 'leech', 'cdr', 'aff'] : slot === 'armor' ? ['life', 'life', 'armor', 'thorns', 'move', 'aff', 'flask'] : ['crit', 'cdr', 'move', 'leech', 'life', 'aff', 'aff', 'atk'];
  const out: Affix[] = [];
  for (let k = 0; k < n * 4 && out.length < n; k++) {
    const id = pool[Math.floor(rnd() * pool.length)];
    if (id === 'aff') { const e = (Object.keys(ELEMENT_COLOR) as Element[])[Math.floor(rnd() * 7)]; const stat = `aff:${e}` as Stat; if (!out.some(a => a.stat === stat)) out.push({ stat, value: 1 + (ilvl > 2.2 && rnd() < .3 ? 1 : 0) }); continue; }
    if (out.some(a => a.stat === id)) continue;
    const d = AFFIX[id], v = id === 'flask' ? 1 : (d.lo + (d.hi - d.lo) * rnd()) * ilvl;
    out.push({ stat: id as Stat, value: Math.min(CAP[id] ?? 9, +v.toFixed(3)) });
  }
  return out;
}

/** Rough worth for auto-equip decisions: rarity, item level, affix count, a power. */
const worth = (rarity: number, item: number, affixes: Affix[], power?: Power) => item * (1 + rarity * .22) + affixes.length * .35 + (power ? 2 : 0);

export function rollGear(floor: number, rnd: () => number, bonus = 0, kind?: 'weapon' | 'armor' | 'charm'): Gear {
  const rarity = rollRarity(floor, rnd, bonus), ilvl = 1 + floor * .06 + bonus * .15;
  const k = kind ?? (rnd() < .5 ? 'weapon' : rnd() < .55 ? 'armor' : 'charm');
  const n = [0, 1 + (rnd() < .5 ? 1 : 0), 3 + (rnd() < .4 ? 1 : 0), 3, 4][rarity];
  const affixes = rollAffixes(n, ilvl, rnd, k);
  const powers = Object.keys(POWERS) as Power[];
  const power = rarity >= 3 ? powers[Math.floor(rnd() * powers.length)] : undefined;
  const id = `${k}#${++serial}`;
  const name = (base: string) => {
    if (rarity === 0) return base;
    if (rarity >= 3) return `${POWERS[power!].name}${rarity === 4 ? ' Eternal' : ''}`;
    if (rarity === 2) return `${RARE_A[Math.floor(rnd() * RARE_A.length)]} ${RARE_B[k][Math.floor(rnd() * RARE_B[k].length)]}`;
    const w = (a: Affix) => a.stat.startsWith('aff:') ? ELEMENT_WORD[a.stat.slice(4) as Element] : AFFIX[a.stat].word;
    return `${w(affixes[0])[0]} ${base}${affixes[1] ? ' ' + w(affixes[1])[1] : ''}`;
  };
  const score = worth(rarity, ilvl, affixes, power);
  if (k === 'weapon') {
    const b = WEAPON_BASES[Math.floor(rnd() * WEAPON_BASES.length)];
    const elAff = affixes.find(a => a.stat.startsWith('aff:'));
    return { kind: 'weapon', ...b, id, base: b.name, name: name(b.name), item: ilvl, rarity, affixes, power, score, element: elAff ? elAff.stat.slice(4) as Element : undefined };
  }
  if (k === 'armor') { const t = Math.min(4, Math.floor(floor / 22 + rnd() * 1.2)), base = ARMORS[t]; return { kind: 'armor', id, base, name: name(base), item: ilvl, rarity, affixes, power, score, reduction: .05 + t * .045 }; }
  const base = CHARMS[Math.floor(rnd() * CHARMS.length)];
  return { kind: 'charm', id, base, name: name(base), item: ilvl, rarity, affixes, power, score };
}

export function rollBook(rnd: () => number): Item {
  const e = (Object.keys(BOOKS) as Element[])[Math.floor(rnd() * 7)];
  return { kind: 'book', id: `book#${++serial}`, name: BOOKS[e].title, element: e, skill: cloneSkill(BOOKS[e].skill) };
}
export function rollScroll(rnd: () => number): Item {
  const s = SCROLLS[Math.floor(rnd() * SCROLLS.length)];
  return { kind: 'scroll', id: `scroll#${++serial}`, name: s.name, skill: cloneSkill(s) };
}
export function rollTreatise(rnd: () => number, known: string[] = []): Item {
  const left = ALL_FORMS.filter(f => !known.includes(f)), pool = left.length ? left : ALL_FORMS;
  const f = pool[Math.floor(rnd() * pool.length)];
  return { kind: 'treatise', id: `treatise#${++serial}`, name: FORMS[f].treatise, form: f };
}
/** Time is not found lying about the tower: only its god teaches it. */
const FOUND = ALL_ELEMENTS.filter(e => e !== 'time');
export function rollElementTome(rnd: () => number): Item {
  const e = FOUND[Math.floor(rnd() * FOUND.length)];
  return { kind: 'book', id: `book#${++serial}`, name: BOOKS[e].title, element: e, skill: cloneSkill(BOOKS[e].skill) };
}
export function rollRune(rnd: () => number): Item {
  const e = FOUND[Math.floor(rnd() * FOUND.length)];
  return { kind: 'rune', id: `rune#${++serial}`, name: `Runestone of ${ELEMENT_INFO[e].name}`, element: e };
}
export function rollElixir(rnd: () => number): Item {
  const ks = Object.keys(POTIONS) as PotionKind[], k = ks[Math.floor(rnd() * ks.length)];
  if (k === 'elemental') { const e = FOUND[Math.floor(rnd() * FOUND.length)]; return { kind: 'elixir', id: `elixir#${++serial}`, name: `Elixir of ${ELEMENT_INFO[e].name}`, potion: k, element: e }; }
  return { kind: 'elixir', id: `elixir#${++serial}`, name: POTIONS[k].name, potion: k };
}
export function essenceItem(e: Essence): Item { return { kind: 'essence', id: `essence#${++serial}`, name: `${ESSENCES[e].name} Essence`, essence: e }; }

export type Source = 'enemy' | 'elite' | 'chest' | 'boss' | 'box';
/**
 * Drops by source. Enemies rarely drop; chests and bosses always do; essences come from what the monster
 * is (a goblin yields swift or shadow, a skeleton bone). `boxTier` is a DCC loot box's tier (0..5).
 */
export function rollLoot(floor: number, rnd: () => number, source: Source, foeKind?: string, boxTier = 0): Item[] {
  const out: Item[] = [];
  const bonus = source === 'boss' ? 1.2 : source === 'chest' ? .5 : source === 'elite' ? .5 : source === 'box' ? boxTier * .45 : 0;
  const n = source === 'boss' ? 3 : source === 'chest' ? 1 + (rnd() < .4 ? 1 : 0) : source === 'box' ? 1 + Math.floor(boxTier / 2) : 1;
  const chance = source === 'enemy' ? .14 : source === 'elite' ? .6 : 1;
  for (let i = 0; i < n; i++) {
    if (rnd() > chance) continue;
    const r = rnd();
    if (r < .44) out.push(rollGear(floor, rnd, bonus));
    else if (r < .56) out.push(rollElementTome(rnd));
    else if (r < .66) out.push(rollTreatise(rnd));
    else if (r < .74) out.push(rollScroll(rnd));
    else if (r < .88) out.push(rollElixir(rnd));
    else if (r < .92) out.push(rollRune(rnd));
    else out.push({ kind: 'potion', id: `potion#${++serial}`, name: 'Draught of Mending', heal: .35 });
  }
  // Essences: rare from the rank and file, likely from bosses; always in the best boxes.
  const ess = foeKind ? FOE_ESSENCE[foeKind] : undefined;
  const ec = source === 'boss' ? .3 : source === 'elite' ? .05 : source === 'enemy' ? .012 : source === 'box' ? (boxTier >= 5 ? 1 : boxTier === 4 ? .5 : boxTier * .05) : 0;
  if (rnd() < ec) {
    const pool = ess ?? (Object.keys(ESSENCES) as Essence[]);
    out.push(essenceItem(pool[Math.floor(rnd() * pool.length)]));
  }
  return out;
}
