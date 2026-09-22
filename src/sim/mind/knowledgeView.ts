import type { KnowledgeItem, Person } from '../core/types';

/** A fresh, ordered view of this mind's own evidence. No cached beliefs or indexes.
 * Bounded knowledge tables repeatedly delete/reinsert keys. On V8 those dictionary-mode
 * objects make Object.values expensive in deliberation; enumerating own keys and loading
 * values explicitly preserves the same order/references without that slow native path. */
export function knowledgeItems(person: Pick<Person, 'knowledge'>): KnowledgeItem[] {
  const knowledge = person.knowledge;
  return Object.keys(knowledge).map(key => knowledge[key]);
}
