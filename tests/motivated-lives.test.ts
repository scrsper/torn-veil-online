import { isExternallyControlled } from '../src/sim/runtime/controllers';
import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, face, step, v } from './helpers/world';
import { getRel, setRelTags } from '../src/sim/mind/relationships';
import { learn } from '../src/sim/mind/knowledge';
import { formConcerns } from '../src/sim/mind/concern';
import { makeItem } from '../src/sim/world/factory';
import { createRequest, acceptRequest, completeRequest, failRequest, requestById } from '../src/sim/core/requests';
import {
  MAX_OBLIGATION_MAGNITUDE, MIN_OBLIGATION_MAGNITUDE, OBLIGATION_REINFORCE_COOLDOWN_SECONDS,
  describeObligation, forgivenessFor, formObligations, liveObligations, maintainObligations,
  noticeBrokenPromises, obligationCredit, obligationGoalBoost, obligationsOf,
} from '../src/sim/social/obligation';
import {
  MAX_ACTIVE_PURSUITS, MAX_MOTIVATION_BONUS, MAX_PURSUITS, PRIORITY_MARGIN,
  PURSUIT_FORBIDDEN_GOALS, PURSUIT_MIN_DWELL_SECONDS,
  PURSUIT_SERVING_GOALS, believedHarm, formPursuits, livePursuits, maintainPursuits,
  motivationBoost, pursuitGoalBoost, pursuitOutcome, pursuitPriority, pursuitStepUtility, pursuitSteps, pursuitsOf,
} from '../src/sim/mind/pursuit';
import { deserialize, serialize } from '../src/sim/persist/save';
import { newWorld } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import type { GoalType, KnowledgeItem, Person } from '../src/sim/core/types';

/**
 * v0.10 "Motivated Lives". These assert the GENERIC mechanisms structurally — on the state they
 * actually produce (obligations, purposes, priorities, utilities, resolutions), never on the text
 * of a log line and never on one authored pair of people. The end-to-end causal traces on the
 * real generated village live in `npm run motive:trace`.
 */

/** A belief about a real, emitted canonical attack — so provenance (`world.event(...)`) actually
 * resolves, exactly as it does when a mind perceives one in play. */
function attackBelief(tw: ReturnType<typeof createTestWorld>, actorId: string, targetId: string): Omit<KnowledgeItem, 'sharedWith'> & { sharedWith: string[] } {
  const ev = tw.world.emit('attack', { actor: actorId, target: targetId, significance: 0.7, data: { intent: 'injure' }, summary: 'a beating' });
  return {
    key: `ev:${ev.id}`, kind: 'event',
    claim: { eventId: ev.id, type: 'attack', actor: actorId, target: targetId, significance: 0.7, tick: tw.world.now },
    confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
  };
}

/** A canonical `gift` belief, as `onPerceived` would form it for the person who received it. */
function giftBelief(tw: ReturnType<typeof createTestWorld>, giverId: string, receiverId: string, itemId: string, eventId?: string): Omit<KnowledgeItem, 'sharedWith'> & { sharedWith: string[] } {
  const id = eventId ?? tw.world.emit('gift', { actor: giverId, target: receiverId, item: itemId, significance: 0.5, summary: 'a gift' }).id;
  return {
    key: `ev:${id}`, kind: 'event',
    claim: { eventId: id, type: 'gift', actor: giverId, target: receiverId, item: itemId, significance: 0.5, tick: tw.world.now },
    confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
  };
}

describe('v0.10 §II — obligations are traceable stakes, not favour points', () => {
  it('forms an obligation with full provenance from a real gift, and only from the beneficiary side', () => {
    const tw = createTestWorld(10_001, 40);
    const giver = addPerson(tw, 'Giver', 'smith', v(5.5, 1, 5.5));
    const receiver = addPerson(tw, 'Receiver', 'baker', v(6.5, 1, 5.5));
    const bystander = addPerson(tw, 'Bystander', 'farmer', v(7.5, 1, 5.5));
    giver.wealth = 30;
    const ring = makeItem(tw.world, 'ring', 'a plain ring', { owner: receiver.id, holder: receiver.id });
    ring.value = 40;

    const belief = giftBelief(tw, giver.id, receiver.id, ring.id);
    const kReceiver = learn(tw.world, receiver, belief)!;
    const formed = formObligations(tw.world, receiver, kReceiver);

    expect(formed).toHaveLength(1);
    const o = formed[0];
    expect(o.kind).toBe('was_given');
    expect(o.towardId).toBe(giver.id);
    // Provenance: who feels it, toward whom, why, and because of WHAT canonical event.
    expect(o.causeEventId, 'the obligation names the canonical event it came from').toBe(belief.claim.eventId);
    expect(tw.world.event(o.causeEventId), 'and that event really exists').toBeDefined();
    expect(o.basisKey).toBe(belief.key);
    expect(o.reasons.join(' ')).toMatch(/ring|silver/i);
    expect(o.status).toBe('live');
    // A ring worth more than the giver's whole purse is a large thing to be given.
    expect(o.magnitude).toBeGreaterThan(0.4);

    // The bystander watched the same event and owes nobody anything: an obligation is formed by
    // being the person HELPED, not by knowing that someone was.
    const kBystander = learn(tw.world, bystander, { ...belief })!;
    expect(formObligations(tw.world, bystander, kBystander)).toHaveLength(0);
    expect(liveObligations(bystander)).toHaveLength(0);
    // ...and neither does the giver, from their own act.
    const kGiver = learn(tw.world, giver, { ...belief })!;
    expect(formObligations(tw.world, giver, kGiver)).toHaveLength(0);
  });

  it('weighs the same act differently by cost to the giver, by need, and by closeness', () => {
    const tw = createTestWorld(10_002, 40);
    const rich = addPerson(tw, 'Rich', 'merchant', v(5.5, 1, 5.5));
    const poor = addPerson(tw, 'Poor', 'vagrant', v(6.5, 1, 5.5));
    const strangerA = addPerson(tw, 'StrangerA', 'farmer', v(7.5, 1, 5.5));
    const strangerB = addPerson(tw, 'StrangerB', 'farmer', v(8.5, 1, 5.5));
    const kin = addPerson(tw, 'Kin', 'farmer', v(9.5, 1, 5.5));
    rich.wealth = 400; poor.wealth = 4;
    setRelTags(kin, poor.id, 'sibling'); setRelTags(poor, kin.id, 'sibling');

    const mk = (owner: Person, value: number, id: string) => { const it = makeItem(tw.world, 'ring', id, { owner: owner.id }); it.value = value; return it; };
    const fromRich = mk(rich, 30, 'from-rich');
    const fromPoor = mk(poor, 30, 'from-poor');

    const richGift = formObligations(tw.world, strangerA, learn(tw.world, strangerA, giftBelief(tw, rich.id, strangerA.id, fromRich.id, 'e_rich'))!)[0];
    const poorGift = formObligations(tw.world, strangerB, learn(tw.world, strangerB, giftBelief(tw, poor.id, strangerB.id, fromPoor.id, 'e_poor'))!)[0];
    // The same object given by someone who can barely spare it weighs more.
    expect(poorGift.magnitude).toBeGreaterThan(richGift.magnitude);

    // ...and the same gift between siblings weighs markedly less: kin do for one another, and
    // recording a debt for every such act would turn family life into a ledger.
    const fromKin = mk(kin, 30, 'from-kin');
    const kinGift = formObligations(tw.world, poor, learn(tw.world, poor, giftBelief(tw, kin.id, poor.id, fromKin.id, 'e_kin'))!)[0];
    expect(kinGift.magnitude).toBeLessThan(poorGift.magnitude);
    expect(kinGift.reasons.join(' ')).toMatch(/kin do this for one another/);
  });

  it('records nothing at all for a trifle', () => {
    const tw = createTestWorld(10_003, 40);
    const giver = addPerson(tw, 'Giver', 'baker', v(5.5, 1, 5.5));
    const receiver = addPerson(tw, 'Receiver', 'farmer', v(6.5, 1, 5.5));
    giver.wealth = 500; receiver.wealth = 500;
    const crumb = makeItem(tw.world, 'bread', 'a crust', { owner: giver.id });
    crumb.value = 0;
    const k = learn(tw.world, receiver, giftBelief(tw, giver.id, receiver.id, crumb.id))!;
    // The formation threshold exists precisely so ordinary kindness stays ordinary.
    expect(formObligations(tw.world, receiver, k)).toHaveLength(0);
    expect(MIN_OBLIGATION_MAGNITUDE).toBeGreaterThan(0);
  });

  it('does not ratchet without bound when the same kindness repeats', () => {
    const tw = createTestWorld(10_004, 40);
    const healer = addPerson(tw, 'Healer', 'herbalist', v(5.5, 1, 5.5));
    const hurt = addPerson(tw, 'Hurt', 'farmer', v(6.5, 1, 5.5));
    const tend = (n: number) => {
      const k = learn(tw.world, hurt, {
        key: `ev:e_heal_${n}`, kind: 'event',
        claim: { eventId: `e_heal_${n}`, type: 'heal', actor: healer.id, target: hurt.id, wound: 0.9, significance: 0.4, tick: tw.world.now },
        confidence: 1, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
      } as any)!;
      formObligations(tw.world, hurt, k);
    };
    for (let i = 0; i < 30; i++) tend(i);
    const owed = obligationsOf(hurt);
    // One growing stake, not thirty ledger rows, and it has a ceiling.
    expect(owed).toHaveLength(1);
    expect(owed[0].magnitude).toBeLessThanOrEqual(MAX_OBLIGATION_MAGNITUDE);
    expect(OBLIGATION_REINFORCE_COOLDOWN_SECONDS).toBeGreaterThan(0);
  });

  it('lapses a stake toward someone who dies, and fades an ordinary one over weeks', () => {
    const tw = createTestWorld(10_005, 40);
    const giver = addPerson(tw, 'Giver', 'smith', v(5.5, 1, 5.5));
    const other = addPerson(tw, 'Other', 'smith', v(7.5, 1, 5.5));
    const receiver = addPerson(tw, 'Receiver', 'baker', v(6.5, 1, 5.5));
    giver.wealth = 20; other.wealth = 20;
    const a = makeItem(tw.world, 'ring', 'ring a', { owner: giver.id }); a.value = 40;
    const b = makeItem(tw.world, 'ring', 'ring b', { owner: other.id }); b.value = 40;
    formObligations(tw.world, receiver, learn(tw.world, receiver, giftBelief(tw, giver.id, receiver.id, a.id, 'e_a'))!);
    formObligations(tw.world, receiver, learn(tw.world, receiver, giftBelief(tw, other.id, receiver.id, b.id, 'e_b'))!);
    expect(liveObligations(receiver)).toHaveLength(2);

    giver.alive = false;
    maintainObligations(tw.world, receiver, 1);
    const toDead = obligationsOf(receiver).find(o => o.towardId === giver.id)!;
    expect(toDead.status).toBe('lapsed');
    expect(toDead.resolution).toBe('they_died');

    // The surviving one is still live now, and spent after a couple of months of nothing — at
    // which point it stops being anything at all rather than lingering as a zero-weight row.
    expect(liveObligations(receiver).some(o => o.towardId === other.id)).toBe(true);
    maintainObligations(tw.world, receiver, 24 * 90);
    expect(liveObligations(receiver).some(o => o.towardId === other.id)).toBe(false);
  });

  it('is answered by doing the work, and a broken promise is learned by inference, not broadcast', () => {
    const tw = createTestWorld(10_006, 40);
    const requester = addPerson(tw, 'Requester', 'baker', v(5.5, 1, 5.5), { workId: tw.places.tavern });
    const worker = addPerson(tw, 'Worker', 'vagrant', v(6.5, 1, 5.5));
    const outsider = addPerson(tw, 'Outsider', 'farmer', v(20.5, 1, 20.5));
    requester.wealth = 40;

    const req = createRequest(tw.world, { type: 'haul', requesterId: requester.id, requesterPlaceId: tw.places.tavern, reward: 6, cause: 'the tavern is low on bread', payload: {} });
    acceptRequest(tw.world, req, worker);
    const accepted = obligationsOf(worker).find(o => o.kind === 'accepted_task');
    expect(accepted, 'accepting commissioned work records a real, breakable promise').toBeDefined();
    expect(accepted!.requestId).toBe(req.id);
    expect(requestById(tw.world, req.id)).toBe(req);

    completeRequest(tw.world, req);
    expect(obligationsOf(worker).find(o => o.kind === 'accepted_task')!.status).toBe('fulfilled');

    // ...and the failure case, on a second promise.
    const req2 = createRequest(tw.world, { type: 'haul', requesterId: requester.id, requesterPlaceId: tw.places.tavern, reward: 6, cause: 'more bread', payload: {} });
    acceptRequest(tw.world, req2, worker);
    failRequest(tw.world, req2, 'the worker never returned to finish it');
    maintainObligations(tw.world, worker, 0.2);
    const broken = obligationsOf(worker).filter(o => o.requestId === req2.id)[0];
    expect(broken.status).toBe('failed');

    // The person who commissioned it works it out for themselves — their own affairs, at their
    // own place, with `inferred` provenance. Nobody else is told anything.
    noticeBrokenPromises(tw.world, requester, [req2]);
    const belief = requester.knowledge[`promise_broken:${req2.id}`];
    expect(belief, 'the requester infers that work they commissioned was dropped').toBeDefined();
    expect(belief.source.type).toBe('inferred');
    expect(belief.claim.actor).toBe(worker.id);
    expect(getRel(requester, worker.id).trust).toBeLessThan(0);

    noticeBrokenPromises(tw.world, outsider, [req2]);
    expect(outsider.knowledge[`promise_broken:${req2.id}`], 'a villager across the vale learns nothing by magic').toBeUndefined();
  });

  it('bends decisions toward the person owed — and only toward them', () => {
    const tw = createTestWorld(10_007, 40);
    const benefactor = addPerson(tw, 'Benefactor', 'smith', v(5.5, 1, 5.5));
    const stranger = addPerson(tw, 'Stranger', 'smith', v(7.5, 1, 5.5));
    const debtor = addPerson(tw, 'Debtor', 'baker', v(6.5, 1, 5.5));
    benefactor.wealth = 20;
    const gift = makeItem(tw.world, 'ring', 'a ring', { owner: benefactor.id }); gift.value = 40;
    formObligations(tw.world, debtor, learn(tw.world, debtor, giftBelief(tw, benefactor.id, debtor.id, gift.id))!);

    const toward = obligationGoalBoost(debtor, 'help', benefactor.id);
    const away = obligationGoalBoost(debtor, 'help', stranger.id);
    expect(toward.bonus).toBeGreaterThan(0);
    expect(away.bonus).toBe(0);
    expect(obligationCredit(debtor, benefactor.id)).toBeGreaterThan(0);
    expect(obligationCredit(debtor, stranger.id)).toBe(0);

    // A haul serves whoever COMMISSIONED it, which is not the goal's own target.
    expect(obligationGoalBoost(debtor, 'haul', undefined, benefactor.id).bonus).toBeGreaterThan(0);

    // Debt makes people helpful, never belligerent: no goal that sends someone toward a fight
    // may ever be lifted by it.
    for (const t of ['attack', 'confront', 'rob', 'investigate'] as GoalType[]) {
      expect(obligationGoalBoost(debtor, t, benefactor.id).bonus, t).toBe(0);
    }
    expect(describeObligation(tw.world, liveObligations(debtor)[0])).toContain('Benefactor');
  });

  it('softens the reaction to a small wrong by someone you owe — but never to a serious one', () => {
    const tw = createTestWorld(10_008, 40);
    const benefactor = addPerson(tw, 'Benefactor', 'smith', v(5.5, 1, 5.5));
    const debtor = addPerson(tw, 'Debtor', 'baker', v(6.5, 1, 5.5));
    benefactor.wealth = 20;
    const gift = makeItem(tw.world, 'ring', 'a ring', { owner: benefactor.id }); gift.value = 40;
    formObligations(tw.world, debtor, learn(tw.world, debtor, giftBelief(tw, benefactor.id, debtor.id, gift.id))!);
    expect(forgivenessFor(debtor, benefactor.id, 0.35)).toBeGreaterThan(0);
    expect(forgivenessFor(debtor, benefactor.id, 0.6), 'a standing favour does not buy forgiveness for a beating').toBe(0);
    expect(forgivenessFor(debtor, benefactor.id, 0.35)).toBeLessThanOrEqual(0.5);
  });
});

describe('v0.10 §I — persistent purposes outlive the plans that serve them', () => {
  /** A spouse who has just learned the other was badly beaten. The shape every `tend` case has. */
  function worriedSpouse(seed: number) {
    const tw = createTestWorld(seed, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(20.5, 1, 20.5));
    const hurt = addPerson(tw, 'Hurt', 'farmer', v(30.5, 1, 30.5));
    const spouse = addPerson(tw, 'Spouse', 'cook', v(5.5, 1, 5.5), { homeId: tw.places.tavern });
    setRelTags(spouse, hurt.id, 'spouse'); setRelTags(hurt, spouse.id, 'spouse');
    const k = learn(tw.world, spouse, attackBelief(tw, attacker.id, hurt.id))!;
    formConcerns(tw.world, spouse, k);
    return { tw, spouse, hurt, attacker };
  }

  it('turns a live welfare concern into a purpose with grounds and a traceable cause', () => {
    const { tw, spouse, hurt } = worriedSpouse(10_101);
    formPursuits(tw.world, spouse);
    const live = livePursuits(spouse);
    expect(live).toHaveLength(1);
    expect(live[0].kind).toBe('tend');
    expect(live[0].subjectId).toBe(hurt.id);
    expect(live[0].source.kind).toBe('concern');
    expect(tw.world.event(live[0].causeEventId), 'the purpose names a canonical event that really exists').toBeDefined();
    expect(tw.world.event(live[0].causeEventId)!.type).toBe('attack');
    expect(live[0].reasons.join(' ')).toMatch(/Hurt/);
    // Idempotent: the same live concern does not spawn a second errand to the same door.
    formPursuits(tw.world, spouse);
    expect(livePursuits(spouse)).toHaveLength(1);
  });

  it('re-derives its next step from world state, so one purpose produces different actions', () => {
    const { tw, spouse, hurt } = worriedSpouse(10_102);
    formPursuits(tw.world, spouse);
    maintainPursuits(tw.world, spouse);
    const pu = livePursuits(spouse)[0];
    expect(pu.status).toBe('active');

    // 1. They are far away and I have nothing to bring: go and look.
    let steps = pursuitSteps(tw.world, spouse, pu);
    expect(steps.map(s => s.goal)).toContain('check_on');

    // 2. Give them something worth bringing and the SAME purpose proposes a different act.
    const loaf = makeItem(tw.world, 'bread', 'a loaf', { owner: spouse.id, holder: spouse.id, quantity: 4 });
    spouse.inventory.push(loaf.id);
    steps = pursuitSteps(tw.world, spouse, pu);
    expect(steps.map(s => s.goal), 'with something to bring, the errand changes').toContain('provide');

    // 3. Put them in front of me, hurt, and it becomes tending them.
    const body = tw.world.primaryBody(hurt.id)!;
    body.health = body.maxHealth * 0.2;
    spouse.mind.percepts = [{ entityId: hurt.id, bodyId: body.id, how: 'saw', tick: tw.world.now, pos: { ...body.pos }, distance: 2 }];
    steps = pursuitSteps(tw.world, spouse, pu);
    expect(steps.map(s => s.goal)).toContain('help');

    // Nothing a purpose ever proposes may be a goal that walks someone into a fight.
    for (const s of steps) expect(PURSUIT_FORBIDDEN_GOALS.has(s.goal), s.goal).toBe(false);
  });

  it('ends when its condition is met, when its source goes, and when it simply runs out of time', () => {
    const { tw, spouse, hurt } = worriedSpouse(10_103);
    formPursuits(tw.world, spouse);
    maintainPursuits(tw.world, spouse);
    const pu = livePursuits(spouse)[0];
    expect(pursuitOutcome(tw.world, spouse, pu)).toBeNull();

    // The subject dying makes it impossible, with a stated reason.
    hurt.alive = false;
    expect(pursuitOutcome(tw.world, spouse, pu)).toEqual({ status: 'impossible', resolution: 'they_died' });
    hurt.alive = true;

    // The concern behind it being discharged satisfies it.
    const concern = spouse.mind.concerns!.find(c => c.id === pu.source.id)!;
    concern.status = 'addressed';
    expect(pursuitOutcome(tw.world, spouse, pu)).toEqual({ status: 'satisfied', resolution: 'seen_well' });
    concern.status = 'active';

    // And nothing is immortal: past its ceiling it is abandoned, explicitly.
    tw.world.clock.worldSeconds = pu.expiresAt + 1;
    expect(pursuitOutcome(tw.world, spouse, pu)).toEqual({ status: 'abandoned', resolution: 'expired' });
  });

  it('bounds how many purposes a person can hold, and how many can be acted on at once', () => {
    const tw = createTestWorld(10_104, 40);
    const worrier = addPerson(tw, 'Worrier', 'elder', v(5.5, 1, 5.5));
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(20.5, 1, 20.5));
    for (let i = 0; i < MAX_PURSUITS + 4; i++) {
      const friend = addPerson(tw, `Friend${i}`, 'farmer', v(10.5 + i, 1, 30.5));
      setRelTags(worrier, friend.id, 'friend'); setRelTags(friend, worrier.id, 'friend');
      const k = learn(tw.world, worrier, attackBelief(tw, attacker.id, friend.id))!;
      formConcerns(tw.world, worrier, k);
    }
    formPursuits(tw.world, worrier);
    maintainPursuits(tw.world, worrier);
    expect(pursuitsOf(worrier).length).toBeLessThanOrEqual(MAX_PURSUITS);
    const active = livePursuits(worrier).filter(x => x.status === 'active');
    expect(active.length).toBeLessThanOrEqual(MAX_ACTIVE_PURSUITS);
    // What is set aside is kept, not thrown away.
    expect(livePursuits(worrier).some(x => x.status === 'deferred')).toBe(true);
  });

  /**
   * The deterministic counterpart of `npm run motive:trace`'s "the choice changes when the state
   * changes". That harness looks for someone who HAPPENED to accumulate three live purposes in a
   * 36-hour window — roughly 1% of person-samples — so which village demonstrates it is decided by
   * where everybody was standing, and any change to simulation behaviour re-rolls it (measured:
   * `main` itself fails that check at seed 1337). The semantics do not need luck to be checked:
   * build the competition directly and drive the state change by hand.
   */
  it('changes which purposes are being pursued when the state changes, and keeps the displaced one', () => {
    const tw = createTestWorld(10_110, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(20.5, 1, 20.5));
    const carer = addPerson(tw, 'Carer', 'cook', v(5.5, 1, 5.5));
    const hurt = [0, 1, 2].map(i => {
      const friend = addPerson(tw, `Friend${i}`, 'farmer', v(30.5 + i, 1, 30.5));
      setRelTags(carer, friend.id, 'friend'); setRelTags(friend, carer.id, 'friend');
      formConcerns(tw.world, carer, learn(tw.world, carer, attackBelief(tw, attacker.id, friend.id) as KnowledgeItem)!);
      return friend;
    });
    formPursuits(tw.world, carer);
    maintainPursuits(tw.world, carer);

    const live = livePursuits(carer);
    expect(live.length).toBeGreaterThan(MAX_ACTIVE_PURSUITS);
    const activeBefore = live.filter(x => x.status === 'active');
    const deferredBefore = live.filter(x => x.status === 'deferred');
    expect(activeBefore.length).toBe(MAX_ACTIVE_PURSUITS);
    expect(deferredBefore.length).toBeGreaterThan(0);

    // The set-aside worry becomes the pressing one, and the least pressing active one eases —
    // through the concerns the purposes actually rest on, not by writing priorities directly.
    const promoted = deferredBefore[0];
    const demoted = [...activeBefore].sort((a, b) => a.priority - b.priority)[0];
    carer.mind.concerns!.find(c => c.id === promoted.source.id)!.intensity = 1;
    carer.mind.concerns!.find(c => c.id === demoted.source.id)!.intensity = 0.15;
    // A more pressing alternative cannot displace work during its protected dwell.
    // The trace must explain this temporary priority reversal instead of calling it a defect.
    tw.world.clock.advance((PURSUIT_MIN_DWELL_SECONDS - 60) / tw.world.clock.timeScale);
    maintainPursuits(tw.world, carer);
    expect(promoted.priority).toBeGreaterThan(demoted.priority + PRIORITY_MARGIN);
    expect(promoted.status).toBe('deferred');
    expect(demoted.status).toBe('active');
    // Past the dwell window, so a purpose in hand is no longer being held for anti-oscillation.
    tw.world.clock.advance(120 / tw.world.clock.timeScale);

    maintainPursuits(tw.world, carer);

    expect(promoted.status).toBe('active');
    expect(promoted.priority).toBeGreaterThan(demoted.priority + PRIORITY_MARGIN);
    // The displaced purpose is SET ASIDE, not discarded: still live, still re-considered.
    expect(demoted.status).toBe('deferred');
    expect(livePursuits(carer)).toContain(demoted);
    expect(pursuitsOf(carer).filter(x => x.status === 'active').length).toBeLessThanOrEqual(MAX_ACTIVE_PURSUITS);
    // ...and the active set really is the most pressing live ones, not a fixed ordering.
    const nowActive = livePursuits(carer).filter(x => x.status === 'active');
    const nowDeferred = livePursuits(carer).filter(x => x.status === 'deferred');
    for (const d of nowDeferred) {
      expect(Math.min(...nowActive.map(a => a.priority))).toBeGreaterThan(d.priority - PRIORITY_MARGIN);
    }
    void hurt;
  });

  it('always loses to the body: a purpose is scaled by real physiological severity', () => {
    const { tw, spouse, hurt } = worriedSpouse(10_105);
    formPursuits(tw.world, spouse);
    maintainPursuits(tw.world, spouse);
    const pu = livePursuits(spouse)[0];
    pu.priority = 1;
    const step = pursuitSteps(tw.world, spouse, pu)[0];
    const healthy = pursuitStepUtility(pu, step, 1);
    const urgent = pursuitStepUtility(pu, step, 0.55);
    const critical = pursuitStepUtility(pu, step, 0.25);
    const inDanger = pursuitStepUtility(pu, step, 0);
    expect(healthy).toBeGreaterThan(urgent);
    expect(urgent).toBeGreaterThan(critical);
    expect(inDanger).toBe(0);
    // Even a maximal purpose stays below the top of the utility range, where a bedtime sleep, a
    // critical thirst and a real emergency live.
    expect(healthy).toBeLessThan(0.95);
    void hurt;
  });

  it('never lifts a goal that is not actually for the person, however aimed', () => {
    const { tw, spouse, hurt } = worriedSpouse(10_106);
    formPursuits(tw.world, spouse);
    maintainPursuits(tw.world, spouse);
    // `report` takes a GUARD as its target; a purpose about someone must not be credited with,
    // or add weight to, telling the watch about a crime just because the two ids line up.
    for (const t of ['report', 'investigate', 'attack', 'confront'] as GoalType[]) {
      expect(PURSUIT_SERVING_GOALS.has(t), t).toBe(false);
      expect(pursuitGoalBoost(spouse, t, hurt.id).bonus, t).toBe(0);
    }
    expect(pursuitGoalBoost(spouse, 'check_on', hurt.id).bonus).toBeGreaterThan(0);
    expect(motivationBoost(spouse, 'check_on', hurt.id).bonus).toBeGreaterThan(0);
  });

  it('caps concern + obligation + purpose together, so a motivated person bends and is never dictated to', () => {
    const tw = createTestWorld(10_107, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(20.5, 1, 20.5));
    const hurt = addPerson(tw, 'Hurt', 'smith', v(30.5, 1, 30.5));
    const carer = addPerson(tw, 'Carer', 'cook', v(5.5, 1, 5.5));
    hurt.wealth = 10;
    setRelTags(carer, hurt.id, 'spouse'); setRelTags(hurt, carer.id, 'spouse');
    formConcerns(tw.world, carer, learn(tw.world, carer, attackBelief(tw, attacker.id, hurt.id))!);
    const gift = makeItem(tw.world, 'ring', 'a ring', { owner: hurt.id }); gift.value = 60;
    formObligations(tw.world, carer, learn(tw.world, carer, giftBelief(tw, hurt.id, carer.id, gift.id))!);
    formPursuits(tw.world, carer);
    maintainPursuits(tw.world, carer);

    const boost = motivationBoost(carer, 'check_on', hurt.id, hurt.id);
    expect(boost.bonus).toBeGreaterThan(0);
    expect(boost.bonus).toBeLessThanOrEqual(MAX_MOTIVATION_BONUS);
    expect(boost.reasons.length).toBeGreaterThan(0);
  });

  it('reads how badly someone is hurt from beliefs only, never from the canonical body', () => {
    const tw = createTestWorld(10_108, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(20.5, 1, 20.5));
    const hurt = addPerson(tw, 'Hurt', 'farmer', v(30.5, 1, 30.5));
    const informed = addPerson(tw, 'Informed', 'cook', v(5.5, 1, 5.5));
    const ignorant = addPerson(tw, 'Ignorant', 'cook', v(6.5, 1, 5.5));
    const body = tw.world.primaryBody(hurt.id)!;
    body.health = 1; // canonically at death's door

    learn(tw.world, informed, attackBelief(tw, attacker.id, hurt.id));
    expect(believedHarm(tw.world, informed, hurt.id)).toBeGreaterThan(0.3);
    expect(believedHarm(tw.world, ignorant, hurt.id), 'someone who was never told believes nothing').toBe(0);

    // A first-hand look overrides hearsay in both directions.
    learn(tw.world, informed, { key: `state:${hurt.id}`, kind: 'state', claim: { entityId: hurt.id, state: 'unharmed', tick: tw.world.now }, confidence: 1, source: { type: 'witnessed' } } as any);
    expect(believedHarm(tw.world, informed, hurt.id)).toBe(0);
  });

  it('prioritises by relationship and by how bad they believe it is, and reorders when state changes', () => {
    const tw = createTestWorld(10_109, 40);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(20.5, 1, 20.5));
    const spouse = addPerson(tw, 'Spouse', 'farmer', v(30.5, 1, 30.5));
    const acquaintance = addPerson(tw, 'Acquaintance', 'farmer', v(31.5, 1, 30.5));
    const carer = addPerson(tw, 'Carer', 'cook', v(5.5, 1, 5.5));
    setRelTags(carer, spouse.id, 'spouse'); setRelTags(spouse, carer.id, 'spouse');
    getRel(carer, acquaintance.id).familiarity = 0.4;
    formConcerns(tw.world, carer, learn(tw.world, carer, attackBelief(tw, attacker.id, spouse.id))!);
    formConcerns(tw.world, carer, learn(tw.world, carer, attackBelief(tw, attacker.id, acquaintance.id))!);
    formPursuits(tw.world, carer);
    maintainPursuits(tw.world, carer);

    const forSpouse = livePursuits(carer).find(x => x.subjectId === spouse.id)!;
    const forOther = livePursuits(carer).find(x => x.subjectId === acquaintance.id);
    expect(forSpouse).toBeDefined();
    if (forOther) expect(pursuitPriority(tw.world, carer, forSpouse)).toBeGreaterThan(pursuitPriority(tw.world, carer, forOther));

    // Seeing the spouse well drops that priority — selection follows state, it is not a fixed order.
    const before = pursuitPriority(tw.world, carer, forSpouse);
    learn(tw.world, carer, { key: `state:${spouse.id}`, kind: 'state', claim: { entityId: spouse.id, state: 'unharmed', tick: tw.world.now }, confidence: 1, source: { type: 'witnessed' } } as any);
    carer.mind.concerns!.find(c => c.id === forSpouse.source.id)!.intensity *= 0.2;
    expect(pursuitPriority(tw.world, carer, forSpouse)).toBeLessThan(before);
  });
});

describe('v0.10 — the whole layer survives a save and a reload', () => {
  it('round-trips obligations and purposes, which cannot be re-derived from present state', () => {
    const { world } = newWorld(4242);
    const sim = new Simulation(world);
    const people = world.persons().filter(p => p.alive && !isExternallyControlled(p));
    const benefactor = people[0]; const debtor = people[1]; const hurt = people[2];
    benefactor.wealth = 20;
    const gift = makeItem(world, 'ring', 'a ring', { owner: benefactor.id }); gift.value = 50;
    formObligations(world, debtor, learn(world, debtor, {
      key: 'ev:e_gift', kind: 'event',
      claim: { eventId: 'e_gift', type: 'gift', actor: benefactor.id, target: debtor.id, item: gift.id, significance: 0.5, tick: world.now },
      confidence: 1, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
    } as any)!);
    setRelTags(debtor, hurt.id, 'spouse'); setRelTags(hurt, debtor.id, 'spouse');
    formConcerns(world, debtor, learn(world, debtor, {
      key: 'ev:e_atk', kind: 'event',
      claim: { eventId: 'e_atk', type: 'attack', actor: benefactor.id, target: hurt.id, significance: 0.7, tick: world.now },
      confidence: 1, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
    } as any)!);
    formPursuits(world, debtor);
    maintainPursuits(world, debtor);
    const beforeObligations = obligationsOf(debtor).map(o => ({ ...o }));
    const beforePursuits = pursuitsOf(debtor).map(x => ({ ...x }));
    expect(beforeObligations.length).toBeGreaterThan(0);
    expect(beforePursuits.length).toBeGreaterThan(0);

    const loaded = deserialize(serialize(world));
    expect(loaded, 'the save must load at the current schema version').not.toBeNull();
    const reloaded = loaded!.world.person(debtor.id)!;
    expect(obligationsOf(reloaded).map(o => ({ ...o }))).toEqual(beforeObligations);
    expect(pursuitsOf(reloaded).map(x => ({ ...x }))).toEqual(beforePursuits);
    // Deep-copied, not shared with the serialized payload.
    obligationsOf(reloaded)[0].reasons.push('mutated after load');
    expect(beforeObligations[0].reasons).not.toContain('mutated after load');
    void sim;
  });
});

describe('v0.10 — a purpose actually drives behaviour in a running simulation', () => {
  it('makes someone who believes their spouse is hurt go to them, and stop once they have seen them well', () => {
    const tw = createTestWorld(10_301, 60);
    const attacker = addPerson(tw, 'Attacker', 'woodcutter', v(50.5, 1, 50.5));
    const hurt = addPerson(tw, 'Hurt', 'farmer', v(40.5, 1, 40.5), { homeId: tw.places.chapel });
    const spouse = addPerson(tw, 'Spouse', 'cook', v(4.5, 1, 4.5), { homeId: tw.places.tavern });
    setRelTags(spouse, hurt.id, 'spouse'); setRelTags(hurt, spouse.id, 'spouse');
    const hurtBody = tw.world.primaryBody(hurt.id)!;
    hurtBody.health = hurtBody.maxHealth * 0.2;
    // They know where their spouse was last seen — real, ordinary location knowledge.
    learn(tw.world, spouse, { key: `loc:${hurt.id}`, kind: 'location', claim: { entityId: hurt.id, pos: { ...hurtBody.pos }, tick: tw.world.now }, confidence: 1, source: { type: 'witnessed' } } as any);
    formConcerns(tw.world, spouse, learn(tw.world, spouse, attackBelief(tw, attacker.id, hurt.id))!);

    const startDistance = Math.hypot(tw.world.primaryBody(spouse.id)!.pos.x - hurtBody.pos.x, tw.world.primaryBody(spouse.id)!.pos.z - hurtBody.pos.z);
    const goals: string[] = [];
    let closestDistance = startDistance;
    tw.world.onEvent(e => {
      if (e.type === 'goal_changed' && e.actor === spouse.id) goals.push(String(e.data?.to));
      const pos = tw.world.primaryBody(spouse.id)!.pos;
      closestDistance = Math.min(closestDistance, Math.hypot(pos.x-hurtBody.pos.x,pos.z-hurtBody.pos.z));
    });
    step(tw, 900);

    expect(livePursuits(spouse).length + pursuitsOf(spouse).length, 'a purpose formed during ordinary simulation').toBeGreaterThan(0);
    const purposeGoals = goals.filter(g => ['check_on', 'provide', 'help'].includes(g));
    expect(purposeGoals.length, `expected a purpose-driven goal, saw ${goals.join(',')}`).toBeGreaterThan(0);
    // A completed visit can be followed by another errand before this 15-hour run ends.
    expect(closestDistance, 'they actually reached their spouse').toBeLessThan(4);
  });
});
