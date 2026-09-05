import type { ItemType, Occupation } from './types';

/**
 * Affordance foundation (v0.7 §Affordance foundation). An object has both an identity ("what is
 * this?") and a functional affordance ("what can this enable?") — physical facts that exist
 * whether or not any particular mind has recognized them (Constitution v0.7's axe example:
 * identity/composition/properties/affordances/known-uses, all real regardless of who is
 * looking). This module is the physical-fact side only; `mind/knowledge.ts`'s `learnAffordance`/
 * `recognizedUses` is the separate, bounded, acquired-belief side — a person may see an axe
 * without knowing its conventional name or what it is good for, and a knowledgeable person may
 * recognize more uses than an unfamiliar one. The two must never be conflated (a physically
 * possible action is not gated on knowledge; what a mind consciously reasons about pursuing is).
 *
 * Deliberately layered on TOP of the existing mechanical affordance system (`core/tools.ts`'s
 * `ToolAction`/`bestToolFor`/`toolWorkMultiplier`, which already governs what a tool actually
 * DOES in the simulation) rather than replacing it — this adds the legible, semantic identity/
 * composition/known-use description the roadmap asks for, for display (Inspector) and for the
 * knowledge layer to gate recognition on, without touching the numbers that already work.
 */
export interface AffordanceDef {
  /** The object's identity — its conventional name, independent of any one person's knowledge
   * of it (a person may still not know to call it this). */
  identity: string;
  /** What it is made of / built from, coarsely — real composition, not a full materials model
   * (that is v0.8's job). */
  composition: string[];
  /** Physical properties that make the affordances below possible. */
  properties: string[];
  /** What the object physically enables — mirrors `core/tools.ts`'s `ToolAction` where
   * applicable, plus non-mechanical affordances (e.g. a weapon-like "strike"). */
  affordances: string[];
  /** Concrete known uses a recognizing mind would articulate. */
  knownUses: string[];
}

/** The roadmap's own worked example (axe), plus the other worksite tools already modeled
 * mechanically by `core/tools.ts` — enough to prove the architecture, not an exhaustive catalog
 * of every object in the world (Constitution v0.7: "do not build the complete crafting system
 * yet"). */
export const AFFORDANCE_DEF: Partial<Record<ItemType, AffordanceDef>> = {
  axe: {
    identity: 'axe',
    composition: ['head', 'handle', 'binding'],
    properties: ['sharp edge', 'hard head', 'handheld leverage'],
    affordances: ['cut', 'chop', 'strike'],
    knownUses: ['fell trees', 'split timber', 'weapon-like use'],
  },
  pickaxe: {
    identity: 'pickaxe',
    composition: ['head', 'handle', 'binding'],
    properties: ['hard point', 'hard head', 'handheld leverage'],
    affordances: ['break', 'quarry', 'strike'],
    knownUses: ['break rock', 'work a quarry face', 'weapon-like use'],
  },
  saw: {
    identity: 'two-man saw',
    composition: ['toothed blade', 'two handles'],
    properties: ['toothed edge', 'flexible blade'],
    affordances: ['cut', 'saw'],
    knownUses: ['cut logs into planks'],
  },
  hammer: {
    identity: 'hammer',
    composition: ['head', 'handle'],
    properties: ['heavy head', 'handheld leverage'],
    affordances: ['strike', 'construct'],
    knownUses: ['drive nails/pegs', 'shape metal at a forge', 'weapon-like use'],
  },
  // v0.8 §F: the practical-crafting vertical slice's own result — a real, weaker tool made from
  // raw components (world/crafting.ts), not a forged one. Its affordance is taught to the
  // crafter the moment they make it (learning by making, the same "learning by doing" spirit
  // v0.7 already established for using a tool).
  stoneaxe: {
    identity: 'stone axe',
    composition: ['stone head', 'stick handle', 'plant-fiber binding'],
    properties: ['crude edge', 'hard head', 'handheld leverage'],
    affordances: ['cut', 'chop', 'strike'],
    knownUses: ['fell trees', 'split timber', 'weapon-like use'],
  },
};

export function affordancesOf(type: ItemType): AffordanceDef | undefined {
  return AFFORDANCE_DEF[type];
}

/** Plausible starting affordance knowledge by occupation — world-generation background, the
 * same "backstory, known since before the story started" spirit as `core/skills.ts`'s
 * `STARTING_SKILLS` and v0.6's occupational service-knowledge seeding, never a magical job
 * permission. A woodcutter has swung an axe before; someone who has never touched one (most
 * occupations) starts recognizing none of these — see mind/knowledge.ts's `recognizedUses`'
 * non-omniscience test. */
export const STARTING_AFFORDANCE_KNOWLEDGE: Partial<Record<Occupation, ItemType[]>> = {
  woodcutter: ['axe', 'saw'],
  smith: ['hammer'],
  apprentice: ['hammer', 'axe'],
  farmer: ['axe'],
  vagrant: ['axe', 'pickaxe'],
  hunter: ['axe'],
};
