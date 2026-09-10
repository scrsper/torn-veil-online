/** Ordered extension metadata only. A label never supplies power or combat precedence. */
export const ONTOLOGICAL_STAGES = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond', 'God', 'Astral King', 'Astral Being', 'John Smith'] as const;
export type OntologicalStage = typeof ONTOLOGICAL_STAGES[number];
export const STAGE_EXTENSIONS = ONTOLOGICAL_STAGES.map((name, order) => ({ name, order, implemented: name === 'Normal' }));
