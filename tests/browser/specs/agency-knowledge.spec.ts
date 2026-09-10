import type { BrowserSpec } from '../run';
import { startGame, movePlayerTo, aimCursorAt, advanceWorld, openDialogueWith, readDialogue, chooseDialogueOption } from '../helpers';

export const agencyKnowledge: BrowserSpec = {
  name: 'avatar knowledge inspection hides canonical identity and private mind state',
  run: async (page, baseURL) => {
    await startGame(page, 741, baseURL);
    const target = await page.evaluate(() => {
      const g = (window as any).game, w = g.world;
      const p = w.persons().find((p: any) => p.id !== w.playerId && p.alive);
      return { id: p.id, name: p.name, pos: { ...w.primaryBody(p.id).pos } };
    });
    await movePlayerTo(page, target.pos, 2);
    await aimCursorAt(page, { ...target.pos, y: target.pos.y + 1 });
    await advanceWorld(page, 0.3, 0.05);
    const before = await page.evaluate(id => (window as any).game.playerSession.beliefs('local', id), target.id);
    if (before.knownName || JSON.stringify(before).includes(target.name)) throw new Error('Proximity leaked canonical identity');
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => (document.getElementById('person-knowledge') as HTMLElement)?.style.display === 'block');
    const panel = await page.locator('#person-knowledge').innerText();
    if (!panel.includes('unfamiliar person') || /current goal|honesty|intellect|attributes|skills/.test(panel)) throw new Error(`Normal inspection leaked hidden truth: ${panel}`);
    await page.keyboard.press('Escape');
    await openDialogueWith(page, target.id);
    const dialogue = await readDialogue(page);
    if (dialogue.speaker.includes(target.name)) throw new Error('Dialogue header leaked the unknown name');
    await chooseDialogueOption(page, 'Who are you?');
    const after = await page.evaluate(id => (window as any).game.playerSession.beliefs('local', id), target.id);
    if (!after.knownName || after.name !== target.name || !after.identity.source.viaEvent) throw new Error('Introduction failed to create provenance-bearing identity');
  },
};
