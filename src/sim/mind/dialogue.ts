import type { Person, KnowledgeItem, Item } from '../core/types';
import { World } from '../core/world';
import { Simulation } from './agent';
import { getRel, describeRel, disposition, adjustRel, isClose } from './relationships';
import { describeClaim, isCrime, learn } from './knowledge';
import { memoriesAbout, recentMemories } from './memory';
import { formatRelativeTime } from '../core/time';
import { ITEM_LABEL } from '../world/factory';

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
    else if (crimes.length && (npc.occupation === 'guard' || npc.occupation === 'captain')) { const k = crimes[0]; lines.push(`${k.source.type === 'told' ? `${w.nameOf(k.source.from)} told me` : 'I know'} what you did to ${w.nameOf(k.claim.target)}. Don't think I've forgotten.`); }
    else if (r.fear > 0.5) lines.push(`*${this.first(npc)} backs away.* Please. I don't want any trouble.`);
    else if (r.grudge > 0.5) lines.push(`You have some nerve speaking to me${crimes.length ? ` after what you did to ${w.nameOf(crimes[0].claim.target)}` : ''}.`);
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
    if (npc.occupation === 'child') return `Are you the traveler? Pip says you came over the bridge. Did you fight any wolves?`;
    if (npc.occupation === 'merchant') return `A new face! Welcome to Crane's. Everything has a price, and every price is fair.`;
    if (npc.occupation === 'innkeeper') return `Welcome to the Boar, stranger. Ale's three coppers, stew's four, gossip's free.`;
    if (npc.occupation === 'priest') return `Peace on you, traveler. The Lantern-Bearer lights the road for all who walk it.`;
    if (npc.occupation === 'guard' || npc.occupation === 'captain') return `Stranger. Keep to the roads and keep your blade sheathed and we'll get along.`;
    if (g === 'work') return t.sociability > 0.5 ? `Don't get many strangers. What brings you to the Vale?` : `I'm working. Say what you want.`;
    return t.sociability > 0.5 ? `Hello there. You're the one who came in on the west road, aren't you?` : `Hm. Stranger.`;
  }
  private familiarGreeting(npc: Person): string {
    const g = npc.mind.goal; const w = this.world;
    if (g?.type === 'flee') return `Not now! Can't you see something's wrong?`;
    if (g?.type === 'report') return `I can't stop, I have to find the watch!`;
    if (g?.type === 'investigate') return `I'm looking into something. Have you seen anything strange?`;
    if (g?.type === 'work') return `Back again? I'm ${g.data?.label ?? 'working'}, but go on.`;
    if (g?.type === 'sleep') return `*yawns* It's late. What is it?`;
    if (g?.type === 'eat') return `Sit, sit. There's enough.`;
    if (g?.type === 'mourn') return `*${this.first(npc)} does not look up from the grave.* ...she liked the evenings best.`;
    return `${this.first(npc) ? 'Traveler.' : ''} What can I do for you?`.trim() || `What can I do for you?`;
  }

  private options(npc: Person, player: Person): DialogueOption[] {
    const w = this.world; const opts: DialogueOption[] = [];
    const rel = getRel(npc, player.id);
    const hostileNow = npc.hostile && rel.fear < 0.5;
    if (hostileNow) { opts.push({ label: 'I don\'t think so.', next: () => { this.sim.say(npc, 'Then we do it the hard way.'); npc.mind.alarm = 1; getRel(npc, player.id).grudge = 1; return null; } }); opts.push({ label: 'Leave', next: () => null }); return opts; }
    opts.push({ label: "What's the news?", next: () => this.news(npc, player) });
    opts.push({ label: 'Who are you?', next: () => ({ speaker: npc, lines: [this.identity(npc)], options: this.options(npc, player) }) });
    opts.push({ label: 'What do you think of me?', next: () => ({ speaker: npc, lines: [this.opinionOfPlayer(npc, player)], options: this.options(npc, player) }) });
    opts.push({ label: 'Ask about someone…', next: () => this.askAboutMenu(npc, player) });
    const forSale = w.items().filter(i => i.ownerId === npc.id && i.pos && !i.holderId);
    if (forSale.length && ['merchant', 'baker', 'innkeeper', 'smith', 'hunter', 'farmer', 'herbalist'].includes(npc.occupation)) opts.push({ label: 'Trade', next: () => this.trade(npc, player) });
    if (player.inventory.length) opts.push({ label: 'Give something…', next: () => this.giveMenu(npc, player) });
    const known = Object.values(player.knowledge).filter(k => k.kind === 'event' && !k.sharedWith.includes(npc.id) && !npc.knowledge[k.key]);
    if (known.length) opts.push({ label: 'Tell them something…', next: () => this.tellMenu(npc, player) });
    if (rel.grudge > 0.2 || rel.fear > 0.3) opts.push({ label: 'Apologize', next: () => this.apologize(npc, player) });
    const desire = npc.desires.find(d => !d.fulfilled);
    if (desire) opts.push({ label: 'Is there anything you need?', next: () => ({ speaker: npc, lines: [desire.note + (desire.type === 'recover_item' ? ` I'd pay ${desire.reward} silver to whoever brings it.` : '')], options: this.options(npc, player) }) });
    opts.push({ label: 'Goodbye', next: () => null });
    return opts;
  }
  private identity(npc: Person): string {
    const w = this.world; const home = w.nameOf(npc.homeId); const work = npc.workId ? w.nameOf(npc.workId) : null;
    const fam = Object.entries(npc.relationships).filter(([, r]) => r.tags.some(t => ['spouse', 'child', 'parent'].includes(t))).map(([id, r]) => `${w.nameOf(id)} (my ${r.tags.find(t => ['spouse', 'child', 'parent'].includes(t))})`);
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
  private news(npc: Person, player: Person): DialogueState {
    const w = this.world;
    const cands = Object.values(npc.knowledge).filter(k => k.kind === 'event' && !k.sharedWith.includes(player.id) && k.claim.actor !== player.id).sort((a, b) => (b.claim.significance ?? 0.3) - (a.claim.significance ?? 0.3) + (b.learnedAt - a.learnedAt) / 864000);
    const lines: string[] = [];
    if (!cands.length) lines.push(`Nothing you haven't heard, I expect.`);
    else { const k = cands[0]; const src = k.source.type === 'witnessed' ? 'I saw it myself' : k.source.type === 'heard' ? 'I heard it' : k.source.type === 'inferred' ? 'I worked it out' : k.source.from ? `${w.nameOf(k.source.from)} told me` : 'so they say'; lines.push(`${describeClaim(w, k)}${k.claim.tick ? `, ${formatRelativeTime(k.claim.tick, w.now)}` : ''}. ${src}${k.confidence < 0.6 ? ', though I only half believe it' : ''}.`); k.sharedWith.push(player.id);
      learn(w, player, { key: k.key, kind: k.kind, claim: { ...k.claim }, confidence: k.confidence * 0.8, source: { type: 'told', from: npc.id }, hops: k.hops + 1, summary: describeClaim(w, k) }, true);
      w.emit('told', { actor: npc.id, target: player.id, pos: w.primaryBody(npc.id)?.pos, significance: 0.2, data: { key: k.key }, summary: `${npc.name} told the Traveler: "${describeClaim(w, k)}"` }); }
    return { speaker: npc, lines, options: this.options(npc, player) };
  }
  private askAboutMenu(npc: Person, player: Person): DialogueState {
    const w = this.world; const known = Object.entries(npc.relationships).filter(([id, r]) => r.familiarity > 0.1 && id !== player.id && w.person(id)).sort((a, b) => Math.abs(disposition(npc, b[0])) - Math.abs(disposition(npc, a[0]))).slice(0, 12);
    const opts: DialogueOption[] = known.map(([id]) => ({ label: w.nameOf(id), next: () => ({ speaker: npc, lines: [this.about(npc, id)], options: this.options(npc, player) }) }));
    opts.push({ label: 'Never mind', next: () => ({ speaker: npc, lines: ['Ask away.'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: ['Who do you want to know about?'], options: opts };
  }
  private about(npc: Person, id: string): string {
    const w = this.world; const o = w.person(id)!; const r = getRel(npc, id); const facts = Object.values(npc.knowledge).filter(k => k.kind === 'event' && (k.claim.actor === id || k.claim.target === id)).sort((a, b) => (b.claim.significance ?? 0) - (a.claim.significance ?? 0)).slice(0, 2);
    let s = `${o.name}? ${o.alive ? `The ${o.occupation}.` : `Dead, gods rest ${o.gender === 'f' ? 'her' : 'him'}.`} `;
    if (r.tags.length) s += `${o.gender === 'f' ? 'She' : 'He'}'s my ${r.tags.filter(t => t !== 'employer' && t !== 'employee').join(' and ') || r.tags[0]}. `;
    const d = disposition(npc, id); s += d > 0.5 ? `I'd trust ${o.gender === 'f' ? 'her' : 'him'} with my life. ` : d > 0.2 ? `Good sort. ` : d < -0.4 ? `Don't get me started. ` : d < -0.1 ? `We don't get on. ` : ``;
    if (r.fear > 0.4) s += `Frightens me, truth be told. `;
    if (facts.length) s += facts.map(k => `${describeClaim(w, k)} (${k.source.type === 'told' ? `${w.nameOf(k.source.from)} told me` : k.source.type})`).join('. ') + '.';
    const loc = npc.knowledge[`loc:${id}`]; if (loc && w.now - loc.learnedAt < 3600 * 3) s += ` Last I saw ${o.gender === 'f' ? 'her' : 'him'} ${loc.claim.placeId ? 'at ' + w.nameOf(loc.claim.placeId) : 'about'}, ${formatRelativeTime(loc.learnedAt, w.now)}.`;
    return s;
  }
  private trade(npc: Person, player: Person): DialogueState {
    const w = this.world; const r = getRel(npc, player.id);
    if (r.fear > 0.45 || r.grudge > 0.5) return { speaker: npc, lines: [`I'll not trade with you. Get out.`], options: this.options(npc, player) };
    const goods = w.items().filter(i => i.ownerId === npc.id && i.pos && !i.holderId);
    const coins = player.inventory.map(id => w.item(id)).find(i => i?.type === 'coins');
    const markup = 1 + npc.traits.greed * 0.5 - Math.max(0, disposition(npc, player.id)) * 0.3;
    const opts: DialogueOption[] = goods.slice(0, 8).map(it => { const price = Math.max(1, Math.round(it.value * markup)); return { label: `Buy ${it.name} (${price}s)`, next: () => { const ev = this.sim.buyItem(player, npc, it, price); if (!ev) { return { speaker: npc, lines: [`You haven't the coin.`], options: this.options(npc, player) }; } adjustRel(w, npc, player.id, { affection: 0.05, trust: 0.05 }, 'traded', ev.id); return { speaker: npc, lines: [`Done. ${npc.traits.greed > 0.7 ? 'Pleasure doing business.' : 'Fair price.'}`], options: this.options(npc, player) }; } }; });
    // sell
    for (const id of player.inventory) { const it = w.item(id); if (!it || it.type === 'coins' || it.type === 'dagger') continue; if (it.ownerId && it.ownerId !== player.id && npc.knowledge[`owner:${it.id}`]) continue; const price = Math.max(1, Math.round(it.value * 0.5 / markup)); opts.push({ label: `Sell ${it.name} (${price}s)`, next: () => { const spot = w.place(npc.workId)?.anchors.find(a => a.kind === 'display'); const pos = spot ? { x: spot.pos.x + 0.5, y: spot.pos.y, z: spot.pos.z + 0.5 } : { ...w.primaryBody(npc.id)!.pos }; const ev = this.sim.sellItem(player, npc, it, price, pos, npc.workId ?? undefined); if (!ev) return { speaker: npc, lines: [`I haven't the coin for that.`], options: this.options(npc, player) }; return { speaker: npc, lines: [`I'll take it. ${price} silver.`], options: this.options(npc, player) }; } }); }
    opts.push({ label: 'Nothing today', next: () => ({ speaker: npc, lines: ['Suit yourself.'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: [`Have a look. You've ${coins?.quantity ?? 0} silver.`], options: opts };
  }
  private giveMenu(npc: Person, player: Person): DialogueState {
    const w = this.world;
    const opts: DialogueOption[] = player.inventory.map(id => w.item(id)!).filter(Boolean).map(it => ({ label: `${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`, next: () => {
      if (it.type === 'coins') { const debt = npc.desires.find(d => d.type === 'collect_debt' && !d.fulfilled); if (debt && it.quantity >= 20) { it.quantity -= 20; npc.wealth += 20; debt.fulfilled = true; const ev = w.emit('debt_paid', { actor: player.id, target: npc.id, pos: w.primaryBody(npc.id)?.pos, significance: 0.5, visibility: 10, summary: `the Traveler paid ${npc.name} Fenn's twenty silver` }); adjustRel(w, npc, player.id, { affection: 0.4, trust: 0.4, respect: 0.2 }, 'paid a debt', ev.id); return { speaker: npc, lines: [`Well! Twenty silver, counted. I'll not forget this. Fenn can keep his miserable hide.`], options: this.options(npc, player) }; } const n = Math.min(5, it.quantity); it.quantity -= n; npc.wealth += n; adjustRel(w, npc, player.id, { affection: 0.1, trust: 0.05 }, 'gave coins'); return { speaker: npc, lines: [`Coin? Well... thank you.`], options: this.options(npc, player) }; }
      const ev = this.sim.giveItem(player, npc, it); const line = it.ownerId === npc.id && ev.type === 'returned_item' ? (npc.speech?.text ?? `That's mine! Thank you.`) : `${it.type === 'bread' || it.type === 'pie' || it.type === 'cheese' ? 'Food! Kind of you.' : it.type === 'flowers' ? 'Flowers? For me?' : 'A gift? Well. Thank you.'}`;
      if (ev.type === 'gift') adjustRel(w, npc, player.id, { affection: 0.15, trust: 0.1 }, 'received a gift', ev.id);
      return { speaker: npc, lines: [line], options: this.options(npc, player) }; } }));
    opts.push({ label: 'Never mind', next: () => ({ speaker: npc, lines: ['?'], options: this.options(npc, player) }) });
    return { speaker: npc, lines: ['What do you have?'], options: opts };
  }
  private tellMenu(npc: Person, player: Person): DialogueState {
    const w = this.world; const known = Object.values(player.knowledge).filter(k => k.kind === 'event' && !k.sharedWith.includes(npc.id) && !npc.knowledge[k.key]).sort((a, b) => b.learnedAt - a.learnedAt).slice(0, 8);
    const opts: DialogueOption[] = known.map(k => ({ label: describeClaim(w, k), next: () => { this.sim.tell(player, npc, k); return { speaker: npc, lines: [npc.speech?.text ?? (isCrime(k.claim.type, k.claim.intent) ? 'Is that so...' : 'Hm.')], options: this.options(npc, player) }; } }));
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
