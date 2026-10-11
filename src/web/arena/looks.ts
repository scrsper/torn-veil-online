/**
 * Arena cast: realistic MPFB people dressed in CC0/CC-BY MakeHuman community clothing, built by
 * art/tools/arena/build_arena_people.py into web/public/arena/people/<id>.glb.
 */
/** creator_male / creator_female: the ontology creator's current Human family (src/web/actors/creatorAppearance.ts). */
export const LOOK_IDS = ['creator_male', 'creator_female', 'ranger', 'brann', 'wren', 'raider', 'raider_f', 'soldier', 'knight', 'archer', 'mystic', 'orc', 'orc_chief', 'goblin', 'goblin_archer', 'skeleton', 'skeleton_mage', 'skeleton_brute', 'chrysanthus'] as const;
export type LookId = typeof LOOK_IDS[number];
