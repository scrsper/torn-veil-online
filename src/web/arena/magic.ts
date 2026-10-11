import type { Element } from './tower/capability';
import type { Kernel, SkillDef } from './tower/skills';

/**
 * The magic of the Tower of Chrysanthus (Constitution §12, §29, §30).
 *
 * Magic is capability, not a menu. A spell is an ELEMENT (an affinity the climber holds) shaped by a FORM (a way of
 * shaping mana they have learned). Any element that reaches affinity 1, crossed with any known form, gives a spell
 * that dawns on the climber as an insight. So the spellbook grows out of what you absorbed, read and practised:
 *   10 elements x 8 forms = 80 spells, each named, each with its element's behaviour.
 * Elements interact through the statuses they leave (wet, burning, chilled, frozen, shocked, slowed, gathered),
 * so combinations emerge in play: soak then shock, soak then freeze, freeze then burn, gather then burst.
 *
 * Mechanical truth vs interpretation (§30): each floor has a ley element whose mana runs strong there; the tower
 * reports it in its scholars' terms (a measured output), while its shrines call it a god's favour.
 */
export const ELEMENT_INFO: Record<Element, { name: string; color: string; glyph: string; text: string }> = {
  flame: { name: 'Fire', color: '#ff7a2e', glyph: '🔥', text: 'burns; melts the frozen for a shatter' },
  frost: { name: 'Ice', color: '#8fdcff', glyph: '❄️', text: 'chills; freezes the wet solid' },
  storm: { name: 'Lightning', color: '#b9a4ff', glyph: '⚡', text: 'shocks and arcs; electrocutes the wet' },
  swift: { name: 'Wind', color: '#c8ffe0', glyph: '🌀', text: 'hurls and lifts; fans flames to neighbours' },
  iron: { name: 'Earth', color: '#c9a77a', glyph: '🪨', text: 'staggers and breaks guards; stone skin' },
  shadow: { name: 'Shadow', color: '#9a6ad0', glyph: '🌑', text: 'deep wounds; strikes the unaware harder' },
  verdance: { name: 'Life', color: '#7fd36b', glyph: '🌿', text: 'heals you from what it harms; roots' },
  water: { name: 'Water', color: '#4aa8ff', glyph: '💧', text: 'soaks (wet); douses fire into blinding steam' },
  gravity: { name: 'Gravity', color: '#7a5cff', glyph: '🕳️', text: 'gathers foes to a point; crushes the gathered' },
  time: { name: 'Time', color: '#ffd76a', glyph: '⏳', text: 'slows a body’s whole motion; ruptures the slowed' },
};
export const ALL_ELEMENTS = Object.keys(ELEMENT_INFO) as Element[];

export type Form = 'bolt' | 'nova' | 'wave' | 'field' | 'lance' | 'weave' | 'ward' | 'step';
export const FORMS: Record<Form, { name: string; treatise: string; kernel: Kernel; mana: number; cooldown: number; text: string }> = {
  bolt: { name: 'Bolt', treatise: 'Treatise on the Bolt', kernel: 'bolt', mana: 10, cooldown: .55, text: 'a fast missile at the cursor' },
  nova: { name: 'Nova', treatise: 'Treatise on the Nova', kernel: 'nova', mana: 24, cooldown: 6, text: 'a burst all around you' },
  wave: { name: 'Wave', treatise: 'Treatise on the Wave', kernel: 'cone', mana: 18, cooldown: 3, text: 'a cone ahead of you' },
  field: { name: 'Field', treatise: 'Treatise on Fields', kernel: 'field', mana: 26, cooldown: 9, text: 'a lasting zone at the cursor' },
  lance: { name: 'Lance', treatise: 'Treatise on the Lance', kernel: 'spear', mana: 20, cooldown: 4, text: 'a piercing line' },
  weave: { name: 'Weave', treatise: 'Treatise on Weaving', kernel: 'imbue', mana: 22, cooldown: 16, text: 'imbues your weapon for 20 seconds' },
  ward: { name: 'Ward', treatise: 'Treatise on Wards', kernel: 'ward', mana: 22, cooldown: 12, text: 'a protective working on yourself' },
  step: { name: 'Step', treatise: 'Treatise on the Step', kernel: 'blink', mana: 14, cooldown: 3, text: 'move through space to the cursor' },
};
export const ALL_FORMS = Object.keys(FORMS) as Form[];

const NAMES: Record<Element, Record<Form, string>> = {
  flame: { bolt: 'Firebolt', nova: 'Immolation', wave: 'Dragon’s Breath', field: 'Pyre Field', lance: 'Flame Lance', weave: 'Flame Weave', ward: 'Ember Ward', step: 'Flamestep' },
  frost: { bolt: 'Ice Shard', nova: 'Frost Nova', wave: 'Cone of Cold', field: 'Frozen Ground', lance: 'Glacial Spear', weave: 'Frost Weave', ward: 'Ice Barrier', step: 'Rime Step' },
  storm: { bolt: 'Lightning Bolt', nova: 'Thunderclap', wave: 'Forked Lightning', field: 'Thunderhead', lance: 'Lightning Spear', weave: 'Storm Weave', ward: 'Static Ward', step: 'Lightning Step' },
  swift: { bolt: 'Wind Blade', nova: 'Cyclone', wave: 'Gale', field: 'Tornado', lance: 'Piercing Gust', weave: 'Wind Weave', ward: 'Wind Wall', step: 'Zephyr Step' },
  iron: { bolt: 'Stone Bullet', nova: 'Earthquake', wave: 'Rockslide', field: 'Stone Spikes', lance: 'Earthspear', weave: 'Stone Weave', ward: 'Stoneskin', step: 'Earthen Stride' },
  shadow: { bolt: 'Shadow Bolt', nova: 'Night Burst', wave: 'Dread Wave', field: 'Umbral Pool', lance: 'Shadow Lance', weave: 'Shadow Weave', ward: 'Veil of Night', step: 'Shadowstep' },
  verdance: { bolt: 'Thorn Dart', nova: 'Bloom', wave: 'Bramble Wave', field: 'Garden of Thorns', lance: 'Thorn Lance', weave: 'Verdant Weave', ward: 'Barkskin', step: 'Petal Step' },
  water: { bolt: 'Water Bolt', nova: 'Tidal Burst', wave: 'Tidal Wave', field: 'Whirlpool', lance: 'Hydro Jet', weave: 'Tide Weave', ward: 'Water Shell', step: 'Riptide Step' },
  gravity: { bolt: 'Mass Bolt', nova: 'Collapse', wave: 'Repulse', field: 'Singularity', lance: 'Gravity Lance', weave: 'Weight Weave', ward: 'Event Horizon', step: 'Fall Upward' },
  time: { bolt: 'Chrono Bolt', nova: 'Stasis', wave: 'Wither', field: 'Stasis Field', lance: 'Moment Lance', weave: 'Quickened Blade', ward: 'Rewind', step: 'Blink' },
};
const FORM_ICON: Record<Form, string> = { bolt: '➶', nova: '✺', wave: '◢', field: '◎', lance: '➹', weave: '⚔', ward: '⛨', step: '➟' };

/** The spell an element and a form make. Deterministic: the same pair is always the same spell. */
export function spellFor(e: Element, f: Form): SkillDef {
  const E = ELEMENT_INFO[e], F = FORMS[f];
  // Time is the costliest element; the shaping forms of gravity and time are a little slower to recover.
  const k = e === 'time' ? 1.35 : e === 'gravity' ? 1.15 : 1;
  return {
    id: `sp:${e}:${f}`, name: NAMES[e][f], icon: f === 'bolt' || f === 'nova' ? E.glyph : FORM_ICON[f], color: E.color,
    text: `${E.name} × ${F.name}: ${F.text}; ${E.text}`, kernel: F.kernel, source: 'spell',
    cost: 0, mana: Math.round(F.mana * k), cooldown: +(F.cooldown * k).toFixed(2), riders: [e], power: 1, rank: 1, uses: 0, element: e, form: f,
  };
}

/** Status interactions, for the spellbook guide (the rules themselves live in ArenaWorld.elementHit). */
export const REACTIONS: { a: string; b: string; result: string; text: string }[] = [
  { a: 'Water', b: 'Lightning', result: 'Electrocute', text: 'double damage, stun, arcs to every wet foe nearby' },
  { a: 'Water', b: 'Ice', result: 'Freeze', text: 'frozen solid for two seconds' },
  { a: 'Ice (frozen)', b: 'Fire / Earth / heavy blow', result: 'Shatter', text: 'triple damage, ends the freeze' },
  { a: 'Fire', b: 'Water', result: 'Steam', text: 'douses the burn; a blinding cloud staggers everyone in it' },
  { a: 'Fire', b: 'Wind', result: 'Wildfire', text: 'the flames leap to nearby foes' },
  { a: 'Gravity (gathered)', b: 'any burst', result: 'Crush', text: 'bonus damage to foes pulled together' },
  { a: 'Time (slowed)', b: 'three more hits', result: 'Rupture', text: 'stored time bursts out as damage' },
  { a: 'Lightning', b: 'Lightning field', result: 'Overcharge', text: 'shocked foes chain again' },
];

// ---- potions: the belt (V drinks the first) ----
export type PotionKind = 'mana' | 'haste' | 'might' | 'stone' | 'elemental' | 'clarity';
export const POTIONS: Record<PotionKind, { name: string; icon: string; color: string; text: string; seconds: number }> = {
  mana: { name: 'Mana Draught', icon: '🧪', color: '#5aa8ff', text: 'restores 60% of your mana', seconds: 0 },
  haste: { name: 'Quicksilver Tonic', icon: '⚗️', color: '#c8ffe0', text: '+25% move and attack speed', seconds: 15 },
  might: { name: 'Giant’s Draught', icon: '🍺', color: '#ff8c2e', text: '+30% damage', seconds: 15 },
  stone: { name: 'Stoneblood Elixir', icon: '🪨', color: '#c9a77a', text: '40% less damage taken', seconds: 12 },
  elemental: { name: 'Elixir of', icon: '✨', color: '#ffd76a', text: 'imbues your weapon with an element', seconds: 30 },
  clarity: { name: 'Draught of Clarity', icon: '💠', color: '#a8f0ff', text: 'spells cost no mana', seconds: 8 },
};

/** Floor ley element (mechanical truth): that element's spells are 35% stronger there and mana flows faster. */
export const LEY_BONUS = 1.35;
