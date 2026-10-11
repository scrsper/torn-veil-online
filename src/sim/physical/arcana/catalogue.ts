import type { Element, Style } from '../../progression/tower';

/**
 * Emergent skills. Nothing is chosen from a menu: every slotted skill comes from something the climber
 * absorbed, read or became.
 *   essence     an essence absorbed from a monster grants its ability (three essences form a confluence)
 *   confluence  the fourth, emergent essence: an ultimate composed from the three you hold
 *   book        a skill book teaches its skill permanently (re-reading one ranks it up)
 *   class       an emerged class grants a signature skill, tinted by its element
 *   scroll      one-shot: read with G, never slotted
 * Each skill is data over a small set of effect kernels the world knows how to run.
 */
export type Kernel = 'cone' | 'wave' | 'ward' | 'sigil' | 'nova' | 'chain' | 'dash' | 'heal' | 'frenzy' | 'spear' | 'volley' | 'meteor' | 'cataclysm' | 'bolt' | 'field' | 'imbue' | 'blink';
export type SkillSource = 'essence' | 'confluence' | 'book' | 'class' | 'scroll' | 'sign' | 'spell';
/** Status riders: elements, plus the two essences that are not elements. */
export type Rider = Element | 'bone' | 'blood';

export interface SkillDef {
  id: string; name: string; icon: string; color: string; text: string;
  kernel: Kernel; source: SkillSource;
  cost: number; cooldown: number;
  /** Riders applied on hit (burn, chill, chain, lifesteal...). */
  riders: Rider[];
  /** Effect multiplier; grows with affinity and rank. */
  power: number;
  /** Uses rank a skill up (practice is capability). */
  rank: number; uses: number;
  /** Spells: mana cost (instead of stamina), and the element and form they were shaped from. */
  mana?: number; element?: Element; form?: string;
}

const S = (id: string, name: string, icon: string, color: string, kernel: Kernel, cost: number, cooldown: number, riders: Rider[], text: string, source: SkillSource): SkillDef =>
  ({ id, name, icon, color, kernel, cost, cooldown, riders, text, source, power: 1, rank: 1, uses: 0 });
export const cloneSkill = (s: SkillDef): SkillDef => ({ ...s, riders: [...s.riders] });

// ---- the sandbox's four Witcher-style signs (the gym keeps them all unlocked) ----
export const SIGNS: SkillDef[] = [
  S('ember', 'Ember', '🔥', '#ff7a2e', 'cone', 22, 2.5, ['flame'], 'Cone of fire; burns', 'sign'),
  S('gust', 'Gust', '🌀', '#cfe8ff', 'wave', 25, 4, [], 'Force wave; knocks down, breaks guards', 'sign'),
  S('ward', 'Ward', '🛡️', '#7fb8ff', 'ward', 30, 10, [], 'Shield that absorbs damage', 'sign'),
  S('sigil', 'Frost Sigil', '❄️', '#8fdcff', 'sigil', 28, 7, ['frost'], 'Circle that chills and slows', 'sign'),
];

// ---- essences (He Who Fights With Monsters): absorbed from monsters, one ability each ----
export type Essence = 'fire' | 'ice' | 'storm' | 'swift' | 'iron' | 'shadow' | 'life' | 'bone' | 'blood' | 'water' | 'gravity' | 'time';
export const ESSENCES: Record<Essence, { name: string; color: string; element?: Element; skill: SkillDef }> = {
  fire: { name: 'Fire', color: '#ff7a2e', element: 'flame', skill: S('ess-fire', 'Immolate', '🔥', '#ff7a2e', 'nova', 26, 6, ['flame'], 'Burst of flame around you; burns', 'essence') },
  ice: { name: 'Ice', color: '#8fdcff', element: 'frost', skill: S('ess-ice', 'Rime Circle', '❄️', '#8fdcff', 'sigil', 26, 7, ['frost'], 'Freezing circle at the cursor; slows', 'essence') },
  storm: { name: 'Storm', color: '#c9a4ff', element: 'storm', skill: S('ess-storm', 'Chain Lightning', '⚡', '#c9a4ff', 'chain', 24, 4, ['storm'], 'Lightning leaps between nearby foes', 'essence') },
  swift: { name: 'Swift', color: '#b8ffcf', element: 'swift', skill: S('ess-swift', 'Blink Strike', '💨', '#b8ffcf', 'dash', 18, 3.5, ['swift'], 'Dash through foes, cutting all you pass', 'essence') },
  iron: { name: 'Iron', color: '#c0c6cf', element: 'iron', skill: S('ess-iron', 'Iron Skin', '🛡️', '#c0c6cf', 'ward', 28, 11, ['iron'], 'Skin of iron absorbs damage', 'essence') },
  shadow: { name: 'Shadow', color: '#8a6aa8', element: 'shadow', skill: S('ess-shadow', 'Shadow Step', '🌑', '#8a6aa8', 'dash', 20, 4.5, ['shadow'], 'Step through shadow; hits wound deeply', 'essence') },
  life: { name: 'Life', color: '#7fd36b', element: 'verdance', skill: S('ess-life', 'Mending', '✚', '#7fd36b', 'heal', 34, 14, ['verdance'], 'Restore a quarter of your health', 'essence') },
  bone: { name: 'Bone', color: '#e8dfc8', skill: S('ess-bone', 'Bone Spear', '🦴', '#e8dfc8', 'spear', 22, 3.5, ['bone'], 'A line of bone spikes erupts ahead', 'essence') },
  blood: { name: 'Blood', color: '#d1343e', skill: S('ess-blood', 'Blood Frenzy', '🩸', '#d1343e', 'frenzy', 20, 16, ['blood'], 'Faster, harder blows that drink life', 'essence') },
  water: { name: 'Water', color: '#4aa8ff', element: 'water', skill: S('ess-water', 'Drowning Tide', '🌊', '#4aa8ff', 'cone', 22, 5, ['water'], 'A crashing wave that soaks everything', 'essence') },
  gravity: { name: 'Gravity', color: '#7a5cff', element: 'gravity', skill: S('ess-gravity', 'Well of Weight', '🕳️', '#7a5cff', 'field', 28, 10, ['gravity'], 'A gravity well that drags foes together', 'essence') },
  time: { name: 'Time', color: '#ffd76a', element: 'time', skill: S('ess-time', 'Still Moment', '⏳', '#ffd76a', 'nova', 34, 14, ['time'], 'Everything near you slows almost to stillness', 'essence') },
};

/** Named confluences; any other trio composes a name from its parts. Order does not matter. */
const CONFLUENCES: { of: Essence[]; name: string; text: string }[] = [
  { of: ['bone', 'blood', 'shadow'], name: 'Doom', text: 'Death answers: a wave of ruin that bleeds all it touches' },
  { of: ['fire', 'storm', 'swift'], name: 'Wildfire', text: 'Flame on the wind: an inferno that leaps between foes' },
  { of: ['ice', 'storm', 'swift'], name: 'Tempest', text: 'A screaming storm of ice and lightning' },
  { of: ['iron', 'bone', 'life'], name: 'Undying', text: 'You will not stay down: a shockwave, then a shield and mending' },
  { of: ['fire', 'blood', 'iron'], name: 'Forge', text: 'Blood and iron in the furnace: a molten eruption' },
  { of: ['shadow', 'swift', 'blood'], name: 'Predator', text: 'The hunt made flesh: rend everything near you' },
  { of: ['life', 'fire', 'storm'], name: 'Sunbirth', text: 'A new sun kindles: burning light that heals you' },
  { of: ['ice', 'bone', 'shadow'], name: 'Crypt', text: 'The cold of the grave rises' },
];
const ROOT: Record<Essence, [string, string]> = {
  fire: ['Ember', 'blaze'], ice: ['Rime', 'frost'], storm: ['Thunder', 'storm'], swift: ['Gale', 'wind'], iron: ['Iron', 'heart'],
  shadow: ['Gloam', 'shade'], life: ['Green', 'bloom'], bone: ['Ossu', 'bone'], blood: ['Sanguine', 'blood'], water: ['Tide', 'deep'], gravity: ['Grave', 'well'], time: ['Aeon', 'hour'],
};
const riderOf = (e: Essence): Rider => ESSENCES[e].element ?? (e as 'bone' | 'blood');

/** Three essences form the confluence: an ultimate carrying every rider of its parts. */
export function confluence(held: Essence[]): { name: string; essenceText: string; skill: SkillDef } {
  const key = [...held].sort().join('+');
  const named = CONFLUENCES.find(c => [...c.of].sort().join('+') === key);
  const name = named?.name ?? ROOT[held[0]][0] + ROOT[held[2]][1];
  const colors = held.map(e => ESSENCES[e].color);
  const skill = S(`conf-${key}`, `${name} Unbound`, '✴️', colors[0], 'cataclysm', 45, 22, held.map(riderOf),
    named?.text ?? `${held.map(e => ESSENCES[e].name).join(', ')} made one: a cataclysm around you`, 'confluence');
  skill.power = 1.4;
  return { name, essenceText: named?.text ?? '', skill };
}

/** Which essences a monster can yield (its nature decides; HWFWM essences come from what they slay). */
export const FOE_ESSENCE: Record<string, Essence[]> = {
  goblin: ['swift', 'shadow'], goblin_archer: ['swift', 'storm'], orc: ['blood', 'iron'], orc_chief: ['blood', 'iron', 'fire'],
  skeleton: ['bone', 'shadow'], skeleton_mage: ['bone', 'ice', 'gravity'], skeleton_brute: ['bone', 'iron'],
  minion: ['bone'], warrior: ['iron', 'blood'], rogue: ['shadow', 'swift'], mage: ['fire', 'ice', 'storm', 'life', 'water'], chrysanthus: ['time'],
};

// ---- skill books: learn the element's skill; affinity +1 ----
export const BOOKS: Record<Element, { title: string; skill: SkillDef }> = {
  flame: { title: 'Tome of Kindled Wrath', skill: S('book-ember', 'Ember', '🔥', '#ff7a2e', 'cone', 22, 2.5, ['flame'], 'Cone of fire; burns', 'book') },
  frost: { title: 'Tome of the Long Winter', skill: S('book-sigil', 'Frost Sigil', '❄️', '#8fdcff', 'sigil', 28, 7, ['frost'], 'Circle that chills and slows', 'book') },
  storm: { title: 'Tome of Split Skies', skill: S('book-thunder', 'Thunderclap', '⚡', '#c9a4ff', 'nova', 26, 5, ['storm'], 'Thunder bursts around you and arcs outward', 'book') },
  swift: { title: 'Tome of the Quick Step', skill: S('book-gust', 'Gust', '🌀', '#cfe8ff', 'wave', 25, 4, ['swift'], 'Force wave; knocks down, breaks guards', 'book') },
  iron: { title: 'Tome of the Unbowed', skill: S('book-ward', 'Ward', '🛡️', '#7fb8ff', 'ward', 30, 10, ['iron'], 'Shield that absorbs damage', 'book') },
  shadow: { title: 'Tome of the Quiet Knife', skill: S('book-knife', 'Night Knife', '🗡️', '#8a6aa8', 'dash', 20, 4, ['shadow'], 'Vanish and strike from behind', 'book') },
  verdance: { title: 'Tome of Green Return', skill: S('book-mend', 'Green Return', '✚', '#7fd36b', 'heal', 34, 14, ['verdance'], 'Restore a quarter of your health', 'book') },
  water: { title: 'Tome of the Deep Current', skill: S('book-tide', 'Tidal Wave', '🌊', '#4aa8ff', 'cone', 22, 4, ['water'], 'A wave that soaks', 'book') },
  gravity: { title: 'Tome of Falling Stars', skill: S('book-well', 'Gravity Well', '🕳️', '#7a5cff', 'field', 28, 10, ['gravity'], 'A well that drags foes in', 'book') },
  time: { title: 'Tome of the Unwound Hour', skill: S('book-still', 'Still Moment', '⏳', '#ffd76a', 'nova', 34, 14, ['time'], 'Slow everything near you', 'book') },
};

// ---- scrolls: one strong cast, read with G ----
export const SCROLLS: SkillDef[] = [
  S('scroll-meteor', 'Scroll of Falling Star', '☄️', '#ff9a3c', 'meteor', 0, 0, ['flame'], 'A star falls on the cursor', 'scroll'),
  S('scroll-chain', 'Scroll of Forked Sky', '⚡', '#c9a4ff', 'chain', 0, 0, ['storm', 'storm'], 'Lightning forks through the room', 'scroll'),
  S('scroll-mend', 'Scroll of Mending', '✚', '#7fd36b', 'heal', 0, 0, ['verdance'], 'Heal a quarter of your health', 'scroll'),
  S('scroll-gust', 'Scroll of the Gale', '🌀', '#cfe8ff', 'wave', 0, 0, ['swift'], 'A gale hurls everything back', 'scroll'),
  S('scroll-bone', 'Scroll of the Ossuary', '🦴', '#e8dfc8', 'cataclysm', 0, 0, ['bone'], 'Bones erupt all around you', 'scroll'),
];
SCROLLS.forEach(s => { s.power = 1.6; });

// ---- class signatures: the class you became grants its skill ----
const SIGNATURE: Record<Style, SkillDef> = {
  fists: S('cls-fists', 'Hundred Fists', '👊', '#ffd45c', 'cone', 20, 5, [], 'A blur of blows ahead of you', 'class'),
  blade: S('cls-blade', 'Whirlwind', '🌪️', '#ffd45c', 'nova', 24, 6, [], 'Spin and cut everything around you', 'class'),
  heavy: S('cls-heavy', 'Earthsplitter', '⛰️', '#ffd45c', 'spear', 28, 7, [], 'Split the floor in a line; hurls foes', 'class'),
  axe: S('cls-axe', 'Reaving Cleave', '🪓', '#ffd45c', 'wave', 22, 5, ['blood'], 'A wide cleave that drinks blood', 'class'),
  bow: S('cls-bow', 'Volley', '🏹', '#ffd45c', 'volley', 22, 5, [], 'Loose an arrow at every foe ahead', 'class'),
};
export function signatureSkill(clsId: string, clsName: string, style: Style | 'ascetic', element?: Element): SkillDef {
  const s = cloneSkill(style === 'ascetic' ? S('cls-ascetic', 'Iron Body', '🧘', '#ffd45c', 'frenzy', 20, 14, ['iron'], 'Body of iron: harder blows, a skin that absorbs', 'class') : SIGNATURE[style]);
  s.id = `cls-${clsId}`; if (element) { s.riders.push(element); s.name = `${clsName}: ${s.name}`; }
  s.text += ` · signature of the ${clsName}`; s.power = 1.15;
  return s;
}

/** Slots grow with tier: the stronger you are measured to be, the more you can hold ready. */
export const SLOTS_BY_TIER = [2, 3, 4, 5, 6, 6, 6];
export const MAX_SLOTS = 7;   // six from tier, one more when a confluence forms
