import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, face, step, v } from './helpers/world';
import { getRel, setRelTags } from '../src/sim/mind/relationships';
import { learn } from '../src/sim/mind/knowledge';
import { appraiseClaim, proposeConcerns } from '../src/sim/social/appraisal';
import { activeConcerns, concernGoalBoost, formConcerns, maintainConcerns } from '../src/sim/mind/concern';
import {
  DORMANT_AFTER_SECONDS, maintainSituations, personalSituationView,
  situationForEvent, situationRelevance, situationsInvolving,
} from '../src/sim/social/situation';
import { selectTopic, scoreTopic } from '../src/sim/mind/conversation';
import { realizeTopic } from '../src/sim/mind/realize';
import { noticeAbsences } from '../src/sim/social/absence';
import { SERIOUS_WOUND, getPhysicalCapability, woundSeverity } from '../src/sim/core/attributes';
import { DialogueSystem } from '../src/sim/mind/dialogue';
import type { KnowledgeItem, Person } from '../src/sim/core/types';

/**
 * v0.9 "Social Causality Vertical Slice". These assert the GENERIC mechanisms structurally —
 * on the state they actually produce (situations, appraisals, concerns, goals, relationships),
 * never on the text of a log line. The end-to-end causal traces on the real generated village
 * live in `tests/social-causality-trace.test.ts` and `npm run social:trace`.
 */

function attackKnowledge(tw: ReturnType<typeof createTestWorld>, actorId: string, targetId: string, eventId = 'e_atk'): Omit<KnowledgeItem, 'sharedWith'> & { sharedWith: string[] } {
  return {
    key: `ev:${eventId}`, kind: 'event',
    claim: { eventId, type: 'attack', actor: actorId, target: targetId, significance: 0.7, tick: tw.world.now },
    confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
  };
}

describe('v0.9 §A — the same event means different things to different people', () => {
  it('appraises one identical belief very differently by relationship, role and material stake', () => {
    const tw = createTestWorld(9001, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5), { workId: tw.places.tavern });
    const spouse = addPerson(tw, 'Spouse', 'cook', v(7.5, 1, 5.5));
    const coworker = addPerson(tw, 'Coworker', 'server', v(8.5, 1, 5.5), { workId: tw.places.tavern });
    const guard = addPerson(tw, 'Guard', 'guard', v(9.5, 1, 5.5), { workId: tw.places.guardhouse });
    const stranger = addPerson(tw, 'Stranger', 'farmer', v(10.5, 1, 5.5));
    setRelTags(spouse, victim.id, 'spouse');
    getRel(spouse, victim.id).affection = 0.9;

    const k = attackKnowledge(tw, attacker.id, victim.id) as KnowledgeItem;
    const weights = new Map<string, number>();
    for (const p of [victim, spouse, coworker, guard, stranger]) {
      learn(tw.world, p, { ...k, claim: { ...k.claim } }, true);
      weights.set(p.name, appraiseClaim(tw.world, p, p.knowledge[k.key]).weight);
    }

    // The victim above everyone; the spouse above the coworker; every one of them above the
    // unrelated stranger. These are ORDERINGS, not tuned constants.
    expect(weights.get('Victim')!).toBeGreaterThan(weights.get('Spouse')!);
    expect(weights.get('Spouse')!).toBeGreaterThan(weights.get('Stranger')!);
    expect(weights.get('Coworker')!).toBeGreaterThan(weights.get('Stranger')!);
    expect(weights.get('Guard')!).toBeGreaterThan(weights.get('Stranger')!);
    expect(new Set([...weights.values()]).size).toBe(weights.size); // no two identical
  });

  it('gives the attacker’s own friend a real stake, distinct from a stranger’s', () => {
    const tw = createTestWorld(9002, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const friendOfActor = addPerson(tw, 'FriendOfActor', 'farmer', v(7.5, 1, 5.5));
    const stranger = addPerson(tw, 'Stranger', 'farmer', v(8.5, 1, 5.5));
    setRelTags(friendOfActor, attacker.id, 'friend');
    getRel(friendOfActor, attacker.id).affection = 0.7;
    getRel(friendOfActor, attacker.id).familiarity = 0.8;

    const k = attackKnowledge(tw, attacker.id, victim.id) as KnowledgeItem;
    for (const p of [friendOfActor, stranger]) learn(tw.world, p, { ...k, claim: { ...k.claim } }, true);
    const friendly = appraiseClaim(tw.world, friendOfActor, friendOfActor.knowledge[k.key]);
    const strange = appraiseClaim(tw.world, stranger, stranger.knowledge[k.key]);
    expect(friendly.roles).toContain('close_to_actor');
    expect(friendly.weight).toBeGreaterThan(strange.weight);
  });

  it('discounts a distant, low-confidence rumour relative to an eyewitness account', () => {
    const tw = createTestWorld(9003, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const witness = addPerson(tw, 'Witness', 'farmer', v(7.5, 1, 5.5));
    const hearsay = addPerson(tw, 'Hearsay', 'farmer', v(8.5, 1, 5.5));
    const base = attackKnowledge(tw, attacker.id, victim.id) as KnowledgeItem;
    learn(tw.world, witness, { ...base, claim: { ...base.claim } }, true);
    learn(tw.world, hearsay, { ...base, claim: { ...base.claim }, confidence: 0.35, hops: 3, source: { type: 'told', from: witness.id } }, true);
    expect(appraiseClaim(tw.world, witness, witness.knowledge[base.key]).weight)
      .toBeGreaterThan(appraiseClaim(tw.world, hearsay, hearsay.knowledge[base.key]).weight);
  });

  it('does not treat a guard’s lawful subdual as a wrong to be answered for', () => {
    const tw = createTestWorld(9004, 40);
    const guard = addPerson(tw, 'Guard', 'guard', v(5.5, 1, 5.5), { workId: tw.places.guardhouse });
    const outlaw = addPerson(tw, 'Outlaw', 'bandit', v(6.5, 1, 5.5));
    const villager = addPerson(tw, 'Villager', 'farmer', v(7.5, 1, 5.5), { traits: { honesty: 0.95 } });
    const k: KnowledgeItem = {
      key: 'ev:lawful', kind: 'event',
      claim: { eventId: 'lawful', type: 'attack', intent: 'subdue', actor: guard.id, target: outlaw.id, significance: 0.6, tick: tw.world.now },
      confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
    };
    learn(tw.world, villager, k, true);
    const ap = appraiseClaim(tw.world, villager, villager.knowledge[k.key]);
    expect(ap.crime).toBe(false);
    const kinds = proposeConcerns(tw.world, villager, ap).map(c => c.kind);
    expect(kinds).not.toContain('justice');
    expect(kinds).not.toContain('safety');
  });
});

describe('v0.9 §B — knowledge produces concerns, and concerns change behaviour', () => {
  it('forms a welfare concern in the spouse and a justice concern in the guard, from the same event', () => {
    const tw = createTestWorld(9010, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const spouse = addPerson(tw, 'Spouse', 'cook', v(7.5, 1, 5.5));
    const guard = addPerson(tw, 'Guard', 'guard', v(9.5, 1, 5.5), { workId: tw.places.guardhouse });
    setRelTags(spouse, victim.id, 'spouse');
    getRel(spouse, victim.id).affection = 0.9;

    const k = attackKnowledge(tw, attacker.id, victim.id) as KnowledgeItem;
    for (const p of [spouse, guard]) {
      learn(tw.world, p, { ...k, claim: { ...k.claim } }, true);
      const item = p.knowledge[k.key];
      const proposals = proposeConcerns(tw.world, p, appraiseClaim(tw.world, p, item));
      for (const prop of proposals) p.mind.concerns = [...(p.mind.concerns ?? []), {
        id: `cn_${p.id}_${prop.kind}`, kind: prop.kind, subjectId: prop.subjectId, aboutId: prop.aboutId,
        basisKeys: [item.key], intensity: prop.intensity, createdAt: tw.world.now, lastReinforcedAt: tw.world.now,
        status: 'active', reasons: prop.reasons,
      }];
    }
    expect(activeConcerns(spouse).map(c => c.kind)).toContain('welfare');
    expect(activeConcerns(guard).map(c => c.kind)).toContain('justice');
  });

  it('a welfare concern actually raises the utility of going to see that person, and only them', () => {
    const tw = createTestWorld(9011, 40);
    const worried = addPerson(tw, 'Worried', 'cook', v(5.5, 1, 5.5));
    const cared = addPerson(tw, 'Cared', 'baker', v(6.5, 1, 5.5));
    const other = addPerson(tw, 'Other', 'farmer', v(7.5, 1, 5.5));
    worried.mind.concerns = [{
      id: 'cn_1', kind: 'welfare', subjectId: cared.id, basisKeys: ['ev:x'], intensity: 0.8,
      createdAt: tw.world.now, lastReinforcedAt: tw.world.now, status: 'active', reasons: ['they are my spouse'],
    }];
    expect(concernGoalBoost(worried, 'check_on', cared.id).bonus).toBeGreaterThan(0);
    expect(concernGoalBoost(worried, 'check_on', other.id).bonus).toBe(0);
    // Bounded: a concern bends a decision, it never dictates one.
    expect(concernGoalBoost(worried, 'check_on', cared.id).bonus).toBeLessThanOrEqual(0.3);
  });

  it('a justice concern raises reporting/investigating without naming any specific goal target', () => {
    const tw = createTestWorld(9012, 40);
    const p = addPerson(tw, 'Honest', 'farmer', v(5.5, 1, 5.5), { traits: { honesty: 0.9 } });
    const suspect = addPerson(tw, 'Suspect', 'woodcutter', v(6.5, 1, 5.5));
    p.mind.concerns = [{
      id: 'cn_j', kind: 'justice', aboutId: suspect.id, basisKeys: ['ev:x'], intensity: 0.7,
      createdAt: tw.world.now, lastReinforcedAt: tw.world.now, status: 'active', reasons: ['I saw it'],
    }];
    expect(concernGoalBoost(p, 'report').bonus).toBeGreaterThan(0);
    expect(concernGoalBoost(p, 'sleep').bonus).toBe(0);
  });

  it('an unwitnessed assault reaching someone only by gossip still forms a concern in them', () => {
    const tw = createTestWorld(9013, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const witness = addPerson(tw, 'Witness', 'farmer', v(7.5, 1, 5.5));
    // Far enough away that neither sight nor sound of it can reach them: the ONLY route by
    // which this can reach the spouse is another person telling them.
    const spouse = addPerson(tw, 'Spouse', 'cook', v(36.5, 1, 36.5));
    setRelTags(spouse, victim.id, 'spouse');
    getRel(spouse, victim.id).affection = 0.9;
    face(witness, tw, tw.world.primaryBody(victim.id)!.pos);
    const attack = tw.sim.applyHit(attacker, tw.world.primaryBody(attacker.id)!, tw.world.primaryBody(victim.id)!, 30)!;
    step(tw, 2);
    expect(witness.knowledge[`ev:${attack.id}`]).toBeDefined();
    // The spouse was never present — the only route is being told.
    expect(spouse.knowledge[`ev:${attack.id}`]).toBeUndefined();
    tw.sim.tell(witness, spouse, witness.knowledge[`ev:${attack.id}`]);
    expect(spouse.knowledge[`ev:${attack.id}`]?.source.type).toBe('told');
    expect(activeConcerns(spouse).some(c => c.subjectId === victim.id || c.aboutId === attacker.id)).toBe(true);
  });
});

describe('v0.9 §C — relationships respond in proportion to what the event meant', () => {
  it('moves a close relation’s opinion of the attacker further than a stranger’s', () => {
    const tw = createTestWorld(9020, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(15.5, 1, 15.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(16.5, 1, 15.5));
    const spouse = addPerson(tw, 'Spouse', 'cook', v(17.5, 1, 15.5));
    const stranger = addPerson(tw, 'Stranger', 'farmer', v(18.5, 1, 15.5));
    setRelTags(spouse, victim.id, 'spouse');
    getRel(spouse, victim.id).affection = 0.9;
    for (const p of [spouse, stranger]) face(p, tw, tw.world.primaryBody(victim.id)!.pos);
    tw.sim.applyHit(attacker, tw.world.primaryBody(attacker.id)!, tw.world.primaryBody(victim.id)!, 30);
    step(tw, 2);
    expect(getRel(spouse, attacker.id).grudge).toBeGreaterThan(getRel(stranger, attacker.id).grudge);
    expect(getRel(spouse, attacker.id).trust).toBeLessThan(getRel(stranger, attacker.id).trust);
  });
});

describe('v0.9 §D — injury is a real, persistent, observable physical consequence', () => {
  it('a serious wound measurably reduces what a person can do', () => {
    const tw = createTestWorld(9030, 40);
    const p = addPerson(tw, 'Hurt', 'woodcutter', v(5.5, 1, 5.5));
    const body = tw.world.primaryBody(p.id)!;
    const healthy = getPhysicalCapability(p, tw.world);
    body.health = body.maxHealth * 0.25;
    const wounded = getPhysicalCapability(p, tw.world);
    expect(woundSeverity(body)).toBeGreaterThan(SERIOUS_WOUND);
    expect(wounded.currentExertionCapacity).toBeLessThan(healthy.currentExertionCapacity);
    expect(wounded.workRate).toBeLessThan(healthy.workRate);
  });

  it('a wound does not heal away within a work shift the way it used to', () => {
    const tw = createTestWorld(9031, 40);
    const p = addPerson(tw, 'Hurt', 'woodcutter', v(5.5, 1, 5.5));
    const body = tw.world.primaryBody(p.id)!;
    body.health = body.maxHealth * 0.3;
    step(tw, 60); // 60 physical seconds = one world hour at the default 60x time scale
    expect(woundSeverity(body)).toBeGreaterThan(0.3);
  });

  it('notices, by real inference from its own perception gap, that a workmate has not turned up', () => {
    const tw = createTestWorld(9032, 40);
    const observer = addPerson(tw, 'Observer', 'innkeeper', v(35.5, 1, 3.5), { workId: tw.places.tavern, homeId: tw.places.tavern });
    const absentee = addPerson(tw, 'Absentee', 'server', v(5.5, 1, 35.5), { workId: tw.places.tavern, homeId: tw.places.tavern });
    // The observer has actually seen them, once, a long time ago — which is what makes the
    // absence measurable rather than manufactured.
    learn(tw.world, observer, { key: `loc:${absentee.id}`, kind: 'location', claim: { entityId: absentee.id, pos: { x: 35, y: 1, z: 3 }, placeId: tw.places.tavern }, confidence: 1, source: { type: 'witnessed' } }, true);
    observer.knowledge[`loc:${absentee.id}`].learnedAt = tw.world.now;
    observer.schedule = [{ start: 0, end: 24, activity: 'work', placeId: tw.places.tavern, label: 'the bar' }];
    tw.world.clock.worldSeconds += 12 * 3600;
    noticeAbsences(tw.world, observer, tw.world.clock.hourF);
    const belief = observer.knowledge[`absent:${absentee.id}`];
    expect(belief).toBeDefined();
    expect(belief.source.type).toBe('inferred');
    // It states only what was actually inferred — that they were not there — never a cause.
    expect(belief.claim.type).toBe('absence_noticed');
    expect(belief.claim).not.toHaveProperty('reason');
  });

  it('does not manufacture an absence for someone it has never laid eyes on', () => {
    const tw = createTestWorld(9033, 40);
    const observer = addPerson(tw, 'Observer', 'innkeeper', v(35.5, 1, 3.5), { workId: tw.places.tavern, homeId: tw.places.tavern });
    const absentee = addPerson(tw, 'Absentee', 'server', v(5.5, 1, 35.5), { workId: tw.places.tavern, homeId: tw.places.tavern });
    observer.schedule = [{ start: 0, end: 24, activity: 'work', placeId: tw.places.tavern, label: 'the bar' }];
    tw.world.clock.worldSeconds += 48 * 3600;
    noticeAbsences(tw.world, observer, tw.world.clock.hourF);
    expect(observer.knowledge[`absent:${absentee.id}`]).toBeUndefined();
  });
});

describe('v0.9 §E — conversation is situation-aware, and silence is a real outcome', () => {
  function assaultWorld(seed: number) {
    const tw = createTestWorld(seed, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const witness = addPerson(tw, 'Witness', 'farmer', v(7.5, 1, 5.5), { traits: { sociability: 0.8 } });
    const guard = addPerson(tw, 'Guard', 'guard', v(9.5, 1, 5.5), { workId: tw.places.guardhouse });
    const bystander = addPerson(tw, 'Bystander', 'farmer', v(10.5, 1, 5.5), { traits: { sociability: 0.2 } });
    const k = attackKnowledge(tw, attacker.id, victim.id) as KnowledgeItem;
    learn(tw.world, witness, { ...k, claim: { ...k.claim } }, true);
    return { tw, attacker, victim, witness, guard, bystander, key: k.key };
  }

  it('rates a crime as far more worth raising with the watch than with an unconnected neighbour', () => {
    const { tw, witness, guard, bystander, key } = assaultWorld(9040);
    const toGuard = scoreTopic(tw.world, witness, guard, witness.knowledge[key]);
    const toNeighbour = scoreTopic(tw.world, witness, bystander, witness.knowledge[key]);
    expect(toGuard.score).toBeGreaterThan(toNeighbour.score);
    expect(toGuard.reasons.join(' ')).toMatch(/watch/);
  });

  it('stays silent rather than volunteering a stale, trivial, third-hand fact', () => {
    const tw = createTestWorld(9041, 40);
    const speaker = addPerson(tw, 'Speaker', 'farmer', v(5.5, 1, 5.5), { traits: { sociability: 0.3 } });
    const listener = addPerson(tw, 'Listener', 'farmer', v(6.5, 1, 5.5));
    const other = addPerson(tw, 'Other', 'farmer', v(7.5, 1, 5.5));
    const third = addPerson(tw, 'Third', 'farmer', v(8.5, 1, 5.5));
    learn(tw.world, speaker, {
      key: 'ev:trivial', kind: 'event',
      claim: { eventId: 'trivial', type: 'dispute', actor: other.id, target: third.id, significance: 0.15, tick: tw.world.now },
      confidence: 0.25, hops: 3, source: { type: 'told', from: other.id },
    }, true);
    speaker.knowledge['ev:trivial'].learnedAt = tw.world.now - 5 * 86400;
    tw.world.clock.worldSeconds += 5 * 86400;
    expect(selectTopic(tw.world, speaker, listener)).toBeNull();
  });

  it('never volunteers a matter back to the person who did it', () => {
    const { tw, attacker, witness, key } = assaultWorld(9042);
    void key;
    expect(selectTopic(tw.world, witness, attacker)).toBeNull();
  });

  it('synthesizes several grounded facts into one statement without inventing any of them', () => {
    const { tw, attacker, victim, witness, guard, key } = assaultWorld(9043);
    learn(tw.world, witness, {
      key: `absent:${victim.id}`, kind: 'event',
      claim: { eventId: 'abs1', type: 'absence_noticed', actor: witness.id, target: victim.id, placeId: tw.places.tavern, significance: 0.4, tick: tw.world.now },
      confidence: 0.85, source: { type: 'inferred' },
    }, true);
    const topic = selectTopic(tw.world, witness, guard, { ignoreListenerKnowledge: true, threshold: -1 })!;
    expect(topic.k.key).toBe(key);
    expect(topic.supporting.length).toBeGreaterThan(0);
    const line = realizeTopic(tw.world, witness, topic);
    expect(line).toContain(attacker.name);
    expect(line).toContain(victim.name);
    // Nobody else in this world may appear in a line about this matter.
    for (const p of tw.world.persons()) {
      if ([attacker.id, victim.id, witness.id].includes(p.id)) continue;
      expect(line).not.toContain(p.name);
    }
  });

  it('produces materially different descriptions of the same event from different speakers', () => {
    const { tw, attacker, victim, witness, guard, key } = assaultWorld(9044);
    const spouse = addPerson(tw, 'Spouse', 'cook', v(11.5, 1, 5.5));
    setRelTags(spouse, victim.id, 'spouse');
    getRel(spouse, victim.id).affection = 0.9;
    learn(tw.world, spouse, { ...witness.knowledge[key], claim: { ...witness.knowledge[key].claim }, source: { type: 'told', from: witness.id }, hops: 1, confidence: 0.6, sharedWith: [] } as any, true);
    const lines = new Set<string>();
    for (const speaker of [witness, spouse]) {
      const t = selectTopic(tw.world, speaker, guard, { ignoreListenerKnowledge: true, threshold: -1 });
      if (t) lines.add(realizeTopic(tw.world, speaker, t));
    }
    expect(lines.size).toBe(2);
    void attacker;
  });
});

describe('v0.9 §F — no fabricated history', () => {
  it('the ambient small-talk pool asserts nothing that happened', () => {
    // The v0.9 audit removed lines that stated debts, prices and bereavements the simulation
    // never recorded. This asserts the property structurally on the shipped source, so a future
    // edit that reintroduces an invented fact fails here rather than in a playtest.
    const source = readAgentSource();
    const smallTalk = source.slice(source.indexOf('private smallTalk('), source.indexOf('private smallTalk(') + 1800);
    for (const forbidden of ['Still owe me', 'Candles are two coppers', "It's quiet without her"]) {
      expect(smallTalk).not.toContain(forbidden);
    }
  });

  it('the debt-settlement dialogue names the real debtor and the real amount, not a hardcoded pair', () => {
    const tw = createTestWorld(9060, 40);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(5.5, 1, 5.5), { controlled: true });
    const creditor = addPerson(tw, 'Creditor', 'merchant', v(6.5, 1, 5.5));
    const debtor = addPerson(tw, 'Debtor', 'vagrant', v(7.5, 1, 5.5));
    player.wealth = 100;
    const debtEvent = tw.world.emit('debt', { actor: debtor.id, target: creditor.id, data: { amount: 37 }, significance: 0.5, summary: 'a debt' });
    learn(tw.world, creditor, { key: `ev:${debtEvent.id}`, kind: 'event', claim: { eventId: debtEvent.id, type: 'debt', actor: debtor.id, target: creditor.id, amount: 37, tick: tw.world.now }, confidence: 1, source: { type: 'prior' } }, true);
    creditor.desires.push({ type: 'collect_debt', targetId: debtor.id, note: 'I am owed.', reward: 5, fulfilled: false });

    const dialogue = new DialogueSystem(tw.world, tw.sim);
    const start = dialogue.start(creditor, player);
    const option = start.options.find(o => o.label.includes('silver for them'));
    expect(option).toBeDefined();
    // The real debtor and the real canonical amount — neither hardcoded anywhere.
    expect(option!.label).toContain('Debtor');
    expect(option!.label).toContain('37');
    option!.next();
    expect(player.wealth).toBe(63);
    expect(creditor.desires[0].fulfilled).toBe(true);
    // And the obligation that debt opened is now settled, even though the payer was not the debtor.
    const obligations = situationsInvolving(tw.world, creditor.id).filter(s => s.kind === 'obligation');
    expect(obligations.length).toBe(1);
    expect(obligations[0].status).toBe('resolved');
    expect(obligations[0].resolution).toBe('settled');
  });

  it('mourning is directed by a real grief concern rather than one hardcoded name', () => {
    const source = readAgentSource();
    expect(source).not.toContain("a.label?.startsWith('Anna')");
    expect(source.slice(source.indexOf("case 'mourn'"), source.indexOf("case 'mourn'") + 700)).toContain("kind === 'grief'");
  });
});

describe('v0.9 §G — situations age, resolve, and are known only through evidence', () => {
  it('opens a situation for a real assault and settles it when the subject recovers', () => {
    const tw = createTestWorld(9050, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const body = tw.world.primaryBody(victim.id)!;
    tw.sim.applyHit(attacker, tw.world.primaryBody(attacker.id)!, body, 40);
    const sits = situationsInvolving(tw.world, victim.id);
    expect(sits.length).toBe(1);
    expect(sits[0].kind).toBe('harm');
    expect(sits[0].status).toBe('active');
    body.health = body.maxHealth;
    tw.world.clock.worldSeconds += 8 * 3600;
    maintainSituations(tw.world);
    expect(sits[0].status).toBe('resolved');
    expect(sits[0].resolution).toBe('recovered');
  });

  it('does not open a fresh matter for a guard’s lawful subdual', () => {
    const tw = createTestWorld(9051, 40);
    const guard = addPerson(tw, 'Guard', 'guard', v(5.5, 1, 5.5), { workId: tw.places.guardhouse });
    const outlaw = addPerson(tw, 'Outlaw', 'bandit', v(6.5, 1, 5.5));
    tw.sim.applyHit(guard, tw.world.primaryBody(guard.id)!, tw.world.primaryBody(outlaw.id)!, 20, 'subdue');
    expect(situationsInvolving(tw.world, outlaw.id).filter(s => s.kind === 'harm').length).toBe(0);
  });

  it('folds repeated blows in one brawl into a single ongoing matter, not one per blow', () => {
    const tw = createTestWorld(9052, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const ab = tw.world.primaryBody(attacker.id)!; const vb = tw.world.primaryBody(victim.id)!;
    for (let i = 0; i < 4; i++) tw.sim.applyHit(attacker, ab, vb, 8);
    const sits = situationsInvolving(tw.world, victim.id);
    expect(sits.length).toBe(1);
    // All four blows, plus whatever else genuinely bore on the same matter (the conflict opening).
    expect(sits[0].eventIds.length).toBeGreaterThanOrEqual(4);
    expect(sits[0].eventIds.filter(id => tw.world.event(id)?.type === 'attack').length).toBe(4);
  });

  it('becomes dormant once nothing has happened about it for long enough', () => {
    const tw = createTestWorld(9053, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    tw.sim.applyHit(attacker, tw.world.primaryBody(attacker.id)!, tw.world.primaryBody(victim.id)!, 5);
    const sit = situationsInvolving(tw.world, victim.id)[0];
    // Keep the victim wounded so the recovery path cannot claim it first.
    tw.world.primaryBody(victim.id)!.health = 5;
    tw.world.clock.worldSeconds += DORMANT_AFTER_SECONDS + 3600;
    maintainSituations(tw.world);
    expect(sit.status).toBe('dormant');
    expect(situationRelevance(sit, tw.world.now)).toBeLessThan(0.4);
  });

  it('a person believes a matter is settled only when THEY know of the event that settled it', () => {
    const tw = createTestWorld(9054, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const informed = addPerson(tw, 'Informed', 'farmer', v(7.5, 1, 5.5));
    const uninformed = addPerson(tw, 'Uninformed', 'farmer', v(30.5, 1, 30.5));
    const attack = tw.sim.applyHit(attacker, tw.world.primaryBody(attacker.id)!, tw.world.primaryBody(victim.id)!, 30)!;
    const sit = situationForEvent(tw.world, attack.id)!;
    for (const p of [informed, uninformed]) {
      learn(tw.world, p, { key: `ev:${attack.id}`, kind: 'event', claim: { eventId: attack.id, type: 'attack', actor: attacker.id, target: victim.id, tick: tw.world.now, significance: 0.7 }, confidence: 1, source: { type: 'witnessed' } }, true);
    }
    const arrest = tw.world.emit('entity_arrested', { actor: informed.id, target: attacker.id, significance: 0.6, summary: 'arrested' });
    expect(sit.status).toBe('resolved');
    learn(tw.world, informed, { key: `ev:${arrest.id}`, kind: 'event', claim: { eventId: arrest.id, type: 'entity_arrested', actor: informed.id, target: attacker.id, tick: tw.world.now }, confidence: 1, source: { type: 'witnessed' } }, true);

    expect(personalSituationView(tw.world, informed, sit).status).toBe('resolved');
    // The world knows; this person does not. They must still believe it is open.
    expect(personalSituationView(tw.world, uninformed, sit).status).toBe('unresolved');
    // And someone who never heard of the matter at all knows nothing about it either way.
    const oblivious = addPerson(tw, 'Oblivious', 'farmer', v(31.5, 1, 31.5));
    expect(personalSituationView(tw.world, oblivious, sit).status).toBe('unknown');
  });

  it('discharges a concern when — and only when — its holder learns the matter was settled', () => {
    const tw = createTestWorld(9055, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(5.5, 1, 5.5));
    const victim = addPerson(tw, 'Victim', 'baker', v(6.5, 1, 5.5));
    const spouse = addPerson(tw, 'Spouse', 'cook', v(30.5, 1, 30.5));
    setRelTags(spouse, victim.id, 'spouse');
    getRel(spouse, victim.id).affection = 0.9;
    const attack = tw.sim.applyHit(attacker, tw.world.primaryBody(attacker.id)!, tw.world.primaryBody(victim.id)!, 30)!;
    const sit = situationForEvent(tw.world, attack.id)!;
    learn(tw.world, spouse, { key: `ev:${attack.id}`, kind: 'event', claim: { eventId: attack.id, type: 'attack', actor: attacker.id, target: victim.id, tick: tw.world.now, significance: 0.7 }, confidence: 1, source: { type: 'witnessed' } }, true);
    formConcerns(tw.world, spouse, spouse.knowledge[`ev:${attack.id}`]);
    const concern = activeConcerns(spouse).find(c => c.subjectId === victim.id);
    expect(concern).toBeDefined();

    const arrest = tw.world.emit('entity_arrested', { actor: victim.id, target: attacker.id, significance: 0.6, summary: 'arrested' });
    maintainConcerns(tw.world, spouse, 0.1);
    expect(concern!.status).toBe('active'); // the spouse has not heard

    learn(tw.world, spouse, { key: `ev:${arrest.id}`, kind: 'event', claim: { eventId: arrest.id, type: 'entity_arrested', actor: victim.id, target: attacker.id, tick: tw.world.now }, confidence: 1, source: { type: 'told', from: victim.id } }, true);
    maintainConcerns(tw.world, spouse, 0.1);
    expect(concern!.status).toBe('addressed');
    void sit;
  });
});

let cachedSource: string | null = null;
function readAgentSource(): string {
  if (cachedSource) return cachedSource;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs');
  cachedSource = fs.readFileSync('src/sim/mind/agent.ts', 'utf8') as string;
  return cachedSource;
}

export type { Person };
