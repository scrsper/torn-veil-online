import type { BrowserSpec } from '../run';
import { startGame, advanceWorld, readCanonicalState, openDialogueWith, readDialogue, chooseDialogueOption } from '../helpers';

/**
 * v0.9 "definition of done": «I should be able to enter the game after this milestone, witness
 * or encounter the aftermath of a significant event, walk around town, and feel that different
 * people are actually living through the consequences of the same situation.»
 *
 * This drives the REAL client — the same index.html/main.ts a human plays — through the real
 * dialogue UI. It seeds ONE canonical assault (through `Simulation.applyHit`, the same method an
 * NPC or the player goes through) and then only observes: who ends up knowing, what they end up
 * carrying, and what they actually say when the player walks up and asks.
 *
 * The assertions are about materially different experience, not about phrasing: several people
 * must be carrying concerns, at least two must give the player DIFFERENT grounded accounts of
 * the same matter, and someone with a live worry must offer the "What's troubling you?" option
 * that a person with nothing on their mind does not.
 */
export const socialAftermath: BrowserSpec = {
  name: 'the aftermath of one assault is lived through differently by different people',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);
    await advanceWorld(page, 3600 * 8, 2);

    // ---- seed exactly one canonical event, through the canonical path.
    // Participants are chosen structurally in the page (an ordinary villager with a spouse and a
    // workmate; the most aggressive ordinary villager as the assailant) — no names anywhere.
    const parties = await page.evaluate(() => {
      const game = (window as any).game;
      const w = game.world;
      const ordinary = w.persons().filter((p: any) => p.alive && !(p.id === w.playerId) && !p.hostile
        && !['guard', 'captain', 'child', 'bandit', 'traveler'].includes(p.occupation));
      const subject = ordinary
        .filter((p: any) => Object.entries(p.relationships).some(([id, r]: any) => r.tags.includes('spouse') && w.person(id)?.alive)
          && !!p.workId && w.persons().some((q: any) => q.alive && q.id !== p.id && q.workId === p.workId))
        .sort((a: any, b: any) => (Object.keys(b.relationships).length - Object.keys(a.relationships).length) || a.id.localeCompare(b.id))[0];
      const actor = ordinary.filter((p: any) => p.id !== subject.id)
        .sort((a: any, b: any) => (b.traits.aggression - a.traits.aggression) || a.id.localeCompare(b.id))[0];
      const sb = w.primaryBody(subject.id); const ab = w.primaryBody(actor.id);
      const home = { x: ab.pos.x, y: ab.pos.y, z: ab.pos.z };
      ab.path = null; ab.pathGoal = null; ab.sitAnchor = null;
      ab.pos = { x: sb.pos.x + 1, y: sb.pos.y, z: sb.pos.z };
      for (let i = 0; i < 6 && sb.health > sb.maxHealth * 0.35; i++) game.sim.applyHit(actor, ab, sb, 12, 'injure');
      ab.pos = home;
      return { subjectId: subject.id, subjectName: subject.name, actorId: actor.id, actorName: actor.name };
    });

    await advanceWorld(page, 3600 * 20, 2);

    // ---- a matter is genuinely open in the world, and several people are living with it
    const state = await readCanonicalState(page, () => {
      const w = (window as any).game.world;
      const concerned = w.persons().filter((p: any) => p.alive && (p.mind.concerns ?? []).some((c: any) => c.status === 'active'));
      return {
        situations: w.situations.map((s: any) => `${s.kind}/${s.status}`),
        concernedCount: concerned.length,
        concernedIds: concerned.map((p: any) => p.id),
        kinds: [...new Set(concerned.flatMap((p: any) => p.mind.concerns.filter((c: any) => c.status === 'active').map((c: any) => c.kind)))],
      };
    });
    if (!state.situations.length) throw new Error('No situation was opened by a real assault');
    if (state.concernedCount < 2) throw new Error(`Expected several people to be carrying concerns, got ${state.concernedCount}`);
    if (state.kinds.length < 2) throw new Error(`Expected materially different kinds of concern, got ${JSON.stringify(state.kinds)}`);

    // ---- walk up to people and ask. Different people must give different grounded accounts.
    const accounts = new Map<string, string>();
    let sawTroublesOption = false;
    for (const id of state.concernedIds.slice(0, 6)) {
      await openDialogueWith(page, id);
      const opened = await readDialogue(page);
      if (!opened.open) throw new Error(`Dialogue did not open for ${id}`);
      if (opened.options.some(o => o.includes("What's troubling you?"))) {
        sawTroublesOption = true;
        await chooseDialogueOption(page, "What's troubling you?");
        const troubles = await readDialogue(page);
        if (!troubles.lines.join(' ').trim()) throw new Error('The "troubling you" answer was empty');
      }
      await chooseDialogueOption(page, "What's the news?");
      const news = await readDialogue(page);
      const text = news.lines.join(' ').trim();
      if (text) accounts.set(id, text);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(30);
    }

    if (!sawTroublesOption) throw new Error('No one with a live concern offered the "What\'s troubling you?" option');
    const distinct = new Set(accounts.values());
    if (distinct.size < 2) throw new Error(`Expected different people to describe things differently, got ${distinct.size} distinct account(s): ${[...distinct].join(' || ')}`);

    // ---- and no account may name a person the speaker has no belief about (v0.9 §F). Checked
    // against the speaker's OWN knowledge map, in the page, so this is a real grounding test
    // rather than a spot-check of phrasing.
    const ungrounded = await page.evaluate((payload: { accounts: [string, string][] }) => {
      const w = (window as any).game.world;
      const bad: string[] = [];
      for (const [speakerId, text] of payload.accounts) {
        const speaker = w.person(speakerId);
        const believedIds = new Set<string>([speakerId]);
        for (const k of Object.values(speaker.knowledge) as any[]) {
          for (const field of ['actor', 'target', 'item', 'entityId', 'placeId', 'requesterId']) if (k.claim?.[field]) believedIds.add(k.claim[field]);
          if (k.source?.from) believedIds.add(k.source.from);
        }
        for (const id of Object.keys(speaker.relationships)) believedIds.add(id);
        for (const other of w.persons()) {
          if (believedIds.has(other.id)) continue;
          if (text.includes(other.name)) bad.push(`${speaker.name} named ${other.name} with no belief involving them`);
        }
      }
      return bad;
    }, { accounts: [...accounts.entries()] });
    if (ungrounded.length) throw new Error(`Ungrounded claims in dialogue: ${ungrounded.join('; ')}`);

    console.log(`      ${parties.actorName} -> ${parties.subjectName}; ${state.concernedCount} people carrying concerns (${state.kinds.join(', ')}); ${distinct.size} distinct accounts`);
  },
};
