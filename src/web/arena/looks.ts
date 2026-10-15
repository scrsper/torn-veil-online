/**
 * Cast looks: one body per role, the provisional picks of the 2026-10-15 model review
 * (src/web/presentation/library.ts CAST_BODIES; files in web/public/arena/cast/, see CAST.md there).
 */
/** creator_male / creator_female: the ontology creator's current Human family (src/web/actors/creatorAppearance.ts). */
export const LOOK_IDS = ['creator_male', 'creator_female', 'player_m', 'player_f', 'npc_m', 'npc_f', 'warden', 'imp', 'puglin'] as const;
export type LookId = typeof LOOK_IDS[number];
