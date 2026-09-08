import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, face, step, v, wall } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { addPlaceStock } from '../src/sim/world/stock';
import { learn } from '../src/sim/mind/knowledge';
import { getRel, setRelTags } from '../src/sim/mind/relationships';
import { activeConcerns, concernGoalBoost, concernsOf, maintainConcerns } from '../src/sim/mind/concern';
import { clearShortfall, noteWorkBlocked, shortfallKey } from '../src/sim/world/shortfall';
import { causeOf, drawInferences, MAX_INFERRED_GRIEVANCE } from '../src/sim/mind/inference';
import { claimHaulTask, createHaulTask, depositHaulCargo, loadHaulCargo } from '../src/sim/logistics/haul';
import { explainConcern, explainGoal, explainRelationship, traceLines } from '../src/sim/history/causality';
import { TRADE_MAKES, TRADE_NEEDS, tradeMakes, tradeNeeds, tradesThatMake } from '../src/sim/world/supply';
import { bake, mill, saw } from '../src/sim/world/metabolism';
import { productionSpecs } from '../src/sim/world/production';
import { consumerDemands } from '../src/sim/logistics/haul';
import { ITEM_LABEL } from '../src/sim/world/factory';
import { generateVillage } from '../src/sim/world/village';
import { World } from '../src/sim/core/world';
import { handInteractions, performHandInteraction } from '../src/sim/physical/hand';
import { appraiseClaim } from '../src/sim/social/appraisal';
import type { Person, Vec3 } from '../src/sim/core/types';

/**
 * CAUSAL SOCIETY. These assert CAUSAL SEMANTICS, not implementation trivia: that a belief has the
 * provenance it should have and not a better one, that a conclusion is weaker than what it was
 * drawn from, that a person with no evidence concludes nothing, and that a decision can be walked
 * back to the event responsible for it.
 *
 * Everything here goes through the same canonical methods an NPC or the player would go through.
 * Nothing asserts on log text.
 */

type TW = ReturnType<typeof createTestWorld>;

/** A test village with the two ends of a real supply chain in it. */
function withTrades(tw: TW) {
  const mill = makePlace(tw.world, 'mill', 'test mill', { x0: 2, z0: 2, x1: 7, z1: 7, y0: 1, y1: 4 }, { inside: v(4, 1, 4) });
  const bakery = makePlace(tw.world, 'bakery', 'test bakery', { x0: 12, z0: 2, x1: 17, z1: 7, y0: 1, y1: 4 }, { inside: v(14, 1, 4) });
  return { mill: mill.id, bakery: bakery.id, millPos: mill.inside as Vec3, bakeryPos: bakery.inside as Vec3 };
}

function attackBelief(tw: TW, p: Person, actorId: string | undefined, targetId: string, o: { eventId?: string; confidence?: number; hops?: number } = {}) {
  const eventId = o.eventId ?? 'e_atk';
  return learn(tw.world, p, {
    key: `ev:${eventId}`, kind: 'event',
    claim: {
      eventId, type: 'attack', actor: actorId, actorUnknown: actorId ? undefined : true,
      target: targetId, significance: 0.7, tick: tw.world.now,
    },
    confidence: o.confidence ?? 1, hops: o.hops ?? 0,
    source: o.hops ? { type: 'told', from: targetId } : { type: 'witnessed' },
  }, true)!;
}

// ---------------------------------------------------------------------------------------------

describe('Causal Society — a stoppage becomes something minds can hold', () => {
  it('gives the worker who found the bin empty a first-hand belief and a supply worry, and nobody else anything', () => {
    const tw = createTestWorld(4001, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const faraway = addPerson(tw, 'Faraway', 'farmer', v(35.5, 1, 35.5));

    const belief = noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');

    expect(belief).toBeTruthy();
    expect(belief!.key).toBe(shortfallKey(pl.bakery, 'flour'));
    expect(belief!.source.type).toBe('self');
    expect(belief!.hops).toBe(0);
    expect(belief!.confidence).toBe(1);
    expect(belief!.claim.need).toBe('flour');
    expect(belief!.claim.making).toBe('bread');

    const supply = activeConcerns(baker).filter(c => c.kind === 'supply');
    expect(supply).toHaveLength(1);
    expect(supply[0].resource).toBe('flour');
    expect(supply[0].placeId).toBe(pl.bakery);
    expect(supply[0].basisKeys).toContain(belief!.key);

    // No omniscience: a farmer at the far edge of the map learns nothing at all from it.
    expect(faraway.knowledge[shortfallKey(pl.bakery, 'flour')]).toBeUndefined();
    expect(activeConcerns(faraway)).toHaveLength(0);
  });

  it('does not re-announce a shortage it is already standing in — it just becomes more certain of it', () => {
    const tw = createTestWorld(4002, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });

    expect(noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread')).toBeTruthy();
    const again = noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    expect(again).toBeNull();

    expect(tw.world.events.filter(e => e.type === 'work_blocked')).toHaveLength(1);
    const belief = baker.knowledge[shortfallKey(pl.bakery, 'flour')];
    expect(belief.confidence).toBe(1);
    expect(belief.lastConfirmedAt).toBe(tw.world.now);
    expect(activeConcerns(baker).filter(c => c.kind === 'supply')).toHaveLength(1);
  });

  it('lands in the same slot however it was come by, so one continuing shortage is one belief', () => {
    const tw = createTestWorld(4007, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const bystander = addPerson(tw, 'Bystander', 'server', v(15, 1, 4), { workId: pl.bakery });
    face(bystander, tw, pl.bakeryPos);

    noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    step(tw, 1);

    const key = shortfallKey(pl.bakery, 'flour');
    const seen = bystander.knowledge[key];
    expect(seen).toBeTruthy();
    expect(seen.source.type).toBe('witnessed');
    expect(seen.hops).toBe(0);
    // ...and NOT under a second, event-shaped key that could never merge with anyone else's.
    expect(Object.keys(bystander.knowledge).filter(k => k.startsWith('short:'))).toHaveLength(1);
    expect(Object.values(bystander.knowledge).filter(k => k.claim.type === 'work_blocked')).toHaveLength(1);
  });

  it('keeps who it has already told when the same shortage is still standing hours later', () => {
    const tw = createTestWorld(4008, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const neighbour = addPerson(tw, 'Neighbour', 'farmer', v(14.5, 1, 4));

    const belief = noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread')!;
    tw.sim.tell(baker, neighbour, belief);
    expect(belief.sharedWith).toContain(neighbour.id);

    // Nine world hours later the bakery is still empty and the baker tries again.
    tw.world.clock.advance(9 * 3600);
    const again = noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');

    expect(again).toBe(belief); // the same standing belief, refreshed
    expect(tw.world.events.filter(e => e.type === 'work_blocked')).toHaveLength(2);
    expect(belief.confidence).toBe(1);
    // A shortage that has not lifted is not fresh news to the people who already heard about it.
    expect(belief.sharedWith).toContain(neighbour.id);
  });

  it('travels by being told, one hop at a time, and reaches nobody it was not told', () => {
    const tw = createTestWorld(4003, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const hauler = addPerson(tw, 'Hauler', 'farmer', v(14.5, 1, 4));
    const third = addPerson(tw, 'Third', 'server', v(15.5, 1, 4));
    const outsider = addPerson(tw, 'Outsider', 'smith', v(35.5, 1, 35.5));

    const belief = noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread')!;
    tw.sim.tell(baker, hauler, belief);
    const heard = hauler.knowledge[belief.key];
    expect(heard).toBeTruthy();
    expect(heard.source.type).toBe('told');
    expect(heard.source.from).toBe(baker.id);
    expect(heard.hops).toBe(1);
    expect(heard.confidence).toBeLessThan(belief.confidence);

    tw.sim.tell(hauler, third, heard);
    const thirdHand = third.knowledge[belief.key];
    expect(thirdHand.hops).toBe(2);
    expect(thirdHand.confidence).toBeLessThan(heard.confidence);
    expect(thirdHand.source.from).toBe(hauler.id);

    // Repeated propagation must not inflate anything: telling the hauler again cannot make their
    // belief better than the one they were told, nor add a hop.
    tw.sim.tell(baker, hauler, belief);
    expect(hauler.knowledge[belief.key].hops).toBe(1);
    expect(hauler.knowledge[belief.key].confidence).toBeLessThan(belief.confidence);

    expect(outsider.knowledge[belief.key]).toBeUndefined();
  });

  it('lifts the haul that carries the missing material, and no other haul, and only the trade that makes it', () => {
    const tw = createTestWorld(4004, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const miller = addPerson(tw, 'Miller', 'miller', pl.millPos, { workId: pl.mill });

    const belief = noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread')!;
    tw.sim.tell(baker, miller, belief);

    expect(concernGoalBoost(baker, 'haul', undefined, 'flour').bonus).toBeGreaterThan(0);
    expect(concernGoalBoost(baker, 'haul', undefined, 'log').bonus).toBe(0);
    expect(concernGoalBoost(baker, 'haul', undefined, undefined).bonus).toBe(0);
    // Standing in an empty bakery does not make flour appear, so the worry does not push the
    // baker to work; it pushes the MILLER to, because flour is what a miller's trade puts out.
    expect(concernGoalBoost(baker, 'work').bonus).toBe(0);
    expect(concernGoalBoost(miller, 'work').bonus).toBeGreaterThan(0);
    // A concern bends a decision, it never dictates one.
    expect(concernGoalBoost(miller, 'work').bonus).toBeLessThanOrEqual(0.3);
    // Nothing that walks anybody toward another person.
    for (const g of ['attack', 'confront', 'investigate', 'rob'] as const) {
      expect(concernGoalBoost(baker, g, miller.id, 'flour').bonus).toBe(0);
    }
  });

  it('is discharged when the worker gets a batch out of the very thing they believed was gone', () => {
    const tw = createTestWorld(4005, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });

    noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    expect(activeConcerns(baker).some(c => c.kind === 'supply')).toBe(true);

    clearShortfall(tw.world, baker, pl.bakery, 'flour');
    maintainConcerns(tw.world, baker, 0.1);

    const supply = concernsOf(baker).find(c => c.kind === 'supply')!;
    expect(supply.status).toBe('addressed');
    expect(tw.world.events.some(e => e.type === 'concern_resolved' && e.data.resolution === 'supplied')).toBe(true);
  });

  it('leaves a hearer worrying only if the shortage actually reaches their own trade', () => {
    const tw = createTestWorld(4006, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const miller = addPerson(tw, 'Miller', 'miller', pl.millPos, { workId: pl.mill });
    const priest = addPerson(tw, 'Priest', 'priest', v(20.5, 1, 20.5), { workId: tw.places.chapel });

    const belief = noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread')!;
    tw.sim.tell(baker, miller, belief);
    tw.sim.tell(baker, priest, belief);

    expect(activeConcerns(miller).some(c => c.kind === 'supply')).toBe(true);
    expect(activeConcerns(priest).some(c => c.kind === 'supply')).toBe(false);
    // ...and it must not have been misread as something having befallen the baker.
    expect(activeConcerns(miller).some(c => c.kind === 'welfare')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Causal Society — the trades table describes the mechanics it claims to', () => {
  /**
   * `world/supply.ts` is common knowledge ABOUT mechanics that live in `world/metabolism.ts`, not
   * a replacement for them (Constitution §IX, capability over labels). Being a description, it can
   * drift out of step with what it describes — so this drives the real transforms with empty
   * inputs and checks that the material each one actually reports missing is the material the
   * table says that trade needs.
   */
  it('names, for each trade, the material its real transform actually stops for', () => {
    const tw = createTestWorld(4401, 40);
    const pl = withTrades(tw);
    makePlace(tw.world, 'sawpit', 'test sawpit', { x0: 22, z0: 2, x1: 27, z1: 7, y0: 1, y1: 4 }, { inside: v(24, 1, 4) });
    const miller = addPerson(tw, 'Miller', 'miller', pl.millPos, { workId: pl.mill });
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const sawyer = addPerson(tw, 'Sawyer', 'woodcutter', v(24, 1, 4));

    const milled = mill(tw.world, miller);
    expect(milled.ok).toBe(false);
    expect(TRADE_NEEDS.miller).toContain(milled.shortage);
    expect(TRADE_MAKES.miller).toContain('flour');

    const baked = bake(tw.world, baker);
    expect(baked.ok).toBe(false);
    expect(TRADE_NEEDS.baker).toContain(baked.shortage);
    expect(TRADE_MAKES.baker).toContain('bread');

    const sawn = saw(tw.world, sawyer);
    expect(sawn.ok).toBe(false);
    expect(TRADE_NEEDS.woodcutter).toContain(sawn.shortage);
    expect(TRADE_MAKES.woodcutter).toContain('plank');

    // ...and the two ends of the chain line up: what the baker needs is what the miller makes.
    expect(TRADE_MAKES.miller).toEqual(expect.arrayContaining(TRADE_NEEDS.baker!));
  });

  it('agrees with the canonical production and logistics records over the real generated village', () => {
    const world = new World(918271);
    generateVillage(world);

    // OUTPUT side, against `world/production.ts`: whatever a place canonically puts out, the
    // table must name a trade working there that makes it. A renamed or deleted row fails here.
    for (const spec of productionSpecs()) {
      const place = world.places().find(p => p.type === spec.placeType);
      if (!place) continue;
      const trades = place.workers.map(id => world.person(id)).filter(Boolean).map(p => p!.occupation);
      expect(trades.length).toBeGreaterThan(0);
      expect(trades.some(t => tradeMakes(t, spec.resource))).toBe(true);
    }

    // INPUT side, against `logistics/haul.ts`: for every place that canonically produces
    // something, at least one material the village actually hauls INTO it must be one the table
    // says a trade working there needs. This is what covers the cook, whose transform cannot be
    // driven empty in a unit test without first lighting a real fire.
    for (const spec of productionSpecs()) {
      const place = world.places().find(p => p.type === spec.placeType);
      if (!place) continue;
      const trades = place.workers.map(id => world.person(id)).filter(Boolean).map(p => p!.occupation);
      const delivered = consumerDemands().filter(d => d.destType === spec.placeType).map(d => d.resource);
      expect(delivered.some(r => trades.some(t => tradeNeeds(t, r)))).toBe(true);
    }

    // Every trade named is a trade somebody in this world actually plies.
    const occupations = new Set(world.persons().map(p => p.occupation));
    for (const occ of [...Object.keys(TRADE_MAKES), ...Object.keys(TRADE_NEEDS)]) {
      expect(occupations.has(occ as never)).toBe(true);
    }

    // Nothing may be needed that the world cannot supply: either a trade makes it, or it comes
    // out of the ground. A row asking for a material with no source anywhere would let a mind
    // form a supply worry about something that can never arrive.
    const fromTheGround = new Set(world.resourceNodes.map(n => n.yield));
    for (const [occ, needs] of Object.entries(TRADE_NEEDS)) {
      for (const need of needs ?? []) {
        expect(tradesThatMake(need).length > 0 || fromTheGround.has(need),
          `${occ} needs ${need}, which nothing makes and no resource node yields`).toBe(true);
      }
    }

    // Every material named anywhere in the table is a real item type the world can hold.
    for (const list of [...Object.values(TRADE_MAKES), ...Object.values(TRADE_NEEDS)]) {
      for (const r of list ?? []) expect(ITEM_LABEL[r]).toBeTruthy();
    }
  });

  it('can name a producer for every material a real stoppage can be about', () => {
    // The property the inference engine actually depends on: if a transform can report a material
    // missing, some trade must be nameable as its source, or no stoppage of it could ever be
    // explained. Derived from the real transforms rather than restated by hand.
    const tw = createTestWorld(4403, 40);
    const pl = withTrades(tw);
    makePlace(tw.world, 'sawpit', 'test sawpit', { x0: 22, z0: 2, x1: 27, z1: 7, y0: 1, y1: 4 }, { inside: v(24, 1, 4) });
    const shortages = [
      mill(tw.world, addPerson(tw, 'M', 'miller', pl.millPos, { workId: pl.mill })).shortage,
      bake(tw.world, addPerson(tw, 'B', 'baker', pl.bakeryPos, { workId: pl.bakery })).shortage,
      saw(tw.world, addPerson(tw, 'W', 'woodcutter', v(24, 1, 4))).shortage,
    ].filter(Boolean);
    expect(shortages.length).toBe(3);
    for (const r of shortages) expect(tradesThatMake(r!).length).toBeGreaterThan(0);
  });

  it('is a description, not a gate: it stops nobody from doing anything', () => {
    const tw = createTestWorld(4402, 40);
    const pl = withTrades(tw);
    // A smith, whose trade this table says has nothing to do with flour, standing at the mill
    // with grain in it, still mills — capability and materials decide that, not the label.
    const smith = addPerson(tw, 'Smith', 'smith', pl.millPos, { workId: pl.mill });
    addPlaceStock(tw.world, 'grain', 30, pl.mill, smith.id, undefined, 'seeded');
    const milled = mill(tw.world, smith);
    expect(milled.ok).toBe(true);
    expect(milled.produced).toBeGreaterThan(0);
    expect(tradeMakes('smith', 'flour')).toBe(false);
    // And the smith has no row at all, because nothing in the simulation forges anything — see
    // the rule at the top of world/supply.ts.
    expect(TRADE_MAKES.smith).toBeUndefined();
    expect(TRADE_NEEDS.smith).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------

describe('Causal Society — working out why', () => {
  function bakerWhoCannotBake(seed: number) {
    const tw = createTestWorld(seed, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const miller = addPerson(tw, 'Miller', 'miller', pl.millPos, { workId: pl.mill });
    const raider = addPerson(tw, 'Raider', 'bandit', v(30.5, 1, 30.5));
    noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    return { tw, pl, baker, miller, raider };
  }

  it('draws no conclusion at all when it has no news about the trade that supplies it', () => {
    const { tw, baker, pl } = bakerWhoCannotBake(4101);
    drawInferences(tw.world, baker);
    expect(causeOf(baker, shortfallKey(pl.bakery, 'flour'))).toBeUndefined();
  });

  it('links the stoppage to a producer it has real news about, and holds it less firmly than either premise', () => {
    const { tw, baker, miller, raider, pl } = bakerWhoCannotBake(4102);
    // Second-hand: the baker never saw it, he was told.
    const premise = attackBelief(tw, baker, raider.id, miller.id, { confidence: 0.8, hops: 1 });

    drawInferences(tw.world, baker);

    const why = causeOf(baker, shortfallKey(pl.bakery, 'flour'));
    expect(why).toBeTruthy();
    expect(why!.kind).toBe('cause');
    expect(why!.source.type).toBe('inferred');
    expect(why!.claim.effectKey).toBe(shortfallKey(pl.bakery, 'flour'));
    expect(why!.claim.becauseKey).toBe(premise.key);
    expect(why!.claim.subjectId).toBe(miller.id);
    expect(why!.claim.responsibleId).toBe(raider.id);
    // A conclusion is never firmer than the evidence, nor closer to the source than it.
    expect(why!.confidence).toBeLessThan(premise.confidence);
    expect(why!.confidence).toBeLessThan(baker.knowledge[shortfallKey(pl.bakery, 'flour')].confidence);
    expect(why!.hops).toBe(premise.hops);
  });

  it('preserves uncertainty: a harm whose hand was never seen names nobody, and costs nobody', () => {
    const { tw, baker, miller, raider, pl } = bakerWhoCannotBake(4103);
    attackBelief(tw, baker, undefined, miller.id);

    drawInferences(tw.world, baker);

    const why = causeOf(baker, shortfallKey(pl.bakery, 'flour'))!;
    expect(why).toBeTruthy();
    expect(why.claim.subjectId).toBe(miller.id);
    expect(why.claim.responsibleId).toBeUndefined();
    expect(baker.relationships[raider.id]).toBeUndefined();
  });

  it('makes a crime it never witnessed matter, sours regard for the hand it believes was behind it, and never blames the victim', () => {
    const { tw, baker, miller, raider, pl } = bakerWhoCannotBake(4104);
    attackBelief(tw, baker, raider.id, miller.id, { confidence: 0.9, hops: 1 });
    const beforeMiller = { ...getRel(baker, miller.id) };

    drawInferences(tw.world, baker);

    const towardRaider = getRel(baker, raider.id);
    expect(towardRaider.trust).toBeLessThan(0);
    expect(towardRaider.grudge).toBeGreaterThan(0);
    // Bounded: believing someone ruined your trade is not the same as having watched them do it.
    expect(towardRaider.grudge).toBeLessThanOrEqual(MAX_INFERRED_GRIEVANCE);
    expect(Math.abs(towardRaider.trust)).toBeLessThanOrEqual(MAX_INFERRED_GRIEVANCE);
    // Nobody resents a miller for having been attacked.
    expect(getRel(baker, miller.id).grudge).toBe(beforeMiller.grudge);
    expect(getRel(baker, miller.id).trust).toBe(beforeMiller.trust);

    // The re-appraisal reaches behaviour only through ordinary channels: the watch may be told,
    // and the baker is never moved at the man himself.
    expect(concernGoalBoost(baker, 'report').bonus).toBeGreaterThan(0);
    for (const g of ['attack', 'confront', 'investigate'] as const) {
      expect(concernGoalBoost(baker, g, raider.id).bonus).toBe(0);
    }
  });

  it('prefers the stronger explanation, and does not re-draw the same conclusion every pass', () => {
    const { tw, baker, miller, raider, pl } = bakerWhoCannotBake(4105);
    // A weak premise (a mere absence) and a strong one (a killing) for the same stoppage.
    learn(tw.world, baker, {
      key: `absent:${miller.id}`, kind: 'event',
      claim: { eventId: 'e_abs', type: 'absence_noticed', actor: baker.id, target: miller.id, tick: tw.world.now, significance: 0.4 },
      confidence: 0.85, source: { type: 'inferred' },
    }, true);
    learn(tw.world, baker, {
      key: 'ev:e_kill', kind: 'event',
      claim: { eventId: 'e_kill', type: 'kill', actor: raider.id, target: miller.id, tick: tw.world.now, significance: 1 },
      confidence: 0.9, source: { type: 'told', from: raider.id },
    }, true);

    drawInferences(tw.world, baker);
    const why = causeOf(baker, shortfallKey(pl.bakery, 'flour'))!;
    expect(why.claim.becauseKey).toBe('ev:e_kill');
    expect(why.claim.rule).toBe('producer_dead');

    const grudgeAfterFirst = getRel(baker, raider.id).grudge;
    drawInferences(tw.world, baker);
    drawInferences(tw.world, baker);
    // Standing conclusions do not compound into a grievance by being thought again.
    expect(getRel(baker, raider.id).grudge).toBe(grudgeAfterFirst);
  });

  it('explains an upstream stoppage by the stoppage above it', () => {
    const tw = createTestWorld(4106, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const miller = addPerson(tw, 'Miller', 'miller', pl.millPos, { workId: pl.mill });

    noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    const upstream = noteWorkBlocked(tw.world, miller, pl.mill, 'grain', 'flour')!;
    tw.sim.tell(miller, baker, upstream);

    drawInferences(tw.world, baker);
    const why = causeOf(baker, shortfallKey(pl.bakery, 'flour'))!;
    expect(why.claim.rule).toBe('upstream_short');
    expect(why.claim.becauseKey).toBe(upstream.key);
    expect(why.claim.responsibleId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------

/**
 * The epistemic guarantees stated as a group, over the same standing shortage belief. Several of
 * them are also asserted in context above; this block exists so that if one is ever weakened, a
 * test whose NAME is the guarantee fails, rather than an incidental assertion inside a test about
 * something else.
 */
describe('Causal Society — provenance invariants', () => {
  it('never lets a belief get better by being passed along, however far or however often', () => {
    const tw = createTestWorld(4501, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const chain = ['A', 'B', 'C', 'D'].map((n, i) => addPerson(tw, n, 'farmer', v(14.5 + i * 0.5, 1, 4)));

    const origin = noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread')!;
    let teller: Person = baker;
    let tellerBelief = origin;
    const seen: { hops: number; confidence: number }[] = [{ hops: origin.hops, confidence: origin.confidence }];
    for (const listener of chain) {
      tw.sim.tell(teller, listener, tellerBelief);
      const heard = listener.knowledge[origin.key];
      // Each link: strictly one more hop, and never more confident than whoever told them.
      expect(heard.hops).toBe(tellerBelief.hops + 1);
      expect(heard.confidence).toBeLessThan(tellerBelief.confidence);
      expect(heard.source.type).toBe('told');
      expect(heard.source.from).toBe(teller.id);
      seen.push({ hops: heard.hops, confidence: heard.confidence });
      teller = listener; tellerBelief = heard;
    }
    // Monotonic the whole way down — no link anywhere in the chain recovers anything.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].hops).toBeGreaterThan(seen[i - 1].hops);
      expect(seen[i].confidence).toBeLessThan(seen[i - 1].confidence);
    }
    // Repetition is not evidence: hearing the same thing again from the same person changes
    // nothing at all, and hearing it back from someone further away cannot make it worse either.
    const mid = chain[1];
    const before = { ...mid.knowledge[origin.key] };
    tw.sim.tell(chain[0], mid, chain[0].knowledge[origin.key]);
    tw.sim.tell(chain[3], mid, chain[3].knowledge[origin.key]);
    expect(mid.knowledge[origin.key].hops).toBe(before.hops);
    expect(mid.knowledge[origin.key].confidence).toBe(before.confidence);
  });

  it('never lets a conclusion get firmer by being drawn again', () => {
    const tw = createTestWorld(4502, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const miller = addPerson(tw, 'Miller', 'miller', pl.millPos, { workId: pl.mill });
    const raider = addPerson(tw, 'Raider', 'bandit', v(30.5, 1, 30.5));
    noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    const premise = attackBelief(tw, baker, raider.id, miller.id, { confidence: 0.85, hops: 1 });

    drawInferences(tw.world, baker);
    const why = causeOf(baker, shortfallKey(pl.bakery, 'flour'))!;
    const first = { confidence: why.confidence, hops: why.hops };
    expect(first.confidence).toBeLessThan(premise.confidence);

    for (let i = 0; i < 5; i++) drawInferences(tw.world, baker);
    expect(why.confidence).toBe(first.confidence);
    expect(why.hops).toBe(first.hops);
    // ...and the conclusion is still no firmer than the weakest thing it rests on.
    expect(why.confidence).toBeLessThan(baker.knowledge[premise.key].confidence);
    expect(why.hops).toBeGreaterThanOrEqual(baker.knowledge[premise.key].hops);
  });

  it('gives a stoppage to nobody who neither saw it nor was told of it, in a real running world', () => {
    const tw = createTestWorld(4503, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const inTheRoom = addPerson(tw, 'InTheRoom', 'server', v(15, 1, 4), { workId: pl.bakery });
    const acrossTheVillage = addPerson(tw, 'AcrossTheVillage', 'farmer', v(36.5, 1, 36.5));
    const behindAWall = addPerson(tw, 'BehindAWall', 'smith', v(9, 1, 4));
    wall(tw, 10, 0, 12);
    face(inTheRoom, tw, pl.bakeryPos);
    face(behindAWall, tw, pl.bakeryPos);

    noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    step(tw, 3);

    const key = shortfallKey(pl.bakery, 'flour');
    expect(inTheRoom.knowledge[key]).toBeTruthy();          // line of sight
    expect(behindAWall.knowledge[key]).toBeUndefined();     // no line of sight
    expect(acrossTheVillage.knowledge[key]).toBeUndefined(); // out of range
    // Nobody without the belief carries a worry about it either.
    for (const p of [behindAWall, acrossTheVillage]) {
      expect(activeConcerns(p).some(c => c.kind === 'supply')).toBe(false);
      expect(causeOf(p, key)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('Causal Society — relationships follow from what people actually do', () => {
  it('moves a witness who cares about the person helped further than one who does not', () => {
    const tw = createTestWorld(4201, 40);
    const giver = addPerson(tw, 'Giver', 'merchant', v(10.5, 1, 10.5));
    const beneficiary = addPerson(tw, 'Beneficiary', 'farmer', v(11.5, 1, 10.5));
    const fond = addPerson(tw, 'Fond', 'server', v(12.5, 1, 10.5));
    const indifferent = addPerson(tw, 'Indifferent', 'smith', v(12.5, 1, 11.5));
    setRelTags(fond, beneficiary.id, 'sibling');
    getRel(fond, beneficiary.id).affection = 0.9;
    getRel(fond, beneficiary.id).familiarity = 0.9;
    for (const w of [fond, indifferent]) face(w, tw, v(11, 1, 10.5));

    const gift = makeItem(tw.world, 'bread', 'a loaf', { owner: giver.id });
    giver.inventory.push(gift.id); gift.holderId = giver.id;
    tw.sim.giveItem(giver, beneficiary, gift);
    step(tw, 1);

    const fondRel = getRel(fond, giver.id);
    const indifferentRel = getRel(indifferent, giver.id);
    expect(fondRel.affection).toBeGreaterThan(0);
    expect(indifferentRel.affection).toBeGreaterThan(0);
    expect(fondRel.affection).toBeGreaterThan(indifferentRel.affection);
    expect(fondRel.trust).toBeGreaterThan(indifferentRel.trust);
    // The one it was actually done for moves most of all.
    expect(getRel(beneficiary, giver.id).affection).toBeGreaterThan(fondRel.affection);
  });

  it('builds real trust out of repeated deliveries, and only for a requester who was there to see them', () => {
    const tw = createTestWorld(4202, 40);
    const pl = withTrades(tw);
    const miller = addPerson(tw, 'Miller', 'miller', pl.millPos, { workId: pl.mill });
    const absentee = addPerson(tw, 'Absentee', 'farmer', v(35.5, 1, 35.5), { workId: pl.mill });
    const hauler = addPerson(tw, 'Hauler', 'farmer', v(14.5, 1, 4));

    const deliver = (requester: Person) => {
      addPlaceStock(tw.world, 'grain', 6, pl.bakery, requester.id, undefined, 'seeded');
      const task = createHaulTask(tw.world, {
        resource: 'grain', quantity: 6, sourcePlaceId: pl.bakery, destPlaceId: pl.mill,
        reason: 'the mill wants grain', requesterId: requester.id, priority: 0.5,
      });
      claimHaulTask(tw.world, task, hauler);
      expect(loadHaulCargo(tw.world, task, hauler)).toBe(true);
      expect(depositHaulCargo(tw.world, task, hauler)).toBe(true);
    };

    deliver(miller);
    const afterOne = getRel(miller, hauler.id).trust;
    expect(afterOne).toBeGreaterThan(0);
    deliver(miller);
    deliver(miller);
    expect(getRel(miller, hauler.id).trust).toBeGreaterThan(afterOne);
    expect(getRel(miller, hauler.id).familiarity).toBeGreaterThan(0);

    // Someone who was nowhere near owes the hauler nothing they could know about.
    deliver(absentee);
    expect(absentee.relationships[hauler.id]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------

/**
 * CROSS-SYSTEM: the playable-life hand-interaction path (`sim/physical/hand.ts`, the entry point
 * the Unreal client's E key reaches) must produce exactly the ordinary social and perceptual
 * consequences an NPC doing the same thing produces. This is the integration seam between that
 * milestone and this one, and it is asserted by running the SAME theft twice — once by an NPC
 * through `Simulation.takeItem`, once by a controlled player through the bridge's own
 * `performHandInteraction` — into two identically generated worlds, and comparing what the
 * witness ends up holding. Nothing player-specific is introduced by this test; it exists to fail
 * if anything player-specific ever is.
 */
describe('Causal Society — a player action lands on the village like anybody else\'s', () => {
  function theftWorld(seed: number, takerControlled: boolean) {
    const tw = createTestWorld(seed, 40);
    const owner = addPerson(tw, 'Owner', 'farmer', v(20.5, 1, 20.5));
    const taker = addPerson(tw, 'Taker', 'traveler', v(10.5, 1, 10.5), {
      controlled: takerControlled,
      traits: { honesty: 0.5, courage: 0.5, sociability: 0.5 },
    });
    const witness = addPerson(tw, 'Witness', 'server', v(13.5, 1, 10.5), {
      traits: { honesty: 0.9, courage: 0.5, sociability: 0.5 },
    });
    face(witness, tw, v(10.5, 1, 10.5));
    const purse = makeItem(tw.world, 'ring', "Owner's ring", { owner: owner.id, pos: v(11.2, 1, 10.5) });
    return { tw, owner, taker, witness, purse };
  }

  it('gives a witness the same belief, the same worry and the same souring, whoever took it', () => {
    const npcRun = theftWorld(4601, false);
    npcRun.tw.sim.takeItem(npcRun.taker, npcRun.purse, 'theft', npcRun.owner.id);
    step(npcRun.tw, 2);

    const playerRun = theftWorld(4601, true);
    const offer = handInteractions(playerRun.tw.sim, playerRun.taker).find(a => a.kind === 'steal');
    expect(offer, 'the hand path must offer the same taking an NPC can perform').toBeTruthy();
    expect(performHandInteraction(playerRun.tw.sim, playerRun.taker, offer!.id)).toBe('accepted');
    step(playerRun.tw, 2);

    for (const run of [npcRun, playerRun]) {
      const belief = Object.values(run.witness.knowledge)
        .find(k => k.kind === 'event' && k.claim.type === 'theft' && k.claim.actor === run.taker.id);
      expect(belief, 'the witness saw it happen').toBeTruthy();
      expect(belief!.source.type).toBe('witnessed');
      expect(belief!.hops).toBe(0);
      // It meant something to them, and their regard for the taker moved against them.
      expect(appraiseClaim(run.tw.world, run.witness, belief!).weight).toBeGreaterThan(0);
      expect(getRel(run.witness, run.taker.id).trust).toBeLessThan(0);
      expect(getRel(run.witness, run.taker.id).grudge).toBeGreaterThan(0);
      // ...and the world recorded a real theft with the taker named as the actor.
      expect(run.tw.world.events.some(e => e.type === 'theft' && e.actor === run.taker.id)).toBe(true);
    }

    // The two are not merely both non-zero — they are the SAME, to six places, because the same
    // code ran on the same world. Any player-specific branch anywhere in perception, appraisal or
    // reaction would separate these numbers.
    const fingerprint = (run: ReturnType<typeof theftWorld>) => {
      const rel = getRel(run.witness, run.taker.id);
      const belief = Object.values(run.witness.knowledge)
        .find(k => k.kind === 'event' && k.claim.type === 'theft' && k.claim.actor === run.taker.id)!;
      return {
        trust: rel.trust, grudge: rel.grudge, affection: rel.affection, fear: rel.fear, respect: rel.respect,
        confidence: belief.confidence, hops: belief.hops, source: belief.source.type,
        weight: appraiseClaim(run.tw.world, run.witness, belief).weight,
        concerns: activeConcerns(run.witness).map(c => c.kind).sort().join(','),
        ownerAfter: run.purse.ownerId === run.owner.id,
      };
    };
    expect(fingerprint(playerRun)).toEqual(fingerprint(npcRun));
    expect(playerRun.purse.holderId).toBe(playerRun.taker.id);
  });

  it('leaves the player their own mind: the taker forms no worry about their own deed either way', () => {
    // `formConcerns`/`drawInferences` skip a controlled entity for the pre-existing reason every
    // cognition path does — a player's beliefs are the player's own, not because a different rule
    // applies to them. The NPC taker forms nothing about it either, because an appraisal of one's
    // own theft proposes no concern.
    const npcRun = theftWorld(4602, false);
    npcRun.tw.sim.takeItem(npcRun.taker, npcRun.purse, 'theft', npcRun.owner.id);
    step(npcRun.tw, 2);
    expect(activeConcerns(npcRun.taker).some(c => c.aboutId === npcRun.taker.id)).toBe(false);

    const playerRun = theftWorld(4602, true);
    const offer = handInteractions(playerRun.tw.sim, playerRun.taker).find(a => a.kind === 'steal')!;
    performHandInteraction(playerRun.tw.sim, playerRun.taker, offer.id);
    step(playerRun.tw, 2);
    expect(activeConcerns(playerRun.taker)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Causal Society — the trace', () => {
  it('walks a worry back through the belief that justifies it to the canonical stoppage', () => {
    const tw = createTestWorld(4301, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });

    noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    const concern = activeConcerns(baker).find(c => c.kind === 'supply')!;
    const chain = explainConcern(tw.world, baker, concern);

    expect(chain[0].kind).toBe('concern');
    expect(chain.some(n => n.kind === 'belief' && n.ref === shortfallKey(pl.bakery, 'flour'))).toBe(true);
    expect(chain.find(n => n.ref === shortfallKey(pl.bakery, 'flour'))!.via).toBe('I found it so myself');
    expect(traceLines(chain).length).toBe(chain.length);
  });

  it('walks a decision back past the worker\'s own conclusion to the crime the world actually recorded', () => {
    const tw = createTestWorld(4302, 40);
    const pl = withTrades(tw);
    const baker = addPerson(tw, 'Baker', 'baker', pl.bakeryPos, { workId: pl.bakery });
    const miller = addPerson(tw, 'Miller', 'miller', pl.millPos, { workId: pl.mill });
    const raider = addPerson(tw, 'Raider', 'bandit', v(30.5, 1, 30.5));

    noteWorkBlocked(tw.world, baker, pl.bakery, 'flour', 'bread');
    attackBelief(tw, baker, raider.id, miller.id, { confidence: 0.9, hops: 1 });
    drawInferences(tw.world, baker);

    const goal = {
      type: 'haul' as const, utility: 0.7, reasons: ['flour is needed at the bakery'],
      createdAt: tw.world.now, key: 'haul:x', data: { resource: 'flour' as const },
    };
    const chain = explainGoal(tw.world, baker, goal);
    const kinds = chain.map(n => n.kind);
    expect(kinds[0]).toBe('goal');
    expect(kinds).toContain('concern');
    expect(kinds).toContain('cause');
    // ...and the conclusion names, as its own next link, the second-hand account it rests on.
    const premise = chain.find(n => n.ref === 'ev:e_atk');
    expect(premise).toBeTruthy();
    expect(premise!.via).toContain('told by');
    expect(premise!.hops).toBe(1);

    // The relationship is explicable in the same terms — and it reads as a modest, purely
    // inferred coolness, not as the settled enmity of somebody who watched it happen.
    const relChain = explainRelationship(tw.world, baker, raider.id);
    expect(relChain[0].what).toContain('Raider');
    expect(relChain[0].via).toMatch(/trust -0\./);
    expect(relChain.some(n => n.ref === 'ev:e_atk')).toBe(true);
    expect(relChain.some(n => n.kind === 'cause')).toBe(true);
  });
});
