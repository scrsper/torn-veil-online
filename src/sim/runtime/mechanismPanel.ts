import type { World } from '../core/world';
import type { Person } from '../core/types';
import { knowledgeView } from './knowledgeView';
import type { PersonIntent } from './gameSim';

/** A knowledge-derived menu. It offers attempts, never predicts success or reads topology. */
export function mechanismPanel(w: World, p: Person) {
  const view = knowledgeView(w, p);
  return view.visibleMechanisms.map(a => {
    const actions: { label: string; intent: PersonIntent }[] = [{ label: 'Inspect', intent: { kind: 'inspect', assemblyId: a.assemblyId } }];
    const evidence = p.knowledge[`mechanical-evidence:${a.assemblyId}`];
    if (evidence) {
      actions.push({ label: 'Consider repair', intent: { kind: 'diagnose', assemblyId: a.assemblyId } }, { label: 'Attempt operation / test', intent: { kind: 'test', assemblyId: a.assemblyId } }, { label: 'Dismantle', intent: { kind: 'dismantle', assemblyId: a.assemblyId } }, { label: 'Study construction', intent: { kind: 'reverse_engineer', assemblyId: a.assemblyId } });
      const hypotheses = p.knowledge[`mechanical-hypothesis:${a.assemblyId}`]?.claim.mechanicalHypothesis as { kind?: string; part?: number }[] | undefined;
      const hypothesis = hypotheses?.find(h => h.kind === 'replace');
      if (hypothesis?.kind === 'replace' && Number.isInteger(hypothesis.part)) for (const c of view.visibleComponents) actions.push({ label: 'Attempt fitting observed spare', intent: { kind: 'replace', assemblyId: a.assemblyId, part: hypothesis.part!, componentId: c.componentId } });
      for (const k of Object.values(p.knowledge)) {
        const definition = k.claim.component?.id as string | undefined;
        if (definition) actions.push({ label: 'Attempt making known part', intent: { kind: 'manufacture', assemblyId: a.assemblyId, definition } });
      }
    }
    return { ...a, evidence: evidence ? 'You have inspected this mechanism.' : 'Unfamiliar mechanism', actions };
  });
}
