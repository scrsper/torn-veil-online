/** Ordered extension metadata only. A label never supplies power or combat precedence. */
export const ONTOLOGICAL_STAGES = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond', 'God', 'Astral King', 'Astral Being', 'John Smith'] as const;
export type OntologicalStage = typeof ONTOLOGICAL_STAGES[number];
/**
 * Constitution §16: John Smith sits past the simulation/ontology boundary. He is drawn on the
 * conceptual ladder above, but he is the orchestrator of the universe, not a stage within it:
 * no entity holds, reaches or is promoted to him.
 */
export const ONTOLOGY_BOUNDARY = 'John Smith' as const;
export type AttainableStage = Exclude<OntologicalStage, typeof ONTOLOGY_BOUNDARY>;
export const ATTAINABLE_STAGES: readonly AttainableStage[] = ONTOLOGICAL_STAGES.filter((s): s is AttainableStage => s !== ONTOLOGY_BOUNDARY);
export function isAttainableStage(s: unknown): s is AttainableStage { return (ATTAINABLE_STAGES as readonly unknown[]).includes(s); }
export const STAGE_EXTENSIONS = ONTOLOGICAL_STAGES.map((name, order) => ({ name, order, implemented: name === 'Normal', attainable: name !== ONTOLOGY_BOUNDARY }));
