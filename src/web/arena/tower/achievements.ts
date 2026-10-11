/**
 * Achievements and loot boxes, after Dungeon Crawler Carl: the tower's system voice notices what you
 * do, names it, mocks you a little, and awards a tiered box that opens when the floor is clear (the
 * floor's safe moment). Box tier sets the loot's quality; Legendary and Celestial boxes hold essences.
 */
export const BOX_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Legendary', 'Celestial'] as const;
export const BOX_COLOR = ['#c8874a', '#dfe6ee', '#ffd45c', '#9fe8ff', '#ff8c2e', '#ff5ad1'];

/** What the run has counted so far; the tower updates it, achievements read it. */
export interface RunStats {
  kills: number; fistKills: number; bestCombo: number; parries: number; smashed: number; bosses: number;
  floor: number; essences: number; confluences: number; legendaries: number; scrolls: number; books: number;
  multikill: number; flawlessFloors: number; nearDeath: number; classes: number; skillCasts: number; burnKills: number; skeletons: number; goblins: number; orcs: number;
}
export const newStats = (): RunStats => ({ kills: 0, fistKills: 0, bestCombo: 0, parries: 0, smashed: 0, bosses: 0, floor: 1, essences: 0, confluences: 0, legendaries: 0, scrolls: 0, books: 0, multikill: 0, flawlessFloors: 0, nearDeath: 0, classes: 0, skillCasts: 0, burnKills: 0, skeletons: 0, goblins: 0, orcs: 0 });

export interface Achievement { id: string; name: string; text: string; box: number; test: (s: RunStats) => boolean }
const A = (id: string, name: string, box: number, text: string, test: (s: RunStats) => boolean): Achievement => ({ id, name, box, text, test });

export const ACHIEVEMENTS: Achievement[] = [
  A('first-blood', 'First Blood!', 0, 'You killed something. It probably had a family. The viewers do not care.', s => s.kills >= 1),
  A('knuckles', 'Bare Knuckle Enthusiast', 0, 'Ten kills with nothing but your fists. Someone get this crawler a sword. Or don’t; this is funnier.', s => s.fistKills >= 10),
  A('knuckles-50', 'Fist of the Tower', 2, 'Fifty kills by hand. You are now legally a weapon in most jurisdictions.', s => s.fistKills >= 50),
  A('combo-10', 'Rhythm Section', 0, 'A ten-hit combo. Your opponent experienced all of them.', s => s.bestCombo >= 10),
  A('combo-25', 'Unbroken Chain', 1, 'Twenty-five hits without a breath. The audience is on its feet.', s => s.bestCombo >= 25),
  A('combo-50', 'The Blender', 3, 'Fifty consecutive hits. That is not a fight, that is a kitchen appliance.', s => s.bestCombo >= 50),
  A('parry', 'Not Today', 0, 'You parried. Timing is a virtue the tower rarely rewards. Today it does.', s => s.parries >= 1),
  A('parry-10', 'Wall of Spite', 2, 'Ten parries. The monsters have started a support group.', s => s.parries >= 10),
  A('smash', 'Property Damage', 0, 'Twenty pieces of furniture destroyed. The tower bills by the barrel.', s => s.smashed >= 20),
  A('multikill', 'Three for One', 1, 'Three kills in under two seconds. Efficiency is its own kind of cruelty.', s => s.multikill >= 3),
  A('multikill-5', 'Pentakill Is Not a Real Word', 3, 'Five kills in two seconds. It is now.', s => s.multikill >= 5),
  A('boss', 'Giant Slayer', 1, 'Your first boss. It was very big. You were very rude to it.', s => s.bosses >= 1),
  A('boss-5', 'Management Problems', 3, 'Five bosses. The tower is having trouble keeping the position filled.', s => s.bosses >= 5),
  A('flawless', 'Untouchable', 1, 'A floor cleared without taking a single hit. Show-off.', s => s.flawlessFloors >= 1),
  A('near-death', 'Not Dead Yet', 1, 'You cleared a floor on a sliver of life. The viewers had money on you dying.', s => s.nearDeath >= 1),
  A('essence', 'You Are What You Kill', 2, 'You absorbed an essence. Something of the monster lives in you now. Try not to think about it.', s => s.essences >= 1),
  A('confluence', 'Confluence', 4, 'Three essences became a fourth. You are no longer entirely what you were.', s => s.confluences >= 1),
  A('legendary', 'Shiny!', 2, 'A legendary item. Orange. The colour of a good day.', s => s.legendaries >= 1),
  A('class', 'Self-Made', 1, 'A class emerged from what you actually do. Nobody chose it for you. Not even you.', s => s.classes >= 1),
  A('class-3', 'Identity Crisis', 2, 'Your third class this climb. Who are you? The tower would also like to know.', s => s.classes >= 3),
  A('scrolls', 'Light Reading', 0, 'Five scrolls read. Literacy: the deadliest weapon.', s => s.scrolls >= 5),
  A('books', 'Bookworm', 1, 'Three skill books. You learn things by reading them, which is cheating, but allowed.', s => s.books >= 3),
  A('pyro', 'Smells Like Victory', 1, 'Ten foes died while on fire. Please ventilate the floor.', s => s.burnKills >= 10),
  A('skeletons', 'Funny Bones', 1, 'Twenty skeletons returned to being a pile. They were already dead. You were thorough.', s => s.skeletons >= 20),
  A('goblins', 'Pest Control', 1, 'Thirty goblins. The tower’s goblin population thanks you for the vacancies.', s => s.goblins >= 30),
  A('orcs', 'Tusk Collector', 2, 'Fifteen orcs. Big, angry and now horizontal.', s => s.orcs >= 15),
  A('floor-10', 'Getting Somewhere', 1, 'Floor 10. Most crawlers never see it. Most crawlers are dead.', s => s.floor >= 10),
  A('floor-25', 'Quarter Mark', 2, 'Floor 25. The tower widens. So should your eyes.', s => s.floor >= 25),
  A('floor-50', 'Halfway to a God', 3, 'Floor 50. The gods have started learning your name.', s => s.floor >= 50),
  A('floor-75', 'The Thin Air', 4, 'Floor 75. Few have breathed this high.', s => s.floor >= 75),
  A('floor-100', 'Chrysanthus', 5, 'The summit. The tower has nothing left to teach you, and it is a little afraid.', s => s.floor >= 100),
];

// Lifetime record of earned achievements (this browser), kept beside the class codex.
const KEY = 'tv.tower.achievements.v1';
const RECORDS = 'tv.tower.achievements.v2';
function records(): { counts: Record<string,number>; receipts: string[] } { try { const saved = localStorage.getItem(RECORDS); if (saved) return JSON.parse(saved); } catch { /* recover from legacy */ } return { counts: legacyEarned(), receipts: [] }; }
function legacyEarned(): Record<string, number> { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } }
export function loadEarned(): Record<string,number> { return records().counts; }
export function recordEarned(id: string, receipt?: string): boolean {
  const state = records(), e = state.counts; if (receipt && state.receipts.includes(receipt)) return false;
  const first = !e[id]; e[id] = (e[id] ?? 0) + 1; if (receipt) state.receipts.push(receipt);
  try { localStorage.setItem(RECORDS, JSON.stringify(state)); } catch { /* private mode */ }
  return first;
}
