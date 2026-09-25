import { describe, expect, it } from 'vitest';
import { playerJournal } from '../src/bridge/journal';
import { addPerson, createTestWorld, v } from './helpers/world';
import { recordCapabilityPractice } from '../src/sim/core/capability';
import { definitionClaim, learnTechnique } from '../src/sim/mind/martialKnowledge';
import { techniqueDefinition } from '../src/sim/core/martialDefinitions';

describe('player progression journal', () => {
  it('shows earned practice and martial-family technique knowledge without revealing an unknown teacher name', () => {
    const t = createTestWorld(958), w = t.world;
    const learner = addPerson(t, 'Learner', 'villager', v(12, 1, 12));
    const teacher = addPerson(t, 'Unknown Teacher', 'villager', v(13, 1, 12));
    const lesson = w.emit('work_taught', { actor: teacher.id, target: learner.id });
    learnTechnique(w, learner, definitionClaim(techniqueDefinition(w, 'unarmed:straight-punch')!, .7), .7,
      { type: 'told', from: teacher.id, viaEvent: lesson.id });
    const session = w.emit('work_shift', { actor: learner.id, target: teacher.id,
      data: { martial: 'spar', phase: 'completed', family: 'unarmed', techniqueId: 'unarmed:straight-punch', seconds: 60, effort: .8 } });
    const credit = recordCapabilityPractice(w, learner, { skill: 'unarmed', sourceEventId: session.id });
    expect(credit.credited).toBe(true);
    const journal = playerJournal(w, learner);
    expect(journal.practiceHoursRequired).toBe(2);
    expect(journal.practice[0].hours).toBe(Math.round(credit.effectiveSeconds / 36) / 100);
    expect(journal.practice[0].days).toBe(1);
    expect(journal.techniques).toContain('unarmed');
    expect(journal.techniqueHistory[0].teacher).not.toBe(teacher.name);
    expect(journal.advancement.eligible).toBe(false);
  });
});
