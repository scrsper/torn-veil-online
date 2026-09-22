import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '../src/sim/core/types';
import { knowledgeItems } from '../src/sim/mind/knowledgeView';

const fact = (key: string): KnowledgeItem => ({ key, kind: 'fact', claim: { value: key },
  confidence: 0.5, learnedAt: 0, source: { type: 'prior' }, hops: 0, sharedWith: [] });

describe('fresh knowledge traversal', () => {
  it('matches own enumerable value order through insertion, eviction, refinement and replacement', () => {
    const knowledge: Record<string, KnowledgeItem> = Object.create({ inherited: fact('inherited') });
    const person = { knowledge };
    for (let i = 0; i < 600; i++) {
      const key = i % 3 ? `ev:${i}` : String(i);
      knowledge[key] = fact(key);
      if (i > 50) delete knowledge[i % 3 ? `ev:${i - 40}` : String(i - 30)];
      if (i % 7 === 0) knowledge[key].confidence = 0.9;
      const actual = knowledgeItems(person), reference = Object.values(knowledge);
      expect(actual.map(k => k.key)).toEqual(reference.map(k => k.key));
      expect(actual.every((k, index) => k === reference[index])).toBe(true);
    }
    Object.defineProperty(knowledge, 'hidden', { value: fact('hidden'), enumerable: false });
    (knowledge as any)[Symbol('symbol')] = fact('symbol');
    expect(knowledgeItems(person)).toEqual(Object.values(knowledge));
    const detached = knowledgeItems(person); detached.reverse(); detached.pop();
    const next = knowledgeItems(person);
    expect(next).toEqual(Object.values(knowledge));
    knowledge[next[0].key] = fact('replacement');
    expect(knowledgeItems(person)[0]).toBe(knowledge[next[0].key]);
    person.knowledge = { fresh: fact('fresh') };
    expect(knowledgeItems(person).map(k => k.key)).toEqual(['fresh']);
  });
});
