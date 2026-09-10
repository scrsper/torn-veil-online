import { introduce, knownName, perceivedName } from './people';
import type { Person, KnowledgeItem, Item, Desire } from '../core/types';
import { World } from '../core/world';
import { Simulation } from './agent';
import { getRel, describeRel, disposition, adjustRel, isClose } from './relationships';
import { describeClaim, isCrime, learn } from './knowledge';
import { realizeClaim, realizeTopic } from './realize';
import { selectTopic, foremostMatter } from './conversation';
import { activeConcerns, describeConcern } from './concern';
import { personalSituationView, situationsInvolving, describeSituation } from '../social/situation';
import { woundSeverity, SERIOUS_WOUND } from '../core/attributes';
import { memoriesAbout, recentMemories } from './memory';
import { formatRelativeTime } from '../core/time';
import { ITEM_LABEL } from '../world/factory';
import { foodForSaleBy, canAcceptHaul } from '../logistics/participation';
import { effectivePrice } from '../world/pricing';
import { stockAt as stockAtPlace } from '../world/stock';
import type { RefusalReason } from '../world/commerce';

/** What a seller says when the simulation refuses a sale — one line per canonical reason, so a
 * refusal is explained rather than silently doing nothing. */
function refusalLine(npc: Person, reason: RefusalReason): string {
  switch (reason) {
    case 'hostile': return `I'll not trade with you.`;
    case 'not_theirs': return `That's not mine to sell.`;
    case 'personal': return `That's not for sale. It's mine.`;
    case 'needed_for_work': return `I need that for my work.`;
    case 'committed': return `That one's spoken for.`;
    case 'last_food': return `${npc.traits.greed > 0.7 ? "I'd sooner eat than sell it." : "I've barely enough for myself."}`;
  }
}

export interface DialogueOption { label: string; next: () => DialogueState | null; }
export interface DialogueState { speaker: Person; lines: string[]; options: DialogueOption[]; }

/** Deterministic dialogue grounded in the simulation: identity, knowledge, memory, relationship, mood, goals. */
export class DialogueSystem {
  constructor(private world: World, private sim: Simulation) {}
  first(p: Person): string { return p.name.split(' ')[0]; }

  start(npc: Person, player: Person): DialogueState {
    const w = this.world; const r = getRel(npc, player.id); const body = w.primaryBody(npc.id);
    adjustRel(w, npc, player.id, { familiarity: 0.05 }, 'talked to', undefined, true);
    const crimes = Object.values(npc.knowledge).filter(k => k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && k.claim.actor === player.id);
    const lines: string[] = [];
    if (body?.pose === 'downed') lines.push(`*${npc.name} groans on the ground.* ...leave me be...`);
    else if (npc.hostile) lines.push(r.fear > 0.5 ? `Stay back. I've seen what you can do.` : `You've walked a long way to get robbed, friend. Turn out your purse.`);
    else if (crimes.length && (npc.occupation === 'guard' || npc.occupation === 'captain')) { const k = crimes[0]; lines.push(`${k.source.type === 'told' ? `${perceivedName(w, npc, k.source.from)} told me` : 'I know'} what you did to ${perceivedName(w, npc, k.claim.target)}. Don't think I've forgotten.`); }
    else if (r.fear > 0.5) lines.push(`*${this.first(npc)} backs away.* Please. I don't want any trouble.`);
    else if (r.grudge > 0.5) lines.push(`You have some nerve speaking to me${crimes.length ? ` after what you did to ${perceivedName(w, npc, crimes[0].claim.target)}` : ''}.`);
    else if (r.affection > 0.5) lines.push(`${this.first(npc) === 'Cedric' ? 'Friend' : 'Ah'}, it's you. Good to see you.`);
    else if (r.familiarity < 0.15) lines.push(this.strangerGreeting(npc));
    else lines.push(this.familiarGreeting(npc));
    // mood colour
    if (npc.emotions.fear > 0.4 && r.fear < 0.5) lines.push(`*${this.first(npc)} keeps glancing over ${npc.gender === 'f' ? 'her' : 'his'} shoulder.*`);
    else if (npc.emotions.sadness > 0.5) lines.push(`*${npc.gender === 'f' ? 'She' : 'He'} looks tired and sad.*`);
    else if (npc.emotions.anger > 0.5) lines.push(`*${npc.gender === 'f' ? 'She' : 'He'} is plainly angry.*`);
    return { speaker: npc, lines, options: this.options(npc, player) };
  }
  private strangerGreeting(npc: Person): string {
    const g = npc.mind.goal?.type; const t = npc.traits;
    // v0.9 §F audit: this used to attribute a specific claim to a named third party ("Pip says
    // you came over the bridge") that no one had said and that nothing in the simulation
    // recorded. A greeting may be curious; it may not report hearsay that never happened.
    if (npc.occupation === 'child') return `Are you the traveler? Did you come in over the bridge?`;
    if (npc.occupation === 'merchant') return `A new face. Everything has a price, and every price is fair.`;
    // v0.9 §F audit: fixed prices were quoted here that the pricing system (world/pricing.ts)
    // does not set and no one is bound by. An innkeeper may advertise; they may not quote a
    // number the world will not honour.
    if (npc.occupation === 'innkeeper') return `Welcome to the Boar, stranger. There's ale, there's stew, and gossip costs nothing.`;
    if (npc.occupation === 'priest') return `Peace on you, traveler. The Lantern-Bearer lights the road for all who walk it.`;
    if (npc.occupation === 'guard' || npc.occupation === 'captain') return `Stranger. Keep to the roads and keep your blade sheathed and we'll get along.`;
    if (g === 'work') return t.sociability > 0.5 ? `Don't get many strangers. What brings you to the Vale?` : `I'm working. Say what you want.`;
    return t.sociability > 0.5 ? `Hello there. You're the one who came in on the west road, aren't you?` : `Hm. Stranger.`;
  }
  private familiarGreeting(npc: Person): string {
    const g = npc.mind.goal; const w = this.world;
    // v0.9 §E: what is actually on this person's mind colours how they greet you — grounded in a
    // real concern and its real evidential basis, never in a mood adjective alone.
    const body = w.primaryBody(npc.id);
    if (body && woundSeverity(body) >= SERIOUS_WOUND) return `*${this.first(npc)} is favouring one side, badly.* ...what is it.`;
    if (g?.type === 'flee') return `Not now! Can't you see something's wrong?`;
    if (g?.type === 'report') return `I can't stop, I have to find the watch!`;
    if (g?.type === 'investigate') return `I'm looking into something. Have you seen anything strange?`;
    if (g?.type === 'work') return `Back again? I'm ${g.data?.label ?? 'working'}, but go on.`;
    if (g?.type === 'sleep') return `*yawns* It's late. What is it?`;
    if (g?.type === 'eat') return `Sit, sit. There's enough.`;
    // v0.9 §F audit: this asserted a fond memory of an unnamed woman regardless of who (if
    // anyone) this person had actually lost — invented history, in the most emotionally loaded
    // place in the whole dialogue system. It now names the real person this NPC is grieving,
    // drawn from their own grief concern (mind/concern.ts), and says nothing about them beyond
    // the fact of the loss when there is no such concern.
    if (g?.type === 'mourn') {
      const grief = activeConcerns(npc).filter(c => c.kind === 'grief' && c.subjectId).sort((a, b) => b.intensity - a.intensity)[0];
      return grief?.subjectId
        ? `*${this.first(npc)} does not look up from the grave.* ...${perceivedName(w, npc, grief.subjectId)}.`
        : `*${this.first(npc)} does not look up from the grave.*`;
    }
    // v0.9 §B: a person who has just walked across the village out of worry says so.
    if (g?.type === 'check_on' && g.targetEntity) return `Not now — I'm going to find ${perceivedName(w, npc, g.targetEntity)}.`;
    return `${this.first(npc) ? 'Traveler.' : ''} What can I do for you?`.trim() || `What can I do for you?`;
  }

  private options(npc: Person, player: Person): DialogueOption[] {
    const w = this.world; const opts: DialogueOption[] = [];
    const rel = getRel(npc, player.id);
    const hostileNow = npc.hostile && rel.fear < 0.5;
    if (hostileNow) { opts.push({ label: 'I don\'t think so.', next: () => { this.sim.say(npc, 'Then we do it the hard way.'); npc.mind.alarm = 1; getRel(npc, player.id).grudge = 1; return null; } }); opts.push({ label: 'Leave', next: () => null }); return opts; }
    opts.push({ label: "What's the news?", next: () => this.news(npc, player) });
    opts.push({ label: 'Who are you?', next: () => { introduce(w, npc, player); return { speaker: npc, lines: [this.identity(npc)], options: this.options(npc, player) }; } });
    if (!npc.knowledge['identity:' + player.id]) opts.push({ label: 'Introduce yourself', next: () => { introduce(w, player, npc); return { speaker: npc, lines: ['Good to meet you.'], options: this.options(npc, player) }; } });
    opts.push({ label: 'What do you think of me?', next: () => ({ speaker: npc, lines: [this.opinionOfPlayer(npc, player)], options: this.options(npc, player) }) });
    if (activeConcerns(npc).some(c => c.intensity > 0.15)) opts.push({ label: "What's troubling you?", next: () => this.troubles(npc, player) });
    opts.push({ label: 'Ask about someone…', next: () => this.askAboutMenu(npc, player) });
    // v0.10.1 Part VII: whether Trade is on the table is decided by whether this person actually
    // has anything they would sell (`world/commerce.ts`), not by whether their occupation is on a
    // list of shopkeeper job titles. A farmer with a surplus sack of grain can sell it; a smith
    // with nothing but his own tools cannot, and neither can a merchant who has sold out.
    const offers = this.sim.tradeOffers(npc, player);
    if (offers.length) opts.push({ label: 'Trade', next: () => this.trade(npc, player) });
    // Player embodiment: a meal bought the way a hungry NPC buys one (`buyFoodPortion` — scarcity
    // priced, one unit), and honest work offered by the person who actually raised the request
    // (logistics/participation.ts's `haulOffersFrom`) — the same Request an NPC hauler would take.
    if (this.sim.haulOffersFrom(npc).length || this.sim.activeHaulFor(player)) opts.push({ label: 'Any work going?', next: () => this.workMenu(npc, player) });
    const meal = foodForSaleBy(w, npc)[0];
    if (meal) { const price = effectivePrice(meal.type, meal.value ?? 2, meal.placeId ? stockAtPlace(w, meal.type, meal.placeId) : meal.quantity); opts.push({ label: `Buy a meal — ${meal.type} (${price}s)`, next: () => this.buyMeal(npc, player) }); }
    // v0.9 §F / Constitution §66: this option used to name one hardcoded debtor and one
    // hardcoded amount, so it read as an authored quest hook and would have said the same thing
    // about a completely different debt. Both are now resolved from canonical state: the debtor
    // from the creditor's own `collect_debt` desire, and the amount from the canonical `debt`
    // event this NPC actually holds a belief about. No grounded amount, no option.
    const debt = npc.desires.find(d => d.type === 'collect_debt' && !d.fulfilled);
    const owed = debt ? this.debtOwedTo(npc, debt) : null;
    if (debt && owed && player.wealth >= owed.amount) {
      opts.push({ label: `Pay ${perceivedName(w, npc, owed.debtorId)}'s ${owed.amount} silver for them`, next: () => this.payDebt(npc, player, debt, owed) });
    }
    if (player.inventory.length) opts.push({ label: 'Give something…', next: () => this.giveMenu(npc, player) });
    const known = Object.values(player.knowledge).filter(k => k.kind === 'event' && !k.sharedWith.includes(npc.id) && !npc.knowledge[k.key]);
    if (known.length) opts.push({ label: 'Tell them something…', next: () => this.tellMenu(npc, player) });
    if (rel.grudge > 0.2 || rel.fear > 0.3) opts.push({ label: 'Apologize', next: () => this.apologize(npc, player) });
    const desire = npc.desires.find(d => !d.fulfilled);
    if (desire) opts.push({ label: 'Is there anything you need?', next: () => this.hearDesire(npc, player, desire) });
    const wantedItems = Object.values(player.knowledge).filter(k => k.kind === 'fact' && k.claim.wantedItem && !w.person(k.claim.requesterId)?.desires.find(d => d.targetId === k.claim.itemId)?.fulfilled);
    if (wantedItems.length) opts.push({ label: 'Ask about an item…', next: () => this.askAboutItemMenu(npc, player, wantedItems) });
    opts.push({ label: 'Goodbye', next: () => null });
    return opts;
  }
  /**
   * v0.8 "The Legible World" §E: hearing a desire used to be pure flavor text with no lasting
   * effect on the player's own knowledge — there was no way to later ASK someone else where the
   * wanted item actually is. Learning it here (a real, grounded `fact` KnowledgeItem, exactly
   * the same `learn()` path any other acquired knowledge goes through) is what makes "Ask about
   * an item…" below possible, and is what a generated lost/stolen-property task needs to be
   * completable rather than a dead end after the first conversation.
   */
  private hearDesire(npc: Person, player: Person, desire: import('../core/types').Desire): DialogueState {
    const w = this.world;
    const line = desire.note + (desire.type === 'recover_item' ? ` I'd pay ${desire.reward} silver to whoever brings it.` : '');
    if (desire.type === 'recover_item' && desire.targetId) {
      learn(w, player, { key: `wanted:${desire.targetId}`, kind: 'fact', claim: { text: line, wantedItem: true, itemId: desire.targetId, requesterId: npc.id, reward: desire.reward }, confidence: 1, source: { type: 'told', from: npc.id } }, true);
    }
    return { speaker: npc, lines: [line], options: this.options(npc, player) };
  }
  private askAboutItemMenu(npc: Person, player: Person, wantedItems: KnowledgeItem[]): DialogueState {
    const w = this.world;
    const opts: DialogueOption[] = wantedItems.map(k => ({ label: perceivedName(w, npc, k.claim.itemId), next: () => ({ speaker: npc, lines: [this.aboutItem(npc, k.claim.itemId, k.claim.requesterId)], options: this.options(npc, player) }) }));
    opts.push({ label: 'Never mind', next: () => ({ speaker: npc, lines: ['Ask away.'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: ['Which one?'], options: opts };
  }
  /**
   * Grounded exactly like `about()` does for a person's last-known location: only ever states
   * what THIS npc's own knowledge (`loc:<itemId>`, real provenance, real staleness) actually
   * supports — never a fabricated or omniscient answer just because the simulation itself knows
   * where the item really is.
   */
  private aboutItem(npc: Person, itemId: string, requesterId: string): string {
    const w = this.world; const item = w.item(itemId);
    const requesterName = perceivedName(w, npc, requesterId);
    if (!item) return `I couldn't tell you. Ask ${requesterName}, maybe.`;
    const loc = npc.knowledge[`loc:${itemId}`];
    if (!loc) return `I've heard ${requesterName} is missing ${perceivedName(w, npc, itemId)}, but I couldn't say where it ended up.`;
    const where = loc.claim.placeId ? perceivedName(w, npc, loc.claim.placeId) : loc.claim.pos ? 'nearby' : 'somewhere';
    const src = loc.source.type === 'witnessed' ? 'I saw it there myself' : loc.source.type === 'heard' ? 'so I heard' : loc.source.from ? `${perceivedName(w, npc, loc.source.from)} told me` : 'so they say';
    const age = formatRelativeTime(loc.learnedAt, w.now);
    return `${perceivedName(w, npc, itemId)}? Last I know of it, it was at ${where}, ${age}. ${src}.`;
  }
  private identity(npc: Person): string {
    const w = this.world; const home = perceivedName(w, npc, npc.homeId); const work = npc.workId ? perceivedName(w, npc, npc.workId) : null;
    const fam = Object.entries(npc.relationships).filter(([, r]) => r.tags.some(t => ['spouse', 'child', 'parent'].includes(t))).map(([id, r]) => `${perceivedName(w, npc, id)} (my ${r.tags.find(t => ['spouse', 'child', 'parent'].includes(t))})`);
    return `I'm ${npc.name}${npc.title ? ', ' + npc.title : ''}, ${npc.age} years, the ${npc.occupation} here. I live at ${home}${work ? ` and work at ${work}` : ''}.${fam.length ? ` My family: ${fam.join(', ')}.` : ''} ${npc.bio}`;
  }
  private opinionOfPlayer(npc: Person, player: Person): string {
    const w = this.world; const r = getRel(npc, player.id); const mems = memoriesAbout(npc, player.id);
    const d = disposition(npc, player.id);
    let s = r.familiarity < 0.15 ? `I hardly know you.` : d > 0.4 ? `I think well of you.` : d < -0.3 ? `I don't trust you, and I'm not alone in that.` : `I've no strong feelings yet.`;
    if (r.fear > 0.4) s += ` You frighten me, if I'm honest.`;
    if (mems.length) s += ` I remember: ${mems.slice(0, 2).map(m => `${m.summary} (${formatRelativeTime(m.tick, w.now)})`).join('; ')}.`;
    return s + ` (${describeRel(r)})`;
  }
  /**
   * v0.9 §E: the same situation-aware selection ambient gossip uses (mind/conversation.ts), so
   * what an NPC volunteers to the player and what they say to each other cannot drift apart.
   * The threshold is lowered — the player explicitly ASKED, which is an invitation a passer-by
   * has not extended — but not to zero: an NPC with nothing relevant to say still says so
   * rather than reciting the highest-significance row in their knowledge map.
   */
  private news(npc: Person, player: Person): DialogueState {
    const w = this.world;
    const topic = selectTopic(w, npc, player, { ignoreListenerKnowledge: true, threshold: 0.12 });
    const lines: string[] = [];
    if (!topic) lines.push(`Nothing you haven't heard, I expect.`);
    else {
      const k = topic.k;
      lines.push(realizeTopic(w, npc, topic));
      k.sharedWith.push(player.id);
      learn(w, player, { key: k.key, kind: k.kind, claim: { ...k.claim }, confidence: k.confidence * 0.8, source: { type: 'told', from: npc.id }, hops: k.hops + 1, summary: describeClaim(w, k, npc) }, true);
      // The supporting facts the NPC actually said out loud travel to the player as well, with
      // their own provenance — otherwise the player hears a claim they cannot then repeat or act
      // on, which is exactly the "dialogue-only knowledge" the Constitution forbids.
      for (const s of topic.supporting) {
        if (s.sharedWith.includes(player.id)) continue;
        s.sharedWith.push(player.id);
        learn(w, player, { key: s.key, kind: s.kind, claim: { ...s.claim }, confidence: s.confidence * 0.8, source: { type: 'told', from: npc.id }, hops: s.hops + 1, summary: describeClaim(w, s) }, true);
      }
      w.emit('told', { actor: npc.id, target: player.id, pos: w.primaryBody(npc.id)?.pos, significance: 0.2, data: { key: k.key, score: Math.round(topic.score * 100) / 100, reasons: topic.reasons }, summary: `${npc.name} told the Traveler: "${describeClaim(w, k, npc)}"` });
    }
    return { speaker: npc, lines, options: this.options(npc, player) };
  }

  /**
   * v0.9 §B/§E: "What's troubling you?" — the player-facing window onto what a person is actually
   * CARRYING (mind/concern.ts), as distinct from what they happen to know. Every line is a real
   * concern with a real evidential basis; a person with nothing on their mind says so.
   */
  private troubles(npc: Person, player: Person): DialogueState {
    const w = this.world;
    const concerns = activeConcerns(npc).filter(c => c.intensity > 0.15).sort((a, b) => b.intensity - a.intensity);
    const lines: string[] = [];
    if (!concerns.length) lines.push(`Nothing I'd trouble you with.`);
    else {
      const c = concerns[0];
      lines.push(`${describeConcern(w, c).replace(/^worried/, "I'm worried").replace(/^wary/, "I'm wary").replace(/^set on/, "I want").replace(/^after/, "I'm after").replace(/^short-handed/, "We're short-handed").replace(/^grieving/, "I'm grieving")}. ${c.reasons[0] ?? ''}`.trim());
      const matter = foremostMatter(w, npc);
      if (matter && matter.k.key === c.basisKeys[0]) lines.push(realizeTopic(w, npc, matter));
      if (concerns[1]) lines.push(`And ${describeConcern(w, concerns[1])}.`);
    }
    return { speaker: npc, lines, options: this.options(npc, player) };
  }
  private askAboutMenu(npc: Person, player: Person): DialogueState {
    const w = this.world; const known = Object.entries(npc.relationships).filter(([id, r]) => r.familiarity > 0.1 && id !== player.id && w.person(id)).sort((a, b) => Math.abs(disposition(npc, b[0])) - Math.abs(disposition(npc, a[0]))).slice(0, 12);
    const opts: DialogueOption[] = known.map(([id]) => ({ label: knownName(player, id), next: () => ({ speaker: npc, lines: [this.about(npc, id)], options: this.options(npc, player) }) }));
    opts.push({ label: 'Never mind', next: () => ({ speaker: npc, lines: ['Ask away.'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: ['Who do you want to know about?'], options: opts };
  }
  private about(npc: Person, id: string): string {
    const w = this.world; const o = w.person(id)!; const r = getRel(npc, id); const facts = Object.values(npc.knowledge).filter(k => k.kind === 'event' && (k.claim.actor === id || k.claim.target === id)).sort((a, b) => (b.claim.significance ?? 0) - (a.claim.significance ?? 0)).slice(0, 2);
    let s = `${knownName(npc, id)}? `;
    if (r.tags.length) s += `${o.gender === 'f' ? 'She' : 'He'}'s my ${r.tags.filter(t => t !== 'employer' && t !== 'employee').join(' and ') || r.tags[0]}. `;
    const d = disposition(npc, id); s += d > 0.5 ? `I'd trust ${o.gender === 'f' ? 'her' : 'him'} with my life. ` : d > 0.2 ? `Good sort. ` : d < -0.4 ? `Don't get me started. ` : d < -0.1 ? `We don't get on. ` : ``;
    if (r.fear > 0.4) s += `Frightens me, truth be told. `;
    if (facts.length) s += facts.map(k => realizeClaim(w, npc, k)).join(' ');
    // v0.9 §G: an unsettled matter about this person reads differently from one that has been
    // dealt with — and the speaker may only say it is dealt with if THEY have heard so
    // (`personalSituationView` reads their own knowledge, never `Situation.status`).
    const matters = situationsInvolving(w, id)
      .map(sit => ({ sit, view: personalSituationView(w, npc, sit) }))
      .filter(x => x.view.status !== 'unknown')
      .sort((a, b) => b.view.relevance - a.view.relevance);
    const top = matters[0];
    if (top) {
      s += top.view.status === 'resolved'
        ? ` That business — ${describeSituation(w, top.sit)} — is settled now (${top.view.resolution}).`
        : ` And ${describeSituation(w, top.sit)}, which is still not put right.`;
    }
    // A first-hand belief about their physical state, if this speaker has one.
    const state = npc.knowledge[`state:${id}`];
    if (state && w.now - state.learnedAt < 86400 * 2 && state.claim.state !== 'unharmed') s += ` ${state.claim.text}, last I saw ${o.gender === 'f' ? 'her' : 'him'}.`;
    const loc = npc.knowledge[`loc:${id}`]; if (loc && w.now - loc.learnedAt < 3600 * 3) s += ` Last I saw ${o.gender === 'f' ? 'her' : 'him'} ${loc.claim.placeId ? 'at ' + perceivedName(w, npc, loc.claim.placeId) : 'about'}, ${formatRelativeTime(loc.learnedAt, w.now)}.`;
    return s;
  }
  /**
   * v0.10.1 Parts VI/VII: what is on the table comes from `world/commerce.ts`, which reads the
   * canonical world — who owns it, where it is sitting, what is already promised elsewhere, what
   * they need themselves. There is no shop inventory anywhere in this file, and no per-occupation
   * stock list: this menu renders whatever `tradeOffers` says, and the refusals it shows are the
   * ones the simulation actually gave.
   *
   * Buying goes through the Simulation's own transaction functions — `buyUnits` for a stack (the
   * same `purchaseUnits` a hungry NPC's food purchase uses) and `buyItem` for a whole object.
   * Both re-check willingness at the moment of sale, so a menu drawn a minute ago cannot complete
   * a trade the seller would now refuse.
   */
  /** Open straight into the Trade menu — the client's "Trade" prompt on a selected person. Same
   * state the `Trade` option produces; the shortcut skips the greeting, not any of the rules. */
  startTrade(npc: Person, player: Person): DialogueState { return this.trade(npc, player); }
  private trade(npc: Person, player: Person): DialogueState {
    const w = this.world;
    const offers = this.sim.tradeOffers(npc, player);
    if (!offers.length) {
      const refusals = this.sim.tradeRefusals(npc, player);
      const hostile = refusals.find(r => r.reason === 'hostile');
      if (hostile) return { speaker: npc, lines: [`I'll not trade with you. Get out.`], options: this.options(npc, player) };
      const first = refusals[0];
      return { speaker: npc, lines: [first ? `Nothing for sale — ${first.note}.` : `I've nothing to sell just now.`], options: this.options(npc, player) };
    }
    const opts: DialogueOption[] = offers.slice(0, 8).map(o => {
      const stack = o.item.quantity > 1;
      const label = stack
        ? `Buy ${o.item.type} (${o.unitPrice}s each, ${o.available} to be had)`
        : `Buy ${o.item.name} (${o.unitPrice}s)`;
      return {
        label,
        next: () => {
          if (stack) {
            const r = this.sim.buyUnits(player, npc, o.item, 1);
            if (!r.units) return { speaker: npc, lines: [r.refused ? refusalLine(npc, r.refused) : `You haven't the coin.`], options: this.options(npc, player) };
            adjustRel(w, npc, player.id, { affection: 0.05, trust: 0.05 }, 'traded', r.event?.id);
            return { speaker: npc, lines: [`${r.units} ${o.item.type}, ${r.paid} silver. ${npc.traits.greed > 0.7 ? 'Pleasure doing business.' : 'Fair price.'}`], options: this.options(npc, player) };
          }
          const ev = this.sim.buyItem(player, npc, o.item);
          if (!ev) return { speaker: npc, lines: [player.wealth < o.unitPrice ? `You haven't the coin.` : `I've changed my mind about that one.`], options: this.options(npc, player) };
          adjustRel(w, npc, player.id, { affection: 0.05, trust: 0.05 }, 'traded', ev.id);
          return { speaker: npc, lines: [`Done. ${npc.traits.greed > 0.7 ? 'Pleasure doing business.' : 'Fair price.'}`], options: this.options(npc, player) };
        },
      };
    });
    // Selling TO them: the mirror of the same rules. They will not knowingly buy what someone
    // else owns, and `sellItem` conserves the money and the object.
    const markup = 1 + npc.traits.greed * 0.5 - Math.max(0, disposition(npc, player.id)) * 0.3;
    for (const id of player.inventory) {
      const it = w.item(id); if (!it || it.type === 'coins' || it.type === 'dagger') continue;
      if (it.ownerId && it.ownerId !== player.id && npc.knowledge[`owner:${it.id}`]) continue;
      if (it.haulTaskId) continue;
      const price = Math.max(1, Math.round(it.value * 0.5 / markup));
      opts.push({ label: `Sell ${it.name} (${price}s)`, next: () => {
        const spot = w.place(npc.workId)?.anchors.find(a => a.kind === 'display');
        const pos = spot ? { x: spot.pos.x + 0.5, y: spot.pos.y, z: spot.pos.z + 0.5 } : { ...w.primaryBody(npc.id)!.pos };
        const ev = this.sim.sellItem(player, npc, it, price, pos, npc.workId ?? undefined);
        if (!ev) return { speaker: npc, lines: [`I haven't the coin for that.`], options: this.options(npc, player) };
        return { speaker: npc, lines: [`I'll take it. ${price} silver.`], options: this.options(npc, player) };
      } });
    }
    opts.push({ label: 'Nothing today', next: () => ({ speaker: npc, lines: ['Suit yourself.'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: [`Have a look. You've ${player.wealth} silver.`], options: opts };
  }

  /** Honest work: open haul Requests this person speaks for. Accepting is `claimHaulTask` via
   * participation.ts — the identical claim an NPC hauler makes; loading, carrying, depositing
   * and the wage all then happen through the same functions and the same conservation rules. */
  private workMenu(npc: Person, player: Person): DialogueState {
    const w = this.world; const mine = this.sim.activeHaulFor(player);
    if (mine) {
      const carrying = mine.carried > 0;
      return { speaker: npc, lines: [`You've already taken on carrying ${mine.resource} to ${perceivedName(w, npc, mine.destPlaceId)}. ${carrying ? 'Get it there first.' : `Fetch it from ${perceivedName(w, npc, mine.sourcePlaceId)} first.`}`], options: this.options(npc, player) };
    }
    if (!canAcceptHaul(player)) return { speaker: npc, lines: ['Not for the likes of you, not today.'], options: this.options(npc, player) };
    const offers = this.sim.haulOffersFrom(npc);
    if (!offers.length) return { speaker: npc, lines: ['Nothing needs carrying just now.'], options: this.options(npc, player) };
    const opts: DialogueOption[] = offers.slice(0, 6).map(o => ({
      label: `Carry ${o.task.quantity} ${o.task.resource} from ${o.source.name} to ${o.destination.name} (${o.request.reward}s)`,
      next: () => {
        if (!this.sim.acceptHaul(player, o.task)) return { speaker: npc, lines: ['Someone else has it in hand.'], options: this.options(npc, player) };
        return { speaker: npc, lines: [`Good. ${o.task.reason.charAt(0).toUpperCase() + o.task.reason.slice(1)}. Fetch it from ${o.source.name}, bring it to ${o.destination.name}, and ${perceivedName(w, npc, o.request.requesterId) === npc.name ? "I'll" : `${perceivedName(w, npc, o.request.requesterId)} will`} pay ${o.request.reward} silver when it's all there.`], options: this.options(npc, player) };
      },
    }));
    opts.push({ label: 'Not today', next: () => ({ speaker: npc, lines: ['Suit yourself.'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: [`There's carrying to be done, if your back is up to it. You've ${player.wealth} silver.`], options: opts };
  }
  /** A single meal through `buyFoodPortion` — the NPC purchase path (scarcity-priced, real stock,
   * real wealth transfer), not a player shop screen. */
  private buyMeal(npc: Person, player: Person): DialogueState {
    const w = this.world; const r = getRel(npc, player.id);
    if (r.fear > 0.45 || r.grudge > 0.5) return { speaker: npc, lines: [`I'll not serve you. Get out.`], options: this.options(npc, player) };
    const before = player.wealth;
    const got = this.sim.buyMeal(player, npc, 1);
    if (!got) return { speaker: npc, lines: [player.wealth < 1 ? `You haven't the coin.` : `Nothing left to sell you.`], options: this.options(npc, player) };
    adjustRel(w, npc, player.id, { affection: 0.03, trust: 0.03 }, 'traded');
    return { speaker: npc, lines: [`${got.type.charAt(0).toUpperCase() + got.type.slice(1)}, ${before - player.wealth} silver. Eat it while it's fresh.`], options: this.options(npc, player) };
  }
  /** What this creditor actually believes they are owed, and by whom — from their own
   * `collect_debt` desire (the debtor) and a canonical `debt` event they hold a belief about
   * (the amount). Returns null when either is missing: a debt no one can name a figure for is
   * not something the player can settle on someone's behalf. */
  private debtOwedTo(npc: Person, debt: Desire): { debtorId: string; amount: number } | null {
    if (!debt.targetId) return null;
    const record = Object.values(npc.knowledge).find(k => k.kind === 'event' && k.claim.type === 'debt'
      && k.claim.actor === debt.targetId && k.claim.target === npc.id && typeof k.claim.amount === 'number');
    if (!record) return null;
    return { debtorId: debt.targetId, amount: record.claim.amount as number };
  }
  private payDebt(npc: Person, player: Person, debt: Desire, owed: { debtorId: string; amount: number }): DialogueState {
    const w = this.world;
    if (player.wealth < owed.amount) return { speaker: npc, lines: [`You haven't ${owed.amount} silver on you.`], options: this.options(npc, player) };
    player.wealth -= owed.amount; npc.wealth += owed.amount; debt.fulfilled = true;
    const debtor = perceivedName(w, npc, owed.debtorId);
    // `onBehalfOf` names whose obligation this discharged — without it the settlement could not
    // be matched to the ongoing matter it settles (social/situation.ts's 'pair_or_behalf'), since
    // the person handing over the coin is not the person who owed it.
    const ev = w.emit('debt_paid', { actor: player.id, target: npc.id, pos: w.primaryBody(npc.id)?.pos, significance: 0.5, visibility: 10, data: { onBehalfOf: owed.debtorId, amount: owed.amount }, summary: `the Traveler paid ${npc.name} the ${owed.amount} silver ${debtor} owed` });
    adjustRel(w, npc, player.id, { affection: 0.4, trust: 0.4, respect: 0.2 }, 'paid a debt', ev.id);
    return { speaker: npc, lines: [`Well! ${owed.amount} silver, counted. I'll not forget this. ${debtor} can keep his miserable hide.`], options: this.options(npc, player) };
  }
  private giveMenu(npc: Person, player: Person): DialogueState {
    const w = this.world;
    const opts: DialogueOption[] = player.inventory.map(id => w.item(id)!).filter(Boolean).map(it => ({ label: `${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`, next: () => {
      const ev = this.sim.giveItem(player, npc, it); const line = it.ownerId === npc.id && ev.type === 'returned_item' ? (npc.speech?.text ?? `That's mine! Thank you.`) : `${it.type === 'bread' || it.type === 'pie' || it.type === 'cheese' ? 'Food! Kind of you.' : it.type === 'flowers' ? 'Flowers? For me?' : 'A gift? Well. Thank you.'}`;
      if (ev.type === 'gift') adjustRel(w, npc, player.id, { affection: 0.15, trust: 0.1 }, 'received a gift', ev.id);
      return { speaker: npc, lines: [line], options: this.options(npc, player) }; } }));
    opts.push({ label: 'Never mind', next: () => ({ speaker: npc, lines: ['?'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: ['What do you have?'], options: opts };
  }
  private tellMenu(npc: Person, player: Person): DialogueState {
    const w = this.world; const known = Object.values(player.knowledge).filter(k => k.kind === 'event' && !k.sharedWith.includes(npc.id) && !npc.knowledge[k.key]).sort((a, b) => b.learnedAt - a.learnedAt).slice(0, 8);
    const opts: DialogueOption[] = known.map(k => ({ label: describeClaim(w, k, npc), next: () => { this.sim.tell(player, npc, k); return { speaker: npc, lines: [npc.speech?.text ?? (isCrime(k.claim.type, k.claim.intent) ? 'Is that so...' : 'Hm.')], options: this.options(npc, player) }; } }));
    opts.push({ label: 'Never mind', next: () => ({ speaker: npc, lines: ['Go on then.'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: ['What is it?'], options: opts };
  }
  private apologize(npc: Person, player: Person): DialogueState {
    const w = this.world; const r = getRel(npc, player.id); const ev = w.emit('apology', { actor: player.id, target: npc.id, pos: w.primaryBody(npc.id)?.pos, significance: 0.3, visibility: 8, summary: `the Traveler apologised to ${npc.name}` });
    const accept = npc.traits.honesty * 0.3 + (1 - npc.traits.aggression) * 0.4 + r.affection * 0.3 > 0.4 + r.grudge * 0.5;
    if (accept) { adjustRel(w, npc, player.id, { grudge: -0.25, fear: -0.15, trust: 0.1 }, 'accepted apology', ev.id); return { speaker: npc, lines: [`...Well. Words are cheap, but I'll take them. Don't make me regret it.`], options: this.options(npc, player) }; }
    adjustRel(w, npc, player.id, { grudge: -0.05 }, 'rejected apology', ev.id);
    return { speaker: npc, lines: [`Sorry? Sorry doesn't mend bones.`], options: this.options(npc, player) };
  }
}
export { ITEM_LABEL, recentMemories };
export type { Item, KnowledgeItem };
