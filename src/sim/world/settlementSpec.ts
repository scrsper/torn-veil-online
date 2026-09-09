import { RNG, valueNoise } from '../core/rng';
import type { Occupation, ItemType } from '../core/types';
import { TRADE_MAKES, TRADE_NEEDS, tradesThatMake } from './supply';
import { physiologyProfileFor } from '../core/species';

export interface SettlementSite { id: string; x: number; z: number; }
export interface GeneratedResident { key: string; name: string; gender: 'm' | 'f'; age: number; occupation: Occupation; household: number; parents: string[]; spouse?: string; wealth: number; }
export interface SettlementSpec {
  version: 1; site: SettlementSite; seed: number; name: string;
  biome: 'grassland' | 'woodland' | 'dryland'; moisture: number; relief: number;
  resources: { timber: number; stone: number; fields: number; foodReserve: number };
  roles: Occupation[]; residents: GeneratedResident[];
  history: { kind: 'debt' | 'quarrel'; a: string; b: string; daysAgo: number; amount: number }[];
}

/** Stable hash of the complete site tuple; independent of runtime RNG and insertion order. */
export function settlementSeed(worldSeed: number, site: SettlementSite): number {
  let h = 2166136261;
  for (const c of JSON.stringify([worldSeed, site.id, site.x, site.z])) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const GIVEN = ['Aster', 'Briar', 'Cora', 'Dain', 'Elowen', 'Flint', 'Galen', 'Hester', 'Iris', 'Jonas', 'Kael', 'Lark', 'Maren', 'Nico', 'Orla', 'Perrin', 'Rhea', 'Silas', 'Thora', 'Una', 'Wren', 'Yara'];
const SURNAMES = ['Alder', 'Brook', 'Cairn', 'Dale', 'Elm', 'Fen', 'Grove', 'Hart', 'Ives', 'Juniper', 'Keld', 'Linden', 'Moss', 'Nettle', 'Oak', 'Pike', 'Reed', 'Stone', 'Thorne', 'Vale'];

export function generateSettlementSpec(worldSeed: number, site: SettlementSite): SettlementSpec {
  if (!site.id || !Number.isSafeInteger(site.x) || !Number.isSafeInteger(site.z) || site.x < 0 || site.z < 0) throw new Error('Settlement sites require an ID and nonnegative integer coordinates');
  const seed = settlementSeed(worldSeed, site), rng = new RNG(seed);
  const moisture = rng.range(0.2, 0.85), relief = rng.int(1, 4);
  const biome = moisture < 0.4 ? 'dryland' : moisture > 0.65 ? 'woodland' : 'grassland';
  const fields = biome === 'grassland' ? rng.int(3, 5) : rng.int(1, 3);
  const resources = { timber: biome === 'woodland' ? rng.int(16, 24) : rng.int(4, 12), stone: rng.int(2, 7), fields, foodReserve: rng.int(5, 16) };
  // Expand selected consumption baskets through the existing process graph, including inputs.
  // Repeated primary producers represent site capacity; no separate occupation supply table.
  const roles: Occupation[] = [];
  const requireResource = (item: ItemType, visiting = new Set<Occupation>()) => {
    const occupation = tradesThatMake(item)[0];
    if (!occupation || visiting.has(occupation)) return;
    if (!roles.includes(occupation)) roles.push(occupation);
    const next = new Set(visiting).add(occupation);
    for (const input of TRADE_NEEDS[occupation] ?? []) requireResource(input, next);
  };
  for (const food of ['bread', 'stew', 'ale', 'herbs'] as ItemType[]) requireResource(food);
  for (let i = 1; i < fields; i++) roles.push(tradesThatMake('grain')[0]);
  if (biome === 'woodland') roles.push(tradesThatMake('log')[0], tradesThatMake('meat')[0]);
  if (biome === 'dryland') roles.push(tradesThatMake('meat')[0]);
  rng.shuffle(roles);
  const residents: GeneratedResident[] = [];
  const familyNames = rng.shuffle([...SURNAMES]);
  const names = new Set<string>();
  const add = (household: number, gender: 'm' | 'f', age: number, occupation: Occupation, parents: string[] = []) => {
    const base = `${rng.pick(GIVEN)} ${familyNames[household % familyNames.length]}`;
    let name = base, suffix = 2; while (names.has(name)) name = `${base} ${suffix++}`; names.add(name);
    const p: GeneratedResident = { key: `person_${residents.length}`, name, household, gender, age, occupation, parents, wealth: age < 18 ? 0 : rng.int(15, 95) };
    residents.push(p); return p;
  };
  let household = 0;
  for (let i = 0; i < roles.length;) {
    const a = add(household, rng.pick(['m', 'f'] as const), rng.int(26, 62), roles[i++]);
    if (i < roles.length && rng.chance(0.7)) {
      const b = add(household, a.gender === 'm' ? 'f' : 'm', Math.max(24, a.age + rng.int(-6, 6)), roles[i++]);
      a.spouse = b.key; b.spouse = a.key;
      const count = rng.int(0, 3);
      const mother = a.gender === 'f' ? a : b, father = a.gender === 'm' ? a : b;
      const fertility = physiologyProfileFor('human').fertileAges;
      const youngest = Math.max(1, mother.age - fertility.gestational[1], father.age - fertility.fertilizing[1]);
      const oldest = Math.min(16, mother.age - fertility.gestational[0] - 1, father.age - fertility.fertilizing[0] - 1);
      const ages = oldest >= youngest ? rng.shuffle(Array.from({ length: oldest - youngest + 1 }, (_, i) => youngest + i)) : [];
      for (const age of ages.slice(0, count)) add(household, rng.pick(['m', 'f'] as const), age, 'child', [mother.key, father.key]);
    }
    if (rng.chance(0.25)) { const elder = add(household, rng.pick(['m', 'f'] as const), a.age + rng.int(20, 28), 'elder'); a.parents.push(elder.key); }
    household++;
  }
  const adults = residents.filter(p => p.age >= 18);
  const history: SettlementSpec['history'] = [];
  for (let i = 0, n = rng.int(3, 9); i < n; i++) {
    const a = rng.pick(adults), choices = adults.filter(b => b.household !== a.household);
    if (!choices.length) continue;
    history.push({ kind: rng.chance(0.5) ? 'debt' : 'quarrel', a: a.key, b: rng.pick(choices).key, daysAgo: rng.int(2, 300), amount: rng.int(3, 12) });
  }
  if (roles.some(o => !TRADE_MAKES[o])) throw new Error('Unbacked generated occupation');
  return { version: 1, site: { ...site }, seed, name: `${rng.pick(SURNAMES)}${rng.pick(['ford', 'mere', 'wick', 'haven', 'stead'])}`, biome, moisture, relief, resources, roles, residents, history };
}

export const SETTLEMENT_SIZE = 240;
export function settlementHeight(spec: SettlementSpec, x: number, z: number): number {
  return 12 + Math.floor(spec.relief * valueNoise(x / 80, z / 80, spec.seed));
}
/** At 3.4 m/physical second and the ordinary 60x world clock, even nonstop walking
 * between these sites takes over 500 world years. There are no roads or travel supplies. */
export const ISOLATED_SITES: readonly SettlementSite[] = [0, 1, 2, 3].map(i => ({ id: `site_${i}`, x: 256 + i * 1_000_000_000, z: 128 }));
